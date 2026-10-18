import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { checkProjectAccess } from "@/lib/rbac"
import { docxToPdf, pdfConfigured } from "@/lib/legal/pdf"
import { canWriteItem, getVaultActor } from "@/lib/vault"
import { resolveSheetAccess } from "@/lib/project-sheets"
import { firstTable, markdownBlocks, plainBlocks, renderDocx, renderXlsx, type Block } from "@/lib/gideon-file-render"
import { gideonFileBytes, gideonFileFor, gideonFileUrl, storeGideonFile } from "@/lib/gideon-files"
import { clip, str, PUBLIC_BASE } from "./util"
import { webError, type ExtraTool, type Input, type WebCall } from "./types"

/**
 * Files out of GIDEON (owner, 18 Oct 2026).
 *  - export_file: a Doc the person can open (Can view in its project), or text GIDEON wrote (Markdown), as DOCX or
 *    PDF (the DOCX converted by the Legal module's Gotenberg sidecar), or a table as XLSX. A project spreadsheet is
 *    exported by the Sheets page's own export (its link, after the same access check). The file goes into the
 *    person's GIDEON chat as a download only they can open; nothing in NEXUS changes, so there is no card.
 *  - save_file_to_vault: such a file into Z Vault — a card, applied through the Vault page's own upload as the person
 *    (shelf write rights, quota, unique names, realtime, audit).
 */

const MD_MAX = 200_000
const FORMATS = new Set(["pdf", "docx", "xlsx"])

type Source = { title: string; blocks: Block[]; table: [string[], unknown[][]] | null; from: string }

async function sourceOf(actor: User, input: Input): Promise<Source> {
  const docId = str(input.docId)
  if (docId) {
    const doc = await prisma.doc.findUnique({ where: { id: docId }, select: { title: true, projectId: true, contentText: true } })
    if (!doc || !(await checkProjectAccess(actor.id, doc.projectId, ["VIEWER"])).allowed) throw new Error("That doc does not exist or this person cannot open it.")
    const text = doc.contentText ?? ""
    // contentText keeps the doc's lines; Markdown-looking lines (#, -, |) render as such.
    const blocks = /^(#{1,6}\s|[-*]\s|\|)/m.test(text) ? markdownBlocks(text) : plainBlocks(text)
    const t = firstTable(blocks)
    return { title: str(input.title) ?? doc.title, blocks, table: t, from: `doc “${doc.title}”` }
  }
  const header = Array.isArray(input.columns) ? (input.columns as unknown[]).map((c) => String(c ?? "")) : null
  const rows = Array.isArray(input.rows) ? (input.rows as unknown[]).map((r) => (Array.isArray(r) ? r : [])) : null
  const md = typeof input.markdown === "string" ? input.markdown : typeof input.content === "string" ? input.content : typeof input.text === "string" ? input.text : ""
  if (md.length > MD_MAX) throw new Error("That text is too long for one file.")
  const blocks = md.trim() ? markdownBlocks(md) : []
  if (header && rows) blocks.push({ kind: "table", rows: [header, ...rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v))))] })
  if (!blocks.length) throw new Error("Give the content: docId (a NEXUS doc), markdown (text you wrote), or columns + rows (a table).")
  const table = header && rows ? ([header, rows] as [string[], unknown[][]]) : firstTable(blocks)
  return { title: str(input.title) ?? "GIDEON", blocks, table, from: "GIDEON answer" }
}

async function exportFile(actor: User, input: Input) {
  const format = (str(input.format) ?? "").toLowerCase().replace(/^\./, "")
  if (!FORMATS.has(format)) throw new Error("format is required: pdf, docx or xlsx.")
  // A project spreadsheet: the Sheets page's own export (same numbers as the grid), after the same access check.
  const sheetId = str(input.sheetId)
  if (sheetId) {
    if (format !== "xlsx") throw new Error("A spreadsheet exports as xlsx.")
    const access = await resolveSheetAccess(actor.id, sheetId, ["VIEWER"])
    if (!access.allowed) throw new Error("This person cannot open that spreadsheet.")
    const url = `/api/sheets/${sheetId}/export?format=xlsx`
    return { file: { name: `${access.sheet.name}.xlsx`, format: "xlsx", url }, link: `${PUBLIC_BASE}${url}`, note: "Give the person this download link as a Markdown link with the file name." }
  }
  const src = await sourceOf(actor, input)
  let bytes: Buffer
  if (format === "xlsx") {
    if (!src.table) throw new Error("XLSX needs a table: pass columns + rows (or Markdown with a | table |).")
    bytes = await renderXlsx(src.title, src.table[0], src.table[1])
  } else {
    const docx = await renderDocx(src.title, src.blocks)
    if (format === "docx") bytes = docx
    else {
      if (!pdfConfigured()) throw new Error("PDF is not set up on this server. Offer DOCX instead.")
      bytes = await docxToPdf(docx)
    }
  }
  const meta = await storeGideonFile(actor.id, src.title, format, bytes, src.from)
  const url = gideonFileUrl(meta.id)
  return {
    file: { fileId: meta.id, name: meta.name, format, size: meta.size, url },
    link: `${PUBLIC_BASE}${url}`,
    note: "Give the person this download link as a Markdown link with the file name (only they can open it, for 30 days). To keep it in Z Vault, nexus_save_file_to_vault with this fileId (a card).",
  }
}

async function vaultFolder(actor: User, name: string | undefined) {
  const va = await getVaultActor(actor.id)
  if (!va.workspaceId) throw new Error("This person has no Z Vault.")
  if (!name) {
    if (!(await canWriteItem(va, null))) throw new Error("This person cannot add files to the top of Z Vault. Ask which folder.")
    return { id: null as string | null, name: "Z Vault" }
  }
  const rows = await prisma.vaultItem.findMany({ where: { workspaceId: va.workspaceId, kind: "FOLDER", deletedAt: null, name: { contains: name, mode: "insensitive" } }, select: { id: true, name: true }, take: 10 })
  const ok = []
  for (const r of rows) if (await canWriteItem(va, r.id)) ok.push(r)
  const exact = ok.filter((r) => r.name.toLowerCase() === name.toLowerCase())
  const pick = exact.length ? exact : ok
  if (!pick.length) throw new Error(`No Z Vault folder named like "${name}" that this person can add files to.`)
  if (pick.length > 1) throw new Error(`Several Z Vault folders match: ${pick.map((p) => p.name).join(", ")}. Ask which one.`)
  return pick[0]
}

async function describeSave(actor: User, input: Input) {
  const id = str(input.fileId) ?? (str(input.url)?.match(/\/api\/gideon\/files\/([0-9a-f-]{36})/)?.[1] ?? undefined)
  if (!id) throw new Error("fileId is required (from nexus_export_file).")
  const meta = await gideonFileFor(actor.id, id)
  if (!meta) throw new Error("That file is not one GIDEON made for this person (or it is older than 30 days). Make it again with nexus_export_file.")
  const folder = await vaultFolder(actor, str(input.folder))
  return {
    summary: `Save “${meta.name}” to Z Vault › ${folder.name}`.slice(0, 300),
    diff: [
      { field: "File", to: `${meta.name} (${Math.max(1, Math.round(meta.size / 1024))} KB)` },
      { field: "Section", to: folder.name },
    ],
    store: { fileId: meta.id, ownerId: actor.id, parentId: folder.id, folderName: folder.name },
    note: "NOT saved yet. The card below shows the file and the folder; it is uploaded when the person taps Save. Say so in one sentence.",
  }
}

export const fileTools: Record<string, ExtraTool> = {
  export_file: { read: exportFile, stepArg: (i) => clip(str(i.title) ?? "", 60) || null },
  save_file_to_vault: {
    describe: describeSave,
    stepArg: (i) => str(i.folder) ?? null,
    // The Vault page's own single-shot upload (multipart), as the person. Needs WebCall.files (see report).
    web: async (input, call) => {
      // ownerId: the person the card was made for — the only one the proposals route lets apply it.
      const meta = await gideonFileFor(String(input.ownerId ?? ""), String(input.fileId ?? ""))
      if (!meta) return { ok: false, message: "The file is gone (older than 30 days). Ask GIDEON to make it again." }
      const bytes = await gideonFileBytes(meta)
      const c = {
        method: "POST",
        path: "/api/vault/upload",
        form: input.parentId ? { parentId: String(input.parentId) } : {},
        files: { file: { name: meta.name, type: meta.mime, base64: bytes.toString("base64") } },
      } as WebCall
      const r = await call(c)
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't save to Z Vault") }
      return { ok: true, link: "/vault", result: { vaultItemId: (r.body?.id as string | undefined) ?? null } }
    },
  },
}

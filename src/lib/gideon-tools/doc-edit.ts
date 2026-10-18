import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { bodyAccess, loadBody, type BodyKind } from "@/lib/block-bodies"
import { canonicalDoc, docToText, sanitizeDoc, type BlockDoc } from "@/lib/blockdoc"
import { editedDoc, type DocEditMode } from "@/lib/gideon-doc-apply"
import { clip, str, PUBLIC_BASE } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Edit an existing page (a project Doc, or a task's page body) through GIDEON (owner, 18 Oct 2026): append to it,
 * append to / replace one section, or add a section — ALWAYS on a card with the before → after of that part.
 *
 * Applied with `web`: POST /api/collab/edit as the person, the iOS app's block-edit path. That endpoint checks Can
 * edit again (lib/block-bodies.ts bodyAccess) and merges base → mine block by block into the LIVE Yjs room
 * (lib/collab-rooms.ts applyBlockEdit), relaying it to every open editor as a normal update — so a colleague typing
 * in the page keeps every keystroke, and the room's own persistence saves it (text for older apps, mentions,
 * reminders, realtime). An in-process REST-style save would instead reset open editors ("ydoc:reset").
 *
 * Race-safe: `base` is the document as the card showed it. A block GIDEON's edit touches that someone else changed
 * meanwhile is a 409 from the merge (nothing written, the card says so); edits elsewhere in the page are kept.
 */

const MAX_BASE_BYTES = 400_000
const MAX_TEXT = 20_000
const MODES: Record<string, DocEditMode> = {
  append: "append", end: "append", add: "append",
  append_section: "append_section", append_to_section: "append_section",
  replace_section: "replace_section", replace: "replace_section",
  add_section: "add_section", new_section: "add_section",
}
const MODE_LABEL: Record<DocEditMode, string> = {
  append: "Append to the end",
  append_section: "Append under section",
  replace_section: "Replace section",
  add_section: "Add a section",
}

async function findTarget(actor: User, input: Input): Promise<{ kind: BodyKind; id: string }> {
  const taskId = str(input.taskId)
  if (taskId) return { kind: "taskbody", id: taskId }
  const docId = str(input.docId)
  if (docId) return { kind: "doc", id: docId }
  const title = str(input.doc) ?? str(input.title) ?? str(input.docTitle)
  if (!title) throw new Error("Say which page: docId (from nexus_search_docs), its title (doc), or taskId for a task's page.")
  const rows = await prisma.doc.findMany({ where: { title: { contains: title, mode: "insensitive" } }, select: { id: true, title: true, project: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 25 })
  const visible: typeof rows = []
  for (const r of rows) if ((await bodyAccess(actor.id, "doc", r.id)).read) visible.push(r)
  const exact = visible.filter((r) => r.title.toLowerCase() === title.toLowerCase())
  const pick = exact.length === 1 ? exact : visible
  if (pick.length === 1) return { kind: "doc", id: pick[0].id }
  if (!pick.length) throw new Error(`No page this person can see is titled like “${title}”.`)
  throw new Error(`Several pages match “${title}”: ${pick.slice(0, 6).map((r) => `“${r.title}” (${r.project?.name ?? "?"})`).join(", ")}. Ask which one.`)
}

async function describeEdit(actor: User, input: Input) {
  const target = await findTarget(actor, input)
  const access = await bodyAccess(actor.id, target.kind, target.id)
  if (!access.exists) throw new Error("That page does not exist.")
  if (!access.read) throw new Error("This person cannot see that page.")
  if (!access.write) throw new Error("This person can read that page but not edit it (needs Can edit in its project). Tell them so.")
  const body = await loadBody(target.kind, target.id)
  if (!body) throw new Error("That page does not exist.")
  const base = body.json
  if (canonicalDoc(base).length > MAX_BASE_BYTES) throw new Error("That page is too large to edit from the chat. Open it and edit it there.")
  const mode = MODES[(str(input.mode) ?? "append").toLowerCase().replace(/[\s-]+/g, "_")]
  if (!mode) throw new Error("mode is one of: append, append_section, replace_section, add_section.")
  const text = typeof input.content === "string" ? input.content : typeof input.markdown === "string" ? input.markdown : typeof input.text === "string" ? input.text : ""
  if (!text.trim()) throw new Error("content is required: the exact text (Markdown) to put in the page.")
  if (text.length > MAX_TEXT) throw new Error(`At most ${MAX_TEXT} characters per edit.`)
  const section = str(input.section) ?? null
  const result = editedDoc(base, mode, section, text)
  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { name: true } })
  const beforeText = result.before.length ? docToText({ type: "doc", content: result.before }) : ""
  const afterText = docToText({ type: "doc", content: result.after })
  return {
    summary: `${MODE_LABEL[mode]}${result.sectionTitle ? ` “${result.sectionTitle}”` : ""} in “${body.title}”`.slice(0, 300),
    diff: [
      { field: target.kind === "doc" ? "Doc" : "Task", to: body.title },
      { field: "Project", to: project?.name ?? "—" },
      { field: "Edit", to: MODE_LABEL[mode] },
      ...(result.sectionTitle ? [{ field: "Section", to: result.sectionTitle }] : []),
      ...(mode === "replace_section" ? [{ field: "Change", from: clip(beforeText, 600) ?? "(empty)", to: clip(afterText, 600) ?? "—" }] : []),
    ],
    projectId: body.projectId,
    taskId: target.kind === "taskbody" ? target.id : null,
    // `base` = the page as the card showed it: Apply merges base → mine, so only what this edit touches can conflict.
    store: { kind: target.kind, id: target.id, mode, section, content: text, base, title: body.title },
    preview: afterText,
    note: "NOT changed yet. The card below shows the edit; the page changes only when the person taps Apply edit (people editing it live keep their changes). Say so in one sentence.",
  }
}

export const docEditTools: Record<string, ExtraTool> = {
  edit_doc: {
    describe: describeEdit,
    stepArg: (i) => str(i.doc) ?? str(i.title) ?? null,
    web: async (input, call) => {
      const kind = input.kind === "taskbody" ? "taskbody" : "doc"
      const id = String(input.id ?? "")
      const base = sanitizeDoc(input.base) as BlockDoc | null
      if (!base || !id) return { ok: false, message: "The stored edit is incomplete. Ask GIDEON again." }
      let mine: BlockDoc
      try {
        mine = editedDoc(base, input.mode as DocEditMode, typeof input.section === "string" ? input.section : null, String(input.content ?? "")).doc
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Couldn't build the edit" }
      }
      const r = await call({ method: "POST", path: "/api/collab/edit", json: { kind, id, base, doc: mine } })
      if (r.status === 409) return { ok: false, message: "Someone changed that part of the page after this card was made, so nothing was written. Open the page, or ask GIDEON again · Ada yang mengubah bagian itu setelah kartu dibuat, jadi tidak ada yang ditulis. Buka halamannya, atau minta GIDEON lagi." }
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't edit the page") }
      const link = kind === "doc" ? `/docs/${id}` : `/tasks/${id}`
      return { ok: true, link, result: { changed: r.body?.changed === true, url: `${PUBLIC_BASE}${link}` } }
    },
  },
}

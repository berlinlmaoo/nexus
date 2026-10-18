import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { bytesNumber, canModifyItem, canReadItem, getVaultActor } from "@/lib/vault"
import { EXPIRY_PRESETS } from "@/lib/vault-share"
import { limitOf, str, whenWib, PUBLIC_BASE } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Z Vault (owner, 18 Oct 2026): search what the person can open (the Vault page's own search — name match across the
 * whole drive, then each row through canReadItem, the folder role locks), and make a share link AS them on a card.
 * The link is made by the Vault page's POST /api/vault/shares through the person's session: an internal link (NEXUS
 * login required) for anything they can open, an external one only for its uploader / owner / BoD, the expiry
 * presets 3d / 7d / 14d / 30d / permanent. Defaults here = the Share dialog's: internal, download allowed.
 */

const EXPIRY_LABEL: Record<string, string> = { "3d": "3 days", "7d": "7 days", "14d": "14 days", "30d": "30 days", permanent: "No expiry" }

function sizeText(n: number | null): string | null {
  if (n == null) return null
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

async function folderPaths(workspaceId: string) {
  const folders = await prisma.vaultItem.findMany({ where: { workspaceId, kind: "FOLDER", deletedAt: null }, select: { id: true, name: true, parentId: true } })
  const byId = new Map(folders.map((f) => [f.id, f]))
  return (parentId: string | null) => {
    const trail: string[] = []
    let cur = parentId ? byId.get(parentId) : undefined
    for (let d = 0; cur && d < 32; d++) { trail.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined }
    return trail.join(" / ")
  }
}

async function searchVault(actor: User, input: Input) {
  const va = await getVaultActor(actor.id)
  if (!va.workspaceId) return { access: false, note: "This person has no Z Vault (it is the company drive, for company members). Tell them so." }
  const q = (str(input.query) ?? "").slice(0, 100)
  if (!q) throw new Error("query is required (part of the file or folder name).")
  const kind = str(input.kind)?.toUpperCase()
  const rows = await prisma.vaultItem.findMany({
    where: { workspaceId: va.workspaceId, deletedAt: null, name: { contains: q, mode: "insensitive" }, ...(kind === "FILE" || kind === "FOLDER" ? { kind } : {}) },
    orderBy: [{ kind: "desc" }, { updatedAt: "desc" }],
    take: 200,
    select: { id: true, kind: true, name: true, mimeType: true, size: true, parentId: true, updatedAt: true, uploader: { select: { name: true } } },
  })
  const visible = []
  for (const r of rows) if (await canReadItem(va, r.id)) visible.push(r)
  const limit = limitOf(input, 15, 40)
  const pathOf = await folderPaths(va.workspaceId)
  return {
    total: visible.length,
    items: visible.slice(0, limit).map((r) => ({
      itemId: r.id,
      name: r.name,
      kind: r.kind === "FOLDER" ? "Folder" : "File",
      ...(r.mimeType ? { type: r.mimeType } : {}),
      ...(sizeText(bytesNumber(r.size)) ? { size: sizeText(bytesNumber(r.size)) } : {}),
      in: pathOf(r.parentId) || "Z Vault",
      by: r.uploader?.name ?? null,
      updated: whenWib(r.updatedAt),
      link: `${PUBLIC_BASE}/vault?${r.kind === "FOLDER" ? `folder=${r.id}` : `item=${r.id}`}`,
    })),
    ...(visible.length > limit ? { more: `${visible.length - limit} more; narrow the query or pass kind.` } : {}),
    note: visible.length ? "Only files this person can open. Cite them by exact name." : "Nothing this person can open matches. Say so; do not guess.",
  }
}

async function describeShare(actor: User, input: Input) {
  const va = await getVaultActor(actor.id)
  if (!va.workspaceId) throw new Error("This person has no Z Vault. Tell them so.")
  let item
  const id = str(input.itemId)
  if (id) {
    item = await prisma.vaultItem.findFirst({ where: { id, workspaceId: va.workspaceId, deletedAt: null }, select: { id: true, kind: true, name: true, parentId: true, uploaderId: true, ownerId: true } })
  } else {
    const name = str(input.name) ?? str(input.file) ?? str(input.query)
    if (!name) throw new Error("Say which file or folder: itemId (from nexus_search_vault) or its name.")
    const rows = await prisma.vaultItem.findMany({ where: { workspaceId: va.workspaceId, deletedAt: null, name: { contains: name, mode: "insensitive" } }, select: { id: true, kind: true, name: true, parentId: true, uploaderId: true, ownerId: true }, take: 50 })
    const readable = []
    for (const r of rows) if (await canReadItem(va, r.id)) readable.push(r)
    const exact = readable.filter((r) => r.name.toLowerCase() === name.toLowerCase())
    const pick = exact.length === 1 ? exact : readable
    if (pick.length > 1) throw new Error(`Several items match "${name}": ${pick.slice(0, 6).map((r) => r.name).join("; ")}. Ask which one (or search with nexus_search_vault).`)
    item = pick[0]
  }
  if (!item || !(await canReadItem(va, item.id))) throw new Error("No file or folder this person can open matches that.")
  if (item.kind !== "FILE" && item.kind !== "FOLDER") throw new Error("That item can't be shared.")
  const external = input.external === true || input.requireAuth === false || /^(external|public|luar|publik)$/i.test(str(input.audience) ?? "")
  if (external && !canModifyItem(va, item)) throw new Error("An external link (no NEXUS login) can only be made by the one who uploaded it, its owner or a BoD. Offer an internal link instead, or tell them who can.")
  const preset = str(input.expires) ?? "permanent"
  if (!(preset in EXPIRY_PRESETS)) throw new Error("expires must be one of 3d, 7d, 14d, 30d, permanent.")
  const allowDownload = input.allowDownload !== false
  const pathOf = await folderPaths(va.workspaceId)
  return {
    summary: `Share link for “${item.name}”`,
    diff: [
      { field: item.kind === "FOLDER" ? "Folder" : "File", to: item.name },
      { field: "Location", to: pathOf(item.parentId) || "Z Vault" },
      { field: "Access", to: external ? "Anyone with the link" : "NEXUS members (login required)" },
      { field: "Expires", to: EXPIRY_LABEL[preset] },
      { field: "Download", to: allowDownload ? "Allowed" : "View only" },
    ],
    store: { itemId: item.id, requireAuth: !external, expires: preset, allowDownload },
    note: "NOT made yet. It waits on the card below; the link exists only after the person taps Create link, and then the card shows it. Say so in one sentence.",
  }
}

export const vaultTools: Record<string, ExtraTool> = {
  search_vault: { read: searchVault, stepArg: (i) => str(i.query) ?? null },
  create_vault_share_link: {
    describe: describeShare,
    stepArg: (i) => str(i.name) ?? str(i.file) ?? null,
    web: async (input, call) => {
      const r = await call({ method: "POST", path: "/api/vault/shares", json: { itemId: input.itemId, requireAuth: input.requireAuth !== false, expires: input.expires ?? "permanent", allowDownload: input.allowDownload !== false } })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't create the link") }
      const url = typeof r.body?.url === "string" ? r.body.url : null
      return { ok: true, link: `/vault?item=${String(input.itemId)}`, message: typeof url === "string" && url ? url : null, result: { shareId: r.body?.id ?? null, url } }
    },
  },
}

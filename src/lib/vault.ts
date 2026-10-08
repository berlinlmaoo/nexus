import path from "path"
import { randomUUID, randomBytes, createHash } from "crypto"
import { mkdir, unlink } from "fs/promises"
import { prisma } from "@/lib/prisma"
import { getUserOrgRole, isManagerRole, isBodPlus } from "@/lib/feed"
import { ORG_WORKSPACE_ID, orgRoleOf } from "@/lib/org"

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault — the shared drive.
//
// Everything here is deliberately about ITEM IDS, never paths. A client names an item; this module
// resolves where its bytes live. Path traversal is impossible structurally rather than guarded
// against, and that property only holds as long as no route accepts a storageKey from a request.
// ─────────────────────────────────────────────────────────────────────────────

/** Nested under `attachments/`, which is ALREADY bind-mounted into the container.
 *  A new top-level `uploads/vault/` would work in dev and vanish on the next deploy — the mount list
 *  is declared in three separate files (docker-compose.prod.yml, docker-compose.beta.yml,
 *  scripts/recreate-beta.sh) and only those eight directories survive. `attachments/cf/` and
 *  `attachments/gideon/` already ride along this way. */
export const VAULT_DIR = path.join(process.cwd(), "public", "uploads", "attachments", "vault")

/** Total across the whole workspace, not per person — Berlin's call. The number that actually
 *  binds is the backup destination on the Proxmox host, not the VM disk, so keep this well under it. */
export const VAULT_QUOTA_BYTES = 60 * 1024 * 1024 * 1024 // 60 GB

export const VAULT_MAX_FILE_BYTES = 1024 * 1024 * 1024 // 1 GB, same ceiling as task attachments

// ── storage keys ─────────────────────────────────────────────────────────────

/** `YYYY/MM/<uuid><ext>` — sharded by month so no single directory collects tens of thousands of
 *  entries, which is where `ls`, backup walks and `readdir` all start to hurt. */
export function newStorageKey(originalName: string): string {
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0")
  // Take the extension from the name only if it looks like one — a "file" called `v1.2 final` must
  // not end up stored as `.2 final`.
  const raw = path.extname(originalName).toLowerCase()
  const ext = /^\.[a-z0-9]{1,8}$/.test(raw) ? raw : ""
  return `${yyyy}/${mm}/${randomUUID()}${ext}`
}

/** Absolute path for a storageKey. The guard is defence in depth: keys are server-generated, so if
 *  this ever throws, something upstream started trusting client input and must be fixed there. */
export function storagePath(storageKey: string): string {
  const full = path.resolve(VAULT_DIR, storageKey)
  if (full !== VAULT_DIR && !full.startsWith(VAULT_DIR + path.sep)) {
    throw new Error("Vault storageKey escaped the vault directory")
  }
  return full
}

export async function ensureStorageDir(storageKey: string): Promise<string> {
  const full = storagePath(storageKey)
  await mkdir(path.dirname(full), { recursive: true })
  return full
}

/** Delete the bytes. Emptying the trash MUST reach disk — a soft delete that only hides rows makes
 *  the quota measure a number with no relationship to the disk it is supposed to protect. The
 *  file's thumbnails go with it. */
export async function deleteStoredFile(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return
  try {
    await unlink(storagePath(storageKey))
  } catch {
    /* already gone — the desired end state either way */
  }
  for (const width of VAULT_THUMB_WIDTHS) {
    const thumb = thumbPath(storageKey, width)
    await unlink(thumb).catch(() => {})
    await unlink(`${thumb}.failed`).catch(() => {})
  }
}

/**
 * A short token that changes exactly when a file's BYTES change (Replace file…, 9 Oct 2026), and not
 * on a rename or a move. Every byte address the server hands out carries it as `?v=`, because the
 * clients cache by URL — the iOS AttachmentCache and image cache key on it, and an item id is stable
 * on purpose — so a replaced logo must arrive at a new URL or a phone keeps showing the old one.
 *
 * A hash of the storage key rather than the key itself: the key is where the bytes live on disk,
 * and that stays off the wire. Every replace writes a new key, so a new token.
 */
export function fileVersion(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null
  return createHash("sha256").update(storageKey).digest("hex").slice(0, 12)
}

// ── thumbnails ───────────────────────────────────────────────────────────────
//
// Owner, 9 Oct 2026: a folder of pictures has to show the pictures. GET /api/vault/items/<id>/thumb
// makes a small WebP once per file and width and keeps it here, next to the originals, under
// `.thumbs/` + the original's own storage key — so it inherits the key's randomness (nothing about a
// thumbnail's path can be guessed from an item id) and goes away with the bytes in deleteStoredFile.

/** The only widths made. A request is rounded UP to one of these, so a client cannot fill the disk
 *  with one copy per pixel width it can think of. */
export const VAULT_THUMB_WIDTHS = [160, 320, 640, 1280] as const

export function thumbWidthFor(raw: string | null | undefined): number {
  const n = Number(raw)
  if (!raw || !Number.isFinite(n) || n <= 0) return 320
  return VAULT_THUMB_WIDTHS.find((w) => w >= n) ?? VAULT_THUMB_WIDTHS[VAULT_THUMB_WIDTHS.length - 1]
}

/** Where the thumbnail of a stored file lives: `.thumbs/YYYY/MM/<uuid>-w320.webp`. */
export function thumbPath(storageKey: string, width: number): string {
  const stem = storageKey.replace(/\.[a-z0-9]{1,8}$/i, "")
  const full = path.resolve(VAULT_DIR, ".thumbs", `${stem}-w${width}.webp`)
  if (!full.startsWith(VAULT_DIR + path.sep)) {
    throw new Error("Vault thumbnail escaped the vault directory")
  }
  return full
}

const THUMB_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/tiff"])
const THUMB_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".tif", ".tiff"])

/**
 * Pictures this server can draw small. Not SVG: rasterising someone's uploaded SVG on the server is
 * an attack surface for a picture the browser can already draw safely by itself in an <img>. Not
 * HEIC either: the libvips that ships with sharp reads AVIF but not HEVC-coded HEIC (checked
 * 9 Oct 2026), so a HEIC photo keeps its icon on the web; the iOS app decodes it itself.
 */
export function canThumbnail(mimeType: string | null | undefined, name: string | null | undefined): boolean {
  const mime = (mimeType || "").toLowerCase()
  if (THUMB_MIMES.has(mime)) return true
  if (mime && mime !== "application/octet-stream") return false
  return THUMB_EXTS.has(path.extname(name || "").toLowerCase())
}

// ── share slugs ──────────────────────────────────────────────────────────────

/** A share slug is a CAPABILITY, not a name.
 *  Never slugify() here. Form slugs are human-chosen and guessable, which is fine because the form
 *  is public anyway; this slug IS the key to a file nobody else may read. 16 random bytes. */
export function newShareSlug(): string {
  return randomBytes(16).toString("base64url")
}

// ── access ───────────────────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = { WORKSPACE: 0, MANAGER_PLUS: 1, BOD_PLUS: 2 }

/** Does this org role clear a `minReadRole`/`minWriteRole` threshold? */
export function roleMeets(orgRole: string | null | undefined, threshold: string | null | undefined): boolean {
  const need = ROLE_RANK[threshold ?? "WORKSPACE"] ?? 0
  if (need === 0) return true
  if (need === 1) return isManagerRole(orgRole)
  return isBodPlus(orgRole)
}

export interface VaultActor {
  userId: string
  orgRole: string | null
  workspaceId: string | null
}

/**
 * Z Vault is the COMPANY drive: the actor's vault is the company workspace's, and only its members
 * (or a system admin) get one. Anyone else — e.g. the One Above All of a personal workspace made at
 * sign-up — gets workspaceId null, which every vault route answers with 403. Public share links
 * (/api/vault/public/**) do not go through here and keep working for outsiders.
 */
export async function getVaultActor(userId: string): Promise<VaultActor> {
  const [user, orgRole] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    orgRoleOf(userId),
  ])
  const allowed = orgRole !== null || user?.role === "ADMIN"
  return { userId, orgRole, workspaceId: allowed ? ORG_WORKSPACE_ID : null }
}

export { getUserOrgRole, isManagerRole, isBodPlus }

type ThresholdRow = { id: string; parentId: string | null; minReadRole: string | null; minWriteRole: string | null }

/**
 * Walk from an item up to the root, collecting the nearest ancestor that sets each threshold.
 *
 * Inheritance is resolved by CLIMBING, not by copying values down at write time. Copying is faster
 * to read and wrong the moment somebody locks a top-level shelf: every file already inside it would
 * keep the old open value. The tree is a handful of levels deep; this is a few tiny queries.
 */
export async function effectiveThresholds(
  itemId: string | null,
): Promise<{ read: string | null; write: string | null }> {
  let read: string | null = null
  let write: string | null = null
  let cursor = itemId
  // A cycle can't be created through the API (a move rejects its own subtree), but a bounded loop is
  // cheaper than trusting that forever.
  for (let depth = 0; cursor && depth < 32; depth++) {
    const row: ThresholdRow | null = await prisma.vaultItem.findUnique({
      where: { id: cursor },
      select: { id: true, parentId: true, minReadRole: true, minWriteRole: true },
    })
    if (!row) break
    if (read === null && row.minReadRole) read = row.minReadRole
    if (write === null && row.minWriteRole) write = row.minWriteRole
    if (read !== null && write !== null) break
    cursor = row.parentId
  }
  return { read, write }
}

/** Read access to an item (or, with `itemId` = a folder, to what may be listed inside it). */
export async function canReadItem(actor: VaultActor, itemId: string | null): Promise<boolean> {
  const { read } = await effectiveThresholds(itemId)
  return roleMeets(actor.orgRole, read)
}

export async function canWriteItem(actor: VaultActor, itemId: string | null): Promise<boolean> {
  const { read, write } = await effectiveThresholds(itemId)
  // Writing implies reading: a shelf you cannot see is not one you may drop files into.
  return roleMeets(actor.orgRole, read) && roleMeets(actor.orgRole, write)
}

/** Who may delete or rename something someone else put there. The uploader always may; otherwise
 *  it takes BoD. Deliberately NOT "anyone with write access" — a shared drive where all 46 people
 *  can delete each other's work is how a shared drive becomes an unusable one. */
export function canModifyItem(actor: VaultActor, item: { uploaderId: string; ownerId: string | null }): boolean {
  return item.uploaderId === actor.userId || item.ownerId === actor.userId || isBodPlus(actor.orgRole)
}

// ── names ────────────────────────────────────────────────────────────────────

/** Trim to something safe to show and to store. Slashes and control characters are stripped because
 *  the name is displayed and used for downloads; it is NEVER part of the path on disk. */
export function cleanItemName(input: unknown, fallback = "Untitled"): string {
  const s = typeof input === "string" ? input : ""
  const cleaned = s
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim()
    .slice(0, 180)
  return cleaned || fallback
}

/**
 * Give the item a name nobody else in the same folder already has, by appending " (2)", " (3)"…
 *
 * There is no unique index behind this and there cannot be a useful one: Postgres never considers
 * two NULLs equal, so `@@unique([parentId, name])` would silently allow duplicates at the root —
 * the exact place a shared drive collects them.
 */
export async function uniqueNameInFolder(
  workspaceId: string,
  parentId: string | null,
  desired: string,
  ignoreItemId?: string,
): Promise<string> {
  const siblings = await prisma.vaultItem.findMany({
    where: { workspaceId, parentId, deletedAt: null, ...(ignoreItemId ? { id: { not: ignoreItemId } } : {}) },
    select: { name: true },
  })
  const taken = new Set(siblings.map((s: { name: string }) => s.name.toLowerCase()))
  if (!taken.has(desired.toLowerCase())) return desired

  const ext = path.extname(desired)
  const stem = ext ? desired.slice(0, -ext.length) : desired
  for (let n = 2; n < 500; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

// ── quota ────────────────────────────────────────────────────────────────────

/** Bytes currently held by files. Trashed files still occupy disk, and they are counted too —
 *  otherwise "empty the trash" would be optional and the quota a suggestion. */
export async function vaultUsedBytes(workspaceId: string): Promise<number> {
  const agg = await prisma.vaultItem.aggregate({
    where: { workspaceId, kind: "FILE" },
    _sum: { size: true },
  })
  return agg._sum.size ?? 0
}

export async function assertQuota(workspaceId: string, incomingBytes: number): Promise<string | null> {
  const used = await vaultUsedBytes(workspaceId)
  if (used + incomingBytes > VAULT_QUOTA_BYTES) {
    const freeGb = Math.max(0, (VAULT_QUOTA_BYTES - used) / 1024 ** 3)
    return `Vault penuh. Sisa ${freeGb.toFixed(1)} GB dari ${(VAULT_QUOTA_BYTES / 1024 ** 3).toFixed(0)} GB.`
  }
  return null
}

// ── serialization ────────────────────────────────────────────────────────────

/** Everything the vault UI needs for one row, and nothing that leaks where the bytes are.
 *  `storageKey` is deliberately absent from the wire shape — the client asks for `/raw` by item id. */
export const VAULT_ITEM_INCLUDE = {
  uploader: { select: { id: true, name: true, avatar: true } },
  owner: { select: { id: true, name: true, avatar: true } },
  _count: { select: { children: true, shares: true } },
} as const

type PersonLite = { id: string; name: string; avatar: string | null } | null

export interface VaultItemRow {
  id: string
  kind: string
  name: string
  position: number
  icon: string | null
  color: string | null
  mimeType: string | null
  size: number | null
  width: number | null
  height: number | null
  parentId: string | null
  uploaderId: string
  ownerId: string | null
  storageKey?: string | null
  minReadRole: string | null
  minWriteRole: string | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  uploader?: PersonLite
  owner?: PersonLite
  _count?: { children: number; shares: number }
}

export function serializeVaultItem(row: VaultItemRow, actor: VaultActor) {
  const isFile = row.kind === "FILE"
  // `v` is the content version (fileVersion). Rows read without their storage key fall back to
  // updatedAt, which also moves on a replace — only more often than it has to.
  const version = fileVersion(row.storageKey) ?? String(row.updatedAt.getTime())
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    position: row.position,
    icon: row.icon,
    color: row.color,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    parentId: row.parentId,
    // The ONLY address a client ever gets for the bytes. There is no path anywhere in this payload.
    // `?v=` changes when the file is replaced, so nothing cached by URL outlives the bytes it holds.
    url: isFile ? `/api/vault/items/${row.id}/raw?v=${version}` : null,
    downloadUrl: isFile ? `/api/vault/items/${row.id}/raw?download=1&v=${version}` : null,
    // Pictures only; the client adds `&w=`. Absent from servers before 9 Oct 2026: clients draw the icon.
    thumbUrl: isFile && row.deletedAt === null && canThumbnail(row.mimeType, row.name)
      ? `/api/vault/items/${row.id}/thumb?v=${version}`
      : null,
    /** The content version in the URLs above (since 9 Oct 2026). Changes on Replace file…, only then. */
    fileVersion: isFile ? version : null,
    uploader: row.uploader ?? null,
    owner: row.owner ?? null,
    childCount: row._count?.children ?? 0,
    shareCount: row._count?.shares ?? 0,
    minReadRole: row.minReadRole,
    minWriteRole: row.minWriteRole,
    trashed: row.deletedAt !== null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canModify: canModifyItem(actor, row),
  }
}

/** Root → item, for the breadcrumb. Excludes the item itself. */
export async function breadcrumbFor(itemId: string | null): Promise<{ id: string; name: string }[]> {
  const trail: { id: string; name: string }[] = []
  let cursor = itemId
  for (let depth = 0; cursor && depth < 32; depth++) {
    const row = await prisma.vaultItem.findUnique({
      where: { id: cursor },
      select: { id: true, name: true, parentId: true },
    })
    if (!row) break
    trail.unshift({ id: row.id, name: row.name })
    cursor = row.parentId
  }
  return trail
}

/** Every id in the subtree rooted at `itemId`, including it. Used by delete and by the move guard.
 *  Breadth-first over `parentId` rather than a recursive CTE: Prisma has no CTE support here, and
 *  the tree is shallow enough that a handful of `findMany`s is cheaper than raw SQL to maintain. */
export async function subtreeIds(itemId: string): Promise<string[]> {
  const all = [itemId]
  let frontier = [itemId]
  for (let depth = 0; frontier.length && depth < 32; depth++) {
    const kids: { id: string }[] = await prisma.vaultItem.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    })
    frontier = kids.map((k) => k.id)
    all.push(...frontier)
  }
  return all
}

import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { orgRoleOf } from "@/lib/org"
import { previewKindOf, type PreviewKind } from "@/lib/file-response"
import {
  getVaultActor,
  effectiveThresholds,
  roleMeets,
  canThumbnail,
  fileVersion,
  type VaultActor,
} from "@/lib/vault"

// ─────────────────────────────────────────────────────────────────────────────
// Share links.
//
// This lives outside the route files on purpose: an App Router `route.ts` may only export HTTP
// methods, so anything two routes need in common has to be here or the build fails on a type it
// doesn't explain well.
//
// Phase 2 (owner, 9 Oct 2026): a link can point at a FOLDER, and whoever holds it browses that
// folder's subtree and nothing else. Every public route goes through `openShare` (the link, and who
// is asking) and then `itemInShare` (is this id inside what the link opens). Both run on every
// request, so a revoke, an expiry, a trash or a lock takes effect on the next click.
// ─────────────────────────────────────────────────────────────────────────────

/** Berlin's presets. `permanent` is a real choice, not an oversight — a logo link that dies after a
 *  month is worse than no link at all. */
export const EXPIRY_PRESETS: Record<string, number | null> = {
  "3d": 3,
  "7d": 7,
  "14d": 14,
  "30d": 30,
  permanent: null,
}

export const PUBLIC_BASE = process.env.NEXUS_PUBLIC_URL || "https://nexus.znetworks.id"

export type ShareRow = {
  id: string
  slug: string
  itemId: string
  requireAuth: boolean
  allowDownload: boolean
  expiresAt: Date | null
  revokedAt: Date | null
  viewCount: number
  lastViewedAt: Date | null
  createdAt: Date
  createdById?: string | null
  createdBy?: { id: string; name: string | null } | null
}

/** `canRevoke`, when the caller knows it: whether THIS viewer may switch the link off (its maker,
 *  the file's owner, BoD). Absent from older servers; clients then offer Revoke and let the server say no. */
export function serializeShare(s: ShareRow, opts: { canRevoke?: boolean } = {}) {
  const expired = s.expiresAt !== null && s.expiresAt.getTime() <= Date.now()
  return {
    id: s.id,
    slug: s.slug,
    itemId: s.itemId,
    // Two prefixes, one slug. /v/ is claimed in the AASA and opens the iOS/Mac app; /s/ is
    // deliberately NOT claimed, so an external link handed to a client always stays in their
    // browser instead of launching an app they have no account for. Apple matches on the path
    // alone — this is the only place the distinction can be made.
    url: `${PUBLIC_BASE}/${s.requireAuth ? "v" : "s"}/${s.slug}`,
    requireAuth: s.requireAuth,
    allowDownload: s.allowDownload,
    expiresAt: s.expiresAt?.toISOString() ?? null,
    revokedAt: s.revokedAt?.toISOString() ?? null,
    // Revoked and expired stay apart all the way to the UI: "you turned this off" and "this ran out
    // on 12 Sep" are different answers to "why doesn't my link work".
    status: s.revokedAt ? "revoked" : expired ? "expired" : "active",
    viewCount: s.viewCount,
    lastViewedAt: s.lastViewedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    createdBy: s.createdBy ?? null,
    ...(opts.canRevoke === undefined ? {} : { canRevoke: opts.canRevoke }),
  }
}

/**
 * Why a link does not open. `reason` is what clients translate; `error` is the server's own sentence
 * (Indonesian, as it always was) for clients that show it as is.
 *   missing, revoked, expired, gone — the link itself (gone: its file or folder is in the trash, or
 *     no longer something the link may show).
 *   auth_required — an internal link and no session. not_member — a session, but not of the company
 *     the vault belongs to (a demo account, another company). forbidden — a member whose role does
 *     not reach a lock on that folder.
 */
export type ShareReason = "missing" | "revoked" | "expired" | "gone" | "auth_required" | "not_member" | "forbidden"

export type ShareFailure = { ok: false; status: number; error: string; reason: ShareReason }

export type ShareResolution = { ok: true; share: ResolvedShare } | ShareFailure

/** The columns of an item a public route may need. `storageKey` never leaves the server. */
const ITEM_SELECT = {
  id: true,
  name: true,
  kind: true,
  mimeType: true,
  size: true,
  width: true,
  height: true,
  storageKey: true,
  parentId: true,
  workspaceId: true,
  deletedAt: true,
  minReadRole: true,
  updatedAt: true,
} as const

export type ShareItem = {
  id: string
  name: string
  kind: string
  mimeType: string | null
  size: number | null
  width: number | null
  height: number | null
  storageKey: string | null
  parentId: string | null
  workspaceId: string
  deletedAt: Date | null
  minReadRole: string | null
  updatedAt: Date
}

export type ResolvedShare = {
  id: string
  slug: string
  requireAuth: boolean
  allowDownload: boolean
  expiresAt: Date | null
  createdById: string | null
  /** Shown on the link's page ("Shared by …"). The maker's name only — never their email or role. */
  sharedBy: { name: string } | null
  /** The file or folder the link opens: the root of everything it may show. */
  item: ShareItem
}

function fail(status: number, reason: ShareReason, error: string): ShareFailure {
  return { ok: false, status, error, reason }
}

/**
 * Turn a slug into a share, or into the reason it doesn't work.
 *
 * The whole external surface of Z Vault goes through this function. It takes a slug and returns a
 * row; the caller never sees, builds, or forwards a path. That is what makes traversal structurally
 * impossible here rather than something a regex is asked to prevent, and it is why revocation takes
 * effect on the next request instead of whenever a cache decides.
 */
export async function resolveShare(slug: string): Promise<ShareResolution> {
  if (!slug || slug.length > 64) return fail(404, "missing", "Tautan tidak ditemukan")

  const share = await prisma.vaultShare.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      requireAuth: true,
      allowDownload: true,
      revokedAt: true,
      expiresAt: true,
      createdById: true,
      createdBy: { select: { name: true } },
      item: { select: ITEM_SELECT },
    },
  })

  if (!share) return fail(404, "missing", "Tautan tidak ditemukan")
  if (share.revokedAt) return fail(410, "revoked", "Tautan ini sudah dicabut")
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    return fail(410, "expired", "Tautan ini sudah kedaluwarsa")
  }
  // A trashed file or folder is unreachable through its links too. The share row survives so that
  // restoring it brings every link that was already sent back to life, rather than silently
  // staying dead. A folder has no bytes of its own; a file without them is as good as gone.
  const item = share.item
  if (!item || item.deletedAt || (item.kind === "FILE" && !item.storageKey)) {
    return fail(410, "gone", "Berkasnya sudah tidak ada")
  }

  return {
    ok: true,
    share: {
      id: share.id,
      slug: share.slug,
      requireAuth: share.requireAuth,
      allowDownload: share.allowDownload,
      expiresAt: share.expiresAt,
      createdById: share.createdById,
      sharedBy: share.createdBy?.name ? { name: share.createdBy.name } : null,
      item,
    },
  }
}

/** A link that opens, and the role its contents are judged against. */
export type ShareAccess = {
  ok: true
  share: ResolvedShare
  /**
   * An internal link answers to the VIEWER: a member of the vault's company, reading with their own
   * role, exactly as if they had browsed there. An external link has no viewer, so it answers to its
   * MAKER: it never shows more than the person who made it may see today — a folder locked to BoD
   * inside a shared folder stays out of the link, and locking a shelf later takes it out at once.
   */
  role: string | null
  viewer: VaultActor | null
}

/**
 * A link, and who is asking. Every public route starts here.
 *
 * Internal links (requireAuth) take a session from the company that owns the vault: any NEXUS account
 * is not enough (demo accounts, another company's people). Then the root itself must be readable by
 * the role the link answers to (see ShareAccess.role).
 */
export async function openShare(slug: string): Promise<ShareAccess | ShareFailure> {
  const res = await resolveShare(slug)
  if (!res.ok) return res
  const { share } = res

  let role: string | null
  let viewer: VaultActor | null = null
  if (share.requireAuth) {
    const session = await auth()
    if (!session?.user?.id) {
      return fail(401, "auth_required", "Tautan ini cuma untuk internal. Masuk dulu ya.")
    }
    viewer = await getVaultActor(session.user.id)
    if (!viewer.workspaceId || viewer.workspaceId !== share.item.workspaceId) {
      return fail(403, "not_member", "Tautan ini cuma untuk orang di perusahaan ini.")
    }
    role = viewer.orgRole
  } else {
    role = share.createdById ? await orgRoleOf(share.createdById) : null
  }

  const { read } = await effectiveThresholds(share.item.id)
  if (!roleMeets(role, read)) {
    return share.requireAuth
      ? fail(403, "forbidden", "Folder ini dikunci untuk peran tertentu.")
      : fail(410, "gone", "Berkasnya sudah tidak ada")
  }
  return { ok: true, share, role, viewer }
}

/**
 * An item as seen through a link, or null.
 *
 * Inside means: the item IS the link's root or sits below it; nothing between the two is in the
 * trash; and the role the link answers to clears every lock on the way (the nearest threshold, found
 * by climbing past the root to the top, as everywhere else in the vault). Anything else is null, and
 * every caller answers null with the same 404 — an id outside the link is indistinguishable from one
 * that does not exist, so ids cannot be probed through a link.
 */
export async function itemInShare(access: ShareAccess, itemId: string | null | undefined): Promise<ShareItem | null> {
  const root = access.share.item
  if (!itemId || itemId === root.id) return root
  if (itemId.length > 64) return null

  let cursor: string | null = itemId
  let item: ShareItem | null = null
  let inside = false
  let read: string | null = null
  for (let depth = 0; cursor && depth < 40; depth++) {
    const row: ShareItem | null = await prisma.vaultItem.findUnique({ where: { id: cursor }, select: ITEM_SELECT })
    if (!row) return null
    if (depth === 0) item = row
    if (!inside) {
      // Below the root: every step must be live and in the same vault.
      if (row.deletedAt || row.workspaceId !== root.workspaceId) return null
      if (row.id === root.id) inside = true
    }
    if (read === null && row.minReadRole) read = row.minReadRole
    if (inside && read !== null) break
    cursor = row.parentId
  }
  if (!inside || !item) return null
  return roleMeets(access.role, read) ? item : null
}

/** Root → `folderId`, both included, for the breadcrumb inside a link. Never above the root. */
export async function trailInShare(access: ShareAccess, folder: ShareItem): Promise<{ id: string; name: string }[]> {
  const root = access.share.item
  const trail: { id: string; name: string }[] = []
  let cursor: { id: string; name: string; parentId: string | null } | null = folder
  for (let depth = 0; cursor && depth < 40; depth++) {
    trail.unshift({ id: cursor.id, name: cursor.name })
    if (cursor.id === root.id) return trail
    if (!cursor.parentId) break
    cursor = await prisma.vaultItem.findUnique({ where: { id: cursor.parentId }, select: { id: true, name: true, parentId: true } })
  }
  // Not under the root: itemInShare would have refused it. Show the root alone rather than guess.
  return [{ id: root.id, name: root.name }]
}

export type ShareChild = ShareItem & { childCount: number }

/**
 * What a link shows inside one folder: its live children that the link's role may read, folders
 * first, in the vault's own order. `folder` must already have come through itemInShare.
 */
export async function childrenInShare(access: ShareAccess, folder: ShareItem): Promise<ShareChild[]> {
  const { read: folderRead } = await effectiveThresholds(folder.id)
  const rows = await prisma.vaultItem.findMany({
    where: { parentId: folder.id, deletedAt: null },
    select: { ...ITEM_SELECT, _count: { select: { children: { where: { deletedAt: null } } } } },
    orderBy: [{ kind: "desc" }, { position: "asc" }, { name: "asc" }],
    take: 500,
  })
  // A child's own lock wins; otherwise it has its folder's.
  return rows
    .filter((r) => roleMeets(access.role, r.minReadRole ?? folderRead))
    .map(({ _count, ...r }) => ({ ...r, childCount: _count.children }))
}

/** Where the bytes, the thumbnail and the zip of something inside a link are fetched. */
export function shareBase(slug: string): string {
  return `/api/vault/public/${encodeURIComponent(slug)}`
}

/**
 * One file or folder as the link's page sees it. Every address points back at the SLUG plus an item
 * id, never at a path, and every one is re-checked through openShare + itemInShare when it is used.
 *
 * `previewUrl` is null for a view-only link to a file nothing can preview (a Word file, a zip): there
 * is nothing it could be used for except a download, which that link does not give.
 */
export function publicItemOf(slug: string, row: ShareItem & { childCount?: number }, allowDownload: boolean, isRoot = false) {
  const isFile = row.kind === "FILE"
  const version = isFile ? fileVersion(row.storageKey) : null
  const previewKind: PreviewKind | null = isFile && row.storageKey ? previewKindOf(row.storageKey, row.mimeType) : null
  const base = shareBase(slug)
  // The link's own file keeps its original address (no `item=`): released apps build nothing, they
  // use these URLs as given, and the shorter form is what they have always been sent.
  const query = `${isRoot ? "" : `item=${encodeURIComponent(row.id)}&`}v=${version ?? ""}`
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    childCount: row.childCount ?? 0,
    previewKind,
    previewUrl: isFile && (allowDownload || previewKind) ? `${base}/raw?${query}` : null,
    downloadUrl: isFile && allowDownload ? `${base}/raw?${query}&download=1` : null,
    thumbUrl: isFile && canThumbnail(row.mimeType, row.name) ? `${base}/thumb?${query}` : null,
    fileVersion: version,
  }
}

/** Cache policy for bytes behind a link. An internal link's response was made for one session and
 *  must never sit in a shared cache; an external one may, briefly (a revoke must win within a minute). */
export function shareCacheControl(share: ResolvedShare): string {
  return share.requireAuth ? "private, max-age=60" : "public, max-age=60"
}

/** Counted on the metadata route (someone OPENED the link), never on /raw.
 *  Counting raw requests would make one video worth dozens of "views", because every seek is its own
 *  Range request — the number would grow with how hard the file was to watch. This way it answers the
 *  question people actually ask: has the client opened that deck yet.
 *  Best-effort: a failed counter must never fail a download. */
export async function countShareView(shareId: string): Promise<void> {
  try {
    await prisma.vaultShare.update({
      where: { id: shareId },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    })
  } catch {
    /* the file still goes out */
  }
}

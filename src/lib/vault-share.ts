import prisma from "@/lib/prisma"

// ─────────────────────────────────────────────────────────────────────────────
// Share links.
//
// This lives outside the route files on purpose: an App Router `route.ts` may only export HTTP
// methods, so anything two routes need in common has to be here or the build fails on a type it
// doesn't explain well.
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
  createdBy?: { id: string; name: string | null } | null
}

export function serializeShare(s: ShareRow) {
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
  }
}

export type ShareResolution =
  | { ok: true; share: ResolvedShare }
  | { ok: false; status: number; error: string; reason: "missing" | "revoked" | "expired" | "gone" }

export type ResolvedShare = {
  id: string
  slug: string
  requireAuth: boolean
  allowDownload: boolean
  item: {
    id: string
    name: string
    kind: string
    mimeType: string | null
    size: number | null
    width: number | null
    height: number | null
    storageKey: string | null
  }
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
  if (!slug || slug.length > 64) {
    return { ok: false, status: 404, error: "Tautan tidak ditemukan", reason: "missing" }
  }

  const share = await prisma.vaultShare.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      requireAuth: true,
      allowDownload: true,
      revokedAt: true,
      expiresAt: true,
      item: {
        select: {
          id: true,
          name: true,
          kind: true,
          mimeType: true,
          size: true,
          width: true,
          height: true,
          storageKey: true,
          deletedAt: true,
        },
      },
    },
  })

  if (!share) return { ok: false, status: 404, error: "Tautan tidak ditemukan", reason: "missing" }
  if (share.revokedAt) return { ok: false, status: 410, error: "Tautan ini sudah dicabut", reason: "revoked" }
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 410, error: "Tautan ini sudah kedaluwarsa", reason: "expired" }
  }
  // A trashed file is unreachable through its links too. The share row survives so that restoring the
  // file brings every link that was already sent back to life, rather than silently staying dead.
  if (!share.item || share.item.deletedAt || !share.item.storageKey) {
    return { ok: false, status: 410, error: "Berkasnya sudah tidak ada", reason: "gone" }
  }

  return {
    ok: true,
    share: {
      id: share.id,
      slug: share.slug,
      requireAuth: share.requireAuth,
      allowDownload: share.allowDownload,
      item: {
        id: share.item.id,
        name: share.item.name,
        kind: share.item.kind,
        mimeType: share.item.mimeType,
        size: share.item.size,
        width: share.item.width,
        height: share.item.height,
        storageKey: share.item.storageKey,
      },
    },
  }
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

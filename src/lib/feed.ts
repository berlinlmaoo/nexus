import prisma from "@/lib/prisma"

// The Wire (Feed) — shared constants + helpers. Company-wide firehose: not workspace-scoped.
export const POST_TEXT_MAX = 280
export const IMG_MAX = 4
export const IMG_SIZE_MAX = 8 * 1024 * 1024 // 8MB per image
export const MENTION_MAX = 10
export const EDIT_WINDOW_MS = 15 * 60 * 1000 // 15-minute edit window
export const RATE_MIN_GAP_MS = 20 * 1000 // ≥20s between posts
export const RATE_HOURLY_MAX = 30 // ≤30 posts/hour

/** A user's workspace org role (ONE_ABOVE_ALL/BOD/MANAGER/STAFF). Single-company deploy → first membership. */
export async function getUserOrgRole(userId: string): Promise<string | null> {
  const m = await prisma.workspaceMember.findFirst({ where: { userId }, select: { role: true } })
  return m?.role ?? null
}
export function isManagerRole(role?: string | null): boolean {
  return role === "ONE_ABOVE_ALL" || role === "BOD" || role === "MANAGER"
}
// BETA gate: The Wire is currently visible to BoD and above only (excludes Manager + Staff).
export function isBodPlus(role?: string | null): boolean {
  return role === "ONE_ABOVE_ALL" || role === "BOD"
}

// Opaque keyset cursor over (createdAt, id), both descending.
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url")
}
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|")
    const d = new Date(iso)
    if (!id || Number.isNaN(d.getTime())) return null
    return { createdAt: d, id }
  } catch {
    return null
  }
}

export type PostRow = {
  id: string
  text: string
  createdAt: Date
  editedAt: Date | null
  likeCount: number
  commentCount: number
  authorId: string
  author: { id: string; name: string; avatar: string | null }
  images: { id: string; url: string; width: number | null; height: number | null; position: number }[]
  mentions: { userId: string; user: { id: string; name: string } | null }[]
}

export const POST_INCLUDE = {
  author: { select: { id: true, name: true, avatar: true } },
  images: { orderBy: { position: "asc" as const } },
  mentions: { select: { userId: true, user: { select: { id: true, name: true } } } },
}

export function serializePost(p: PostRow, viewerId: string, likedSet: Set<string>, viewerIsManager: boolean) {
  return {
    id: p.id,
    text: p.text,
    createdAt: p.createdAt,
    editedAt: p.editedAt,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    author: p.author,
    images: p.images.map((im) => ({ id: im.id, url: im.url, width: im.width, height: im.height, position: im.position })),
    mentions: p.mentions.map((m) => ({ userId: m.userId, name: m.user?.name ?? null })),
    likedByMe: likedSet.has(p.id),
    canDelete: p.authorId === viewerId || viewerIsManager,
    canEdit: p.authorId === viewerId,
  }
}

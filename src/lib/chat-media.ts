import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma"
import {
  encodeCursor,
  extractLinks,
  linkTitle,
  MEDIA_COUNT_CAP,
  MESSAGE_KIND_USER,
  olderThan,
  type MediaType,
} from "@/lib/chat-rules"

/**
 * "Media, links and docs" on the group info screen (SYSTEM-MESSAGES contract, Part 2, 8 Oct 2026).
 *
 *   photos  messages with an image attachment (image/*, or no type at all: the oldest uploads)
 *   docs    messages with any other attachment
 *   links   every http(s) address in a message's text, one item per address (chat-rules extractLinks)
 *
 * People's messages only (kind USER), newest first, paged on the same opaque (createdAt, id) cursor as
 * the messages route. Every query is scoped to one conversation and walks the existing
 * ("conversationId", "createdAt") index; links are found by a plain substring test in SQL ("http://" /
 * "https://") and the exact addresses picked out here, so nothing scans another room.
 */

/** How many link-bearing messages the Links count reads before it stops (newest first). */
export const LINK_SCAN_CAP = 1000

const PHOTO_WHERE: Prisma.MessageWhereInput = {
  attachmentUrl: { not: null },
  OR: [{ attachmentType: null }, { attachmentType: "" }, { attachmentType: { startsWith: "image/", mode: "insensitive" } }],
}

const DOC_WHERE: Prisma.MessageWhereInput = {
  attachmentUrl: { not: null },
  attachmentType: { not: null },
  NOT: [{ attachmentType: "" }, { attachmentType: { startsWith: "image/", mode: "insensitive" } }],
}

const LINK_WHERE: Prisma.MessageWhereInput = {
  OR: [{ content: { contains: "http://", mode: "insensitive" } }, { content: { contains: "https://", mode: "insensitive" } }],
}

const WHERE_OF: Record<MediaType, Prisma.MessageWhereInput> = { photos: PHOTO_WHERE, docs: DOC_WHERE, links: LINK_WHERE }

export type MediaCounts = { photos: number; links: number; docs: number }

/** The three totals on the info screen, each capped at MEDIA_COUNT_CAP. */
export async function mediaCounts(conversationId: string): Promise<MediaCounts> {
  const base = { conversationId, kind: MESSAGE_KIND_USER }
  const [photos, docs, linkRows] = await Promise.all([
    prisma.message.count({ where: { ...base, ...PHOTO_WHERE }, take: MEDIA_COUNT_CAP }),
    prisma.message.count({ where: { ...base, ...DOC_WHERE }, take: MEDIA_COUNT_CAP }),
    prisma.message.findMany({
      where: { ...base, ...LINK_WHERE },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LINK_SCAN_CAP,
      select: { content: true },
    }),
  ])
  const links = linkRows.reduce((n, r) => n + extractLinks(r.content).length, 0)
  return { photos, docs, links: Math.min(links, MEDIA_COUNT_CAP) }
}

export type MediaItem = {
  messageId: string
  createdAt: Date
  sender: { id: string; name: string }
  url: string
  attachmentType?: string | null
  title?: string
}

/** The name a document goes by: its caption, else the file name at the end of its path. */
function docTitle(content: string, url: string): string {
  const caption = content.replace(/\s+/g, " ").trim()
  if (caption) return caption.length > 120 ? caption.slice(0, 119).trimEnd() + "…" : caption
  const last = url.split("?")[0].split("/").filter(Boolean).pop() ?? url
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** One page of a tab, newest first. `cursor` = the previous page's nextCursor, decoded. */
export async function mediaPage(
  conversationId: string,
  type: MediaType,
  cursor: { createdAt: Date; id: string } | null,
  limit: number,
): Promise<{ items: MediaItem[]; nextCursor: string | null }> {
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      kind: MESSAGE_KIND_USER,
      AND: [WHERE_OF[type], ...(cursor ? [olderThan(cursor.createdAt, cursor.id)] : [])],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, createdAt: true, content: true, attachmentUrl: true, attachmentType: true, user: { select: { id: true, name: true } } },
  })
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const items: MediaItem[] = []
  for (const m of page) {
    const base = { messageId: m.id, createdAt: m.createdAt, sender: { id: m.user.id, name: m.user.name } }
    if (type === "links") {
      for (const url of extractLinks(m.content)) items.push({ ...base, url, title: linkTitle(url) })
    } else if (m.attachmentUrl) {
      items.push({
        ...base,
        url: m.attachmentUrl,
        attachmentType: m.attachmentType,
        ...(type === "docs" ? { title: docTitle(m.content, m.attachmentUrl) } : {}),
      })
    }
  }
  const last = page[page.length - 1]
  return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null }
}

/**
 * The chat rules that need no database: who gets a push for a new message and what it says, how a
 * page of messages is addressed, how far "read" moves, how unread adds up, and who may stay in a
 * group or DM. Contract: CHAT-CONTRACT (8 Oct 2026), "push + realtime optimal".
 *
 * Pure on purpose — no imports, no I/O — so chat-rules.test.mjs loads it with plain node, the same
 * loader as fcm-payload.test.mjs. The routes and src/lib/chat-*.ts do the reading and writing.
 */

/** "forever" on PATCH /mute is stored as this instant: far enough that nobody outlives it. */
export const MUTE_FOREVER_ISO = "9999-12-31T23:59:59.000Z"

/** The first iOS build that manages its own app-icon badge (clears it when read). */
export const IOS_BADGE_MIN_VERSION = "0.1.7"

/** Unread is counted up to this many per conversation. Every client draws "99+" long before. */
export const UNREAD_CAP = 999

export type ConversationKind = "DM" | "GROUP" | "PROJECT"

type When = Date | string | null | undefined

function ms(value: When): number | null {
  if (value === null || value === undefined) return null
  const t = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(t) ? t : null
}

function isFuture(value: When, now: number): boolean {
  const t = ms(value)
  return t !== null && t > now
}

// ── who is told about a new message ────────────────────────────────────────────────────────────

export type ChatPushDecision = {
  /** Send a push to this member's phones. */
  push: boolean
  /** Write an Inbox (bell) Notification row. Only mentions do: a plain message lives in the chat. */
  inbox: boolean
  reason: "mention" | "muted" | "dnd" | "ok"
}

/**
 * One member, one new message. A mention always gets through — a muted room or Do Not Disturb is
 * "don't buzz me for the chatter", never "don't tell me when someone needs me". Everything else
 * stays quiet while the room is muted or the person is in DND.
 */
export function chatPushDecision(input: {
  isMention: boolean
  mutedUntil?: When
  dndUntil?: When
  now?: Date | number
}): ChatPushDecision {
  const now = input.now instanceof Date ? input.now.getTime() : (input.now ?? Date.now())
  if (input.isMention) return { push: true, inbox: true, reason: "mention" }
  if (isFuture(input.mutedUntil, now)) return { push: false, inbox: false, reason: "muted" }
  if (isFuture(input.dndUntil, now)) return { push: false, inbox: false, reason: "dnd" }
  return { push: true, inbox: false, reason: "ok" }
}

// ── what the push says ─────────────────────────────────────────────────────────────────────────

/**
 * The text a notification shows for a message. A picture with no words is "📷 Foto"; with a caption,
 * the caption. Whitespace is folded so a multi-line message stays readable on a lock screen.
 */
export function chatPreviewText(input: {
  content?: string | null
  attachmentUrl?: string | null
  attachmentType?: string | null
  max?: number
}): string {
  const max = input.max ?? 160
  const text = (input.content ?? "").replace(/\s+/g, " ").trim()
  if (!text) {
    if (!input.attachmentUrl) return ""
    const t = (input.attachmentType ?? "").toLowerCase()
    return !t || t.startsWith("image/") ? "📷 Foto" : "📎 Lampiran"
  }
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text
}

/** What the room is called on a lock screen. A DM is called after the person writing. */
export function chatConversationName(kind: ConversationKind | string, name: string | null | undefined, senderName: string): string {
  if (kind === "DM") return senderName
  const trimmed = (name ?? "").trim()
  if (trimmed) return trimmed
  return kind === "PROJECT" ? "Project chat" : "Group"
}

export type ChatPushContent = {
  title: string
  body: string
  type: "MESSAGE" | "MESSAGE_MENTION"
  link: string
  /** APNs aps.thread-id: one stack per conversation on the lock screen. */
  threadId: string
  /** Custom keys, identical on APNs (top level) and FCM (data). */
  data: {
    conversationId: string
    messageId: string
    conversationName: string
    senderName: string
    isGroup: boolean
    /** The message alone, without "Sender: " — what Android's MessagingStyle wants per line. */
    text: string
  }
}

/**
 * The push for one new message. Group/project: title = the room, body = "Sender: text". DM: title =
 * the sender, body = the text. Mentions read the same and differ in `type`, so the phone can treat
 * them as more urgent.
 */
export function buildChatPush(input: {
  conversationId: string
  messageId: string
  kind: ConversationKind | string
  conversationName?: string | null
  senderName?: string | null
  content?: string | null
  attachmentUrl?: string | null
  attachmentType?: string | null
  isMention: boolean
}): ChatPushContent {
  const senderName = (input.senderName ?? "").trim() || "Seseorang"
  const isGroup = input.kind !== "DM"
  const conversationName = chatConversationName(input.kind, input.conversationName, senderName)
  const text = chatPreviewText(input)
  return {
    title: isGroup ? conversationName : senderName,
    body: isGroup ? `${senderName}: ${text}` : text,
    type: input.isMention ? "MESSAGE_MENTION" : "MESSAGE",
    link: chatLink(input.conversationId),
    threadId: input.conversationId,
    data: {
      conversationId: input.conversationId,
      messageId: input.messageId,
      conversationName,
      senderName,
      isGroup,
      text,
    },
  }
}

/** The deep link every client already reads (web validateSearch, iOS AppRouter, Android Router). */
export function chatLink(conversationId: string): string {
  return `/messages?c=${conversationId}`
}

/** The conversation a `/messages?c=<id>` link points at, or null for any other link. */
export function conversationIdFromLink(link: string | null | undefined): string | null {
  const m = /^\/messages\?c=([^&#]+)/.exec(link ?? "")
  return m ? m[1] : null
}

/** "1.2.3" ≥ "1.2"? Missing parts are 0; anything unreadable is "older" (never gets new behaviour). */
export function appVersionAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version || !/^\d+(\.\d+){0,3}$/.test(version.trim())) return false
  const a = version.trim().split(".").map(Number)
  const b = min.split(".").map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}

/**
 * Whether a device may be sent aps.badge. iOS before 0.1.7 never resets its badge, so a number set by
 * a push would sit on the icon after everything was read. Android builds its own notification from
 * the data keys and decides for itself.
 */
export function badgeAllowedFor(platform: string | null | undefined, appVersion: string | null | undefined): boolean {
  if (platform === "android") return true
  return appVersionAtLeast(appVersion, IOS_BADGE_MIN_VERSION)
}

// ── pages of messages ──────────────────────────────────────────────────────────────────────────

const CURSOR_PREFIX = "c1."

/** Opaque `(createdAt, id)` cursor. Clients only hand it back as `before`. */
export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString()
  return CURSOR_PREFIX + Buffer.from(`${iso}|${id}`, "utf8").toString("base64url")
}

export function decodeCursor(raw: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!raw || !raw.startsWith(CURSOR_PREFIX)) return null
  let text: string
  try {
    text = Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString("utf8")
  } catch {
    return null
  }
  const bar = text.indexOf("|")
  if (bar < 1) return null
  const t = Date.parse(text.slice(0, bar))
  const id = text.slice(bar + 1)
  if (!Number.isFinite(t) || !id) return null
  return { createdAt: new Date(t), id }
}

export type BeforeSpec =
  | { kind: "none" }
  | { kind: "date"; date: Date }
  | { kind: "cursor"; createdAt: Date; id: string }
  | { kind: "invalid" }

/**
 * `before` is either the new opaque cursor or, as every client sent until now, an ISO date (Android
 * pages back with the oldest message's createdAt). A date keeps the old meaning: strictly earlier.
 */
export function parseBefore(raw: string | null | undefined): BeforeSpec {
  if (raw === null || raw === undefined || raw === "") return { kind: "none" }
  if (raw.startsWith(CURSOR_PREFIX)) {
    const c = decodeCursor(raw)
    return c ? { kind: "cursor", ...c } : { kind: "invalid" }
  }
  const t = Date.parse(raw)
  return Number.isFinite(t) ? { kind: "date", date: new Date(t) } : { kind: "invalid" }
}

/** `limit` query value: default 50, at most 100, at least 1; anything unreadable is the default. */
export function parseLimit(raw: string | null | undefined, fallback = 50, max = 100): number {
  const n = raw === null || raw === undefined || raw === "" ? NaN : Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, max)
}

/**
 * The Prisma `where` fragment for "strictly older than (createdAt, id)" / "strictly newer than". Plain
 * objects, so the module stays import-free; the route spreads them into its query.
 */
export function olderThan(createdAt: Date, id: string) {
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }
}
export function newerThan(createdAt: Date, id: string) {
  return { OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: id } }] }
}

/**
 * Shape one page. `rows` were fetched with take = limit + 1 in the page's own direction (newest first
 * for `before`, oldest first for `after`); the extra row only says whether there is more.
 */
export function shapePage<T extends { id: string; createdAt: Date | string }>(
  rows: T[],
  limit: number,
  direction: "older" | "newer",
): { messages: T[]; hasMore: boolean; nextCursor: string | null } {
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows.slice()
  if (direction === "newer") return { messages: page, hasMore, nextCursor: null }
  // Fetched newest first; clients want oldest first. The cursor points past the oldest one shown.
  page.reverse()
  const oldest = page[0]
  return { messages: page, hasMore, nextCursor: hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null }
}

// ── read state ─────────────────────────────────────────────────────────────────────────────────

/** lastReadAt only ever moves forward: an older phone reporting late must not resurrect unread. */
export function nextLastReadAt(current: When, candidate: Date): Date {
  const c = ms(current)
  return c !== null && c > candidate.getTime() ? new Date(c) : candidate
}

// ── unread ─────────────────────────────────────────────────────────────────────────────────────

export type UnreadRow = { conversationId: string; unread: number; mutedUntil?: When; mentions?: number }

/**
 * The badge sum. A muted room adds only the mentions waiting in it; an unmuted room adds everything
 * unread. Mentions never count past the room's own unread (a mention row left unread in the bell for
 * a chat that has since been read is not news).
 */
export function summarizeUnread(rows: UnreadRow[], now: Date | number = Date.now()): {
  totalUnread: number
  mentions: number
  muted: Set<string>
} {
  const t = now instanceof Date ? now.getTime() : now
  let totalUnread = 0
  let mentions = 0
  const muted = new Set<string>()
  for (const r of rows) {
    const unread = Math.max(0, r.unread | 0)
    const m = Math.min(unread, Math.max(0, (r.mentions ?? 0) | 0))
    const isMuted = isFuture(r.mutedUntil, t)
    if (isMuted) muted.add(r.conversationId)
    totalUnread += isMuted ? m : unread
    mentions += m
  }
  return { totalUnread, mentions, muted }
}

// ── mute ───────────────────────────────────────────────────────────────────────────────────────

/** PATCH /mute body value → the stored instant (null = not muted). A past instant is "not muted". */
export function parseMutedUntil(raw: unknown, now: Date | number = Date.now()):
  | { ok: true; value: Date | null }
  | { ok: false; error: string } {
  const t = now instanceof Date ? now.getTime() : now
  if (raw === null) return { ok: true, value: null }
  if (raw === "forever") return { ok: true, value: new Date(MUTE_FOREVER_ISO) }
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: 'mutedUntil must be an ISO date, "forever" or null' }
  }
  const v = Date.parse(raw)
  if (!Number.isFinite(v)) return { ok: false, error: 'mutedUntil must be an ISO date, "forever" or null' }
  if (v <= t) return { ok: true, value: null }
  return { ok: true, value: new Date(Math.min(v, Date.parse(MUTE_FOREVER_ISO))) }
}

// ── who may be in a group or DM ────────────────────────────────────────────────────────────────

/**
 * Whether a member of a GROUP/DM still belongs there (CHAT-CONTRACT "Membership (security)").
 *
 * A room created inside one workspace carries its id: you stay while you are in that workspace. A
 * room without one (created before 8 Oct 2026, or across workspaces) falls back to "you still share a
 * workspace with someone in it" — and a room where nobody else is in any workspace any more (the
 * others deleted their accounts) stays readable by whoever is left, as long as they still belong
 * somewhere.
 */
export function groupRoomAllows(input: {
  roomWorkspaceId: string | null | undefined
  userWorkspaceIds: Iterable<string>
  /** Workspace ids of every OTHER member of the room, one list per member. */
  otherMembersWorkspaceIds: string[][]
}): boolean {
  const mine = new Set(input.userWorkspaceIds)
  if (input.roomWorkspaceId) return mine.has(input.roomWorkspaceId)
  if (mine.size === 0) return false
  const others = input.otherMembersWorkspaceIds.filter((ws) => ws.length > 0)
  if (others.length === 0) return true
  return others.some((ws) => ws.some((w) => mine.has(w)))
}

/**
 * The workspace a new GROUP/DM belongs to: one every participant is in. Several → the creator's
 * oldest (their home workspace, which is how the app picks the active one). None → null: a room that
 * spans workspaces keeps the shared-workspace rule instead.
 */
export function commonWorkspace(participantsWorkspaceIds: string[][], creatorWorkspacesOldestFirst: string[]): string | null {
  if (participantsWorkspaceIds.length === 0) return null
  const sets = participantsWorkspaceIds.map((ws) => new Set(ws))
  for (const w of creatorWorkspacesOldestFirst) if (sets.every((s) => s.has(w))) return w
  return null
}

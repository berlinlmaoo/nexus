/**
 * The chat rules that need no database: who gets a push for a new message and what it says, how a
 * page of messages is addressed, how far "read" moves, how unread adds up, who may stay in a group
 * or DM, and who may add or remove people in a group. Contract: CHAT-CONTRACT (8 Oct 2026), "push +
 * realtime optimal". Also the system messages ("Bagas added Mey") and the group info screen:
 * SYSTEM-MESSAGES (8 Oct 2026).
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

// ── who may add or remove people in a group ────────────────────────────────────────────────────

/** The 403 `code` when someone below Manager tries to add or remove a member (owner, 8 Oct 2026). */
export const MANAGER_REQUIRED = "MANAGER_REQUIRED"

/**
 * The 403 `error` sentence. Apps before 0.1.7 show the server's sentence as it is, so it is written
 * in Indonesian like the other refusals; newer clients recognise `code` and use their own copy.
 */
export const MANAGER_REQUIRED_MESSAGE = "Hanya manager ke atas yang bisa menambah atau mengeluarkan anggota."

/** Workspace roles that may add or remove people in a group: Manager and above. */
const GROUP_MEMBER_MANAGER_ROLES: ReadonlySet<string> = new Set(["MANAGER", "BOD", "ONE_ABOVE_ALL"])

/**
 * Whether the caller may add someone to, or remove someone from, a room (owner decision 8 Oct 2026:
 * only Manager and above, in GROUP chats).
 *
 *   - GROUP only. A PROJECT room follows the project's members and a DM is two people: neither has
 *     member management of its own, so both answer false.
 *   - Leaving is not removing. Taking yourself out of a group (targetIsSelf) is always allowed.
 *   - Otherwise MANAGER, BOD or ONE_ABOVE_ALL in the ROOM's workspace, or a system ADMIN. A role in
 *     some other workspace does not count: anyone who signs up is One Above All of a workspace of
 *     their own. A room without a workspace gives nobody a workspace role (null), so only an admin.
 *
 * Creating a group with its first members is not covered: that stays open to everyone.
 */
export function canManageGroupMembers(input: {
  kind: ConversationKind | string | null | undefined
  /** The caller's role in the room's workspace (Conversation.workspaceId); null when none. */
  callerWorkspaceRole: string | null | undefined
  /** User.role: "ADMIN" | "MEMBER". */
  callerSystemRole: string | null | undefined
  /** The person being removed is the caller (leaving the group). */
  targetIsSelf?: boolean
}): boolean {
  if (input.kind !== "GROUP") return false
  if (input.targetIsSelf) return true
  if (input.callerSystemRole === "ADMIN") return true
  return GROUP_MEMBER_MANAGER_ROLES.has(input.callerWorkspaceRole ?? "")
}

// ── system messages: "Bagas added Mey" (SYSTEM-MESSAGES contract, owner 8 Oct 2026) ─────────────

/**
 * Message.kind. A SYSTEM row is a log line the server writes when a GROUP changes (people added,
 * removed or leaving, the group created or renamed). Its userId is whoever did it; its `content` is an
 * Indonesian sentence (systemMessageFallback) for clients that don't know `kind` yet — iOS 0.1.6,
 * Android, a cached web build — which draw it as an ordinary message from that person.
 */
export const MESSAGE_KIND_USER = "USER"
export const MESSAGE_KIND_SYSTEM = "SYSTEM"

export type SystemEventType = "members_added" | "member_removed" | "member_left" | "group_created" | "group_renamed"

export type SystemPerson = { id: string; name: string }

/**
 * Message.event on a SYSTEM row. `targets`: the people added / removed (members_added, group_created,
 * member_removed) — member_left carries the leaver as both actor and its one target. `name`: the group
 * name (group_created when it has one, group_renamed); `previousName`: the name before (renamed).
 */
export type SystemEvent = {
  type: SystemEventType
  actor: SystemPerson
  targets?: SystemPerson[]
  name?: string
  previousName?: string
}

export function isSystemMessage(m: { kind?: string | null } | null | undefined): boolean {
  return m?.kind === MESSAGE_KIND_SYSTEM
}

/**
 * Whether a message counts toward a member's unread: never your own, never a SYSTEM line (being told
 * that someone joined is not a message waiting for you). chat-unread.ts applies the same rule in SQL.
 */
export function countsTowardUnread(m: { kind?: string | null; userId: string }, viewerId: string): boolean {
  return !isSystemMessage(m) && m.userId !== viewerId
}

/** Replies (and reactions, mentions) are for people's messages: a SYSTEM line cannot be quoted. */
export function canReplyTo(m: { kind?: string | null } | null | undefined): boolean {
  return !!m && !isSystemMessage(m)
}

/** The 400 `code` when replyToId points at a SYSTEM row, and the sentence older apps show as it is. */
export const SYSTEM_MESSAGE_REPLY = "SYSTEM_MESSAGE_REPLY"
export const SYSTEM_MESSAGE_REPLY_MESSAGE = "Pesan sistem tidak bisa dibalas."

/** "Mey" · "Mey dan Yuza" · "Mey, Yuza dan Angela" (Indonesian; the web/iOS render their own). */
export function joinNames(names: string[], and = "dan"): string {
  const list = names.map((n) => n.trim()).filter(Boolean)
  if (list.length <= 1) return list[0] ?? ""
  return `${list.slice(0, -1).join(", ")} ${and} ${list[list.length - 1]}`
}

function personName(p: { name?: string | null } | null | undefined): string {
  return (p?.name ?? "").trim() || "Seseorang"
}

/**
 * The Indonesian sentence stored as a SYSTEM row's `content`: what a client that doesn't know `kind`
 * shows, in third person (no "kamu" — it is the same text for everyone in the room).
 */
export function systemMessageFallback(event: SystemEvent): string {
  const actor = personName(event.actor)
  const targets = (event.targets ?? []).map(personName)
  const group = (event.name ?? "").trim()
  switch (event.type) {
    case "members_added":
      return `${actor} menambahkan ${joinNames(targets) || "anggota baru"} ke grup`
    case "member_removed":
      return `${actor} mengeluarkan ${joinNames(targets) || "seorang anggota"} dari grup`
    case "member_left":
      return `${targets[0] ?? actor} keluar dari grup`
    case "group_created":
      return group ? `${actor} membuat grup “${group}”` : `${actor} membuat grup`
    case "group_renamed":
      return `${actor} mengubah nama grup jadi “${group}”`
    default:
      return actor
  }
}

/** A stored event read back (Message.event is JSON): the shape above, or null when it isn't one. */
export function parseSystemEvent(raw: unknown): SystemEvent | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  const types: SystemEventType[] = ["members_added", "member_removed", "member_left", "group_created", "group_renamed"]
  if (!types.includes(e.type as SystemEventType)) return null
  const person = (p: unknown): SystemPerson | null => {
    if (!p || typeof p !== "object") return null
    const { id, name } = p as Record<string, unknown>
    return typeof id === "string" && id ? { id, name: typeof name === "string" ? name : "" } : null
  }
  const actor = person(e.actor)
  if (!actor) return null
  const out: SystemEvent = { type: e.type as SystemEventType, actor }
  if (Array.isArray(e.targets)) out.targets = e.targets.map(person).filter((p): p is SystemPerson => p !== null)
  if (typeof e.name === "string") out.name = e.name
  if (typeof e.previousName === "string") out.previousName = e.previousName
  return out
}

/**
 * Who a SYSTEM row pushes: only the people it ADDS (members_added, group_created), never whoever did
 * it. Everything else — a removal, someone leaving, a rename — pushes nobody: the room is not told.
 */
export function systemPushRecipients(event: SystemEvent | null | undefined): string[] {
  if (!event || (event.type !== "members_added" && event.type !== "group_created")) return []
  const actorId = event.actor?.id
  return Array.from(new Set((event.targets ?? []).map((t) => t.id).filter((id) => !!id && id !== actorId)))
}

export type SystemPushDecision = { push: boolean; reason: "added" | "not_added" | "muted" | "dnd" }

/**
 * One room member, one SYSTEM row: a push only for someone it added. Being added is not a mention, so
 * Do Not Disturb (or a mute, should one already be set) keeps it quiet like any plain message.
 */
export function systemPushDecision(input: {
  event: SystemEvent | null | undefined
  userId: string
  mutedUntil?: When
  dndUntil?: When
  now?: Date | number
}): SystemPushDecision {
  const now = input.now instanceof Date ? input.now.getTime() : (input.now ?? Date.now())
  if (!systemPushRecipients(input.event).includes(input.userId)) return { push: false, reason: "not_added" }
  if (isFuture(input.mutedUntil, now)) return { push: false, reason: "muted" }
  if (isFuture(input.dndUntil, now)) return { push: false, reason: "dnd" }
  return { push: true, reason: "added" }
}

export type SystemPushContent = {
  title: string
  body: string
  type: "MESSAGE"
  link: string
  threadId: string
  data: ChatPushContent["data"] & { kind: "SYSTEM" }
}

/**
 * The push someone gets when they are added to a group: title = the group, body "{actor} menambahkan
 * kamu ke grup", thread-id and link = the conversation, so the tap opens the chat. Same keys as a chat
 * push (Android builds its notification from them) plus kind "SYSTEM". Not localized: chat pushes are
 * built in one language today (no per-person language on the server).
 */
export function buildSystemPush(input: {
  conversationId: string
  messageId: string
  conversationName?: string | null
  actorName?: string | null
}): SystemPushContent {
  const actor = (input.actorName ?? "").trim() || "Seseorang"
  const conversationName = chatConversationName("GROUP", input.conversationName, actor)
  const body = `${actor} menambahkan kamu ke grup`
  return {
    title: conversationName,
    body,
    type: "MESSAGE",
    link: chatLink(input.conversationId),
    threadId: input.conversationId,
    data: {
      conversationId: input.conversationId,
      messageId: input.messageId,
      conversationName,
      senderName: actor,
      isGroup: true,
      text: body,
      kind: "SYSTEM",
    },
  }
}

// ── group info screen (SYSTEM-MESSAGES contract, Part 2, owner 8 Oct 2026) ───────────────────────

/** Conversation.description: at most this many characters. */
export const DESCRIPTION_MAX = 500

/**
 * PATCH body `description`: absent → leave it (undefined), null or blank → clear it (null), a string up
 * to DESCRIPTION_MAX → that text, trimmed. Anything else is refused.
 */
export function parseDescription(raw: unknown):
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined }
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== "string") return { ok: false, error: "description must be a string or null" }
  const text = raw.trim()
  if (!text) return { ok: true, value: null }
  if (text.length > DESCRIPTION_MAX) return { ok: false, error: `description too long (max ${DESCRIPTION_MAX})` }
  return { ok: true, value: text }
}

/** Workspace roles shown as "Admin" in a room: the people who may add or remove members. */
export function isRoomAdmin(input: { workspaceRole: string | null | undefined; systemRole: string | null | undefined }): boolean {
  if (input.systemRole === "ADMIN") return true
  return GROUP_MEMBER_MANAGER_ROLES.has(input.workspaceRole ?? "")
}

/** The info screen's member list: admins first, then A–Z by name (Indonesian collation, case-blind). */
export function orderInfoMembers<T extends { name: string; isAdmin: boolean }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) =>
    a.isAdmin !== b.isAdmin ? (a.isAdmin ? -1 : 1) : a.name.localeCompare(b.name, "id", { sensitivity: "base" }),
  )
}

export type MediaType = "photos" | "links" | "docs"

export function parseMediaType(raw: string | null | undefined): MediaType | null {
  return raw === "photos" || raw === "links" || raw === "docs" ? raw : null
}

/** A picture, as everywhere else in chat: an image/* type, or none at all (the oldest uploads). */
export function isImageAttachment(attachmentType: string | null | undefined): boolean {
  const t = (attachmentType ?? "").trim().toLowerCase()
  return !t || t.startsWith("image/")
}

/** Media counts on the info screen stop here; a client shows "999+" at the cap. */
export const MEDIA_COUNT_CAP = 999

const LINK_RUN = /https?:\/\/[^\s<>"'`]+/gi
// Punctuation that ends the sentence rather than the address: "see https://x.id/a." is /a.
const LINK_TRAILING = /[.,;:!?'"’”)\]}>]+$/

/**
 * The http(s) addresses in a message, in order, one per occurrence: what the Links tab lists. The
 * same rule the web makes clickable (MessageText), minus bare "www." runs: only real http(s) URLs.
 */
export function extractLinks(text: string | null | undefined): string[] {
  const out: string[] = []
  for (const m of (text ?? "").matchAll(LINK_RUN)) {
    let url = m[0]
    const tail = LINK_TRAILING.exec(url)
    if (tail) {
      url = url.slice(0, tail.index)
      // "…/Foo_(bar))." keeps the ")" its own "(" opened.
      let rest = tail[0]
      while (rest.startsWith(")") && (url.match(/\(/g)?.length ?? 0) > (url.match(/\)/g)?.length ?? 0)) {
        url += ")"
        rest = rest.slice(1)
      }
    }
    try {
      const u = new URL(url)
      if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname) out.push(url)
    } catch {
      // not an address after all
    }
  }
  return out
}

/** A link's title on the Links tab: its host, without "www.". */
export function linkTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "")
  } catch {
    return url
  }
}

export const SEARCH_MIN = 2
export const SEARCH_MAX = 100

/** In-chat search `q`: trimmed, at least SEARCH_MIN characters, at most SEARCH_MAX. */
export function parseSearchQuery(raw: string | null | undefined):
  | { ok: true; q: string }
  | { ok: false; error: string; code: "QUERY_TOO_SHORT" | "QUERY_TOO_LONG" } {
  const q = (raw ?? "").replace(/\s+/g, " ").trim()
  if (q.length < SEARCH_MIN) return { ok: false, error: `q needs at least ${SEARCH_MIN} characters`, code: "QUERY_TOO_SHORT" }
  if (q.length > SEARCH_MAX) return { ok: false, error: `q is longer than ${SEARCH_MAX} characters`, code: "QUERY_TOO_LONG" }
  return { ok: true, q }
}

/**
 * A search hit's one line: whitespace folded, cut to about `max` characters around the first
 * case-insensitive match, with "…" where text was cut.
 */
export function searchSnippet(content: string | null | undefined, q: string, max = 120): string {
  const text = (content ?? "").replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return text.slice(0, max - 1).trimEnd() + "…"
  const lead = Math.max(0, Math.min(at - Math.floor((max - q.length) / 3), text.length - max))
  const end = Math.min(text.length, lead + max)
  return (lead > 0 ? "…" : "") + text.slice(lead, end).trim() + (end < text.length ? "…" : "")
}

/** How a page of `limit` centred on one message splits: the message itself, the rest before and after. */
export function aroundSplit(limit: number): { older: number; newer: number } {
  const rest = Math.max(0, limit - 1)
  const older = Math.ceil(rest / 2)
  return { older, newer: rest - older }
}

/**
 * Shape a page centred on `anchor` (GET …/messages?around=<id>). `older` was fetched newest first
 * with take = split.older + 1, `newer` oldest first with take = split.newer + 1; each extra row only
 * says there is more that way. Same keys as the before/after pages — messages (oldest first), hasMore
 * and nextCursor for what is older (pass as `before`) — plus hasMoreNewer and newerCursor, the id of
 * the newest message shown (pass as `after`).
 */
export function shapeAroundPage<T extends { id: string; createdAt: Date | string }>(
  older: T[],
  anchor: T,
  newer: T[],
  split: { older: number; newer: number },
): { messages: T[]; hasMore: boolean; nextCursor: string | null; hasMoreNewer: boolean; newerCursor: string | null; anchorId: string } {
  const hasMore = older.length > split.older
  const olderShown = older.slice(0, split.older).reverse()
  const hasMoreNewer = newer.length > split.newer
  const newerShown = newer.slice(0, split.newer)
  const messages = [...olderShown, anchor, ...newerShown]
  const oldest = messages[0]
  const newest = messages[messages.length - 1]
  return {
    messages,
    hasMore,
    nextCursor: hasMore ? encodeCursor(oldest.createdAt, oldest.id) : null,
    hasMoreNewer,
    newerCursor: hasMoreNewer ? newest.id : null,
    anchorId: anchor.id,
  }
}

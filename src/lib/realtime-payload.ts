/**
 * What a broadcast may carry about people (13 Oct 2026, realtime bug 2).
 *
 * Task events (`task-created`, `task-updated`, `comment-added`) used to carry whatever the route had loaded:
 * `assignees: { include: { user: true } }` and `creator: true` are FULL user rows — email, phone number,
 * Google Workspace address, session counters — sent to every socket in the project room. A person object in
 * a broadcast is now cut down to what a card or a comment shows. No client reads more: the web shows
 * `name` (email only as a fallback when there is no name, which every account has), iOS and Android read
 * ids only and refetch (Sources/Realtime/RealtimeClient.swift, core/realtime/Realtime.kt).
 *
 * Pure (no imports), so it is unit-tested with node --experimental-strip-types (realtime-payload.test.mjs).
 */

/** Fields of a person that a broadcast may carry. */
export const PUBLIC_PERSON_FIELDS = ["id", "name", "avatar", "image", "role", "deactivatedAt"] as const

const PERSON_PRIVATE_HINTS = ["email", "phoneNumber", "googleWorkspaceEmail", "sessionVersion", "password", "sessionsCutoffAt"]

/** A user row: has an id and a name plus at least one field only a user row has. */
function looksLikePerson(o: Record<string, unknown>): boolean {
  if (typeof o.id !== "string" || !("name" in o)) return false
  return PERSON_PRIVATE_HINTS.some((k) => k in o)
}

function publicPerson(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of PUBLIC_PERSON_FIELDS) if (k in o) out[k] = o[k]
  return out
}

/**
 * A copy of `value` with every person object in it cut down to PUBLIC_PERSON_FIELDS. Everything else is
 * kept as is (ids, titles, statuses, counts). Depth-capped: a payload deeper than that is cut, not walked.
 */
export function stripPrivatePeople<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((v) => stripPrivatePeople(v, depth + 1)) as unknown as T
  if (value instanceof Date) return value
  const o = value as Record<string, unknown>
  if (looksLikePerson(o)) return publicPerson(o) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[k] = stripPrivatePeople(v, depth + 1)
  return out as T
}

/**
 * The legacy `cursor-move` relay (old Next.js editor pages): only a position, never anything a client could
 * use to put words into someone else's screen. Null = drop it.
 */
export function cleanCursorMove(raw: unknown): { x: number; y: number; blockId?: string } | null {
  if (!raw || typeof raw !== "object") return null
  const d = raw as { x?: unknown; y?: unknown; blockId?: unknown }
  if (typeof d.x !== "number" || typeof d.y !== "number" || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null
  const out: { x: number; y: number; blockId?: string } = { x: Math.round(d.x), y: Math.round(d.y) }
  if (typeof d.blockId === "string" && d.blockId.length <= 100) out.blockId = d.blockId
  return out
}

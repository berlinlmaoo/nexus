/**
 * Old ids keep working after the UUIDv7 conversion (docs/internal/UUID-MIGRATION.md).
 *
 * Every id that existed before the conversion is in `legacy_id_map(old_id, new_id, model)`. Links in
 * chats/WhatsApp/push payloads, released apps' caches, old JWTs (token.id) and the offline attendance
 * queue still carry the old ones. This module turns an old id into the new one:
 *   - transparently for every Prisma query (legacyIdQueryExtension in lib/prisma.ts): any string sitting
 *     under an id-like key (`id`, `…Id`, `…Ids`, including `in`/`equals`/`lt`… operators and compound
 *     uniques) that is not already a UUID is looked up once and replaced;
 *   - explicitly where an id does not reach Prisma as such: the JWT (auth.ts, socket handshake), socket
 *     room names, upload file names (api/files), the SPA's address bar (GET /api/legacy-ids).
 *
 * Cost after the conversion: none for UUIDs (a regex test); a non-UUID id string costs one indexed
 * lookup, then it is cached (hit or miss) for the life of the process. Before the conversion (the map is
 * empty or missing) the resolver switches itself off and re-checks once a minute.
 *
 * State lives on globalThis: the App Router, the Pages socket server and instrumentation are separate
 * bundles of this module and should share one cache and one "is the map there" answer.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** What an old id can look like: cuid, 32-hex, and the hand-made ids of scripts/seeds (`fcat_1`, `demo-proj-x`). */
const CANDIDATE_RE = /^[A-Za-z0-9_-]{6,64}$/
/** Old ids as they appear inside text (links, file names): the cuid and 32-hex shapes only. */
const EMBEDDED_RE = /(?<![A-Za-z0-9])(c[a-z0-9]{24}|[0-9a-f]{32})(?![A-Za-z0-9])/g
/** The same, without the g flag (a g regex keeps lastIndex between .test calls). */
const HAS_EMBEDDED_RE = new RegExp(EMBEDDED_RE.source)

type Lookup = (oldIds: string[]) => Promise<Array<{ old_id: string; new_id: string }>>
type Reverse = (newId: string) => Promise<string | null>
type State = {
  lookup: Lookup | null
  probe: (() => Promise<boolean>) | null
  reverse: Reverse | null
  cache: Map<string, string | null>
  enabled: boolean | null
  checkedAt: number
  checking: Promise<boolean> | null
}
const MAX_CACHE = 50_000
const RECHECK_MS = 60_000

const g = globalThis as unknown as { __nexusLegacyIds?: State }
function state(): State {
  return (g.__nexusLegacyIds ??= { lookup: null, probe: null, reverse: null, cache: new Map(), enabled: null, checkedAt: 0, checking: null })
}

/** lib/prisma.ts wires the shared pg pool in (no import cycle with the Prisma client). */
export function setLegacyIdLookup(lookup: Lookup, probe: () => Promise<boolean>, reverse?: Reverse) {
  const s = state()
  s.lookup = lookup
  s.probe = probe
  s.reverse = reverse ?? null
}

/** The old id a converted row had (new -> old), or null. For storage still named by the old id (NAS folders). */
export async function legacyIdOf(newId: string): Promise<string | null> {
  const s = state()
  if (!s.reverse || !UUID_RE.test(newId) || !(await mapReady())) return null
  try {
    return await s.reverse(newId)
  } catch {
    return null
  }
}

export function isLegacyIdCandidate(value: unknown): value is string {
  return typeof value === 'string' && CANDIDATE_RE.test(value) && !UUID_RE.test(value)
}

async function mapReady(): Promise<boolean> {
  const s = state()
  if (!s.lookup || !s.probe) return false
  if (s.enabled === true) return true // once the map has rows it never goes away
  if (s.enabled === false && Date.now() - s.checkedAt < RECHECK_MS) return false
  if (s.checking) return s.checking
  s.checking = s.probe()
    .catch(() => false)
    .then((ok) => {
      s.enabled = ok
      s.checkedAt = Date.now()
      s.checking = null
      return ok
    })
  return s.checking
}

/** Old id -> new id for many strings at once; strings that are not old ids come back unchanged. */
export async function resolveLegacyIds(values: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Set(values.filter(isLegacyIdCandidate))]
  if (!wanted.length || !(await mapReady())) return out
  const s = state()
  const missing: string[] = []
  for (const v of wanted) {
    if (s.cache.has(v)) {
      const hit = s.cache.get(v)
      if (hit) out.set(v, hit)
    } else missing.push(v)
  }
  if (missing.length) {
    try {
      const rows = await s.lookup!(missing)
      const found = new Map(rows.map((r) => [r.old_id, r.new_id]))
      if (s.cache.size > MAX_CACHE) s.cache.clear()
      for (const v of missing) {
        const hit = found.get(v) ?? null
        s.cache.set(v, hit)
        if (hit) out.set(v, hit)
      }
    } catch {
      // The map must never take a request down: an unresolved old id behaves exactly as before.
    }
  }
  return out
}

export async function resolveLegacyId(value: string): Promise<string> {
  if (!isLegacyIdCandidate(value)) return value
  return (await resolveLegacyIds([value])).get(value) ?? value
}

/** Old ids embedded in a string (a link, a file name, a room key) replaced by the new ones. */
export async function resolveLegacyIdsInText(text: string): Promise<string> {
  if (!HAS_EMBEDDED_RE.test(text)) return text
  const found = [...text.matchAll(EMBEDDED_RE)].map((m) => m[1])
  const map = await resolveLegacyIds(found)
  if (!map.size) return text
  return text.replace(EMBEDDED_RE, (whole, id: string) => map.get(id) ?? whole)
}

/** Whether a room name's id part could be an old id (callers skip the await otherwise: event order matters). */
export function roomMayBeLegacy(room: string): boolean {
  const sep = room.indexOf(':')
  return sep > 0 && isLegacyIdCandidate(room.slice(sep + 1))
}

/** `project:<old>` -> `project:<new>` (socket rooms, collab keys "doc:<id>"). */
export async function canonicalRoom(room: string): Promise<string> {
  const sep = room.indexOf(':')
  if (sep < 1) return room
  const id = room.slice(sep + 1)
  const mapped = await resolveLegacyId(id)
  return mapped === id ? room : `${room.slice(0, sep)}:${mapped}`
}

/** A JWT minted before the conversion carries the old user id in `id`/`sub`. Mutates and returns it. */
export async function normalizeTokenUserId<T extends Record<string, unknown>>(token: T): Promise<T> {
  const t = token as Record<string, unknown>
  for (const key of ['id', 'sub'] as const) {
    if (isLegacyIdCandidate(t[key])) t[key] = await resolveLegacyId(t[key] as string)
  }
  return token
}

// ── Prisma: rewrite old ids in query arguments ────────────────────────────────────────────────────

const ID_KEY = /^(id|[A-Za-z0-9]+Id|[A-Za-z0-9]+Ids)$/
/** Prisma filter / write operators: they keep the id context of the key above them. */
const OPERATORS = new Set([
  'equals', 'in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte', 'has', 'hasSome', 'hasEvery', 'set', 'push',
  'contains', 'startsWith', 'endsWith', 'AND', 'OR', 'NOT',
])
/** Id-shaped keys that hold someone else's identifiers, never ours. */
const FOREIGN_KEYS = new Set(['credentialId', 'providerAccountId', 'clientId', 'deviceId', 'messageIdempotencyKey'])

type Slot = { holder: Record<string, unknown> | unknown[]; key: string | number; value: string }

function collect(node: unknown, inId: boolean, out: Slot[], depth = 0) {
  if (depth > 12 || node === null || typeof node !== 'object') return
  if (node instanceof Date || (typeof Buffer !== 'undefined' && Buffer.isBuffer(node))) return
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (inId && typeof v === 'string') {
        if (isLegacyIdCandidate(v)) out.push({ holder: node, key: i, value: v })
      } else collect(v, inId, out, depth + 1)
    })
    return
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const idHere = FOREIGN_KEYS.has(k) ? false : ID_KEY.test(k) ? true : OPERATORS.has(k) ? inId : false
    if (typeof v === 'string') {
      if (idHere && isLegacyIdCandidate(v)) out.push({ holder: node as Record<string, unknown>, key: k, value: v })
    } else collect(v, idHere, out, depth + 1)
  }
}

/** Rewrites, in place, every old id found under an id-like key of a Prisma args object. */
export async function rewriteLegacyIdsInArgs(args: unknown): Promise<void> {
  if (!args || typeof args !== 'object') return
  const slots: Slot[] = []
  collect(args, false, slots)
  if (!slots.length) return
  const map = await resolveLegacyIds(slots.map((s) => s.value))
  if (!map.size) return
  for (const s of slots) {
    const mapped = map.get(s.value)
    if (mapped) (s.holder as Record<string | number, unknown>)[s.key] = mapped
  }
}

/** For tests: forget everything. */
export function resetLegacyIdsForTests() {
  g.__nexusLegacyIds = undefined
}

/**
 * A file URL whose path still names an old id: a 308 to the same path with the new ids (relative Location,
 * so it works behind any proxy). Null when nothing in the path is an old id.
 */
export async function legacyFileRedirect(prefix: string, segments: string[], search = ''): Promise<Response | null> {
  if (!segments.some((s) => HAS_EMBEDDED_RE.test(s))) return null
  const mapped = await Promise.all(segments.map((s) => resolveLegacyIdsInText(s)))
  if (mapped.every((m, i) => m === segments[i])) return null
  const location = `${prefix}/${mapped.map(encodeURIComponent).join('/')}${search}`
  return new Response(null, { status: 308, headers: { Location: location, 'Cache-Control': 'no-store' } })
}

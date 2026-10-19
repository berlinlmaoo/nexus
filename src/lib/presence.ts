import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { getAppConfig } from "@/lib/app-config"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { isSingletonLeader } from "@/lib/bluegreen"
import { SYSTEM_USER_EMAILS } from "@/lib/system-users"
import { getHolidayKeys } from "@/lib/holidays"
import { isAutoDeduction } from "@/lib/attendance-day-lock"
import { usualOfficeByUser } from "@/lib/attendance-absence"
import { isCheckInAway } from "@/lib/attendance-place"
import {
  FLEXI_WINDOW_START,
  formatAttendanceDateKey,
  getAttendanceDate,
  isRestDayForMember,
  isWorkdayForAttendanceDate,
  resolveEffectiveAttendanceShift,
  resolveShiftWindowAt,
} from "@/lib/attendance"
import {
  checkManualStatus,
  decidePresence,
  nextClockEdge,
  samePresence,
  type PresenceFacts,
  type PresenceStatus,
} from "@/lib/presence-core"

export * from "@/lib/presence-core"

/**
 * Presence status (owner, 19 Oct 2026) — the database side. The rule lives in presence-core.ts (pure, tested);
 * this file gathers the facts in a handful of batch queries, caches the result per person, and sends
 * `presence-changed` when someone's status really changed.
 *
 * READ-ONLY on attendance: nothing here writes a record, a request or a point, and nothing here sends a
 * notification or a push (owner: status changes are never announced). The only table it writes is its own
 * PresenceManualStatus (the manual "Away · <text>").
 *
 * Whose workspace: a person's presence is computed in their attendance workspace — the membership with the oldest
 * joinedAt, the same one check-in uses (getAttendanceWorkspaceContext). Anyone sharing ANY workspace with them may
 * read it (owner: everyone in the workspace sees the status and its reason).
 *
 * Freshness:
 *   - writes that change it call touchPresence(userId) (check-in/out, live location, request review, manual set/clear);
 *   - the leader slot's minute ticker recomputes everyone and catches the clock (shift start/end, a manual status
 *     starting or ending, which it also deletes) and anything a hook missed;
 *   - a cached status is served for at most CACHE_MS, and never past its next clock edge.
 *   Every process keeps its own cache and updates it from `presence-changed` on the bus (the realtime bridge
 *   carries it between the blue-green slots).
 */

const log = createLogger("presence")
const CACHE_MS = 30_000
const SLOW_CACHE_MS = 10 * 60_000
/** An open record stops counting this long after its shift ended (forgot to check out → Offline, not Online all night). */
const OPEN_GRACE_MS = 6 * 3600e3
const FLEXI_HOURS = 9

type Entry = { status: PresenceStatus; workspaceIds: string[]; validUntil: number }
type Cache = {
  byUser: Map<string, Entry>
  shifts: Map<string, { at: number; start: string; end: string; flexi: boolean }>
  usual: Map<string, { at: number; map: Map<string, string> }>
  listening: boolean
  ticker: boolean
}
const g = globalThis as unknown as { __nexusPresence?: Cache }
const cache: Cache = g.__nexusPresence ?? { byUser: new Map(), shifts: new Map(), usual: new Map(), listening: false, ticker: false }
g.__nexusPresence = cache

// Statuses sent by any process (this one included, and the other blue-green slot via the bridge) refresh this cache.
if (!cache.listening) {
  cache.listening = true
  eventBus.on(BUS_EVENTS.PRESENCE_CHANGED, (data: { userId?: string; workspaceIds?: string[]; status?: PresenceStatus }) => {
    if (!data?.userId || !data.status) return
    const prev = cache.byUser.get(data.userId)
    cache.byUser.set(data.userId, { status: data.status, workspaceIds: data.workspaceIds ?? prev?.workspaceIds ?? [], validUntil: Date.now() + CACHE_MS })
  })
}

/** Remote-config kill switch (flags.presenceStatus, default on). A config read error keeps it on. */
export async function presenceEnabled(): Promise<boolean> {
  const cfg = await getAppConfig(null).catch(() => null)
  return (cfg?.flags as Record<string, unknown> | undefined)?.presenceStatus !== false
}

type Office = Awaited<ReturnType<typeof prisma.officeLocation.findMany>>[number]

async function shiftFor(userId: string, workspaceId: string, office: Office, date: Date, dateKey: string) {
  const key = `${userId}|${workspaceId}|${office.id}|${dateKey}`
  const hit = cache.shifts.get(key)
  if (hit && Date.now() - hit.at < SLOW_CACHE_MS) return hit
  const s = await resolveEffectiveAttendanceShift({ userId, workspaceId, office, date })
  const v = { at: Date.now(), start: s.shiftStartTime, end: s.shiftEndTime, flexi: Boolean(s.flexi) }
  cache.shifts.set(key, v)
  if (cache.shifts.size > 5000) cache.shifts.clear()
  return v
}

async function usualOffices(workspaceId: string, offices: Office[]): Promise<Map<string, string>> {
  const hit = cache.usual.get(workspaceId)
  if (hit && Date.now() - hit.at < SLOW_CACHE_MS) return hit.map
  const m = await usualOfficeByUser(workspaceId, offices)
  const map = new Map([...m].map(([u, o]) => [u, o.id] as const))
  cache.usual.set(workspaceId, { at: Date.now(), map })
  return map
}

/** One shift window of `date` for this person, as instants (flexi: 12:00 until 9 hours after the latest on-time start). */
function windowOf(date: Date, office: Office, shift: { start: string; end: string; flexi: boolean }) {
  if (shift.flexi) {
    const w = resolveShiftWindowAt(date, office, { shiftStartTime: FLEXI_WINDOW_START, shiftEndTime: shift.end })
    return { start: w.shiftStartAt, end: new Date(w.shiftEndAt.getTime() + FLEXI_HOURS * 3600e3) }
  }
  const w = resolveShiftWindowAt(date, office, { shiftStartTime: shift.start, shiftEndTime: shift.end })
  return { start: w.shiftStartAt, end: w.shiftEndAt }
}

const REQUEST_RANK: Record<string, number> = { SICK: 0, LEAVE: 1, DAY_OFF: 2, RED_DATE: 3, PERMIT: 4 }

/**
 * Compute the status of these people (null = every active member of every workspace) right now. Batch: the cost
 * is a fixed number of queries plus, the first time each day, one shift lookup per person not checked in.
 */
async function computePresence(userIds: string[] | null, now = new Date()): Promise<Map<string, Entry>> {
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      ...(userIds ? { userId: { in: userIds } } : {}),
      user: { deactivatedAt: null, email: { notIn: SYSTEM_USER_EMAILS } },
    },
    select: { userId: true, workspaceId: true, role: true, joinedAt: true, restDays: true },
    orderBy: { joinedAt: "asc" },
  })
  const primary = new Map<string, (typeof memberships)[number]>()
  const rooms = new Map<string, string[]>()
  for (const m of memberships) {
    if (!primary.has(m.userId)) primary.set(m.userId, m)
    rooms.set(m.userId, [...(rooms.get(m.userId) ?? []), m.workspaceId])
  }
  const ids = [...primary.keys()]
  const out = new Map<string, Entry>()
  if (!ids.length) return out

  const today = getAttendanceDate(now)
  const yesterday = new Date(today.getTime() - 86400e3)
  const todayKey = formatAttendanceDateKey(now)
  const yesterdayKey = yesterday.toISOString().slice(0, 10)
  const wsIds = [...new Set([...primary.values()].map((m) => m.workspaceId))]

  const [offices, records, requests, manuals] = await Promise.all([
    prisma.officeLocation.findMany({ where: { workspaceId: { in: wsIds }, isActive: true, archivedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.attendanceRecord.findMany({
      where: { userId: { in: ids }, workspaceId: { in: wsIds }, attendanceDate: { in: [yesterday, today] } },
      select: {
        userId: true, workspaceId: true, attendanceDate: true, status: true, checkInAt: true, checkOutAt: true, outsideSince: true,
        checkInDistanceMeters: true, effectiveShiftStartTime: true, effectiveShiftEndTime: true, attendanceFlexi: true,
        officeLocation: true,
      },
    }),
    prisma.attendanceRequest.findMany({
      where: { userId: { in: ids }, workspaceId: { in: wsIds }, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
      select: { userId: true, workspaceId: true, type: true, endDate: true, reason: true, reviewedById: true, approvalSource: true },
    }),
    prisma.presenceManualStatus.findMany({ where: { userId: { in: ids }, endsAt: { gt: now } } }),
  ])

  const officesByWs = new Map<string, Office[]>()
  for (const o of offices) officesByWs.set(o.workspaceId, [...(officesByWs.get(o.workspaceId) ?? []), o])
  const holidaysByWs = new Map<string, Set<string>>()
  const usualByWs = new Map<string, Map<string, string>>()
  await Promise.all(wsIds.map(async (ws) => {
    const list = officesByWs.get(ws) ?? []
    if (!list.length) return
    holidaysByWs.set(ws, await getHolidayKeys(ws, yesterday, today).catch(() => new Set<string>()))
    usualByWs.set(ws, await usualOffices(ws, list).catch(() => new Map<string, string>()))
  }))
  const manualByUser = new Map(manuals.map((m) => [m.userId, m] as const))

  await Promise.all(ids.map(async (userId) => {
    const m = primary.get(userId)!
    const ws = m.workspaceId
    const wsOffices = officesByWs.get(ws) ?? []
    const mine = records.filter((r) => r.userId === userId && r.workspaceId === ws)
    const todayRec = mine.find((r) => r.attendanceDate.getTime() === today.getTime()) ?? null

    // The open record that still counts: checked in, not out, and not long past its own shift end.
    let open: PresenceFacts["open"] = null
    for (const r of [todayRec, mine.find((x) => x.attendanceDate.getTime() === yesterday.getTime()) ?? null]) {
      if (!r || r.status !== "CHECKED_IN" || r.checkOutAt || !r.checkInAt) continue
      const end = r.attendanceFlexi
        ? new Date(r.checkInAt.getTime() + FLEXI_HOURS * 3600e3)
        : resolveShiftWindowAt(r.attendanceDate, r.officeLocation, { shiftStartTime: r.effectiveShiftStartTime, shiftEndTime: r.effectiveShiftEndTime }).shiftEndAt
      if (now.getTime() > Math.max(end.getTime(), r.checkInAt.getTime()) + OPEN_GRACE_MS) continue
      open = { checkInAt: r.checkInAt, outsideSince: r.outsideSince, checkInAway: isCheckInAway(r) === true }
      break
    }

    const req = requests
      .filter((r) => r.userId === userId && r.workspaceId === ws && !isAutoDeduction(r))
      .sort((a, b) => (REQUEST_RANK[a.type] ?? 9) - (REQUEST_RANK[b.type] ?? 9))[0]

    let notExpected: PresenceFacts["notExpected"] = null
    const windows: PresenceFacts["windows"] = []
    if (m.role === "BOD" || m.role === "ONE_ABOVE_ALL" || !wsOffices.length) {
      notExpected = "exempt"
    } else {
      const usualId = usualByWs.get(ws)?.get(userId)
      const holidays = holidaysByWs.get(ws) ?? new Set<string>()
      const yRec = mine.find((x) => x.attendanceDate.getTime() === yesterday.getTime())
      // Only when it can matter: no open record, nothing approved, not checked out today.
      if (!open && !req && !todayRec?.checkOutAt) {
        for (const [date, key, rec] of [[yesterday, yesterdayKey, yRec], [today, todayKey, todayRec]] as const) {
          const office = (rec?.officeLocation && wsOffices.find((o) => o.id === rec.officeLocation.id)) || wsOffices.find((o) => o.id === usualId) || wsOffices[0]
          const workday = isWorkdayForAttendanceDate(date, office) && !isRestDayForMember(date, m.restDays, office.timezone) && !holidays.has(key)
          if (!workday) continue
          // Yesterday's window only matters for a night shift still running; a day already worked or excused is done.
          if (date === yesterday && rec) continue
          try {
            windows.push(windowOf(date, office, await shiftFor(userId, ws, office, date, key)))
          } catch (error) {
            log.warn("shift lookup failed", { userId, error: String(error) })
          }
        }
        const t = now.getTime()
        if (!windows.some((w) => w.start.getTime() <= t && t < w.end.getTime())) {
          const office = wsOffices.find((o) => o.id === usualId) || wsOffices[0]
          const todayWork = isWorkdayForAttendanceDate(today, office) && !isRestDayForMember(today, m.restDays, office.timezone) && !holidays.has(todayKey)
          if (!todayWork) notExpected = "not_a_workday"
        }
      }
    }

    const mr = manualByUser.get(userId) ?? null
    const facts: PresenceFacts = {
      userId,
      now,
      manual: mr ? { id: mr.id, text: mr.text, startsAt: mr.startsAt, endsAt: mr.endsAt } : null,
      open,
      checkedOutAt: !open && todayRec?.checkOutAt ? todayRec.checkOutAt : null,
      request: req ? { type: req.type, endDay: req.endDate.toISOString().slice(0, 10) } : null,
      notExpected,
      windows,
    }
    const status = decidePresence(facts)
    const edge = nextClockEdge(facts)
    out.set(userId, { status, workspaceIds: rooms.get(userId) ?? [ws], validUntil: Math.min(Date.now() + CACHE_MS, edge ?? Infinity) })
  }))
  return out
}

/** Statuses of these people, from the cache where it is fresh, computed in one batch where not. */
export async function getPresence(userIds: string[]): Promise<Map<string, PresenceStatus>> {
  const want = [...new Set(userIds)]
  const res = new Map<string, PresenceStatus>()
  const stale: string[] = []
  const t = Date.now()
  for (const id of want) {
    const e = cache.byUser.get(id)
    if (e && e.validUntil > t) res.set(id, e.status)
    else stale.push(id)
  }
  if (stale.length) {
    const fresh = await computePresence(stale)
    for (const [id, e] of fresh) {
      cache.byUser.set(id, e)
      res.set(id, e.status)
    }
  }
  return res
}

/** Everyone the viewer shares a workspace with (themselves included): active people only, no system accounts. */
export async function visibleUserIds(viewerId: string): Promise<string[]> {
  const mine = await prisma.workspaceMember.findMany({ where: { userId: viewerId }, select: { workspaceId: true } })
  if (!mine.length) return [viewerId]
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId: { in: mine.map((m) => m.workspaceId) }, user: { deactivatedAt: null, email: { notIn: SYSTEM_USER_EMAILS } } },
    select: { userId: true },
    distinct: ["userId"],
  })
  return rows.map((r) => r.userId)
}

/** The viewer may see this person's status (they share a workspace, or it is themselves). */
export async function canSeePresence(viewerId: string, userId: string): Promise<boolean> {
  if (viewerId === userId) return true
  const n = await prisma.workspaceMember.count({
    where: { userId, workspace: { members: { some: { userId: viewerId } } } },
  })
  return n > 0
}

function emit(userId: string, entry: Entry) {
  try {
    eventBus.emit(BUS_EVENTS.PRESENCE_CHANGED, { userId, workspaceIds: entry.workspaceIds, status: entry.status })
  } catch (error) {
    log.warn("presence-changed listener failed", { error: String(error) })
  }
}

/**
 * Something that can change these people's status was just written: recompute now, and send `presence-changed`
 * to their workspaces when it looks different. Never throws and never delays the caller's answer beyond the
 * recompute; call it AFTER the write committed. A no-op while the feature is switched off.
 */
export async function touchPresence(userIds: Array<string | null | undefined>): Promise<void> {
  try {
    const ids = [...new Set(userIds.filter((x): x is string => typeof x === "string" && x.length > 0))]
    if (!ids.length || !(await presenceEnabled())) return
    const fresh = await computePresence(ids)
    for (const [id, e] of fresh) {
      const prev = cache.byUser.get(id)
      cache.byUser.set(id, e)
      if (!samePresence(prev?.status, e.status)) emit(id, e)
    }
  } catch (error) {
    log.warn("touchPresence failed", { error: String(error) })
  }
}

/** Fire-and-forget form for routes: the answer never waits for it, and it never fails a write. */
export function touchPresenceSoon(...userIds: Array<string | null | undefined>): void {
  setTimeout(() => { void touchPresence(userIds) }, 50).unref?.()
}

// ── manual status ─────────────────────────────────────────────────────────────

/**
 * Set the person's manual status (replaces any earlier one: one per person). Race-safe: a single upsert on the
 * unique userId, so two devices setting at once end with exactly one row (the later write), never two.
 */
export async function setManualStatus(userId: string, input: { text: unknown; startsAt: Date | null; endsAt: Date | null; source: string }, now = new Date()) {
  const ok = checkManualStatus(input, now)
  const source = ["web", "ios", "android", "gideon"].includes(input.source) ? input.source : "web"
  const row = await prisma.presenceManualStatus.upsert({
    where: { userId },
    create: { userId, text: ok.text, startsAt: ok.startsAt, endsAt: ok.endsAt, source },
    update: { text: ok.text, startsAt: ok.startsAt, endsAt: ok.endsAt, source },
  })
  await touchPresence([userId])
  return row
}

/**
 * Clear the person's manual status. With `id`, only that one (a second device clearing an old status must not wipe
 * a newer one set in between); without, whatever is there. Returns how many rows went (0 = nothing to clear).
 */
export async function clearManualStatus(userId: string, id?: string | null): Promise<number> {
  const res = await prisma.presenceManualStatus.deleteMany({ where: { userId, ...(id ? { id } : {}) } })
  await touchPresence([userId])
  return res.count
}

export async function getManualStatus(userId: string) {
  return prisma.presenceManualStatus.findFirst({ where: { userId, endsAt: { gt: new Date() } } })
}

// ── the clock ─────────────────────────────────────────────────────────────────

/**
 * One pass of the clock: expired manual statuses are deleted, everyone is recomputed, and whoever changed gets
 * `presence-changed`. Leader slot only (lib/bluegreen.ts), never on a read-only replica.
 */
export async function presenceTick(now = new Date()): Promise<{ changed: number; expired: number }> {
  if (!(await presenceEnabled())) return { changed: 0, expired: 0 }
  // The condition is evaluated at delete time, so a status re-set a moment ago (new endsAt) is never deleted.
  const due = await prisma.presenceManualStatus.findMany({ where: { endsAt: { lte: now } }, select: { id: true, userId: true } })
  const expired = due.length
    ? (await prisma.presenceManualStatus.deleteMany({ where: { id: { in: due.map((r) => r.id) }, endsAt: { lte: now } } })).count
    : 0
  // Whoever's status just ended is told even when this process has no earlier entry for them (a slot that just
  // became leader after a deploy starts with an empty cache: QA final 19 Oct 2026, a status ended and nobody's
  // screen moved off "Away · …").
  const ended = new Set(due.map((r) => r.userId))
  const fresh = await computePresence(null, now)
  let changed = 0
  for (const [id, e] of fresh) {
    const prev = cache.byUser.get(id)
    cache.byUser.set(id, e)
    if (prev ? !samePresence(prev.status, e.status) : ended.has(id)) {
      changed++
      emit(id, e)
    }
  }
  return { changed, expired }
}

export function startPresenceTicker() {
  if (cache.ticker) return
  cache.ticker = true
  let busy = false
  const tick = async () => {
    if (busy || !isSingletonLeader()) return
    busy = true
    try {
      const rows = await prisma.$queryRaw<Array<{ ro: boolean }>>`select pg_is_in_recovery() as ro`
      if (rows[0]?.ro) return
      const r = await presenceTick()
      if (r.changed || r.expired) log.info("presence tick", r)
    } catch (error) {
      log.error("presence tick failed", { error: String(error) })
    } finally {
      busy = false
    }
  }
  setTimeout(() => { void tick() }, 25_000).unref?.()
  setInterval(() => { void tick() }, 60_000).unref?.()
}

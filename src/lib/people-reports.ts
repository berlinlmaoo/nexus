import prisma from "@/lib/prisma"
import {
  ATTENDANCE_TIMEZONE,
  attendancePeriodKey,
  attendancePeriodRange,
  attendanceWallClockToUtc,
  formatAttendanceDateKey,
} from "@/lib/attendance"
import { classifyAttendanceDays, type ClassifiedAttendanceDay } from "@/lib/attendance-days"
import { getPeriodScores, levelForXp, PERIOD_BASELINE_XP, xpPenaltyKind, type XpPenaltyKind } from "@/lib/gamification"

/**
 * Reports per crew — the numbers behind GET /api/reports/people and /api/reports/people/[userId].
 *
 * Owner's rules (24 Sep 2026), which every function here assumes:
 *  - the period is the attendance period, 28th → 27th, and every "which day" is an Asia/Jakarta day;
 *  - a task with n assignees gives each of them 1/n (fractional; sent with one decimal);
 *  - WHO may be looked at is decided before this file is reached (reportableUserIds); nothing in
 *    here widens or narrows the set it is given.
 *
 * Work counts only top-level tasks (parentId = null, same as the old /api/reports), never CANCELLED,
 * never from calendar-only projects (disableTaskStatus). Open / overdue / due-soon also leave out
 * ARCHIVED projects: a task nobody can see any more is not somebody's overdue work.
 */

// ── periods ──────────────────────────────────────────────────────────────────────────────────────

export type Ratio = { num: number; den: number }

export type ReportPeriod = {
  /** "YYYY-MM" when the window is an attendance period (28th → 27th ending that month), else null. */
  key: string | null
  /** Inclusive first and last day, "YYYY-MM-DD" in Asia/Jakarta. */
  from: string
  to: string
  timezone: string
  /** Today falls inside [from, to]. */
  isCurrent: boolean
  days: number
  /** Days of the window already begun (today included); 0 for a future window, `days` for a past one. */
  daysElapsed: number
}

export type ReportWindow = ReportPeriod & {
  /** Instants: [fromAt, toAt) — 00:00 WIB of `from` up to 00:00 WIB of the day after `to`. */
  fromAt: Date
  toAt: Date
  /** UTC-midnight attendance dates (how attendanceDate is stored), inclusive. */
  fromDate: Date
  toDate: Date
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/
const MAX_WINDOW_DAYS = 366
const DAY_MS = 24 * 60 * 60 * 1000

function keyToUtcDate(key: string) {
  return new Date(`${key}T00:00:00.000Z`)
}

export function addDaysToKey(key: string, days: number) {
  const d = keyToUtcDate(key)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetweenKeys(fromKey: string, toKey: string) {
  return Math.round((keyToUtcDate(toKey).getTime() - keyToUtcDate(fromKey).getTime()) / DAY_MS)
}

function isValidDateKey(value: string) {
  const m = DATE_KEY.exec(value)
  if (!m) return false
  const d = keyToUtcDate(value)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function previousMonthKey(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}

function wibMidnight(key: string): Date {
  const at = attendanceWallClockToUtc(key, "00:00")
  if (!at) throw new Error(`bad date key ${key}`)
  return at
}

export function makeReportWindow(fromKey: string, toKey: string, key: string | null): ReportWindow {
  const todayKey = formatAttendanceDateKey()
  const days = daysBetweenKeys(fromKey, toKey) + 1
  const daysElapsed = todayKey < fromKey ? 0 : todayKey > toKey ? days : daysBetweenKeys(fromKey, todayKey) + 1
  return {
    key,
    from: fromKey,
    to: toKey,
    timezone: ATTENDANCE_TIMEZONE,
    isCurrent: fromKey <= todayKey && todayKey <= toKey,
    days,
    daysElapsed,
    fromAt: wibMidnight(fromKey),
    toAt: wibMidnight(addDaysToKey(toKey, 1)),
    fromDate: keyToUtcDate(fromKey),
    toDate: keyToUtcDate(toKey),
  }
}

function periodWindow(monthKey: string): ReportWindow {
  const { start, end } = attendancePeriodRange(monthKey)
  return makeReportWindow(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), monthKey)
}

/**
 * `period=YYYY-MM` → the 28→27 attendance period ending that month; `from`/`to` (YYYY-MM-DD, both
 * required, ≤ 366 days) → that window; neither → the current attendance period. The previous window is
 * the period before, or for from/to the same number of days immediately before `from`.
 */
export function resolveReportWindows(
  params: URLSearchParams,
): { current: ReportWindow; previous: ReportWindow } | { error: string } {
  const period = params.get("period")
  const from = params.get("from")
  const to = params.get("to")

  if (period && (from || to)) return { error: "Use either period or from/to, not both" }
  if (from || to) {
    if (!from || !to) return { error: "from and to are both required" }
    if (!isValidDateKey(from) || !isValidDateKey(to)) return { error: "from/to must be YYYY-MM-DD" }
    if (from > to) return { error: "from must not be after to" }
    const span = daysBetweenKeys(from, to) + 1
    if (span > MAX_WINDOW_DAYS) return { error: `A window is at most ${MAX_WINDOW_DAYS} days` }
    return {
      current: makeReportWindow(from, to, null),
      previous: makeReportWindow(addDaysToKey(from, -span), addDaysToKey(from, -1), null),
    }
  }
  if (period && !MONTH_KEY.test(period)) return { error: "period must be YYYY-MM" }
  const monthKey = period ?? attendancePeriodKey()
  return { current: periodWindow(monthKey), previous: periodWindow(previousMonthKey(monthKey)) }
}

export function publicPeriod(w: ReportWindow): ReportPeriod {
  return { key: w.key, from: w.from, to: w.to, timezone: w.timezone, isCurrent: w.isCurrent, days: w.days, daysElapsed: w.daysElapsed }
}

// ── shapes ───────────────────────────────────────────────────────────────────────────────────────

export type HeadlineFigures = {
  /** New assignments in the window (TaskAssignee.assignedAt), split 1/n. */
  assigned: number
  /** Tasks completed in the window (Task.completedAt), split 1/n. */
  completed: number
  /** num = completed by the end of their due day (WIB), den = completed tasks that had a due date. Split. */
  onTime: Ratio
  /** Open tasks past their due day at the window's end (or now, for the current window). Split. */
  overdue: number
  /** Median days from task creation to completion, over tasks completed in the window (unsplit). */
  medianCycleDays: number | null
  present: number
  late: number
  lateMinutes: number
  earlyLeave: number
  absent: number
  leave: number
  sick: number
  permit: number
  dayOff: number
  avgWorkedMinutes: number | null
  /** num = present + permit days, den = present + permit + absent days. */
  attendanceRate: Ratio
  /** num = late days, den = present days. */
  lateRate: Ratio
  /** num = check-outs with a reflection, den = check-outs. */
  reflectionRate: Ratio
  /** PERIOD_BASELINE_XP + the XP moved inside the window. */
  xpScore: number
  /** Sum of negative XP inside the window (≤ 0). */
  xpPenalty: number
}

export type OverdueTask = {
  id: string
  title: string
  projectId: string
  projectName: string
  dueDate: string
  /** Due day in WIB, "YYYY-MM-DD". */
  dueKey: string
  daysOverdue: number
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
  assigneeCount: number
  /** This person's share of the task, 1/assigneeCount, one decimal. */
  share: number
}

export type PersonWork = {
  assigned: number
  completed: number
  onTime: Ratio
  dueWithDate: number
  overdueNow: number
  overdueList: OverdueTask[]
  openTotal: number
  openByPriority: { URGENT: number; HIGH: number; MEDIUM: number; LOW: number; NONE: number }
  dueNext7: number
  medianCycleDays: number | null
  /** Tasks the median was taken over. */
  cycleSample: number
  weekly: { from: string; to: string; completed: number; onTime: number }[]
  perProject: { projectId: string; projectName: string; completed: number; open: number; overdue: number }[]
}

export type PersonAttendance = {
  present: number
  late: number
  lateMinutes: number
  earlyLeave: number
  absent: number
  leave: number
  sick: number
  permit: number
  dayOff: number
  avgWorkedMinutes: number | null
  /** Days avgWorkedMinutes was taken over (present days with worked minutes > 0). */
  workedDays: number
  reflections: number
  checkouts: number
  attendanceRate: Ratio
  lateRate: Ratio
  reflectionRate: Ratio
}

export type PersonXp = {
  periodScore: number
  baseline: number
  level: { level: number; name: string; floor: number; nextFloor: number | null; pct: number; isMax: boolean }
  streak: { current: number; longest: number }
  penalties: { kind: XpPenaltyKind; count: number; xp: number }[]
  penaltyTotal: number
}

export type PersonReportData = {
  headline: HeadlineFigures
  previous: HeadlineFigures
  work: PersonWork
  attendance: PersonAttendance
  xp: PersonXp
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

/** One decimal — every split count and every ratio part is sent like this. */
export const r1 = (n: number) => Math.round(n * 10) / 10

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const inKeys = (key: string, w: ReportWindow) => key >= w.from && key <= w.to
const inInstants = (at: Date, w: ReportWindow) => at.getTime() >= w.fromAt.getTime() && at.getTime() < w.toAt.getTime()

const TASK_SELECT = {
  id: true,
  title: true,
  priority: true,
  dueDate: true,
  createdAt: true,
  completedAt: true,
  taskList: { select: { project: { select: { id: true, name: true } } } },
  assignees: { select: { userId: true } },
} as const

type TaskRow = {
  id: string
  title: string
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
  dueDate: Date | null
  createdAt: Date
  completedAt: Date | null
  taskList: { project: { id: string; name: string } }
  assignees: { userId: string }[]
}

const shareOf = (t: { assignees: { userId: string }[] }) => (t.assignees.length > 0 ? 1 / t.assignees.length : 0)

/** Open-task snapshot at instant T: due on a WIB day before T's day, created before T, not completed by T. */
async function overdueSnapshot(workspaceId: string, userIds: string[], at: Date): Promise<Map<string, number>> {
  const cutKey = formatAttendanceDateKey(at)
  const cutAt = wibMidnight(cutKey)
  const rows = await prisma.task.findMany({
    where: {
      parentId: null,
      assignees: { some: { userId: { in: userIds } } },
      status: { not: "CANCELLED" },
      dueDate: { lt: cutAt },
      createdAt: { lt: at },
      OR: [{ completedAt: null }, { completedAt: { gte: at } }],
      taskList: { project: { workspaceId, disableTaskStatus: false, status: { not: "ARCHIVED" } } },
    },
    select: { assignees: { select: { userId: true } } },
  })
  const out = new Map<string, number>()
  for (const t of rows) {
    const share = shareOf(t)
    for (const a of t.assignees) if (userIds.includes(a.userId)) out.set(a.userId, (out.get(a.userId) ?? 0) + share)
  }
  return out
}

function attendanceFigures(days: ClassifiedAttendanceDay[], w: ReportWindow): PersonAttendance {
  let present = 0, late = 0, lateMinutes = 0, earlyLeave = 0, absent = 0, leave = 0, sick = 0, permit = 0, dayOff = 0
  let workedDays = 0, workedTotal = 0, reflections = 0, checkouts = 0
  for (const d of days) {
    if (!inKeys(d.dateKey, w)) continue
    switch (d.dayType) {
      case "PRESENT":
        present++
        if (d.lateMinutes > 0) { late++; lateMinutes += d.lateMinutes }
        if (d.earlyLeaveMinutes > 0) earlyLeave++
        if (d.workedMinutes > 0) { workedDays++; workedTotal += d.workedMinutes }
        if (d.checkedOut) checkouts++
        if (d.hasReflection) reflections++
        break
      case "ABSENT": absent++; break
      case "LEAVE_APPROVED": leave++; break
      case "SICK_APPROVED": sick++; break
      case "PERMIT_APPROVED": permit++; break
      case "DAY_OFF_APPROVED": dayOff++; break
    }
  }
  return {
    present, late, lateMinutes, earlyLeave, absent, leave, sick, permit, dayOff,
    avgWorkedMinutes: workedDays > 0 ? Math.round(workedTotal / workedDays) : null,
    workedDays,
    reflections,
    checkouts,
    attendanceRate: { num: present + permit, den: present + permit + absent },
    lateRate: { num: late, den: present },
    reflectionRate: { num: reflections, den: checkouts },
  }
}

type WorkCore = { completed: number; onTime: number; dueWithDate: number; cycleDays: number[] }

function workCore(userId: string, completedTasks: TaskRow[], w: ReportWindow): WorkCore {
  let completed = 0, onTime = 0, dueWithDate = 0
  const cycleDays: number[] = []
  for (const t of completedTasks) {
    if (!t.completedAt || !inInstants(t.completedAt, w)) continue
    if (!t.assignees.some((a) => a.userId === userId)) continue
    const share = shareOf(t)
    completed += share
    cycleDays.push(Math.max(0, (t.completedAt.getTime() - t.createdAt.getTime()) / DAY_MS))
    if (t.dueDate) {
      dueWithDate += share
      if (formatAttendanceDateKey(t.completedAt) <= formatAttendanceDateKey(t.dueDate)) onTime += share
    }
  }
  return { completed, onTime, dueWithDate, cycleDays }
}

function headlineOf(args: {
  assigned: number
  work: WorkCore
  overdue: number
  att: PersonAttendance
  xpScore: number
  xpPenalty: number
}): HeadlineFigures {
  const m = median(args.work.cycleDays)
  return {
    assigned: r1(args.assigned),
    completed: r1(args.work.completed),
    onTime: { num: r1(args.work.onTime), den: r1(args.work.dueWithDate) },
    overdue: r1(args.overdue),
    medianCycleDays: m === null ? null : r1(m),
    present: args.att.present,
    late: args.att.late,
    lateMinutes: args.att.lateMinutes,
    earlyLeave: args.att.earlyLeave,
    absent: args.att.absent,
    leave: args.att.leave,
    sick: args.att.sick,
    permit: args.att.permit,
    dayOff: args.att.dayOff,
    avgWorkedMinutes: args.att.avgWorkedMinutes,
    attendanceRate: args.att.attendanceRate,
    lateRate: args.att.lateRate,
    reflectionRate: args.att.reflectionRate,
    xpScore: args.xpScore,
    xpPenalty: args.xpPenalty,
  }
}

// ── the one builder ──────────────────────────────────────────────────────────────────────────────

/**
 * Figures for `userIds` over `current` and `previous`. A fixed number of set-based queries run in
 * parallel whatever the head-count (no per-person query). `detail` adds the per-person sections
 * (lists, weekly series, per project, XP breakdown) the single-person report shows.
 */
export async function buildPeopleReports(opts: {
  workspaceId: string
  userIds: string[]
  current: ReportWindow
  previous: ReportWindow
  detail: boolean
}): Promise<Map<string, PersonReportData>> {
  const { workspaceId, current, previous } = opts
  const userIds = [...new Set(opts.userIds)]
  const out = new Map<string, PersonReportData>()
  if (userIds.length === 0) return out

  const now = new Date()
  const todayKey = formatAttendanceDateKey(now)
  const earliest = previous.fromAt.getTime() < current.fromAt.getTime() ? previous : current
  const latestToAt = previous.toAt.getTime() > current.toAt.getTime() ? previous.toAt : current.toAt
  const snapshotAt = (w: ReportWindow) => (w.toAt.getTime() < now.getTime() ? w.toAt : now)
  const inUsers = { some: { userId: { in: userIds } } }
  const liveProject = { workspaceId, disableTaskStatus: false }
  const openProject = { workspaceId, disableTaskStatus: false, status: { not: "ARCHIVED" as const } }

  const [completedTasks, openTasks, assignments, attendanceDays, curScores, prevScores, penaltyTxns, streaks, curOverdue, prevOverdue] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          parentId: null,
          assignees: inUsers,
          status: "DONE",
          completedAt: { gte: earliest.fromAt, lt: latestToAt },
          taskList: { project: liveProject },
        },
        select: TASK_SELECT,
      }),
      prisma.task.findMany({
        where: { parentId: null, assignees: inUsers, status: { notIn: ["DONE", "CANCELLED"] }, taskList: { project: openProject } },
        select: TASK_SELECT,
      }),
      prisma.taskAssignee.findMany({
        where: {
          userId: { in: userIds },
          assignedAt: { gte: earliest.fromAt, lt: latestToAt },
          task: { parentId: null, status: { not: "CANCELLED" }, taskList: { project: liveProject } },
        },
        select: { userId: true, assignedAt: true, task: { select: { _count: { select: { assignees: true } } } } },
      }),
      classifyAttendanceDays({
        workspaceId,
        userIds,
        start: earliest.fromDate,
        end: previous.toDate.getTime() > current.toDate.getTime() ? previous.toDate : current.toDate,
      }),
      getPeriodScores(userIds, current.fromAt, current.toAt),
      getPeriodScores(userIds, previous.fromAt, previous.toAt),
      prisma.xpTransaction.findMany({
        where: { userId: { in: userIds }, amount: { lt: 0 }, createdAt: { gte: earliest.fromAt, lt: latestToAt } },
        select: { userId: true, amount: true, reason: true, createdAt: true },
      }),
      opts.detail
        ? prisma.userStreak.findMany({ where: { userId: { in: userIds } }, select: { userId: true, currentStreak: true, longestStreak: true } })
        : Promise.resolve([] as { userId: string; currentStreak: number; longestStreak: number }[]),
      overdueSnapshot(workspaceId, userIds, snapshotAt(current)),
      overdueSnapshot(workspaceId, userIds, snapshotAt(previous)),
    ])

  const streakBy = new Map(streaks.map((s) => [s.userId, s]))

  for (const userId of userIds) {
    // assignments
    let assignedCur = 0, assignedPrev = 0
    for (const a of assignments) {
      if (a.userId !== userId) continue
      const share = a.task._count.assignees > 0 ? 1 / a.task._count.assignees : 0
      if (inInstants(a.assignedAt, current)) assignedCur += share
      if (inInstants(a.assignedAt, previous)) assignedPrev += share
    }

    const workCur = workCore(userId, completedTasks, current)
    const workPrev = workCore(userId, completedTasks, previous)

    const days = attendanceDays.get(userId) ?? []
    const attCur = attendanceFigures(days, current)
    const attPrev = attendanceFigures(days, previous)

    let penCur = 0, penPrev = 0
    const penaltyBuckets = new Map<XpPenaltyKind, { count: number; xp: number }>()
    for (const t of penaltyTxns) {
      if (t.userId !== userId) continue
      if (inInstants(t.createdAt, current)) {
        penCur += t.amount
        const kind = xpPenaltyKind(t.reason)
        const b = penaltyBuckets.get(kind) ?? { count: 0, xp: 0 }
        b.count++
        b.xp += t.amount
        penaltyBuckets.set(kind, b)
      }
      if (inInstants(t.createdAt, previous)) penPrev += t.amount
    }

    const scoreCur = PERIOD_BASELINE_XP + (curScores.get(userId) ?? 0)
    const scorePrev = PERIOD_BASELINE_XP + (prevScores.get(userId) ?? 0)

    const headline = headlineOf({ assigned: assignedCur, work: workCur, overdue: curOverdue.get(userId) ?? 0, att: attCur, xpScore: scoreCur, xpPenalty: penCur })
    const prevHeadline = headlineOf({ assigned: assignedPrev, work: workPrev, overdue: prevOverdue.get(userId) ?? 0, att: attPrev, xpScore: scorePrev, xpPenalty: penPrev })

    // ── live (now) work state + detail sections ──
    const mineOpen = openTasks.filter((t) => t.assignees.some((a) => a.userId === userId))
    const openByPriority = { URGENT: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 }
    let openTotal = 0, overdueNow = 0, dueNext7 = 0
    const next7Key = addDaysToKey(todayKey, 6)
    const overdueList: OverdueTask[] = []
    const projects = new Map<string, { projectId: string; projectName: string; completed: number; open: number; overdue: number }>()
    const projectOf = (t: TaskRow) => {
      const p = t.taskList.project
      let row = projects.get(p.id)
      if (!row) { row = { projectId: p.id, projectName: p.name, completed: 0, open: 0, overdue: 0 }; projects.set(p.id, row) }
      return row
    }
    for (const t of mineOpen) {
      const share = shareOf(t)
      openTotal += share
      openByPriority[t.priority] += share
      const proj = opts.detail ? projectOf(t) : null
      if (proj) proj.open += share
      if (!t.dueDate) continue
      const dueKey = formatAttendanceDateKey(t.dueDate)
      if (dueKey < todayKey) {
        overdueNow += share
        if (proj) proj.overdue += share
        if (opts.detail) {
          overdueList.push({
            id: t.id,
            title: t.title,
            projectId: t.taskList.project.id,
            projectName: t.taskList.project.name,
            dueDate: t.dueDate.toISOString(),
            dueKey,
            daysOverdue: daysBetweenKeys(dueKey, todayKey),
            priority: t.priority,
            assigneeCount: t.assignees.length,
            share: r1(share),
          })
        }
      } else if (dueKey <= next7Key) {
        dueNext7 += share
      }
    }
    overdueList.sort((a, b) => a.dueKey.localeCompare(b.dueKey) || a.title.localeCompare(b.title))

    const weekly: PersonWork["weekly"] = []
    if (opts.detail) {
      for (let from = current.from; from <= current.to; from = addDaysToKey(from, 7)) {
        const to = addDaysToKey(from, 6) < current.to ? addDaysToKey(from, 6) : current.to
        weekly.push({ from, to, completed: 0, onTime: 0 })
      }
      for (const t of completedTasks) {
        if (!t.completedAt || !inInstants(t.completedAt, current)) continue
        if (!t.assignees.some((a) => a.userId === userId)) continue
        const share = shareOf(t)
        const doneKey = formatAttendanceDateKey(t.completedAt)
        const bucket = weekly.find((b) => doneKey >= b.from && doneKey <= b.to)
        if (bucket) {
          bucket.completed += share
          if (t.dueDate && doneKey <= formatAttendanceDateKey(t.dueDate)) bucket.onTime += share
        }
        projectOf(t).completed += share
      }
      for (const b of weekly) { b.completed = r1(b.completed); b.onTime = r1(b.onTime) }
    }

    const perProject = [...projects.values()]
      .map((p) => ({ ...p, completed: r1(p.completed), open: r1(p.open), overdue: r1(p.overdue) }))
      .sort((a, b) => b.completed + b.open - (a.completed + a.open) || a.projectName.localeCompare(b.projectName))

    const s = streakBy.get(userId)
    const penalties = [...penaltyBuckets.entries()]
      .map(([kind, b]) => ({ kind, count: b.count, xp: b.xp }))
      .sort((a, b) => a.xp - b.xp)

    out.set(userId, {
      headline,
      previous: prevHeadline,
      work: {
        assigned: headline.assigned,
        completed: headline.completed,
        onTime: headline.onTime,
        dueWithDate: r1(workCur.dueWithDate),
        overdueNow: r1(overdueNow),
        overdueList: overdueList.slice(0, 50),
        openTotal: r1(openTotal),
        openByPriority: {
          URGENT: r1(openByPriority.URGENT),
          HIGH: r1(openByPriority.HIGH),
          MEDIUM: r1(openByPriority.MEDIUM),
          LOW: r1(openByPriority.LOW),
          NONE: r1(openByPriority.NONE),
        },
        dueNext7: r1(dueNext7),
        medianCycleDays: headline.medianCycleDays,
        cycleSample: workCur.cycleDays.length,
        weekly,
        perProject,
      },
      attendance: attCur,
      xp: {
        periodScore: scoreCur,
        baseline: PERIOD_BASELINE_XP,
        level: levelForXp(scoreCur),
        streak: { current: s?.currentStreak ?? 0, longest: s?.longestStreak ?? 0 },
        penalties,
        penaltyTotal: penCur,
      },
    })
  }
  return out
}

/** Roster flags — the three things a manager should look at first. */
export function rosterFlags(h: HeadlineFigures) {
  const overdue3 = h.overdue >= 3
  const late3 = h.late >= 3
  const lowReflections = h.reflectionRate.den > 0 && h.reflectionRate.num / h.reflectionRate.den < 0.5
  return { overdue3, late3, lowReflections, count: Number(overdue3) + Number(late3) + Number(lowReflections) }
}

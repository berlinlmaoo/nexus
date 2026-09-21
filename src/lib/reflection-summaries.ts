import prisma from "@/lib/prisma"
import { askGideon } from "@/lib/gideon-chat"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"

/**
 * GIDEON's reading of the daily reflections.
 *
 * Two grains. A DAY summary is written right after check-out (fire-and-forget, never in the
 * response path) — two or three sentences of what the person did, so a manager can skim a month
 * without reading 30 paragraphs. A MONTH summary is written from whatever days exist so far: on
 * demand from the page ("summarize the 20 days collected so far") and by the monthly cron for the
 * month that just closed. Both are cached in ReflectionSummary; a month is regenerated only when
 * the number of source days changed, so repeated taps cost nothing.
 *
 * Months are CALENDAR months (YYYY-MM), not the 28→27 payroll period: a reflection is about the
 * work, and "what did Rina do in September" means September.
 */
export const DAY_KIND = "day"
export const MONTH_KIND = "month"

export type ReflectionDay = { date: string; reflection: string; summary: string | null }
export type ReflectionMonthly = { summary: string; sourceDays: number; updatedAt: string }

function monthRange(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number)
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }
}

export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

/** Last calendar month in Jakarta time, as YYYY-MM. */
export function previousMonthKey(now = new Date()): string {
  const jkt = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const y = jkt.getUTCFullYear(), m = jkt.getUTCMonth() // 0-based current month
  const d = new Date(Date.UTC(y, m - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Who may read whose reflections: yourself, your direct reports (Bagan Approval), and everyone
 * if you manage attendance (BoD / One Above All / system admin). Same rule as the history board.
 */
export async function reflectionAccess(viewerId: string, targetUserId: string | null | undefined) {
  const ctx = await getAttendanceWorkspaceContext(viewerId)
  if (!ctx.workspace) return { ok: false as const, status: 404, error: "No workspace membership found" }
  const userId = targetUserId || viewerId
  const allowed = userId === viewerId || ctx.canManageAttendance || ctx.directReportIds.includes(userId)
  if (!allowed) return { ok: false as const, status: 403, error: "Forbidden" }
  return { ok: true as const, userId, workspaceId: ctx.workspace.id }
}

export async function getReflections(userId: string, workspaceId: string, monthKey: string) {
  const { start, end } = monthRange(monthKey)
  const [records, summaries] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { userId, workspaceId, attendanceDate: { gte: start, lt: end }, checkOutReflection: { not: null } },
      orderBy: { attendanceDate: "asc" },
      select: { attendanceDate: true, checkOutReflection: true },
    }),
    prisma.reflectionSummary.findMany({
      where: { userId, workspaceId, OR: [{ kind: DAY_KIND, periodKey: { startsWith: monthKey } }, { kind: MONTH_KIND, periodKey: monthKey }] },
    }),
  ])
  const dayMap = new Map(summaries.filter((s) => s.kind === DAY_KIND).map((s) => [s.periodKey, s.summary]))
  const month = summaries.find((s) => s.kind === MONTH_KIND)
  const days: ReflectionDay[] = records
    .filter((r) => (r.checkOutReflection ?? "").trim().length > 0)
    .map((r) => {
      const date = r.attendanceDate.toISOString().slice(0, 10)
      return { date, reflection: r.checkOutReflection ?? "", summary: dayMap.get(date) ?? null }
    })
  const monthly: ReflectionMonthly | null = month
    ? { summary: month.summary, sourceDays: month.sourceDays, updatedAt: month.updatedAt.toISOString() }
    : null
  return { userId, month: monthKey, days, monthly }
}

/** Written right after check-out. Never throws — a failed summary must not become a failed check-out. */
export async function summarizeReflectionDay(recordId: string): Promise<void> {
  try {
    const rec = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      select: { userId: true, workspaceId: true, attendanceDate: true, checkOutReflection: true, user: { select: { name: true, email: true } } },
    })
    const text = rec?.checkOutReflection?.trim()
    if (!rec || !text) return
    const date = rec.attendanceDate.toISOString().slice(0, 10)
    const prompt = [
      `You are GIDEON, the assistant inside NEXUS (Z Networks' internal app). Below is the daily reflection ${rec.user?.name || "a team member"} wrote at check-out on ${date}.`,
      `Summarize it in English in two or three plain sentences: what they worked on, what progressed, and anything blocked or planned next. Keep names and project names as written. No headings, no bullet points, no preamble, no advice — the summary only.`,
      ``,
      `Reflection:`,
      text.slice(0, 4000),
    ].join("\n")
    const summary = await askGideon({ prompt, user: rec.user?.name || "", actorEmail: rec.user?.email || rec.userId, tag: `reflection-day ${date}` })
    if (!summary) return
    await prisma.reflectionSummary.upsert({
      where: { userId_kind_periodKey: { userId: rec.userId, kind: DAY_KIND, periodKey: date } },
      create: { workspaceId: rec.workspaceId, userId: rec.userId, kind: DAY_KIND, periodKey: date, summary, sourceDays: 1, model: "luna" },
      update: { summary, sourceDays: 1, model: "luna" },
    })
  } catch (err) {
    console.error("reflection-summaries: day summary failed", { recordId, err })
  }
}

/**
 * The month so far. Returns the cached row when nothing new was written since it was made,
 * so the button on the page can be pressed freely; `force` regenerates anyway.
 */
export async function summarizeReflectionMonth(
  userId: string,
  workspaceId: string,
  monthKey: string,
  opts?: { force?: boolean },
): Promise<{ monthly: ReflectionMonthly | null; cached: boolean; sourceDays: number }> {
  const { start, end } = monthRange(monthKey)
  const [records, user, existing] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { userId, workspaceId, attendanceDate: { gte: start, lt: end }, checkOutReflection: { not: null } },
      orderBy: { attendanceDate: "asc" },
      select: { attendanceDate: true, checkOutReflection: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.reflectionSummary.findUnique({ where: { userId_kind_periodKey: { userId, kind: MONTH_KIND, periodKey: monthKey } } }),
  ])
  const days = records.filter((r) => (r.checkOutReflection ?? "").trim().length > 0)
  if (days.length === 0) return { monthly: null, cached: false, sourceDays: 0 }
  if (existing && existing.sourceDays === days.length && !opts?.force) {
    return { monthly: { summary: existing.summary, sourceDays: existing.sourceDays, updatedAt: existing.updatedAt.toISOString() }, cached: true, sourceDays: days.length }
  }
  const [y, m] = monthKey.split("-").map(Number)
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
  const body = days
    .map((r) => `${r.attendanceDate.toISOString().slice(0, 10)}: ${(r.checkOutReflection ?? "").trim().slice(0, 700)}`)
    .join("\n\n")
  const prompt = [
    `You are GIDEON, the assistant inside NEXUS (Z Networks' internal app). Below are the daily check-out reflections ${user?.name || "a team member"} wrote in ${monthName} — ${days.length} day${days.length === 1 ? "" : "s"} so far.`,
    `Write a month summary in English, at most 180 words, plain prose in short paragraphs (a few short bullet points are fine for themes). Cover: the main things they worked on, what clearly progressed or shipped, recurring blockers, and one line on what stands out. Keep names and project names as written. Do not invent anything that is not in the reflections, do not grade or judge the person, no preamble.`,
    ``,
    body,
  ].join("\n")
  const summary = await askGideon({ prompt, user: user?.name || "", actorEmail: user?.email || userId, tag: `reflection-month ${monthKey}` })
  if (!summary) {
    return existing
      ? { monthly: { summary: existing.summary, sourceDays: existing.sourceDays, updatedAt: existing.updatedAt.toISOString() }, cached: true, sourceDays: days.length }
      : { monthly: null, cached: false, sourceDays: days.length }
  }
  const row = await prisma.reflectionSummary.upsert({
    where: { userId_kind_periodKey: { userId, kind: MONTH_KIND, periodKey: monthKey } },
    create: { workspaceId, userId, kind: MONTH_KIND, periodKey: monthKey, summary, sourceDays: days.length, model: "luna" },
    update: { summary, sourceDays: days.length, model: "luna" },
  })
  return { monthly: { summary: row.summary, sourceDays: row.sourceDays, updatedAt: row.updatedAt.toISOString() }, cached: false, sourceDays: days.length }
}

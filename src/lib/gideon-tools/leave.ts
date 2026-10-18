import { randomUUID } from "node:crypto"
import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { attendancePeriodKey, getAttendanceWorkspaceContext } from "@/lib/attendance"
import { isAutoDeduction } from "@/lib/attendance-absence"
import { canUserReviewRequest, resolveAttendanceApprovers } from "@/lib/attendance-approvers"
import { ANNUAL_LEAVE_DAYS, checkLeaveEligibility, leaveDaysInYear, leaveYearRange } from "@/lib/annual-leave"
import { dayOffBalances, dayOffPeriodOf, dayOffUsageKey } from "@/lib/day-off-usage"
import { isBackdated } from "@/lib/permit-rules"
import { clip, dayLabel, findPerson, str, whenWib, PUBLIC_BASE } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Leave / permission requests through GIDEON (owner, 18 Oct 2026). Nothing here decides a rule:
 *  - Filing goes through POST /api/attendance/requests AS the person (their session, X-Nexus-Client web/1 = the
 *    current rules: one date per request except annual leave, no past dates, the day-off cap, the annual-leave
 *    allowance in calendar days, the izin guard, the per-person lock and idempotency key). What is checked here
 *    first is only so the card never offers something that endpoint would refuse.
 *  - Sick and izin need a photo (and izin the place it was filed from), which a chat card cannot take: GIDEON
 *    points to the form instead of filing them.
 *  - Deciding goes through PATCH /api/attendance/requests/:id AS the approver, so the one resolver
 *    (lib/attendance-approvers.ts), four-eyes and "a rejection needs a reason" all apply.
 * Policy (memory nexus-kebijakan-dayoff-tk, nexus-cuti-hari-kalender): no extra day off when the quota is gone,
 * izin is never a day off or a cover for a forgotten check-in, leave counts every calendar day.
 */

const TYPE_LABEL: Record<string, string> = { LEAVE: "Annual leave", SICK: "Sick", PERMIT: "Permission (izin)", DAY_OFF: "Day off", RED_DATE: "Public holiday" }
const TYPE_ALIASES: Record<string, string> = {
  leave: "LEAVE", cuti: "LEAVE", annual: "LEAVE", annual_leave: "LEAVE",
  day_off: "DAY_OFF", dayoff: "DAY_OFF", off: "DAY_OFF", libur: "DAY_OFF",
  sick: "SICK", sakit: "SICK",
  permit: "PERMIT", izin: "PERMIT", ijin: "PERMIT", permission: "PERMIT",
  red_date: "RED_DATE", tanggal_merah: "RED_DATE", holiday: "RED_DATE",
}
const DAY = /^\d{4}-\d{2}-\d{2}$/

function typeOf(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const k = s.toLowerCase().replace(/[\s-]+/g, "_")
  return TYPE_ALIASES[k] ?? (TYPE_LABEL[s.toUpperCase()] ? s.toUpperCase() : null)
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const utcDay = (k: string) => new Date(`${k}T00:00:00.000Z`)

async function annualLeave(userId: string, workspaceId: string) {
  const member = await prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, select: { employmentStartDate: true } })
  const eligibility = checkLeaveEligibility(member?.employmentStartDate ?? null)
  const { year, start, end } = leaveYearRange()
  const taken = await prisma.attendanceRequest.findMany({
    where: { userId, type: "LEAVE", status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } },
    select: { startDate: true, endDate: true },
  })
  const used = taken.reduce((s, r) => s + leaveDaysInYear(r.startDate, r.endDate, year), 0)
  return { eligible: eligibility.eligible, why: eligibility.eligible ? null : eligibility.reason, year, used, remaining: Math.max(0, ANNUAL_LEAVE_DAYS - used), allowance: ANNUAL_LEAVE_DAYS }
}

async function getLeaveBalance(actor: User) {
  const ctx = await getAttendanceWorkspaceContext(actor.id)
  if (!ctx.workspace) throw new Error("This person is not in a workspace with attendance.")
  const periodKey = attendancePeriodKey()
  const [bal, leave, pending] = await Promise.all([
    dayOffBalances(ctx.workspace.id, [{ userId: actor.id, periodKey }]),
    annualLeave(actor.id, ctx.workspace.id),
    prisma.attendanceRequest.findMany({
      where: { userId: actor.id, workspaceId: ctx.workspace.id, status: "PENDING" },
      orderBy: { startDate: "asc" },
      take: 20,
      select: { id: true, type: true, startDate: true, endDate: true, reason: true, approvalSource: true, reviewedById: true, createdAt: true },
    }),
  ])
  const d = bal.get(dayOffUsageKey(actor.id, periodKey))
  const approver = await resolveAttendanceApprovers(actor.id, ctx.workspace.id)
  const approvers = approver.userIds.length ? await prisma.user.findMany({ where: { id: { in: approver.userIds } }, select: { name: true } }) : []
  return {
    dayOff: d ? { period: `${periodKey} (28th → 27th)`, quota: d.quota, used: d.used, remaining: d.remaining, ...(d.remaining <= 0 ? { note: "Quota used up: no more day off this period (no borrowing, no extra unpaid days)." } : {}) } : null,
    annualLeave: { year: leave.year, allowance: leave.allowance, used: leave.used, remaining: leave.remaining, countsCalendarDays: true, ...(leave.eligible ? {} : { eligible: false, why: leave.why }) },
    pendingRequests: pending.filter((r) => !isAutoDeduction(r as Parameters<typeof isAutoDeduction>[0])).map((r) => ({ type: TYPE_LABEL[r.type] ?? r.type, days: dayKey(r.startDate) === dayKey(r.endDate) ? dayKey(r.startDate) : `${dayKey(r.startDate)} – ${dayKey(r.endDate)}`, reason: clip(r.reason, 80), filed: whenWib(r.createdAt) })),
    approvedBy: approvers.map((a) => a.name).filter(Boolean),
    page: `${PUBLIC_BASE}/attendance`,
  }
}

async function describeSubmit(actor: User, input: Input) {
  const type = typeOf(input.type)
  if (!type) throw new Error("type is required: DAY_OFF (day off), LEAVE (annual leave / cuti), RED_DATE (public holiday). Sick and izin are filed on the form.")
  if (type === "SICK" || type === "PERMIT") {
    throw new Error(`${type === "SICK" ? "A sick request needs the doctor's note photo" : "An izin needs a photo as proof and the place it is filed from"}, which a chat card cannot take. Tell the person to file it on the Attendance page: ${PUBLIC_BASE}/attendance (Request). Do not file anything else instead.`)
  }
  const start = str(input.startDate) ?? str(input.date) ?? str(input.day)
  const end = str(input.endDate) ?? start
  if (!start || !DAY.test(start) || !end || !DAY.test(end)) throw new Error("Give the day(s) as YYYY-MM-DD (date, or startDate + endDate for annual leave).")
  if (end < start) throw new Error("endDate is before startDate.")
  if (type !== "LEAVE" && end !== start) throw new Error("One request is one date (only annual leave takes a range). For more days, make one request per date.")
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (reason.length < 3) throw new Error("A reason is required (at least 3 characters). Ask the person for it.")
  if (reason.length > 1000) throw new Error("The reason is at most 1000 characters.")
  if (isBackdated(utcDay(start))) throw new Error("A day that has already passed cannot be filed by the person themselves; a BoD records it for them. Tell them so.")

  const ctx = await getAttendanceWorkspaceContext(actor.id)
  if (!ctx.workspace) throw new Error("This person is not in a workspace with attendance.")
  const days = Math.round((utcDay(end).getTime() - utcDay(start).getTime()) / 86400e3) + 1
  const diff: { field: string; to: string; toDay?: string }[] = [
    { field: "Type", to: TYPE_LABEL[type] },
    days === 1 ? { field: "Date", to: dayLabel(start) ?? start, toDay: start } : { field: "Dates", to: `${dayLabel(start)} – ${dayLabel(end)}` },
    ...(days > 1 ? [{ field: "Days", to: `${days} calendar days` }] : []),
    { field: "Reason", to: reason },
  ]
  if (type === "DAY_OFF") {
    const periodKey = dayOffPeriodOf(utcDay(start))
    const bal = (await dayOffBalances(ctx.workspace.id, [{ userId: actor.id, periodKey }])).get(dayOffUsageKey(actor.id, periodKey))
    const left = bal?.remaining ?? 0
    if (left <= 0) throw new Error(`The day-off quota for period ${periodKey} is used up (${bal?.used ?? 0} of ${bal?.quota ?? 0}). No more day off can be filed this period; there is no extra or borrowed day off. Tell the person plainly.`)
    diff.push({ field: "Balance", to: `${left} of ${bal?.quota} days off left → ${left - 1} after this` })
  }
  if (type === "LEAVE") {
    const leave = await annualLeave(actor.id, ctx.workspace.id)
    if (!leave.eligible) throw new Error(`Annual leave is not available yet: ${leave.why}`)
    const asking = leaveDaysInYear(utcDay(start), utcDay(end), leave.year)
    if (asking > leave.remaining) throw new Error(`Not enough annual leave for ${leave.year}: ${leave.remaining} of ${leave.allowance} days left, this asks ${days} (every calendar day counts, weekends too).`)
    diff.push({ field: "Balance", to: `${leave.remaining} of ${leave.allowance} leave days left → ${leave.remaining - asking} after this` })
  }
  const approver = await resolveAttendanceApprovers(actor.id, ctx.workspace.id)
  const names = approver.userIds.length ? (await prisma.user.findMany({ where: { id: { in: approver.userIds } }, select: { name: true } })).map((u) => u.name).filter(Boolean) : []
  if (names.length) diff.push({ field: "To", to: names.slice(0, 3).join(", ") })
  return {
    summary: `${TYPE_LABEL[type]} request for ${days === 1 ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(end)}`}`,
    diff,
    store: { type, startDate: start, endDate: end, reason, clientRequestId: `gideon-${randomUUID()}` },
    note: "NOT filed yet. It waits on the card below; when the person taps Submit it is filed exactly as on the Attendance page and goes to their approver. Say so in one sentence.",
  }
}

/** The pending request the approver means: requestId, or the person's name (+ date) among the ones they may decide. */
async function findDecidable(actor: User, input: Input) {
  const ctx = await getAttendanceWorkspaceContext(actor.id)
  if (!ctx.workspace) throw new Error("This person is not in a workspace with attendance.")
  if (!ctx.canReviewAttendanceRequests) throw new Error("This person does not approve anyone's attendance requests.")
  const id = str(input.requestId) ?? str(input.id)
  let req
  if (id) {
    req = await prisma.attendanceRequest.findFirst({ where: { id, workspaceId: ctx.workspace.id }, include: { user: { select: { id: true, name: true } } } })
    if (!req) throw new Error("No attendance request with that id.")
  } else {
    const who = str(input.person) ?? str(input.who) ?? str(input.name)
    if (!who) throw new Error("Say which request: requestId (from nexus_get_my_inbox) or the person's name (+ date).")
    const p = await findPerson(who, { exclude: actor.id })
    const date = str(input.date)
    const rows = await prisma.attendanceRequest.findMany({
      where: { userId: p.id, workspaceId: ctx.workspace.id, status: "PENDING", ...(date && DAY.test(date) ? { startDate: { lte: utcDay(date) }, endDate: { gte: utcDay(date) } } : {}) },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { startDate: "asc" },
      take: 6,
    })
    const real = rows.filter((r) => !isAutoDeduction(r as Parameters<typeof isAutoDeduction>[0]))
    if (!real.length) throw new Error(`${p.name} has no pending request${date ? ` on ${date}` : ""}.`)
    if (real.length > 1) throw new Error(`${p.name} has ${real.length} pending requests: ${real.map((r) => `${TYPE_LABEL[r.type]} ${dayKey(r.startDate)}`).join("; ")}. Ask which one (or pass the date).`)
    req = real[0]
  }
  if (req.userId === actor.id) throw new Error("Nobody approves or rejects their own request. Tell the person to ask their approver.")
  if (req.status !== "PENDING") throw new Error(`That request is already ${req.status.toLowerCase()}.`)
  const verdict = await canUserReviewRequest(actor.id, req.userId, ctx.workspace.id, ctx)
  if (!verdict.ok) throw new Error(`This person is not an approver for ${req.user?.name ?? "that person"} (the Approval chart decides who is). Tell them so.`)
  return req
}

async function describeDecide(actor: User, input: Input) {
  const raw = (str(input.decision) ?? str(input.action) ?? "").toLowerCase()
  const decision = /^(approve|approved|setuju|terima|acc|ok)/.test(raw) ? "approve" : /^(reject|rejected|tolak|decline)/.test(raw) ? "reject" : null
  if (!decision) throw new Error("decision is required: approve or reject.")
  const note = typeof input.note === "string" ? input.note.trim() : typeof input.reviewNote === "string" ? input.reviewNote.trim() : ""
  if (decision === "reject" && note.length < 3) throw new Error("A rejection needs a reason (at least 3 characters) that the requester will see. Ask the person for it.")
  const req = await findDecidable(actor, input)
  const days = dayKey(req.startDate) === dayKey(req.endDate) ? dayLabel(dayKey(req.startDate)) ?? dayKey(req.startDate) : `${dayLabel(dayKey(req.startDate))} – ${dayLabel(dayKey(req.endDate))}`
  return {
    summary: `${decision === "approve" ? "Approve" : "Reject"} ${req.user?.name ?? "?"}'s ${TYPE_LABEL[req.type]?.toLowerCase() ?? "request"} (${days})`,
    diff: [
      { field: "Person", to: req.user?.name ?? "?" },
      { field: "Type", to: TYPE_LABEL[req.type] ?? req.type },
      { field: "Dates", to: days, ...(dayKey(req.startDate) === dayKey(req.endDate) ? { toDay: dayKey(req.startDate) } : {}) },
      { field: "Reason", to: clip(req.reason, 300) ?? "—" },
      ...(req.supportingDocumentUrl ? [{ field: "File", to: "Attached — open the request to see it" }] : []),
      { field: "Decision", to: decision === "approve" ? "Approve" : "Reject" },
      ...(note ? [{ field: "Note", to: note }] : []),
    ],
    store: { requestId: req.id, decision, note },
    note: "NOT decided yet. It waits on the card below; it is applied with the same rules as the Approvals page when the person confirms. Say so in one sentence.",
  }
}

export const leaveTools: Record<string, ExtraTool> = {
  get_leave_balance: { read: (actor) => getLeaveBalance(actor) },
  submit_leave_request: {
    describe: describeSubmit,
    stepArg: (i) => [typeOf(i.type) ? TYPE_LABEL[typeOf(i.type)!] : null, str(i.startDate) ?? str(i.date)].filter(Boolean).join(", ") || null,
    web: async (input, call) => {
      const r = await call({
        method: "POST",
        path: "/api/attendance/requests",
        form: { type: String(input.type), startDate: String(input.startDate), endDate: String(input.endDate), reason: String(input.reason), clientRequestId: String(input.clientRequestId) },
      })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't file the request") }
      const id = r.body?.request?.id as string | undefined
      return { ok: true, link: id ? `/attendance?request=${id}` : "/attendance", result: { requestId: id ?? null } }
    },
  },
  decide_attendance_request: {
    describe: describeDecide,
    stepArg: (i) => str(i.person) ?? str(i.who) ?? null,
    web: async (input, call) => {
      const r = await call({ method: "PATCH", path: `/api/attendance/requests/${String(input.requestId)}`, json: { action: input.decision === "reject" ? "reject" : "approve", reviewNote: input.note ? String(input.note) : null } })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't decide the request") }
      return { ok: true, link: `/attendance?request=${String(input.requestId)}` }
    },
  },
}


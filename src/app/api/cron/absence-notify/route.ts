export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { formatAttendanceDateKey } from "@/lib/attendance"
import { attendanceWaiverReason, getOutageDateKeys, isAutoDeduction } from "@/lib/attendance-absence"
import { isDeletedAccountEmail } from "@/lib/account-deletion"
import { dayOffBalances, dayOffPeriodOf, dayOffUsageKey } from "@/lib/day-off-usage"
import { notifyAttendanceAbsentRecorded } from "@/lib/notification-service"

/**
 * Tell each person, once, that a day was recorded as absent and cost them a day off.
 *
 * The cut is made by POST /api/attendance/deduct-absences at 02:00 WIB (systemd nexus-absence.timer)
 * and that run deliberately sends nothing: a push at two in the morning about yesterday is a push
 * nobody wants. This runs in the morning (crontab, 08:00 WIB) and reads what the night wrote.
 *
 * What counts: the cron's own "Auto: tidak check-in/out pada …" DAY_OFF rows (isAutoDeduction), still
 * APPROVED, created in the last 36 hours — a missed morning run is caught by the next one, and the
 * dedupe in notifyAttendanceAbsentRecorded (one per person per date, ever) makes any overlap harmless.
 * "Auto: telat >120 menit" cuts are NOT announced here; the person was there and knows they were late.
 *
 * Nothing is sent for:
 *   - a cut that has since been refunded — refunds DELETE the row, so it is simply not found;
 *   - a date with ANY recorded outage (AttendanceOutage row, or ATTENDANCE_OUTAGE_DATES). Stricter
 *     than the cron on purpose: a register entry means a human may still pardon the day, and "kamu gak
 *     absen" on a day the system was down is the one message that must not go out by mistake;
 *   - a BoD waiver for that member-day ("hapus punishment");
 *   - a record with a check-in for that date after all (a correction landed after the cut);
 *   - deleted accounts, and people no longer in the workspace.
 *
 * `?dryRun=1` (or body {"dryRun":true}) returns exactly what would be sent and sends nothing.
 */
const WINDOW_MS = 36 * 60 * 60 * 1000

type Skip = { id: string; userId: string; dateKey: string; reason: string }

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
    let authorized = Boolean(cronSecret && bearer && bearer === cronSecret)
    if (!authorized) {
      const session = await auth()
      if (session?.user?.id && isBodPlus(await getUserOrgRole(session.user.id))) authorized = true
    }
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    type Body = { dryRun?: boolean }
    let body: Body | null = null
    try { body = (await req.json()) as Body } catch { /* tanpa body */ }
    const q = req.nextUrl.searchParams.get("dryRun")
    const dryRun = body?.dryRun === true || q === "1" || q === "true"

    const since = new Date(Date.now() - WINDOW_MS)
    const rows = await prisma.attendanceRequest.findMany({
      where: {
        type: "DAY_OFF",
        status: "APPROVED",
        approvalSource: "ADMIN",
        reviewedById: null,
        reason: { startsWith: "Auto: tidak check-in" },
        createdAt: { gte: since },
      },
      select: {
        id: true, userId: true, workspaceId: true, startDate: true, endDate: true, createdAt: true,
        reason: true, reviewedById: true, approvalSource: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    })

    const skipped: Skip[] = []
    // One row is one day (createAutoDayOffOnce writes startDate = endDate); the date is read off the row.
    const candidates = rows
      .filter((r) => isAutoDeduction(r))
      .map((r) => ({ ...r, dateKey: formatAttendanceDateKey(r.startDate) }))

    const live = candidates.filter((r) => {
      if (isDeletedAccountEmail(r.user?.email)) { skipped.push({ id: r.id, userId: r.userId, dateKey: r.dateKey, reason: "deleted_account" }); return false }
      return true
    })
    const dateKeys = Array.from(new Set(live.map((r) => r.dateKey)))
    const userIds = Array.from(new Set(live.map((r) => r.userId)))

    // Outage register. If it cannot be read, send nothing: the next morning's run (still inside the
    // 36-hour window) tries again, and silence is the safe failure for this particular sentence.
    let outageKeys: Set<string>
    try {
      const recorded = dateKeys.length
        ? await prisma.attendanceOutage.findMany({ where: { dateKey: { in: dateKeys } }, select: { dateKey: true } })
        : []
      outageKeys = new Set([...Array.from(getOutageDateKeys()), ...recorded.map((o) => o.dateKey)])
    } catch (err) {
      console.error("[absence-notify] outage register unreadable — nothing sent this run", err)
      return NextResponse.json({ error: "Outage register unreadable" }, { status: 503 })
    }

    const [waivers, checkedIn] = await Promise.all([
      userIds.length
        ? prisma.xpTransaction.findMany({
            where: { userId: { in: userIds }, reason: { in: dateKeys.map(attendanceWaiverReason) } },
            select: { userId: true, reason: true },
          })
        : Promise.resolve([] as { userId: string; reason: string }[]),
      userIds.length
        ? prisma.attendanceRecord.findMany({
            where: {
              userId: { in: userIds },
              attendanceDate: { in: live.map((r) => r.startDate) },
              OR: [{ checkInAt: { not: null } }, { checkOutAt: { not: null } }],
            },
            select: { userId: true, workspaceId: true, attendanceDate: true },
          })
        : Promise.resolve([] as { userId: string; workspaceId: string; attendanceDate: Date }[]),
    ])
    const waived = new Set(waivers.map((w) => `${w.userId}|${w.reason}`))
    const present = new Set(checkedIn.map((c) => `${c.userId}|${c.workspaceId}|${formatAttendanceDateKey(c.attendanceDate)}`))

    const eligible = live.filter((r) => {
      let reason: string | null = null
      if (outageKeys.has(r.dateKey)) reason = "outage_recorded"
      else if (waived.has(`${r.userId}|${attendanceWaiverReason(r.dateKey)}`)) reason = "waiver"
      else if (present.has(`${r.userId}|${r.workspaceId}|${r.dateKey}`)) reason = "checked_in"
      if (reason) skipped.push({ id: r.id, userId: r.userId, dateKey: r.dateKey, reason })
      return !reason
    })

    // Balances: one pair of queries per workspace, whatever the number of people.
    const byWorkspace = new Map<string, typeof eligible>()
    for (const r of eligible) byWorkspace.set(r.workspaceId, [...(byWorkspace.get(r.workspaceId) ?? []), r])

    const results: Array<{ id: string; userId: string; name: string | null; dateKey: string; sent: boolean; skipped?: string; push: boolean; title: string; message: string }> = []
    for (const [workspaceId, list] of Array.from(byWorkspace.entries())) {
      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId, userId: { in: list.map((r) => r.userId) } },
        select: { userId: true },
      })
      const isMember = new Set(members.map((m) => m.userId))
      const stillHere = list.filter((r) => {
        if (isMember.has(r.userId)) return true
        skipped.push({ id: r.id, userId: r.userId, dateKey: r.dateKey, reason: "not_member" })
        return false
      })
      const balances = await dayOffBalances(workspaceId, stillHere.map((r) => ({ userId: r.userId, periodKey: dayOffPeriodOf(r.startDate) })))
      for (const r of stillHere) {
        const b = balances.get(dayOffUsageKey(r.userId, dayOffPeriodOf(r.startDate)))
        if (!b) continue
        try {
          const out = await notifyAttendanceAbsentRecorded({ userId: r.userId, dateKey: r.dateKey, quota: b.quota, used: b.used, dryRun })
          results.push({ id: r.id, userId: r.userId, name: r.user?.name ?? null, dateKey: r.dateKey, sent: out.sent, skipped: out.skipped, push: out.push, title: out.title, message: out.message })
        } catch (err) {
          console.error("[absence-notify] send failed", { id: r.id, userId: r.userId, dateKey: r.dateKey, err })
          skipped.push({ id: r.id, userId: r.userId, dateKey: r.dateKey, reason: "send_failed" })
        }
      }
    }

    const sent = results.filter((r) => r.sent).length
    const wouldSend = dryRun ? results.filter((r) => r.skipped === "dry_run").length : 0
    const already = results.filter((r) => r.skipped === "already_sent").length
    if (sent > 0 || skipped.length > 0) {
      console.log("[absence-notify]", JSON.stringify({ dryRun, since, candidates: candidates.length, sent, already, skipped: skipped.length }))
    }
    return NextResponse.json({ ok: true, dryRun, since, candidates: candidates.length, sent, wouldSend, alreadySent: already, results, skipped })
  } catch (error) {
    console.error("[absence-notify]", error)
    return NextResponse.json({ error: "Absence notify failed" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { attendancePeriodKey, formatAttendanceDateKey, getAttendanceWorkspaceContext } from "@/lib/attendance"
import { periodBounds, periodLabel } from "@/lib/day-off-bonus"
import { placeLabel } from "@/lib/attendance-place"
import { recordLevel, side, type SuspectSide } from "@/lib/attendance-suspect"

/**
 * GET /api/attendance/suspects?periodKey=YYYY-MM   BoD / One Above All (canManageAttendance) only.
 *
 * Attendance flagged for its location in one 28→27 period, newest first: records still open for
 * review, and every verdict given (an INVALID one from its snapshot — the record is gone, the day is
 * TK). `level` FAKE = proof of a fake location, CHECK = a weak signal (see lib/attendance-suspect).
 * Only FAKE items may be judged INVALID (POST ./[recordId]/review).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
    const ctx = await getAttendanceWorkspaceContext(session.user.id)
    if (!ctx.workspace) return NextResponse.json({ error: "No workspace membership found", code: "NO_WORKSPACE" }, { status: 404 })
    if (!ctx.canManageAttendance) {
      return NextResponse.json({ error: "Hanya BoD ke atas yang bisa meninjau absen mencurigakan.", code: "FORBIDDEN" }, { status: 403 })
    }
    const workspaceId = ctx.workspace.id
    const raw = req.nextUrl.searchParams.get("periodKey")
    const current = attendancePeriodKey()
    if (raw && !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
      return NextResponse.json({ error: "Periode harus format YYYY-MM.", code: "VALIDATION" }, { status: 400 })
    }
    const periodKey = raw ?? current
    const { start, end } = periodBounds(periodKey)

    const [records, reviews] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          workspaceId,
          attendanceDate: { gte: start, lte: end },
          OR: [{ checkInSuspect: true }, { checkOutSuspect: true }, { checkInSimulated: true }, { checkOutSimulated: true }],
        },
        include: {
          user: { select: { id: true, name: true, avatar: true } },
          officeLocation: { select: { name: true, radiusMeters: true } },
        },
        orderBy: { attendanceDate: "desc" },
      }),
      prisma.attendanceSuspectReview.findMany({
        where: { workspaceId, attendanceDate: { gte: start, lte: end } },
      }),
    ])
    const reviewByRecord = new Map(reviews.map((r) => [r.recordId, r] as const))
    const peopleIds = new Set<string>([...reviews.map((r) => r.userId), ...reviews.map((r) => r.reviewedById)])
    const people = await prisma.user.findMany({ where: { id: { in: [...peopleIds] } }, select: { id: true, name: true, avatar: true } })
    const personById = new Map(people.map((p) => [p.id, p] as const))

    const reviewOut = (r: (typeof reviews)[number] | undefined) => r ? {
      verdict: r.verdict, note: r.note, reviewedAt: r.reviewedAt.toISOString(),
      reviewedBy: { id: r.reviewedById, name: personById.get(r.reviewedById)?.name ?? null },
    } : null

    type Item = {
      recordId: string; date: string; state: "open" | "valid" | "invalid"; level: string | null
      user: { id: string; name: string | null; image: string | null }
      place: string | null
      checkIn: SuspectSide | null; checkOut: SuspectSide | null
      review: ReturnType<typeof reviewOut>
    }
    const items: Item[] = []
    for (const r of records) {
      const checkIn = side({
        at: r.checkInAt, lat: r.checkInLat, lng: r.checkInLng, accuracyM: r.checkInAccuracyM,
        simulated: r.checkInSimulated, suspect: r.checkInSuspect, reason: r.checkInSuspectReason, impliedKmh: r.checkInImpliedKmh,
        photoUrl: r.checkInPhotoUrl, address: r.checkInAddress, offline: r.checkInOffline,
      })
      const checkOut = side({
        at: r.checkOutAt, lat: r.checkOutLat, lng: r.checkOutLng, accuracyM: r.checkOutAccuracyM,
        simulated: r.checkOutSimulated, suspect: r.checkOutSuspect, reason: r.checkOutSuspectReason, impliedKmh: r.checkOutImpliedKmh,
        photoUrl: r.checkOutPhotoUrl, address: r.checkOutAddress, offline: r.checkOutOffline,
      })
      const rv = reviewByRecord.get(r.id)
      items.push({
        recordId: r.id, date: formatAttendanceDateKey(r.attendanceDate),
        state: rv ? (rv.verdict === "INVALID" ? "invalid" : "valid") : "open",
        level: recordLevel([checkIn, checkOut]),
        user: { id: r.user.id, name: r.user.name, image: r.user.avatar },
        place: placeLabel(r),
        checkIn, checkOut,
        review: reviewOut(rv),
      })
    }
    // INVALID verdicts: the record was deleted; the snapshot is what is left.
    for (const rv of reviews) {
      if (rv.verdict !== "INVALID" || records.some((r) => r.id === rv.recordId)) continue
      const snap = (rv.snapshot ?? {}) as { item?: Item }
      if (!snap.item) continue
      const person = personById.get(rv.userId)
      items.push({ ...snap.item, state: "invalid", review: reviewOut(rv), user: { id: rv.userId, name: person?.name ?? snap.item.user?.name ?? null, image: person?.avatar ?? null } })
    }
    const rank = (i: Item) => (i.state === "open" ? 0 : 1)
    items.sort((a, b) => rank(a) - rank(b) || b.date.localeCompare(a.date) || (a.user.name ?? "").localeCompare(b.user.name ?? ""))

    return NextResponse.json({
      periodKey,
      periodLabel: periodLabel(periodKey, "en"),
      periodStart: formatAttendanceDateKey(start),
      periodEnd: formatAttendanceDateKey(end),
      currentPeriodKey: current,
      counts: {
        fakeOpen: items.filter((i) => i.state === "open" && i.level === "FAKE").length,
        checkOpen: items.filter((i) => i.state === "open" && i.level === "CHECK").length,
        valid: items.filter((i) => i.state === "valid").length,
        invalid: items.filter((i) => i.state === "invalid").length,
      },
      items,
    })
  } catch (error) {
    console.error("Error listing suspect attendance:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

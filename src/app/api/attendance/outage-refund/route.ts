export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getAttendanceWorkspaceContext, parseDateOnlyToUtc } from "@/lib/attendance"
import { refundOutageDay, type OutageRefundResult } from "@/lib/attendance-absence"

// Refund attendance penalties wrongly applied on a SYSTEM-OUTAGE day (listrik mati / NEXUS down):
// for the given date, give back the late/no-checkout/alpha XP and restore any auto-cut day-off, for
// every staff EXCEPT those who already filed a real day-off/leave for that day. Status is untouched;
// no excuse/leave record is created. Pass { dryRun: true } to preview without changing anything.
// Auth: an attendance admin session (BoD / One Above All) OR a CRON_SECRET bearer (server-triggered).
export async function POST(req: NextRequest) {
  try {
    type Body = { date?: string; dryRun?: boolean; workspaceId?: string }
    let body: Body | null = null
    try {
      body = (await req.json()) as Body
    } catch {
      // no body
    }

    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    let authorized = false
    let adminUserId: string | null = null
    let workspaceIds: string[] = []

    if (cronSecret && bearer && bearer === cronSecret) {
      authorized = true
      if (body?.workspaceId) {
        workspaceIds = [body.workspaceId]
      } else {
        // No workspace specified on the cron path → all workspaces.
        workspaceIds = (await prisma.workspace.findMany({ select: { id: true } })).map((w) => w.id)
      }
    } else {
      const session = await auth()
      if (session?.user?.id) {
        const ctx = await getAttendanceWorkspaceContext(session.user.id)
        if (ctx.canManageAttendance && ctx.workspace?.id) {
          authorized = true
          adminUserId = session.user.id
          workspaceIds = [ctx.workspace.id]
        }
      }
    }

    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!body?.date) return NextResponse.json({ error: "Tanggal wajib diisi (date: YYYY-MM-DD)." }, { status: 400 })

    let date: Date
    try {
      date = parseDateOnlyToUtc(body.date)
    } catch {
      return NextResponse.json({ error: "Format tanggal tidak valid (YYYY-MM-DD)." }, { status: 400 })
    }
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Format tanggal tidak valid (YYYY-MM-DD)." }, { status: 400 })
    }

    const dryRun = body.dryRun ?? false
    const perWorkspace: OutageRefundResult[] = []
    for (const wid of workspaceIds) {
      perWorkspace.push(await refundOutageDay({ workspaceId: wid, date, dryRun, adminUserId, request: req }))
    }

    // Merge (single workspace for the admin/button path; possibly many on the cron path).
    const merged = {
      ok: true as const,
      date: perWorkspace[0]?.date ?? body.date,
      dryRun,
      refundedMembers: perWorkspace.reduce((s, r) => s + r.refundedMembers, 0),
      excludedMembers: perWorkspace.reduce((s, r) => s + r.excludedMembers, 0),
      totalXpRefunded: perWorkspace.reduce((s, r) => s + r.totalXpRefunded, 0),
      totalDayOffsRestored: perWorkspace.reduce((s, r) => s + r.totalDayOffsRestored, 0),
      failed: perWorkspace.reduce((s, r) => s + r.failed, 0),
      entries: perWorkspace.flatMap((r) => r.entries),
    }

    return NextResponse.json(merged)
  } catch (error) {
    console.error("attendance outage-refund error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    )
  }
}

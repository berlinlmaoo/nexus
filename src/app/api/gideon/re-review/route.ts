export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { isGideonTicketCategory, reviewSupportTicket } from "@/lib/gideon-ticket"

// Re-run GIDEON's review on tickets it has ALREADY answered.
//
// Every automatic trigger refuses to answer a thread whose last message is GIDEON's own — that guard
// is what stops it replying to itself forever, and it must stay. But it also means an answer written
// by a prompt since found wrong is permanent. When the remedy rules changed there were 13 tickets
// sitting on answers that told people their photo was blurry instead of reading the attendance record
// that was right there. This route is the only way past that guard, and it is deliberately manual:
// a BoD session, or CRON_SECRET for a server-side sweep.
//
// It writes one new GIDEON message per ticket — visible to the reporter, who is notified. So it runs
// SEQUENTIALLY with a pause, never fans out: 13 tickets is 13 people's phones.
export async function POST(req: NextRequest) {
  try {
    type Body = { complaintIds?: string[]; status?: string; limit?: number; dryRun?: boolean }
    let body: Body | null = null
    try {
      body = (await req.json()) as Body
    } catch {
      // no body
    }

    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    let authorized = bearer.length > 0 && bearer === cronSecret
    let workspaceId: string | null = null
    if (!authorized) {
      const session = await auth()
      if (session?.user?.id) {
        const ctx = await getAttendanceWorkspaceContext(session.user.id)
        if (ctx.canManageAttendance && ctx.workspace?.id) {
          authorized = true
          workspaceId = ctx.workspace.id
        }
      }
    }
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Either an explicit list, or every ticket in a status. No "all tickets" default on purpose —
    // an accidental empty body must sweep nothing, not everything.
    const ids = Array.isArray(body?.complaintIds) ? body!.complaintIds!.filter((s) => typeof s === "string") : []
    let targets: { id: string; subject: string; category: string }[] = []

    if (ids.length > 0) {
      targets = await prisma.complaint.findMany({
        where: { id: { in: ids }, ...(workspaceId ? { workspaceId } : {}) },
        select: { id: true, subject: true, category: true },
      })
    } else if (body?.status) {
      targets = await prisma.complaint.findMany({
        where: { status: body.status as never, ...(workspaceId ? { workspaceId } : {}) },
        orderBy: { createdAt: "asc" },
        take: Math.min(Math.max(body.limit ?? 25, 1), 50),
        select: { id: true, subject: true, category: true },
      })
    } else {
      return NextResponse.json({ error: "Kasih complaintIds[] atau status." }, { status: 400 })
    }

    // GIDEON only handles some categories; asking it about the rest wastes a call and confuses the thread.
    const eligible = targets.filter((t) => isGideonTicketCategory(t.category as never))
    const skipped = targets.filter((t) => !isGideonTicketCategory(t.category as never)).map((t) => t.id)

    if (body?.dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, wouldReview: eligible.map((t) => ({ id: t.id, subject: t.subject })), skipped })
    }

    const done: string[] = []
    const failed: { id: string; error: string }[] = []
    for (const t of eligible) {
      try {
        await reviewSupportTicket(t.id, { force: true })
        done.push(t.id)
      } catch (err) {
        failed.push({ id: t.id, error: err instanceof Error ? err.message : String(err) })
      }
      // One at a time, with a breath between: the shim spawns a Hermes process per request, and
      // thirteen at once is how you turn a fix into an outage.
      await new Promise((r) => setTimeout(r, 1500))
    }

    return NextResponse.json({ ok: true, reviewed: done.length, failedCount: failed.length, done, failed, skipped })
  } catch (error) {
    console.error("gideon re-review error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}

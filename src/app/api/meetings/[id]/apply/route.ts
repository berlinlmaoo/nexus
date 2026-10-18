export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkRateLimitByKey } from "@/lib/rate-limit"
import { cleanMom, cleanProposals } from "@/lib/meeting-notes-core"
import { applyMeeting, isMeetingId, meetingAccess, MeetingConflict, serializeMeeting } from "@/lib/meeting-notes"

/**
 * POST /api/meetings/:id/apply { projectId, title, overview, mom, proposals, lang: "en"|"id", taskListId? }
 * The minutes (as edited on screen) become a Doc in the project; every proposal with include:true becomes a task
 * there, linking back to the Doc. → { meeting, doc: { id, title, url }, tasks: [{ id, title }] }
 * 409 ALREADY_APPLIED { meeting } when it was applied already (a double tap, another device): nothing is made twice.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const id = (await params).id
  const row = isMeetingId(id) ? await prisma.meetingNote.findUnique({ where: { id } }) : null
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const access = await meetingAccess(userId, row)
  if (!access.view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!access.edit) return NextResponse.json({ error: "You can view this meeting but not apply it.", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
  const rate = checkRateLimitByKey("meeting-apply", userId, { limit: 20, windowSeconds: 60 })
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests.", code: "RATE_LIMITED" }, { status: 429 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : row.projectId
  if (!projectId) return NextResponse.json({ error: "Pick a project first.", code: "NEEDS_PROJECT" }, { status: 400 })
  if (projectId !== row.projectId && !access.owner) return NextResponse.json({ error: "Only the person who uploaded it can move it to another project.", code: "OWNER_ONLY" }, { status: 403 })
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
  try {
    const result = await applyMeeting(id, { id: userId, name: me?.name ?? null }, {
      projectId,
      title: typeof body.title === "string" ? body.title : row.title,
      overview: typeof body.overview === "string" ? body.overview.slice(0, 6000) : row.overview ?? "",
      mom: cleanMom(body.mom ?? row.mom),
      proposals: cleanProposals(body.proposals ?? row.proposals),
      lang: body.lang === "id" ? "id" : "en",
      taskListId: typeof body.taskListId === "string" ? body.taskListId : null,
    })
    const after = await prisma.meetingNote.findUnique({ where: { id } })
    return NextResponse.json({ meeting: after ? await serializeMeeting(after, await meetingAccess(userId, after), { full: true }) : null, doc: result.doc, tasks: result.tasks })
  } catch (error) {
    if (error instanceof MeetingConflict) {
      const now = await prisma.meetingNote.findUnique({ where: { id } })
      const code = error.status === "APPLIED" || error.status === "APPLYING" ? "ALREADY_APPLIED" : "NOT_READY"
      return NextResponse.json({ error: code === "ALREADY_APPLIED" ? "These minutes were already saved." : "The minutes aren't ready yet.", code, meeting: now ? await serializeMeeting(now, await meetingAccess(userId, now), { full: true }) : null }, { status: 409 })
    }
    const e = error as { http?: number; code?: string; message?: string }
    if (e.http) return NextResponse.json({ error: e.message, code: e.code ?? null }, { status: e.http })
    console.error("meeting apply failed", error)
    return NextResponse.json({ error: "Saving failed. Nothing was created — try again." }, { status: 500 })
  }
}

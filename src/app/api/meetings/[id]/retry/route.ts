export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { cleanSegments } from "@/lib/meeting-notes-core"
import { emitMeetingChanged, isMeetingId, meetingAccess, serializeMeeting } from "@/lib/meeting-notes"

/**
 * POST /api/meetings/:id/retry { stage?: "minutes" | "transcript" }
 * FAILED → back in the pipeline: with a transcript, GIDEON writes the minutes again (SUMMARIZING); without one,
 * the audio is transcribed again (QUEUED) — 410 AUDIO_GONE when the audio was deleted. From READY, `stage:
 * "minutes"` writes the minutes again (the edits so far are replaced; costs GIDEON credits again).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = (await params).id
  const row = isMeetingId(id) ? await prisma.meetingNote.findUnique({ where: { id } }) : null
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const access = await meetingAccess(session.user.id, row)
  if (!access.view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!access.edit) return NextResponse.json({ error: "You can view this meeting but not change it.", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { stage?: string }
  if (row.status !== "FAILED" && row.status !== "READY") return NextResponse.json({ error: "Nothing to retry.", code: "NOT_RETRYABLE" }, { status: 409 })
  const hasTranscript = cleanSegments(row.transcript).length > 0
  const stage = body.stage === "transcript" || !hasTranscript ? "transcript" : "minutes"
  if (row.status === "READY" && stage !== "minutes") return NextResponse.json({ error: "Nothing to retry.", code: "NOT_RETRYABLE" }, { status: 409 })
  if (stage === "transcript" && row.audioDeletedAt) return NextResponse.json({ error: "The recording was deleted, so it can't be transcribed again.", code: "AUDIO_GONE" }, { status: 410 })
  const moved = await prisma.meetingNote.updateMany({
    where: { id, status: row.status, version: row.version },
    data: stage === "minutes"
      ? { status: "SUMMARIZING", progress: 0, error: null, errorCode: null, lockedUntil: null, stageStartedAt: new Date(), version: { increment: 1 } }
      : { status: "QUEUED", progress: 0, error: null, errorCode: null, lockedUntil: null, attempts: 0, stageStartedAt: new Date(), version: { increment: 1 } },
  })
  const now = await prisma.meetingNote.findUnique({ where: { id } })
  if (!now) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!moved.count) return NextResponse.json({ error: "It changed meanwhile. It has been reloaded.", code: "VERSION_CONFLICT", meeting: await serializeMeeting(now, access, { full: true }) }, { status: 409 })
  emitMeetingChanged(now)
  return NextResponse.json({ meeting: await serializeMeeting(now, await meetingAccess(session.user.id, now), { full: true }) })
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { emitMeetingChanged, finishAudio, isMeetingId, meetingAccess, serializeMeeting } from "@/lib/meeting-notes"

/**
 * POST /api/meetings/:id/audio/complete — every byte arrived: the meeting goes in the transcription queue
 * (UPLOADING → QUEUED, conditional, so a repeated call is harmless). 409 INCOMPLETE { received } when bytes are missing.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = (await params).id
  const row = isMeetingId(id) ? await prisma.meetingNote.findUnique({ where: { id } }) : null
  if (!row || row.createdById !== session.user.id) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (row.status !== "UPLOADING") {
    return NextResponse.json({ meeting: await serializeMeeting(row, await meetingAccess(session.user.id, row)) })
  }
  if (row.audioReceived < row.audioBytes) return NextResponse.json({ error: "Some of the file is missing.", code: "INCOMPLETE", received: Number(row.audioReceived) }, { status: 409 })
  try {
    await finishAudio(row)
  } catch {
    // Another request already moved the file (a double tap); the conditional update below decides.
  }
  await prisma.meetingNote.updateMany({ where: { id, status: "UPLOADING" }, data: { status: "QUEUED", progress: 0, attempts: 0, stageStartedAt: new Date(), version: { increment: 1 } } })
  const now = await prisma.meetingNote.findUnique({ where: { id } })
  if (!now) return NextResponse.json({ error: "Not found" }, { status: 404 })
  emitMeetingChanged(now)
  return NextResponse.json({ meeting: await serializeMeeting(now, await meetingAccess(session.user.id, now)) })
}

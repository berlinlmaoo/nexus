export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess, projectAccessLevel } from "@/lib/rbac"
import { checkRateLimitByKey } from "@/lib/rate-limit"
import { MEETING_LANGUAGES, meetingAudioExt } from "@/lib/meeting-notes-core"
import { emitMeetingChanged, meetingAccess, meetingSettings, MEETING_CHUNK_BYTES, MEETING_MAX_CHUNK, serializeMeeting } from "@/lib/meeting-notes"

/**
 * Meeting notes, Beta (18 Oct 2026). docs/internal/meeting-notes-native.md is the contract for the apps.
 *
 * GET  /api/meetings?projectId=&limit=  → { meetings: [...] } — the person's own recordings, plus (with projectId)
 *      the project's recordings they can see. Newest first. Light rows (no transcript).
 * POST /api/meetings { fileName, mime, size, title?, projectId?, language?: auto|id|en, source?: upload|record,
 *      recordedAt?, durationSec?, speakerLabels? (default true), introEndSec? } → 201 { meeting, upload: { chunkBytes, maxChunkBytes } }.
 *      Then PUT /api/meetings/:id/audio?offset=… per chunk and POST /api/meetings/:id/audio/complete.
 *      Refusals carry `code`: DISABLED 403, UNSUPPORTED_TYPE 415, TOO_LARGE 413, TOO_LONG 413, NEEDS_EDIT_ACCESS 403,
 *      RATE_LIMITED 429.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const projectId = req.nextUrl.searchParams.get("projectId")
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50))
  let where: { createdById?: string; OR?: Array<Record<string, unknown>> } = { createdById: userId }
  if (projectId) {
    const level = await projectAccessLevel(userId, projectId).catch(() => null)
    where = level ? { OR: [{ projectId }] } : { OR: [{ projectId, createdById: userId }] }
  }
  const rows = await prisma.meetingNote.findMany({ where, orderBy: { createdAt: "desc" }, take: limit })
  const meetings = []
  for (const row of rows) {
    const access = await meetingAccess(userId, row)
    if (access.view) meetings.push(await serializeMeeting(row, access))
  }
  const settings = await meetingSettings()
  return NextResponse.json({ meetings, settings: { enabled: settings.enabled, maxMinutes: settings.maxMinutes, maxBytes: settings.maxBytes, retentionDays: settings.retentionDays } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const settings = await meetingSettings()
  if (!settings.enabled) return NextResponse.json({ error: "Meeting notes are turned off.", code: "DISABLED" }, { status: 403 })
  const rate = checkRateLimitByKey("meeting-create", userId, { limit: 20, windowSeconds: 3600 })
  if (!rate.allowed) return NextResponse.json({ error: "Too many recordings in an hour. Try again later.", code: "RATE_LIMITED" }, { status: 429 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const fileName = typeof body.fileName === "string" ? body.fileName.replace(/[\r\n/\\]+/g, " ").trim().slice(0, 200) : ""
  const mime = typeof body.mime === "string" ? body.mime.slice(0, 100) : ""
  const size = Number(body.size)
  const ext = meetingAudioExt(fileName, mime)
  if (!ext) return NextResponse.json({ error: "That file type can't be transcribed. Use m4a, mp3, wav, webm, ogg, aac or mp4.", code: "UNSUPPORTED_TYPE" }, { status: 415 })
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: "The file is empty.", code: "EMPTY_FILE" }, { status: 400 })
  if (size > settings.maxBytes) return NextResponse.json({ error: `The file is too large. Maximum ${Math.round(settings.maxBytes / 1048576)} MB.`, code: "TOO_LARGE", maxBytes: settings.maxBytes }, { status: 413 })
  const durationSec = Number(body.durationSec)
  if (Number.isFinite(durationSec) && durationSec > settings.maxMinutes * 60 + 30) {
    return NextResponse.json({ error: `The recording is too long. Maximum ${Math.round(settings.maxMinutes / 60 * 10) / 10} hours.`, code: "TOO_LONG", maxMinutes: settings.maxMinutes }, { status: 413 })
  }
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId.slice(0, 40) : null
  if (projectId && !(await checkProjectAccess(userId, projectId, ["MEMBER"])).allowed) {
    return NextResponse.json({ error: "You need Can edit access in this project.", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
  }
  // At most 3 uploads in flight per person (a disk guard; an abandoned one is dropped after a day).
  const inFlight = await prisma.meetingNote.count({ where: { createdById: userId, status: "UPLOADING" } })
  if (inFlight >= 3) return NextResponse.json({ error: "Finish or cancel your other uploads first.", code: "TOO_MANY_UPLOADS" }, { status: 429 })

  const language = MEETING_LANGUAGES.includes(body.language as never) ? (body.language as string) : "auto"
  const recordedAt = typeof body.recordedAt === "string" && !Number.isNaN(Date.parse(body.recordedAt)) ? new Date(body.recordedAt) : null
  const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 200) : ""
  // Speaker labels (owner, 19 Oct 2026): on unless the person turned them off; introEndSec = the record screen's
  // "Done with introductions" (seconds into the recording), only for a recording made here.
  const introEndSec = Number(body.introEndSec)
  const speakerLabels = body.speakerLabels !== false
  const row = await prisma.meetingNote.create({
    data: {
      createdById: userId,
      projectId,
      title,
      language,
      source: body.source === "record" ? "record" : "upload",
      audioName: fileName || `recording.${ext}`,
      audioMime: mime || null,
      audioExt: ext,
      audioBytes: BigInt(Math.floor(size)),
      recordedAt,
      durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
      speakerLabels,
      introEndSec: speakerLabels && Number.isFinite(introEndSec) && introEndSec > 0 && introEndSec < settings.maxMinutes * 60 ? Math.round(introEndSec * 100) / 100 : null,
    },
  })
  emitMeetingChanged(row)
  const access = await meetingAccess(userId, row)
  return NextResponse.json({ meeting: await serializeMeeting(row, access), upload: { chunkBytes: MEETING_CHUNK_BYTES, maxChunkBytes: MEETING_MAX_CHUNK } }, { status: 201 })
}

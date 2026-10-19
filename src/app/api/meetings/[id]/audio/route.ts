export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { audioBytesMatch, sniffAudio, type MeetingAudioExt } from "@/lib/meeting-notes-core"
import { audioStream, isMeetingId, meetingAccess, MEETING_MAX_CHUNK, removeAudio, writeAudioChunk } from "@/lib/meeting-notes"

type Params = { params: Promise<{ id: string }> }

/**
 * PUT /api/meetings/:id/audio?offset=<bytes already sent> — one chunk of the recording as the RAW body (not
 * multipart), at most 16 MB. Only the uploader, only while UPLOADING. `offset` must equal what the server has
 * (`received`); otherwise 409 { received } and the client continues from there (resumable). A chunk sent twice
 * is written at the same place, never appended twice. The first chunk's bytes must be audio of the declared type
 * (415 UNSUPPORTED_TYPE, and the meeting is dropped). → { received, complete }
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = (await params).id
  const row = isMeetingId(id) ? await prisma.meetingNote.findUnique({ where: { id } }) : null
  if (!row || row.createdById !== session.user.id) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (row.status !== "UPLOADING") return NextResponse.json({ error: "This upload is already finished.", code: "NOT_UPLOADING", received: Number(row.audioReceived) }, { status: 409 })
  const offset = Number(req.nextUrl.searchParams.get("offset"))
  const received = Number(row.audioReceived)
  const total = Number(row.audioBytes)
  if (!Number.isInteger(offset) || offset !== received) return NextResponse.json({ error: "Continue from the server's position.", code: "OFFSET_MISMATCH", received }, { status: 409 })
  if (!req.body) return NextResponse.json({ error: "Empty chunk", code: "EMPTY_CHUNK" }, { status: 400 })
  const maxLen = Math.min(MEETING_MAX_CHUNK, total - offset)
  if (maxLen <= 0) return NextResponse.json({ received, complete: true })
  let written = 0
  try {
    const res = await writeAudioChunk(row, offset, req.body, maxLen)
    written = res.written
    if (offset === 0) {
      const family = res.head ? sniffAudio(res.head) : null
      if (!audioBytesMatch(row.audioExt as MeetingAudioExt, family)) {
        await removeAudio(row)
        await prisma.meetingNote.update({ where: { id }, data: { status: "FAILED", errorCode: "unsupported_type", error: "This file isn't audio of the type its name says." } })
        return NextResponse.json({ error: "This file isn't audio of the type its name says.", code: "UNSUPPORTED_TYPE" }, { status: 415 })
      }
    }
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "CHUNK_TOO_LARGE") return NextResponse.json({ error: "Chunk too large.", code, maxChunkBytes: MEETING_MAX_CHUNK }, { status: 413 })
    console.error("meeting chunk write failed", error)
    return NextResponse.json({ error: "Upload failed. Try again.", code: "WRITE_FAILED", received }, { status: 500 })
  }
  if (!written) return NextResponse.json({ error: "Empty chunk", code: "EMPTY_CHUNK", received }, { status: 400 })
  // Conditional: two requests racing on the same offset cannot both advance it.
  const moved = await prisma.meetingNote.updateMany({ where: { id, status: "UPLOADING", audioReceived: BigInt(offset) }, data: { audioReceived: BigInt(offset + written), progress: (offset + written) / total } })
  const now = await prisma.meetingNote.findUnique({ where: { id }, select: { audioReceived: true } })
  if (!moved.count) return NextResponse.json({ error: "Continue from the server's position.", code: "OFFSET_MISMATCH", received: Number(now?.audioReceived ?? 0) }, { status: 409 })
  const at = Number(now?.audioReceived ?? offset + written)
  return NextResponse.json({ received: at, complete: at >= total })
}

/** GET /api/meetings/:id/audio — the recording, for playback beside the transcript (Range supported). */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = (await params).id
  const row = isMeetingId(id) ? await prisma.meetingNote.findUnique({ where: { id } }) : null
  if (!row || !(await meetingAccess(session.user.id, row)).view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const s = await audioStream(row, req.headers.get("range"))
  if (!s) return NextResponse.json({ error: "The recording has been deleted.", code: "AUDIO_GONE" }, { status: 410 })
  const type = row.audioMime && /^(audio|video)\//.test(row.audioMime) ? row.audioMime : "application/octet-stream"
  if (s.status === 416) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${s.size}` } })
  return new Response(s.body, {
    status: s.status,
    headers: {
      "Content-Type": type,
      "Content-Length": String(s.end - s.start + 1),
      "Accept-Ranges": "bytes",
      ...(s.status === 206 ? { "Content-Range": `bytes ${s.start}-${s.end}/${s.size}` } : {}),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}


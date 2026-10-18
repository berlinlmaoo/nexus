export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { checkProjectAccess } from "@/lib/rbac"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { cleanMom, cleanProposals, cleanSpeakers, MEETING_LANGUAGES } from "@/lib/meeting-notes-core"
import { emitMeetingChanged, isMeetingId, meetingAccess, removeAudio, serializeMeeting, speakerCandidates } from "@/lib/meeting-notes"

type Params = { params: Promise<{ id: string }> }

async function load(id: string) {
  return isMeetingId(id) ? prisma.meetingNote.findUnique({ where: { id } }) : null
}

/** GET /api/meetings/:id → { meeting } with transcript, minutes, proposals and the created tasks. */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const row = await load((await params).id)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const access = await meetingAccess(session.user.id, row)
  if (!access.view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // The people a task can go to: the project's members (for the PIC pickers).
  const members = row.projectId
    ? (await prisma.projectMember.findMany({ where: { projectId: row.projectId }, select: { user: { select: { id: true, name: true, avatar: true, deactivatedAt: true } } } }))
        .filter((m) => m.user && !m.user.deactivatedAt).map((m) => ({ id: m.user.id, name: m.user.name, avatar: m.user.avatar }))
    : []
  return NextResponse.json({ meeting: { ...(await serializeMeeting(row, access, { full: true })), members } })
}

/**
 * PATCH /api/meetings/:id { version, title?, projectId?, language?, overview?, mom?, proposals?, speakers? }
 * Saves edits before Apply. `version` is the one the client edited: a stale one → 409 { meeting } (someone else
 * saved in between; the client merges or reloads). language only before the transcript starts. After Apply the
 * minutes live in the Doc and only the title can change here.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const row = await load((await params).id)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const access = await meetingAccess(userId, row)
  if (!access.view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!access.edit) return NextResponse.json({ error: "You can view this meeting but not edit it.", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const data: Prisma.MeetingNoteUpdateManyMutationInput = {}
  const applied = row.status === "APPLIED" || row.status === "APPLYING"
  if (typeof body.title === "string") data.title = body.title.replace(/\s+/g, " ").trim().slice(0, 200)
  if (!applied) {
    if ("projectId" in body) {
      const pid = typeof body.projectId === "string" && body.projectId ? body.projectId.slice(0, 40) : null
      if (pid && !(await checkProjectAccess(userId, pid, ["MEMBER"])).allowed) return NextResponse.json({ error: "You need Can edit access in that project.", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
      // Only the uploader moves a meeting between projects (it changes who can see it).
      if (pid !== row.projectId && !access.owner) return NextResponse.json({ error: "Only the person who uploaded it can move it to another project.", code: "OWNER_ONLY" }, { status: 403 })
      data.projectId = pid
    }
    if (typeof body.language === "string" && MEETING_LANGUAGES.includes(body.language as never) && ["UPLOADING", "QUEUED"].includes(row.status)) data.language = body.language
    if (row.status === "READY") {
      if (typeof body.overview === "string") data.overview = body.overview.slice(0, 6000)
      if (body.mom !== undefined) data.mom = cleanMom(body.mom) as unknown as Prisma.InputJsonValue
      if (body.proposals !== undefined) data.proposals = cleanProposals(body.proposals) as unknown as Prisma.InputJsonValue
    }
    if (body.speakers && typeof body.speakers === "object" && !Array.isArray(body.speakers)) {
      // { "Speaker N": { name, userId?, auto? } }. An entry sent without auto: true is a hand-made name and wins
      // over the introductions from then on (also after a retry). A label left out goes back to "Speaker N".
      // userId only when that person can be named here (a project member or someone in the workspace).
      const clean = cleanSpeakers(body.speakers)
      const ids = [...new Set(Object.values(clean).map((v) => v.userId).filter((x): x is string => Boolean(x)))]
      if (ids.length) {
        const ok = new Set((await speakerCandidates(row).catch(() => [])).map((c) => c.id))
        for (const v of Object.values(clean)) if (v.userId && !ok.has(v.userId)) v.userId = null
      }
      data.speakers = clean as unknown as Prisma.InputJsonValue
    }
  }
  if (!Object.keys(data).length) return NextResponse.json({ meeting: await serializeMeeting(row, access, { full: true }) })
  const version = Number(body.version)
  const res = await prisma.meetingNote.updateMany({
    where: { id: row.id, status: { notIn: ["APPLYING"] }, ...(Number.isInteger(version) ? { version } : {}) },
    data: { ...data, version: { increment: 1 } },
  })
  const now = await prisma.meetingNote.findUnique({ where: { id: row.id } })
  if (!now) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const nowAccess = await meetingAccess(userId, now)
  if (!res.count) return NextResponse.json({ error: "Someone else changed this meeting. It has been reloaded.", code: "VERSION_CONFLICT", meeting: await serializeMeeting(now, nowAccess, { full: true }) }, { status: 409 })
  emitMeetingChanged(now)
  // Moved out of a project: its old room is told too.
  if (row.projectId && row.projectId !== now.projectId) emitMeetingChanged({ ...now, projectId: row.projectId })
  return NextResponse.json({ meeting: await serializeMeeting(now, nowAccess, { full: true }) })
}

/**
 * DELETE /api/meetings/:id — the transcript and minutes go to Control Room › Audit (restorable for 90 days); the
 * audio file is removed now. The Doc and tasks made by Apply stay (they belong to the project).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const row = await load((await params).id)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const access = await meetingAccess(session.user.id, row)
  if (!access.view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!access.remove) return NextResponse.json({ error: "Only the uploader or someone with Full access can delete it.", code: "NEEDS_FULL_ACCESS" }, { status: 403 })
  if (row.status === "APPLYING") return NextResponse.json({ error: "It's being saved right now. Try again in a moment.", code: "BUSY" }, { status: 409 })
  const workspaceId = row.projectId ? (await prisma.project.findUnique({ where: { id: row.projectId }, select: { workspaceId: true } }))?.workspaceId ?? null : null
  // The audio goes first and the row says so, so the audit copy (and a restore) knows there is no audio.
  await removeAudio(row)
  await prisma.meetingNote.update({ where: { id: row.id }, data: { audioDeletedAt: row.audioDeletedAt ?? new Date(), ...(["UPLOADING", "QUEUED", "TRANSCRIBING"].includes(row.status) ? { status: "FAILED", errorCode: "deleted", error: "Deleted before the transcript finished." } : {}) } })
  await restorableDelete({
    entityType: "meeting_note", entityId: row.id, entityName: row.title || row.audioName || "Meeting", workspaceId,
    userId: session.user.id, request: req, metadata: { projectId: row.projectId },
    meta: { open: { type: "meeting", id: row.id, ...(row.projectId ? { projectId: row.projectId } : {}) }, projectId: row.projectId },
    remove: (tx) => tx.meetingNote.delete({ where: { id: row.id } }),
  })
  emitMeetingChanged(row, { deleted: true })
  return NextResponse.json({ success: true })
}

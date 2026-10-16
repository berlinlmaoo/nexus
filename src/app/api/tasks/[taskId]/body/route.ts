export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { BodyConflictError, bodyAccess, loadBody, saveBody } from "@/lib/block-bodies"
import { flushLiveRoom } from "@/lib/collab-rooms"
import { sanitizeDoc } from "@/lib/blockdoc"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"

/**
 * The task's block-editor body (owner-approved item #5, 12 Oct 2026).
 *
 * GET → { doc, text, canEdit, updatedAt }. `doc` is TipTap JSON (format: lib/blockdoc.ts). When the
 *   description was written as text since the last editor save (released apps, GIDEON, automations),
 *   the document is rebuilt from that text — the text is the truth.
 * PUT { doc, baseText? } → { doc, text, updatedAt }. Stores the JSON and its text form in
 *   Task.description (what released apps read). `baseText` is the description the editor started
 *   from: if the stored one differs, someone else changed it → 409 with the current body, nothing written.
 *
 * Live editing goes through the socket rooms (lib/collab-rooms.ts); this is the fallback when the
 * socket is not available, and the read path for the first paint.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { taskId } = await params
  const access = await bodyAccess(session.user.id, "taskbody", taskId)
  if (!access.exists) return NextResponse.json({ error: "Task not found" }, { status: 404 })
  if (!access.read) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await loadBody("taskbody", taskId)
  if (!body) return NextResponse.json({ error: "Task not found" }, { status: 404 })
  return NextResponse.json({ doc: body.json, text: body.text, canEdit: access.write, updatedAt: body.updatedAt.toISOString() })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { allowed, resetAt } = checkRateLimit(req, session.user.id, { limit: 120, windowSeconds: 60 })
  if (!allowed) return rateLimitResponse(resetAt)
  const { taskId } = await params
  const access = await bodyAccess(session.user.id, "taskbody", taskId)
  if (!access.exists) return NextResponse.json({ error: "Task not found" }, { status: 404 })
  if (!access.write) return NextResponse.json(access.read ? { error: "Forbidden: you need Can edit access in this project", code: "NEEDS_EDIT_ACCESS" } : { error: "Forbidden" }, { status: 403 })

  let payload: { doc?: unknown; baseText?: unknown }
  try { payload = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const doc = sanitizeDoc(payload.doc)
  if (!doc) return NextResponse.json({ error: "doc must be a document ({ type: \"doc\", content: [...] }) under 2 MB" }, { status: 400 })

  // Live editors' unsaved typing first (race audit 16 Oct 2026, H9), then the base check INSIDE saveBody's
  // transaction under the Task row lock (M10): checked here before, 6 of 20 saves from one base landed.
  const live = await flushLiveRoom(`taskbody:${taskId}`)
  const current = await loadBody("taskbody", taskId)
  if (!current) return NextResponse.json({ error: "Task not found" }, { status: 404 })
  const conflict = (c: typeof current) =>
    NextResponse.json({ error: "This description was changed by someone else.", code: "DESCRIPTION_CHANGED", conflict: true, doc: c.json, text: c.text, updatedAt: c.updatedAt.toISOString() }, { status: 409 })
  const baseText = typeof payload.baseText === "string" ? payload.baseText : undefined
  if (baseText !== undefined && baseText !== current.text) return conflict(current)
  let saved
  try {
    saved = await saveBody(current, doc, { actorId: session.user.id, expect: baseText !== undefined ? { text: baseText } : undefined })
  } catch (e) {
    if (e instanceof BodyConflictError) return conflict(e.current)
    throw e
  }
  const replacedLive = live.flushed && baseText === undefined ? live.replaced : null
  logAudit({ action: "update", entityType: "task", entityId: taskId, entityName: current.title, userId: session.user.id, request: req, metadata: { changes: ["description"], via: "block-editor", ...(replacedLive ? { replacedLiveText: replacedLive } : {}) } })
  return NextResponse.json({ doc: saved.json, text: saved.text ?? "", updatedAt: saved.updatedAt.toISOString() })
}

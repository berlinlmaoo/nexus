export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { bodyAccess } from "@/lib/block-bodies"
import { sanitizeDoc } from "@/lib/blockdoc"
import { requestBlockEdit } from "@/lib/collab-rooms"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"

/**
 * POST /api/collab/edit — block edits from a client that does not run the live editor (the iOS app,
 * 12 Oct 2026). Body: { kind: "doc" | "taskbody", id, base, doc, keepBoth? } where `base` is the document
 * the client loaded and `doc` what it ends with (both TipTap JSON, lib/blockdoc.ts).
 *
 * The edit is merged block by block into the LIVE document (the Yjs room — opened for it when nobody has
 * the page open) and relayed to every open editor as a normal Yjs update, so web collaborators see it at
 * once and nothing they type is overwritten (lib/collab-rooms.ts applyBlockEdit, lib/block-merge.ts).
 *   200 { doc, changed, epoch }            merged and saved; `doc` is the document as it is now
 *   409 { conflict: true, doc, conflicts }  a block the client changed was also changed by someone else;
 *                                          nothing written. Resend with keepBoth: true to keep both versions.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { allowed, resetAt } = checkRateLimit(req, session.user.id, { limit: 120, windowSeconds: 60 })
  if (!allowed) return rateLimitResponse(resetAt)

  let payload: { kind?: unknown; id?: unknown; base?: unknown; doc?: unknown; keepBoth?: unknown }
  try { payload = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const kind = payload.kind === "doc" || payload.kind === "taskbody" ? payload.kind : null
  const id = typeof payload.id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(payload.id) ? payload.id : null
  if (!kind || !id) return NextResponse.json({ error: "kind must be doc or taskbody, with an id" }, { status: 400 })
  const base = sanitizeDoc(payload.base)
  const mine = sanitizeDoc(payload.doc)
  if (!base || !mine) return NextResponse.json({ error: "base and doc must be documents ({ type: \"doc\", content: [...] }) under 2 MB" }, { status: 400 })

  const access = await bodyAccess(session.user.id, kind, id)
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!access.write) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const result = await requestBlockEdit({ kind, id, userId: session.user.id, base, mine, keepBoth: payload.keepBoth === true })
  if (result.status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (result.status === 409) {
    return NextResponse.json({ error: "Someone else changed the same part.", conflict: true, doc: result.doc, conflicts: result.conflicts, epoch: result.epoch }, { status: 409 })
  }
  return NextResponse.json({ doc: result.doc, changed: result.changed, epoch: result.epoch })
}

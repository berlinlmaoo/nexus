export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { getAdminSessionContext } from "@/lib/admin-access"
import { logAudit } from "@/lib/audit"
import { approveDraft, BufferError, type ApproveMode } from "@/lib/buffer-client"

const MODES: ApproveMode[] = ["queue", "schedule", "now"]

export async function POST(request: NextRequest) {
  const { session, context } = await getAdminSessionContext()
  if (!context?.user || !session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!context.workspaceMemberships.some((m) => m.role === "ONE_ABOVE_ALL")) {
    return NextResponse.json({ error: "Khusus One Above All." }, { status: 403 })
  }

  let body: { postId?: string; mode?: ApproveMode; dueAt?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }) }
  const postId = (body.postId || "").toString()
  const mode = body.mode as ApproveMode
  if (!postId) return NextResponse.json({ error: "postId wajib." }, { status: 400 })
  if (!MODES.includes(mode)) return NextResponse.json({ error: "mode harus queue/schedule/now." }, { status: 400 })

  try {
    const result = await approveDraft(postId, mode, body.dueAt)
    await logAudit({
      action: "update", entityType: "buffer_post", entityId: postId, entityName: `approve:${mode}`,
      userId: session.user.id, request, metadata: { mode, dueAt: body.dueAt ?? null },
    }).catch(() => {})
    return NextResponse.json({ ok: true, post: result })
  } catch (e) {
    const msg = e instanceof BufferError ? e.message : "Gagal approve di Buffer."
    console.error("[buffer] approve failed", e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

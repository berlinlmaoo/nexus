export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { getAdminSessionContext } from "@/lib/admin-access"
import { logAudit } from "@/lib/audit"
import { rejectDraft, BufferError } from "@/lib/buffer-client"

export async function POST(request: NextRequest) {
  const { session, context } = await getAdminSessionContext()
  if (!context?.user || !session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!context.workspaceMemberships.some((m) => m.role === "ONE_ABOVE_ALL")) {
    return NextResponse.json({ error: "Khusus One Above All." }, { status: 403 })
  }

  let body: { postId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }) }
  const postId = (body.postId || "").toString()
  if (!postId) return NextResponse.json({ error: "postId wajib." }, { status: 400 })

  try {
    const result = await rejectDraft(postId)
    await logAudit({
      action: "delete", entityType: "buffer_post", entityId: postId, entityName: "reject",
      userId: session.user.id, request,
    }).catch(() => {})
    return NextResponse.json({ ok: true, post: result })
  } catch (e) {
    const msg = e instanceof BufferError ? e.message : "Gagal reject di Buffer."
    console.error("[buffer] reject failed", e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

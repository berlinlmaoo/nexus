export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getPrintUpload, removePrintUpload } from "@/lib/print/uploads"

type Ctx = { params: Promise<{ uploadId: string }> }

/** DELETE /api/print/uploads/{id} → { ok } — the person changed their mind: the file is gone now. Your own only;
 *  an unknown, expired or someone else's id answers ok too (nothing of theirs to remove). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { uploadId } = await params
  if (await getPrintUpload(uploadId, session.user.id)) await removePrintUpload(uploadId)
  return NextResponse.json({ ok: true })
}

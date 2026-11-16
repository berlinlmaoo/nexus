export const dynamic = "force-dynamic"

import { pingActorAfter } from "@/lib/attendance-realtime"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { applyAttendanceOverride, type OverrideBody } from "@/lib/attendance-override"

/**
 * JSON (every released client) or multipart/form-data (the web board and apps that attach evidence: the
 * same fields as form fields, plus the file in `evidence`). In multipart an empty `checkOutAt` field means
 * "check-in only" (null), exactly like `"checkOutAt": null` in JSON; leaving the field out keeps the shift end.
 */
async function readBody(req: NextRequest): Promise<{ body: OverrideBody | null; evidence: File | null }> {
  const contentType = req.headers.get("content-type") ?? ""
  if (/multipart\/form-data/i.test(contentType)) {
    const form = await req.formData().catch(() => null)
    if (!form) return { body: null, evidence: null }
    const str = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : undefined }
    const body: OverrideBody = { userId: str("userId"), date: str("date"), action: str("action"), note: str("note"), checkInAt: str("checkInAt") }
    if (form.has("checkOutAt")) body.checkOutAt = str("checkOutAt")?.trim() ? str("checkOutAt") : null
    const file = form.get("evidence") ?? form.get("supportingDocument")
    return { body, evidence: file instanceof File && file.size > 0 ? file : null }
  }
  try {
    return { body: (await req.json()) as OverrideBody, evidence: null }
  } catch {
    return { body: null, evidence: null }
  }
}
// BoD status override from the crew streak board — the rules live in lib/attendance-override.ts.
async function handlePOST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { body, evidence } = await readBody(req)
    return await applyAttendanceOverride({ request: req, session: { user: { id: session.user.id, name: session.user.name } }, body, evidence })
  } catch (error) {
    console.error("attendance override error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 })
  }
}

// C-17: the actor's other devices refetch (lib/attendance-realtime.ts).
export const POST = pingActorAfter("override", handlePOST)

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ownRequest, serializeForRequester } from "@/lib/legal/requests"

type Ctx = { params: Promise<{ requestId: string }> }

/** One of my own Legal requests, with my answers. Someone else's answers 404, exactly like a missing one. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { requestId } = await params
    const row = await ownRequest(session.user.id, requestId)
    if (!row) return NextResponse.json({ error: "Request not found" }, { status: 404 })
    const [request] = await serializeForRequester(session.user.id, [row], { detail: true })
    return NextResponse.json({ request })
  } catch (error) {
    console.error("Error loading my Legal request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

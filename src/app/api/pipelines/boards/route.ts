export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { allPipelinesGate } from "@/lib/pipeline-all"

/**
 * The Pipeline boards of the workspace, for the All Pipelines entry points (owner, 21 Oct 2026): the pinned
 * "All Pipelines" row on Projects and the board switcher in a board's title. BoD / One Above All only; anyone
 * else 403 (clients then show neither). ?workspaceId= optional.
 * → { workspaceId, boards: [{ id, name, icon, color, status, dealCount }] }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const gate = await allPipelinesGate(session.user.id, request.nextUrl.searchParams.get("workspaceId"))
    if (!gate.ok) return gate.response
    return NextResponse.json({ workspaceId: gate.workspaceId, boards: gate.boards })
  } catch (error) {
    console.error("Error listing pipeline boards:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { searchLinks } from "@/lib/legal/links"
import { requesterViewer } from "@/lib/legal/requests"

/** For the request form's "related project / deal": only what the requester can open themselves. */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return NextResponse.json(await searchLinks(await requesterViewer(session.user.id), request.nextUrl.searchParams.get("q") ?? ""))
  } catch (error) {
    console.error("Error searching request links:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

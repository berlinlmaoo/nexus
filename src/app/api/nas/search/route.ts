export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNasSession, nasSearch, NasError } from "@/lib/nas"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { searchParams } = request.nextUrl
    const query = searchParams.get("q")
    const folder = searchParams.get("folder") || "/volume1"
    const recursive = searchParams.get("recursive") !== "false"

    if (!query || query.length < 2) {
      return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 })
    }

    const sid = await getNasSession()
    const files = await nasSearch(sid, folder, query, recursive)

    return NextResponse.json({ files, total: files.length })
  } catch (error) {
    console.error("NAS search error:", error)
    if (error instanceof NasError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Search failed" }, { status: 500 })
  }
}

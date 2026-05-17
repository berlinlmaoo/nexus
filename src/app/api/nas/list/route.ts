export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNasSession, nasList, getCachedList, setCachedList, NasError } from "@/lib/nas"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { searchParams } = request.nextUrl
    const folder = searchParams.get("folder") || "/volume1"
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200)
    const offset = parseInt(searchParams.get("offset") || "0", 10)
    const sortBy = (searchParams.get("sortBy") as "name" | "size" | "mtime") || "name"
    const sortDirection = (searchParams.get("sortDirection") as "asc" | "desc") || "asc"

    // Check cache
    const cacheKey = `${folder}:${offset}:${limit}:${sortBy}:${sortDirection}`
    const cached = getCachedList(cacheKey)
    if (cached) {
      return NextResponse.json({
        files: cached.files,
        total: cached.total,
        offset: cached.offset,
        hasMore: cached.offset + cached.files.length < cached.total,
      })
    }

    const sid = await getNasSession()
    const result = await nasList(sid, folder, offset, limit, sortBy, sortDirection)

    setCachedList(cacheKey, result)

    return NextResponse.json({
      files: result.files,
      total: result.total,
      offset: result.offset,
      hasMore: result.offset + result.files.length < result.total,
    })
  } catch (error) {
    console.error("NAS list error:", error)
    if (error instanceof NasError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to list NAS files" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNasSession, nasDownload, NasError } from "@/lib/nas"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const filePath = request.nextUrl.searchParams.get("filePath")
    if (!filePath) {
      return NextResponse.json({ error: "Missing filePath" }, { status: 400 })
    }

    const sid = await getNasSession()
    const { stream, contentType, filename, size } = await nasDownload(sid, filePath)

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, no-cache",
    }

    if (size > 0) {
      headers["Content-Length"] = String(size)
    }

    return new NextResponse(stream, { headers })
  } catch (error) {
    console.error("NAS download error:", error)
    if (error instanceof NasError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Download failed" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { NasError, getNasSession, nasDownload } from "@/lib/nas"
import { resolveProjectFolder } from "@/lib/nas-project"
import { INLINE_OK, extensionOf } from "@/lib/file-response"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { projectId } = await params
  const { allowed } = await checkProjectAccess(session.user.id!, projectId, ["MEMBER"])
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const rel = request.nextUrl.searchParams.get("path")
    if (!rel) return NextResponse.json({ error: "Missing path" }, { status: 400 })
    const filePath = resolveProjectFolder(projectId, rel)
    // Inline only for types that cannot run script on this origin (an SVG/HTML from the NAS served
    // inline with the NAS's Content-Type would execute with the viewer's session).
    const inline = request.nextUrl.searchParams.get("inline") === "1" && INLINE_OK.has(extensionOf(filePath))

    const sid = await getNasSession()
    const { stream, contentType, filename, size } = await nasDownload(sid, filePath)

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, no-cache",
    }
    if (size > 0) headers["Content-Length"] = String(size)

    return new NextResponse(stream, { headers })
  } catch (error) {
    console.error("Project file download error:", error)
    if (error instanceof NasError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: "Download failed" }, { status: 500 })
  }
}

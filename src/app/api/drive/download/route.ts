export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAccessToken, downloadFile } from "@/lib/google-drive"
import { Readable } from "stream"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const accessToken = await getAccessToken(session.user.id as string)
    if (!accessToken) {
      return NextResponse.json(
        { error: "Google Drive not connected" },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const fileId = searchParams.get("fileId")

    if (!fileId) {
      return NextResponse.json(
        { error: "Missing fileId parameter" },
        { status: 400 }
      )
    }

    const { stream, mimeType, name } = await downloadFile(accessToken, fileId)

    // Convert Node.js stream to Web ReadableStream
    const readable = Readable.toWeb(
      stream instanceof Readable ? stream : Readable.from(stream)
    ) as ReadableStream

    return new NextResponse(readable, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
      },
    })
  } catch (error) {
    console.error("Drive download error:", error)
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 }
    )
  }
}

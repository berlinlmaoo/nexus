import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAccessToken, listFiles } from "@/lib/google-drive"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const accessToken = await getAccessToken(session.user.id as string)
    if (!accessToken) {
      return NextResponse.json(
        { error: "Google Drive not connected. Please authorize first." },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const folderId = searchParams.get("folderId") || undefined
    const query = searchParams.get("query") || undefined
    const pageToken = searchParams.get("pageToken") || undefined

    const result = await listFiles(accessToken, {
      folderId,
      query,
      pageToken,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Drive list error:", error)
    return NextResponse.json(
      { error: "Failed to list files" },
      { status: 500 }
    )
  }
}

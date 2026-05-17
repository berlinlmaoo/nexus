export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAccessToken, uploadFile } from "@/lib/google-drive"
import { Readable } from "stream"

export async function POST(request: Request) {
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

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const folderId = formData.get("folderId") as string | null
    const name = formData.get("name") as string | null

    if (!file) {
      return NextResponse.json(
        { error: "Missing file in form data" },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const readable = Readable.from(buffer)

    const result = await uploadFile(accessToken, {
      name: name || file.name,
      mimeType: file.type || "application/octet-stream",
      body: readable,
      folderId: folderId || undefined,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Drive upload error:", error)
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    )
  }
}

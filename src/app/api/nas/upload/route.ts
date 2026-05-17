export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNasSession, nasUpload, invalidateListCache, NasError } from "@/lib/nas"

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024 // 100MB

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const folderPath = formData.get("folderPath") as string | null

    if (!file || !folderPath) {
      return NextResponse.json({ error: "Missing file or folderPath" }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: "File exceeds 100MB limit" }, { status: 400 })
    }

    const sid = await getNasSession()
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await nasUpload(sid, folderPath, file.name, buffer)

    // Invalidate cache for the folder
    invalidateListCache(folderPath)

    return NextResponse.json({
      path: result.path,
      size: result.size,
      filename: file.name,
      uploaded: new Date().toISOString(),
    })
  } catch (error) {
    console.error("NAS upload error:", error)
    if (error instanceof NasError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}

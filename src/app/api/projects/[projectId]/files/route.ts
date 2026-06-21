export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import { NasError, getNasSession, nasUpload, nasDelete, invalidateListCache } from "@/lib/nas"
import {
  listProjectFolder,
  ensureProjectFolder,
  resolveProjectFolder,
  toRelativePath,
} from "@/lib/nas-project"

const MAX_UPLOAD_SIZE = 200 * 1024 * 1024 // 200MB

function nasErrorStatus(error: unknown) {
  if (error instanceof NasError) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ error: "NAS request failed" }, { status: 500 })
}

// ── List project files ───────────────────────────────
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
    const sp = request.nextUrl.searchParams
    const path = sp.get("path") || ""
    const result = await listProjectFolder(projectId, path, {
      offset: parseInt(sp.get("offset") || "0", 10),
      limit: Math.min(parseInt(sp.get("limit") || "100", 10), 200),
      sortBy: (sp.get("sortBy") as "name" | "size" | "mtime") || "name",
      sortDirection: (sp.get("sortDirection") as "asc" | "desc") || "asc",
    })
    const files = result.files.map((f) => ({ ...f, relPath: toRelativePath(projectId, f.path) }))
    return NextResponse.json({
      path,
      files,
      total: result.total,
      offset: result.offset,
      hasMore: result.offset + result.files.length < result.total,
    })
  } catch (error) {
    console.error("Project files list error:", error)
    return nasErrorStatus(error)
  }
}

// ── Upload a file, or create a sub-folder ─────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { projectId } = await params
  const { allowed } = await checkProjectAccess(session.user.id!, projectId, ["MEMBER"])
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const contentType = request.headers.get("content-type") || ""

  try {
    // JSON body → create a folder.
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}))
      const path = String(body.path || "")
      const name = String(body.name || "").trim()
      if (!name || /[\\/]/.test(name)) {
        return NextResponse.json({ error: "Invalid folder name" }, { status: 400 })
      }
      const folder = await ensureProjectFolder(projectId, path ? `${path}/${name}` : name)
      invalidateListCache(resolveProjectFolder(projectId, path))
      return NextResponse.json({ created: true, path: folder })
    }

    // multipart → upload file(s).
    const formData = await request.formData()
    const path = String(formData.get("path") || "")
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 })
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: "File exceeds 200MB limit" }, { status: 400 })
    }

    const folder = resolveProjectFolder(projectId, path)
    // Make sure the destination exists (lazy first upload).
    await ensureProjectFolder(projectId, path).catch(() => {})

    const sid = await getNasSession()
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await nasUpload(sid, folder, file.name, buffer)
    invalidateListCache(folder)

    return NextResponse.json({
      uploaded: true,
      filename: file.name,
      path: result.path,
      relPath: toRelativePath(projectId, result.path),
      size: result.size,
    })
  } catch (error) {
    console.error("Project files upload error:", error)
    return nasErrorStatus(error)
  }
}

// ── Delete a file or folder within the project ────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { projectId } = await params
  // Deleting requires elevated project rights.
  const { allowed } = await checkProjectAccess(session.user.id!, projectId, ["LEAD"])
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const path = request.nextUrl.searchParams.get("path") || ""
    if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 })
    const target = resolveProjectFolder(projectId, path)
    const sid = await getNasSession()
    await nasDelete(sid, target)
    invalidateListCache(target.slice(0, target.lastIndexOf("/")))
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Project files delete error:", error)
    return nasErrorStatus(error)
  }
}

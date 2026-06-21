export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

// If the FolderPin table doesn't exist yet (migration not applied to this DB), behave as "no pins"
// instead of 500ing — mirrors the graceful degradation in project-folders/route.ts (duck-typed, since
// this project's generated client doesn't re-export the Prisma namespace).
function isMissingSchemaError(error: unknown) {
  return (
    typeof error === "object" && error !== null && "code" in error &&
    ((error as { code?: string }).code === "P2021" || (error as { code?: string }).code === "P2022")
  )
}

// GET → the current user's pinned folder ids (most-recent first).
export async function GET() {
  const session = await auth()
  const user = session?.user
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const pins = await prisma.folderPin.findMany({
      where: { userId: user.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { folderId: true },
    })
    return NextResponse.json({ folderIds: pins.map((p) => p.folderId) })
  } catch (error) {
    if (isMissingSchemaError(error)) return NextResponse.json({ folderIds: [] })
    throw error
  }
}

// POST { folderId, pinned } → pin (pinned !== false) or unpin a folder for this user.
export async function POST(req: NextRequest) {
  const session = await auth()
  const user = session?.user
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const folderId: unknown = body?.folderId
  const pinned: boolean = body?.pinned !== false // default true
  if (typeof folderId !== "string" || !folderId) {
    return NextResponse.json({ error: "folderId is required" }, { status: 400 })
  }

  // Folders have no per-folder membership, so gate on: the folder exists AND the user is a member of its
  // workspace. (Unlike the project-pin route, which leans on the projects list for visibility, a folder
  // id alone is guessable — so we verify workspace membership before letting anyone pin it.)
  const folder = await prisma.projectFolder.findUnique({
    where: { id: folderId },
    select: { workspaceId: true },
  })
  if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 })
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: folder.workspaceId, userId: user.id },
    select: { id: true },
  })
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    if (pinned) {
      const max = await prisma.folderPin.aggregate({ where: { userId: user.id }, _max: { position: true } })
      await prisma.folderPin.upsert({
        where: { userId_folderId: { userId: user.id, folderId } },
        update: {},
        create: { userId: user.id, folderId, position: (max._max.position ?? -1) + 1 },
      })
    } else {
      await prisma.folderPin.deleteMany({ where: { userId: user.id, folderId } })
    }
    return NextResponse.json({ pinned })
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({ error: "Folder pins not migrated yet" }, { status: 503 })
    }
    throw error
  }
}

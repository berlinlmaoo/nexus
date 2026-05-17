export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { isSystemAdminUser } from "@/lib/rbac"

async function canManageWorkspace(userId: string, workspaceId: string) {
  if (await isSystemAdminUser(userId)) return true

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  })

  return membership?.role === "OWNER" || membership?.role === "ADMIN"
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const workspaceId = request.nextUrl.searchParams.get("workspaceId")
    const isSystemAdmin = await isSystemAdminUser(session.user.id)

    if (workspaceId) {
      if (!isSystemAdmin) {
        const membership = await prisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
          select: { id: true },
        })
        if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const folders = await prisma.projectFolder.findMany({
        where: { workspaceId },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      })

      return NextResponse.json(folders)
    }

    const workspaceMemberships = await prisma.workspaceMember.findMany({
      where: isSystemAdmin ? undefined : { userId: session.user.id },
      select: { workspaceId: true },
    })

    if (!isSystemAdmin && workspaceMemberships.length === 0) {
      return NextResponse.json([])
    }

    const folders = await prisma.projectFolder.findMany({
      where: isSystemAdmin
        ? undefined
        : { workspaceId: { in: workspaceMemberships.map((membership) => membership.workspaceId) } },
      orderBy: [{ workspaceId: "asc" }, { position: "asc" }, { name: "asc" }],
    })

    return NextResponse.json(folders)
  } catch (error) {
    console.error("Error fetching project folders:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : ""
    const icon = typeof body.icon === "string" && body.icon.trim()
      ? body.icon.trim().slice(0, 20)
      : "📁"
    const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : "#111827"

    if (!name || !workspaceId) {
      return NextResponse.json({ error: "Folder name and workspaceId are required" }, { status: 400 })
    }

    if (!(await canManageWorkspace(session.user.id, workspaceId))) {
      return NextResponse.json({ error: "Forbidden: workspace admin required" }, { status: 403 })
    }

    const lastFolder = await prisma.projectFolder.findFirst({
      where: { workspaceId },
      orderBy: { position: "desc" },
      select: { position: true },
    })

    const folder = await prisma.projectFolder.create({
      data: {
        name,
        icon,
        color,
        workspaceId,
        position: (lastFolder?.position ?? -1) + 1,
      },
    })

    return NextResponse.json(folder, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "A folder with this name already exists" }, { status: 409 })
    }

    console.error("Error creating project folder:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

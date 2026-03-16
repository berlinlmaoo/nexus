import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const workspaceId = request.nextUrl.searchParams.get("workspaceId")

    const portfolios = await prisma.portfolio.findMany({
      where: {
        ...(workspaceId && { workspaceId }),
        workspace: {
          members: { some: { userId: session.user.id } },
        },
      },
      include: {
        owner: { select: { id: true, name: true, email: true, avatar: true } },
        projects: {
          include: {
            project: {
              select: { id: true, name: true, status: true, color: true },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    })

    return NextResponse.json(portfolios)
  } catch (error) {
    console.error("Error fetching portfolios:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { name, description, workspaceId, projectIds } = await request.json()

    if (!name || !workspaceId) {
      return NextResponse.json({ error: "name and workspaceId are required" }, { status: 400 })
    }

    const portfolio = await prisma.portfolio.create({
      data: {
        name,
        description,
        ownerId: session.user.id,
        workspaceId,
        projects: projectIds?.length
          ? { create: projectIds.map((projectId: string) => ({ projectId })) }
          : undefined,
      },
      include: {
        owner: { select: { id: true, name: true, email: true, avatar: true } },
        projects: {
          include: {
            project: {
              select: { id: true, name: true, status: true, color: true },
            },
          },
        },
      },
    })

    logAudit({ action: "create", entityType: "portfolio", entityId: portfolio.id, entityName: name, userId: session.user.id, request })

    return NextResponse.json(portfolio, { status: 201 })
  } catch (error) {
    console.error("Error creating portfolio:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import type { InputJsonValue } from "@prisma/client/runtime/client"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const member = await prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
    })
    if (!member) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const bundles = await prisma.workflowBundle.findMany({
      where: { workspaceId: member.workspaceId },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ bundles })
  } catch (error) {
    console.error("WorkflowBundles GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const member = await prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
    })
    if (!member) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { name, description, config } = await req.json()

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
    if (!config) return NextResponse.json({ error: "Config is required" }, { status: 400 })

    const bundle = await prisma.workflowBundle.create({
      data: {
        name,
        description,
        config: config as InputJsonValue,
        workspaceId: member.workspaceId,
        createdById: session.user.id,
      },
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
      },
    })

    logAudit({ action: "create", entityType: "workflow_bundle", entityId: bundle.id, entityName: name, userId: session.user.id, request: req })

    return NextResponse.json({ bundle }, { status: 201 })
  } catch (error) {
    console.error("WorkflowBundles POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

    const member = await prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
    })
    if (!member) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const bundle = await prisma.workflowBundle.findFirst({
      where: { id, workspaceId: member.workspaceId },
    })
    if (!bundle) return NextResponse.json({ error: "Bundle not found" }, { status: 404 })

    await prisma.workflowBundle.delete({ where: { id } })

    logAudit({ action: "delete", entityType: "workflow_bundle", entityId: id, entityName: bundle.name, userId: session.user.id, request: req })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("WorkflowBundles DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

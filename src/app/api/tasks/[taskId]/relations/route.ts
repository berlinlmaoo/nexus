export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function GET(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const relations = await prisma.taskRelation.findMany({
      where: {
        OR: [
          { sourceTaskId: params.taskId },
          { targetTaskId: params.taskId },
        ],
      },
      include: {
        sourceTask: {
          select: {
            id: true,
            title: true,
            status: true,
            taskList: {
              select: {
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
        targetTask: {
          select: {
            id: true,
            title: true,
            status: true,
            taskList: {
              select: {
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    })

    // Flatten project info into task objects
    const formatted = relations.map((r) => ({
      ...r,
      sourceTask: {
        id: r.sourceTask.id,
        title: r.sourceTask.title,
        status: r.sourceTask.status,
        project: r.sourceTask.taskList?.project || null,
      },
      targetTask: {
        id: r.targetTask.id,
        title: r.targetTask.title,
        status: r.targetTask.status,
        project: r.targetTask.taskList?.project || null,
      },
    }))

    return NextResponse.json({ relations: formatted })
  } catch (error) {
    console.error("Error fetching relations:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { targetTaskId, type } = await req.json()
    if (!targetTaskId || !type)
      return NextResponse.json(
        { error: "targetTaskId and type are required" },
        { status: 400 }
      )

    const relation = await prisma.taskRelation.create({
      data: {
        sourceTaskId: params.taskId,
        targetTaskId,
        type,
      },
    })

    logAudit({ action: "create", entityType: "task_relation", entityId: relation.id, userId: session.user.id, request: req, metadata: { sourceTaskId: params.taskId, targetTaskId, type } })

    return NextResponse.json({ relation }, { status: 201 })
  } catch (error) {
    console.error("Error creating relation:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

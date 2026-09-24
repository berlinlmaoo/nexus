export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { taskWriteRefusal } from "@/lib/write-access"
import { isUniqueViolation } from "@/lib/prisma-errors"
import { canReadTask, taskReadRefusal } from "@/lib/read-access"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // Signed in is not enough (API.md E5): whoever may open the task (lib/read-access.ts).
    const readable = await canReadTask(session.user.id, (await params).taskId)
    if (readable !== "ok") return taskReadRefusal(readable)

    const relations = await prisma.taskRelation.findMany({
      where: {
        OR: [
          { sourceTaskId: (await params).taskId },
          { targetTaskId: (await params).taskId },
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
  { params }: { params: Promise<{ taskId: string }> }
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

    // Signed in is not enough (writes batch): whoever may open the task — and the other task (its
    // title comes back in the relation list).
    const refusal =
      (await taskWriteRefusal(session.user.id, (await params).taskId)) ??
      (await taskWriteRefusal(session.user.id, String(targetTaskId)))
    if (refusal) return refusal

    const relation = await prisma.taskRelation
      .create({
        data: {
          sourceTaskId: (await params).taskId,
          targetTaskId,
          type,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) return null
        throw error
      })
    // Was a 500: TaskRelation @@unique([sourceTaskId, targetTaskId, type]).
    if (!relation) return NextResponse.json({ error: "This relation already exists" }, { status: 409 })

    logAudit({ action: "create", entityType: "task_relation", entityId: relation.id, userId: session.user.id, request: req, metadata: { sourceTaskId: (await params).taskId, targetTaskId, type } })

    return NextResponse.json({ relation }, { status: 201 })
  } catch (error) {
    console.error("Error creating relation:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

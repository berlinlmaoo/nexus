import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const session = await auth()
    const userId = session?.user?.id || null

    const { formId } = await params
    const { data } = await request.json()

    if (!data) {
      return NextResponse.json({ error: "data is required" }, { status: 400 })
    }

    const form = await prisma.form.findUnique({
      where: { id: formId },
      include: { project: { include: { taskLists: { take: 1, orderBy: { position: "asc" } } } } },
    })

    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    if (!form.isPublic && !userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // For public forms without auth, we still need a creatorId for the task
    // Require auth for now since creatorId is mandatory
    if (!userId) {
      return NextResponse.json({ error: "Authentication required to submit forms" }, { status: 401 })
    }

    const taskList = form.project.taskLists[0]
    if (!taskList) {
      return NextResponse.json({ error: "Project has no task list to create task in" }, { status: 400 })
    }

    // Create submission + auto-create task in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: `Form submission: ${form.name}`,
          description: `Submitted via form "${form.name}"`,
          taskListId: taskList.id,
          creatorId: userId,
        },
      })

      const submission = await tx.formSubmission.create({
        data: {
          data,
          formId,
          taskId: task.id,
          submitterId: userId,
        },
      })

      return { submission, task }
    })

    logAudit({ action: "create", entityType: "formSubmission", entityId: result.submission.id, entityName: form.name, userId, request, metadata: { formId, taskId: result.task.id } })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("Error submitting form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

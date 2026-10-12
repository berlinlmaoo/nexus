export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"

/**
 * The form builder's Responses tab (12 Oct 2026): each response is the task it created, so this lists
 * the submissions newest first with that task's title, status and section and who sent it. Project
 * members only, like GET /api/forms/:id. The answers stay on the task (its description and fields).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { formId } = await params
    const form = await prisma.form.findUnique({ where: { id: formId }, select: { id: true, projectId: true } })
    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, form.projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const [total, rows] = await Promise.all([
      prisma.formSubmission.count({ where: { formId } }),
      prisma.formSubmission.findMany({
        where: { formId },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          createdAt: true,
          submitterId: true,
          task: { select: { id: true, title: true, status: true, taskList: { select: { name: true } } } },
        },
      }),
    ])

    const submitterIds = Array.from(new Set(rows.map((r) => r.submitterId).filter((x): x is string => !!x)))
    const people = submitterIds.length
      ? await prisma.user.findMany({ where: { id: { in: submitterIds } }, select: { id: true, name: true, email: true, avatar: true } })
      : []
    const byId = new Map(people.map((p) => [p.id, p]))

    return NextResponse.json({
      total,
      projectId: form.projectId,
      responses: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        submitter: r.submitterId ? (byId.get(r.submitterId) ?? { id: r.submitterId, name: null, email: null, avatar: null }) : null,
        task: r.task ? { id: r.task.id, title: r.task.title, status: r.task.status, section: r.task.taskList?.name ?? null } : null,
      })),
    })
  } catch (error) {
    console.error("Error listing form responses:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

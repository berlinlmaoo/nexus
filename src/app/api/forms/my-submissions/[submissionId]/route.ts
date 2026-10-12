export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { amountOf, categoryFields, columnOf, dateOf, legacyProcStatus, needsAction, submissionKind } from "@/lib/my-submissions"

type FormField = { id: string; name?: string; type?: string }

// Detail of ONE of your own submissions (read-only): the answers, where it stands (column of the target
// project's board), amount / category / date / handler, Bukti Pencairan, the status history and the
// comments (the submitter may reply: POST ./comments). Old fields kept for released apps.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id

    const { submissionId } = await params
    const sub = await prisma.formSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        createdAt: true,
        data: true,
        submitterId: true,
        form: { select: { id: true, name: true, fields: true, project: { select: { id: true, name: true, folder: { select: { name: true } } } } } },
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            taskList: { select: { name: true, color: true, taskStatus: true } },
            assignees: { select: { user: { select: { id: true, name: true, avatar: true } } } },
            customFieldValues: { select: { value: true, customField: { select: { id: true, name: true, type: true, options: true } } } },
            attachments: { where: { kind: "PROOF" }, orderBy: { createdAt: "desc" }, select: { id: true, filename: true, url: true, mimeType: true, size: true } },
            comments: { orderBy: { createdAt: "asc" }, select: { id: true, content: true, createdAt: true, parentId: true, userId: true, user: { select: { id: true, name: true, avatar: true } } } },
            activityLogs: { where: { action: "changed status" }, orderBy: { createdAt: "asc" }, select: { id: true, details: true, createdAt: true, user: { select: { name: true } } } },
          },
        },
      },
    })

    // Own submissions only (this is "My Submissions").
    if (!sub || sub.submitterId !== me) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 })
    }

    const fields = (Array.isArray(sub.form?.fields) ? (sub.form?.fields as FormField[]) : []).filter((f) => f && f.id)
    const data = (sub.data ?? {}) as Record<string, unknown>
    const answers = fields
      .filter((f) => (f.type ?? "text") !== "section" && (f.type ?? "text") !== "heading")
      .map((f) => ({
        id: f.id,
        label: f.name || f.id,
        type: f.type ?? "text",
        value: data[f.id] ?? (f.name ? data[f.name] : undefined) ?? null,
      }))

    const task = sub.task
    const values = (task?.customFieldValues ?? []).map((v) => ({ value: v.value, customField: { ...v.customField, type: String(v.customField.type) } }))
    const section = task?.taskList ? { name: task.taskList.name, color: task.taskList.color, taskStatus: task.taskList.taskStatus ? String(task.taskList.taskStatus) : null } : null
    const column = columnOf(section)
    const projectId = sub.form?.project?.id ?? null
    const catField = projectId ? (await categoryFields([projectId])).get(projectId) : undefined
    const history = (task?.activityLogs ?? []).map((l) => {
      const m = /from (\w+) to (\w+)/.exec(l.details ?? "")
      return { id: l.id, at: l.createdAt.toISOString(), by: l.user?.name ?? null, from: m?.[1] ?? null, to: m?.[2] ?? null }
    })

    return NextResponse.json({
      id: sub.id,
      createdAt: sub.createdAt.toISOString(),
      formName: sub.form?.name ?? null,
      projectName: sub.form?.project?.name ?? null,
      taskId: task?.id ?? null,
      taskTitle: task?.title ?? null,
      status: task?.status ?? null,
      stage: task?.taskList?.name ?? null,
      procStatus: legacyProcStatus(values.find((v) => v.customField.type === "STATUS")?.value, column),
      proofs: (task?.attachments ?? []).map((a) => ({ id: a.id, name: a.filename, url: a.url, mimeType: a.mimeType, size: a.size })), // Bukti Pencairan from the finance team
      answers,
      column,
      kind: submissionKind(sub.form?.project?.name, sub.form?.project?.folder?.name),
      amount: amountOf(values, data, fields),
      category: catField ? values.find((v) => v.customField.id === catField)?.value?.trim() || null : null,
      date: dateOf(values, task?.dueDate ?? null),
      handlers: (task?.assignees ?? []).map((a) => ({ id: a.user.id, name: a.user.name, avatar: a.user.avatar })),
      needsAction: task ? needsAction(section, task.comments, me) : false,
      history,
      comments: (task?.comments ?? []).map((c) => ({ id: c.id, content: c.content, createdAt: c.createdAt.toISOString(), parentId: c.parentId, mine: c.userId === me, user: { id: c.user.id, name: c.user.name, avatar: c.user.avatar } })),
    })
  } catch (error) {
    console.error("submission detail error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Delete your own submission AND the task it created in the project (the user explicitly wants the
// project task gone too). Best-effort task delete so the submission always clears.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { submissionId } = await params
    const sub = await prisma.formSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, submitterId: true, taskId: true, formId: true, form: { select: { name: true, projectId: true, project: { select: { workspaceId: true } } } } },
    })
    if (!sub || sub.submitterId !== session.user.id) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 })
    }

    // The linked project task goes with it (its subtasks, comments, files…), then the submission row —
    // one transaction, after keeping both in one copy, so Control Room → Audit can bring the
    // submission back with its task (owner, 8 Oct 2026: this used to delete the task with no copy).
    const taskId = sub.taskId
    const projectId = sub.form?.projectId ?? null
    await restorableDelete({
      entityType: "form_submission", entityId: sub.id,
      entityName: `Pengajuan ${sub.form?.name ?? ""}`.trim(),
      workspaceId: sub.form?.project?.workspaceId ?? null, userId: session.user.id, request,
      metadata: { taskId, formId: sub.formId, projectId },
      extraRoots: taskId ? [{ table: "Task", ids: [taskId] }] : undefined,
      meta: {
        open: taskId ? { type: "task", id: taskId, ...(projectId ? { projectId } : {}) } : projectId ? { type: "form", id: sub.formId, projectId } : null,
        projectId, taskId,
      },
      remove: async (tx) => {
        if (taskId) await tx.task.deleteMany({ where: { id: taskId } })
        await tx.formSubmission.delete({ where: { id: sub.id } })
      },
    })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("delete submission error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

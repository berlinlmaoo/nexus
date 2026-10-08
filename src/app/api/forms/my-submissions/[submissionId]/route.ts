export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { restorableDelete } from "@/lib/deletion-snapshot"

type FormField = { id: string; name?: string; type?: string }

// Detail of ONE of your own submissions: the answers you filled in + the linked task's current
// status/stage. Powers the click-through detail in "Pengajuan Saya".
export async function GET(_request: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { submissionId } = await params
    const sub = await prisma.formSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        createdAt: true,
        data: true,
        submitterId: true,
        form: { select: { id: true, name: true, fields: true, project: { select: { id: true, name: true } } } },
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            taskList: { select: { name: true } },
            customFieldValues: { where: { customField: { type: "STATUS" } }, select: { value: true }, take: 1 },
            attachments: { where: { kind: "PROOF" }, orderBy: { createdAt: "desc" }, select: { id: true, filename: true, url: true, mimeType: true, size: true } },
          },
        },
      },
    })

    // Own submissions only (this is "Pengajuan SAYA").
    if (!sub || sub.submitterId !== session.user.id) {
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

    return NextResponse.json({
      id: sub.id,
      createdAt: sub.createdAt.toISOString(),
      formName: sub.form?.name ?? null,
      projectName: sub.form?.project?.name ?? null,
      taskId: sub.task?.id ?? null,
      taskTitle: sub.task?.title ?? null,
      status: sub.task?.status ?? null,
      stage: sub.task?.taskList?.name ?? null,
      procStatus: sub.task?.customFieldValues?.[0]?.value ?? null,
      proofs: (sub.task?.attachments ?? []).map((a) => ({ id: a.id, name: a.filename, url: a.url, mimeType: a.mimeType, size: a.size })), // Bukti Pencairan from the finance team
      answers,
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

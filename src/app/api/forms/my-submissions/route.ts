export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import {
  amountOf, boardColumns, categoryFields, columnOf, dateOf, legacyProcStatus, needsAction, submissionKind,
} from "@/lib/my-submissions"

// Submissions made BY the logged-in user (any form), each on the board of its target project's status
// options (lib/my-submissions.ts). Powers "My Submissions" on the web and "Pengajuan Saya" in the apps.
//
// Shape: { submissions, statusColumns, columns }
//   submissions[]: the old fields (id, createdAt, formId, formName, projectId, projectName, taskId,
//     taskTitle, status, stage, procStatus, proofs) plus column, kind, amount, category, date, handlers,
//     needsAction, commentCount (12 Oct 2026)
//   statusColumns: the old apps' columns (names), after their own "New"
//   columns: the web board's columns, grouped To-do / In progress / Complete
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const me = session.user.id

    const submissions = await prisma.formSubmission.findMany({
      where: { submitterId: me },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        data: true,
        form: { select: { id: true, name: true, fields: true, project: { select: { id: true, name: true, folder: { select: { name: true } } } } } },
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            taskList: { select: { id: true, name: true, color: true, taskStatus: true } },
            assignees: { select: { user: { select: { id: true, name: true, avatar: true } } } },
            customFieldValues: { select: { value: true, customField: { select: { id: true, name: true, type: true, options: true } } } },
            comments: { select: { userId: true, createdAt: true } },
            // "Bukti Pencairan" the finance team attaches on completion — surfaced to the submitter here.
            attachments: {
              where: { kind: "PROOF" },
              orderBy: { createdAt: "desc" },
              select: { id: true, filename: true, url: true, mimeType: true, size: true },
            },
          },
        },
      },
    })

    const projectIds = Array.from(new Set(submissions.map((s) => s.form?.project?.id).filter((x): x is string => !!x)))
    const [columns, catFields] = await Promise.all([boardColumns(projectIds), categoryFields(projectIds)])

    const rows = submissions.map((s) => {
      const task = s.task
      const values = (task?.customFieldValues ?? []).map((v) => ({ value: v.value, customField: { ...v.customField, type: String(v.customField.type) } }))
      const customStatus = values.find((v) => v.customField.type === "STATUS")?.value ?? null
      const section = task?.taskList ? { name: task.taskList.name, color: task.taskList.color, taskStatus: task.taskList.taskStatus ? String(task.taskList.taskStatus) : null } : null
      const column = columnOf(section)
      const projectId = s.form?.project?.id ?? null
      const catField = projectId ? catFields.get(projectId) : undefined
      const category = catField ? values.find((v) => v.customField.id === catField)?.value?.trim() || null : null
      const fields = Array.isArray(s.form?.fields) ? (s.form?.fields as Array<{ id: string; name?: string; type?: string }>) : []
      return {
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        formId: s.form?.id ?? null,
        formName: s.form?.name ?? null,
        projectId,
        projectName: s.form?.project?.name ?? null,
        taskId: task?.id ?? null,
        taskTitle: task?.title ?? null,
        status: task?.status ?? null, // task enum (TODO/DONE/…)
        stage: task?.taskList?.name ?? null, // board column (taskList)
        procStatus: legacyProcStatus(customStatus, column, task?.status ? String(task.status) : null), // released apps' column; null = "New"
        proofs: (task?.attachments ?? []).map((a) => ({ id: a.id, name: a.filename, url: a.url, mimeType: a.mimeType, size: a.size })), // Bukti Pencairan
        column,
        kind: submissionKind(s.form?.project?.name, s.form?.project?.folder?.name),
        amount: amountOf(values, s.data as Record<string, unknown> | null, fields),
        category,
        date: dateOf(values, task?.dueDate ?? null),
        handlers: (task?.assignees ?? []).map((a) => ({ id: a.user.id, name: a.user.name, avatar: a.user.avatar })),
        needsAction: task ? needsAction(section, task.comments, me) : false,
        commentCount: task?.comments.length ?? 0,
      }
    })

    // The released apps' columns: the custom STATUS options where a project still has them, then the
    // board's columns past To-do (they put "New" first themselves).
    const legacy = new Set<string>()
    if (projectIds.length) {
      const statusFields = await prisma.customField.findMany({ where: { projectId: { in: projectIds }, type: "STATUS" }, select: { options: true } })
      for (const f of statusFields) {
        const o = (f.options as { options?: string[] } | null)?.options
        if (Array.isArray(o)) o.forEach((x) => legacy.add(x))
      }
    }
    for (const c of columns) if (c.group !== "todo" && ![...legacy].some((x) => x.toLowerCase() === c.name.toLowerCase())) legacy.add(c.name)

    return NextResponse.json({ submissions: rows, statusColumns: Array.from(legacy), columns })
  } catch (error) {
    console.error("my-submissions error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

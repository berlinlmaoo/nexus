export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

// Submissions made BY the logged-in user (any form), each with its linked task's current
// processing status (the project's "Status" custom field, updated by the finance team) +
// stage. Powers the read-only board in "Pengajuan Saya".
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const submissions = await prisma.formSubmission.findMany({
      where: { submitterId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        form: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            taskList: { select: { id: true, name: true } },
            customFieldValues: {
              where: { customField: { type: "STATUS" } },
              select: { value: true },
              take: 1,
            },
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

    // Columns = the STATUS custom-field options across the projects involved (e.g. On Progress, Done).
    const projectIds = Array.from(new Set(submissions.map((s) => s.form?.project?.id).filter((x): x is string => !!x)))
    const optionSet = new Set<string>()
    if (projectIds.length) {
      const statusFields = await prisma.customField.findMany({
        where: { projectId: { in: projectIds }, type: "STATUS" },
        select: { options: true },
      })
      for (const f of statusFields) {
        const o = (f.options as { options?: string[] } | null)?.options
        if (Array.isArray(o)) o.forEach((x) => optionSet.add(x))
      }
    }
    const statusColumns = Array.from(optionSet)

    const rows = submissions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      formId: s.form?.id ?? null,
      formName: s.form?.name ?? null,
      projectId: s.form?.project?.id ?? null,
      projectName: s.form?.project?.name ?? null,
      taskId: s.task?.id ?? null,
      taskTitle: s.task?.title ?? null,
      status: s.task?.status ?? null, // task enum (TODO/DONE/…)
      stage: s.task?.taskList?.name ?? null, // board column (taskList)
      procStatus: s.task?.customFieldValues?.[0]?.value ?? null, // "Status" custom field — null = belum diproses
      proofs: (s.task?.attachments ?? []).map((a) => ({ id: a.id, name: a.filename, url: a.url, mimeType: a.mimeType, size: a.size })), // Bukti Pencairan
    }))

    return NextResponse.json({ submissions: rows, statusColumns })
  } catch (error) {
    console.error("my-submissions error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

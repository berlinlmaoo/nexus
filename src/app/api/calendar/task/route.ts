export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { buildCalendarItems, calendarCaller, calendarJson, loadStructure, loadTaskRowById } from "@/lib/calendar/server"
import prisma from "@/lib/prisma"

/**
 * GET /api/calendar/task?id=<taskId> — how the Calendar may open one task it has not loaded (a shared
 * link, a task outside the month on screen): `masked` (a private project the caller is not in — do not
 * open), `canEdit` + `editProjectId` (the full panel; else a read-only preview). Same rules as /items.
 * A task that is not in the company workspace, is cancelled, or has no PIC (not on the calendar, owner
 * 12 Oct 2026) answers found:false.
 */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") ?? ""
    if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ error: "id tidak valid.", code: "BAD_ID" }, { status: 400 })
    const caller = await calendarCaller()
    if (caller instanceof NextResponse) return caller
    if (caller.kind !== "ok") return calendarJson(req, { v: 1, access: caller.kind, found: false, masked: false, canEdit: false, editProjectId: null, projectId: null })
    const [row, s] = await Promise.all([loadTaskRowById(id), loadStructure()])
    const item = row ? (await buildCalendarItems([row], caller, s))[0] ?? null : null
    if (!item) return calendarJson(req, { v: 1, access: caller.access, found: false, masked: false, canEdit: false, editProjectId: null, projectId: null })
    // `?detail=1`: the task itself, READ-ONLY, for someone who sees it on the calendar but is not in its
    // project (owner decision 13 Oct 2026: the Master Calendar shows every project's tasks to everyone; a
    // non-member opens them read-only here, while /api/tasks/:id and every other task route stay
    // members-only). Never for a masked (private-project) task. Comments and attachments: names / text only,
    // no file URLs.
    const wantDetail = req.nextUrl.searchParams.get("detail") === "1"
    const detail = wantDetail && !item.masked
      ? await prisma.task.findUnique({
          where: { id },
          select: {
            id: true, title: true, status: true, priority: true, dueDate: true, startDate: true, description: true,
            parent: { select: { id: true, title: true } },
            taskList: { select: { name: true, project: { select: { id: true, name: true, color: true } } } },
            taskProjects: { select: { project: { select: { id: true, name: true } } } },
            assignees: { select: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
            subtasks: { select: { id: true, title: true, status: true }, orderBy: { createdAt: "asc" } },
            comments: { select: { id: true, content: true, createdAt: true, user: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: "asc" }, take: 100 },
            attachments: { select: { id: true, filename: true, size: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 100 },
          },
        }).catch(() => null)
      : null
    return calendarJson(req, {
      v: 1, access: caller.access, found: true,
      masked: item.masked, canEdit: item.canEdit, editProjectId: item.editProjectId,
      projectId: item.project?.id ?? null,
      ...(detail ? { task: detail } : {}),
    })
  } catch (error) {
    console.error("[calendar/task] GET", error)
    return NextResponse.json({ error: "Tugas tidak bisa dimuat." }, { status: 500 })
  }
}

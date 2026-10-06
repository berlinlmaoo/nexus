export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { buildCalendarItems, calendarCaller, calendarJson, loadStructure, loadTaskRowById } from "@/lib/calendar/server"

/**
 * GET /api/calendar/task?id=<taskId> — how the Calendar may open one task it has not loaded (a shared
 * link, a task outside the month on screen): `masked` (a private project the caller is not in — do not
 * open), `canEdit` + `editProjectId` (the full panel; else a read-only preview). Same rules as /items.
 * A task that is not in the company workspace, or is cancelled, answers found:false.
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
    return calendarJson(req, {
      v: 1, access: caller.access, found: true,
      masked: item.masked, canEdit: item.canEdit, editProjectId: item.editProjectId,
      projectId: item.project?.id ?? null,
    })
  } catch (error) {
    console.error("[calendar/task] GET", error)
    return NextResponse.json({ error: "Tugas tidak bisa dimuat." }, { status: 500 })
  }
}

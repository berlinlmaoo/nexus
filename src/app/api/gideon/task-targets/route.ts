export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { editableTaskProjects, taskTargetOptions } from "@/lib/gideon-task-target"

/**
 * GET /api/gideon/task-targets — the create_task card's picker data (owner, 18 Oct 2026), for the signed-in person.
 *   no projectId  → { projects }: the projects they can add a task to (Can edit+, ACTIVE, task projects). The same
 *                   list also comes with the proposal (taskTarget.projects); this one is live.
 *   ?projectId=X  → { sections, members }: that project's columns and its members (the PIC choices). 403 when they
 *                   cannot add a task there.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const projectId = req.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ projects: await editableTaskProjects(session.user.id) })
  const options = await taskTargetOptions(session.user.id, projectId)
  if (!options) return NextResponse.json({ error: "You can't add tasks to that project", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })
  return NextResponse.json(options)
}

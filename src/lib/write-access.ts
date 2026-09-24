import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import type { ProjectRole } from "@/generated/prisma/client"
import { canReadProjectContent, canReadTask, isWorkspaceMemberOrAdmin, taskReadRefusal } from "@/lib/read-access"

/**
 * Write access for routes that used to check only "is someone signed in" (writes batch, after the
 * read batch of lib/read-access.ts).
 *
 * The rule for each one is the rule of the route people already go through to reach the thing —
 * its read route, or the sibling route that writes the same kind of thing — so that nobody who can
 * do it in the app today is refused after this change. What closes is doing it from another
 * workspace (any account, including a self-signup's personal workspace, could edit or delete any
 * doc, sprint, goal, page, … by id).
 *
 * Each helper answers `null` when the caller may go ahead, otherwise the response to return.
 */

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 })

/**
 * Work inside a project (sprints, status updates, project pages): exactly checkProjectAccess, the
 * check of the project page these live on and of the sibling project writes (sections, sheets,
 * tasks). With the default MEMBER bar: system admin, One Above All / BoD / Manager of the project's
 * workspace, and a staff member who is a member of the project. 404 for an unknown project.
 */
export async function projectWriteRefusal(
  userId: string,
  projectId: string,
  roles: ProjectRole[] = ["MEMBER"],
): Promise<NextResponse | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  return (await checkProjectAccess(userId, projectId, roles)).allowed ? null : forbidden()
}

/**
 * A doc: the rule of GET /api/docs/{id} (canReadProjectContent) — search lists every doc of the
 * searcher's workspaces and the doc page lets whoever opens it edit, duplicate or delete it, so the
 * bar is the doc's workspace (or membership of its project), not checkProjectAccess.
 */
export async function docWriteRefusal(userId: string, projectId: string): Promise<NextResponse | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  return (await canReadProjectContent(userId, projectId)) ? null : forbidden()
}

/**
 * Things hung off a task that the task panel lets whoever has it open change (dependencies,
 * relations, follow, like, proof annotations): the rule of GET /api/tasks/{id} (canReadTask).
 */
export async function taskWriteRefusal(userId: string, taskId: string): Promise<NextResponse | null> {
  const verdict = await canReadTask(userId, taskId)
  return verdict === "ok" ? null : taskReadRefusal(verdict)
}

/** Workspace-owned items (goal, portfolio): the rule of their detail GET — workspace member or system admin. */
export async function workspaceItemWriteRefusal(userId: string, workspaceId: string): Promise<NextResponse | null> {
  return (await isWorkspaceMemberOrAdmin(userId, workspaceId)) ? null : forbidden()
}

/**
 * Projects a caller links into a goal or portfolio of `workspaceId`: each must be a project of that
 * same workspace (what the pickers offer) or, failing that, one the caller can open
 * (checkProjectAccess VIEWER — a system admin linking across workspaces). Returns the first one
 * refused, or null.
 */
export async function firstUnlinkableProject(userId: string, projectIds: string[], workspaceId: string): Promise<string | null> {
  for (const projectId of Array.from(new Set(projectIds))) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
    if (!project) return projectId
    if (project.workspaceId === workspaceId) continue
    if (!(await checkProjectAccess(userId, projectId, ["VIEWER"])).allowed) return projectId
  }
  return null
}

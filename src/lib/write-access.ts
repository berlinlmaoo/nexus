import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { checkProjectAccess, hasProjectLevel, type AccessLevel } from "@/lib/rbac"
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
 * A doc / page of a project: Can edit or more (Notion levels, owner 13 Oct 2026). It used to be the READ rule
 * (canReadProjectContent), so a Can view member — or anyone in the workspace — could edit, create and delete
 * pages (QA round 2, N-01).
 */
export async function docWriteRefusal(userId: string, projectId: string): Promise<NextResponse | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
  return (await hasProjectLevel(userId, projectId, "EDIT")) ? null : needsEdit()
}

/**
 * Changing a task's content-like links (dependencies, relations, putting it in a sprint): Can edit in the
 * task's project or in a project it is linked into. Follow / like stay on taskWriteRefusal (anyone who can
 * open the task); proof annotations on taskCommentRefusal (Can comment).
 */
export async function taskEditRefusal(userId: string, taskId: string): Promise<NextResponse | null> {
  return taskLevelRefusal(userId, taskId, "EDIT")
}
export async function taskCommentRefusal(userId: string, taskId: string): Promise<NextResponse | null> {
  return taskLevelRefusal(userId, taskId, "COMMENT")
}
async function taskLevelRefusal(userId: string, taskId: string, min: AccessLevel): Promise<NextResponse | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { taskList: { select: { projectId: true } }, taskProjects: { select: { projectId: true } } },
  })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })
  const projects = [...new Set([task.taskList?.projectId, ...task.taskProjects.map((p) => p.projectId)].filter((x): x is string => !!x))]
  for (const id of projects) if (await hasProjectLevel(userId, id, min)) return null
  return min === "EDIT" ? needsEdit() : NextResponse.json({ error: "Forbidden: you need Can comment access in this project", code: "NEEDS_COMMENT_ACCESS" }, { status: 403 })
}

const needsEdit = () => NextResponse.json({ error: "Forbidden: you need Can edit access in this project", code: "NEEDS_EDIT_ACCESS" }, { status: 403 })

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

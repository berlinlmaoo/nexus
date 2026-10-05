import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { isSystemAdminUser } from "@/lib/rbac"

/**
 * Read access for single items that used to check only "is someone signed in" (API.md §4 E5).
 *
 * These rules are deliberately the UNION of every path through which a person can already reach the
 * item in the app today, so that nobody who can open it now is refused after this change:
 *  - the Calendar (GET /api/calendar/items) shows every task of the company workspace to every
 *    member (owner, 5 Oct 2026), and opening one from there is a read-only preview for non-members —
 *    except private (Finance/Legal) projects, whose rows carry no id. Search, on the other hand, finds
 *    only tasks of projects the searcher is in, plus their own (since 5 Oct 2026);
 *  - the dashboard lists tasks assigned to the user whatever the project;
 *  - the project board shows tasks linked in from other projects (TaskProject);
 *  - the docs list shows docs of projects the user is a ProjectMember of;
 *  - checkProjectAccess (board, comments, attachments) lets system admins, BoD / One Above All /
 *    Manager of the workspace, and project members through.
 * What it closes is reading across workspaces — anyone with an account (a self-signup gets a
 * personal workspace) could read any task, doc, sprint or dependency by id.
 */

export type ReadVerdict = "ok" | "not_found" | "forbidden"

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

async function isMemberOfAnyWorkspace(userId: string, workspaceIds: string[]): Promise<boolean> {
  if (workspaceIds.length === 0) return false
  const n = await prisma.workspaceMember.count({ where: { userId, workspaceId: { in: workspaceIds } } })
  return n > 0
}

async function isMemberOfAnyProject(userId: string, projectIds: string[]): Promise<boolean> {
  if (projectIds.length === 0) return false
  const n = await prisma.projectMember.count({ where: { userId, projectId: { in: projectIds } } })
  return n > 0
}

/**
 * Who may open a task (and what hangs off it: dependencies, relations, followers, likes, proof
 * annotations): its creator, an assignee, the person whose form submission created it, a system
 * admin, a member of the workspace of its home project or of any project it is linked into, or a
 * ProjectMember of any of those projects.
 */
export async function canReadTask(userId: string, taskId: string): Promise<ReadVerdict> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      creatorId: true,
      taskList: { select: { projectId: true, project: { select: { workspaceId: true } } } },
      taskProjects: { select: { projectId: true, project: { select: { workspaceId: true } } } },
      assignees: { where: { userId }, select: { userId: true } },
    },
  })
  if (!task) return "not_found"
  if (task.creatorId === userId || task.assignees.length > 0) return "ok"

  const projectIds = unique([task.taskList.projectId, ...task.taskProjects.map((link) => link.projectId)])
  const workspaceIds = unique([
    task.taskList.project.workspaceId,
    ...task.taskProjects.map((link) => link.project.workspaceId),
  ])
  if (await isMemberOfAnyWorkspace(userId, workspaceIds)) return "ok"
  if (await isSystemAdminUser(userId)) return "ok"
  if (await isMemberOfAnyProject(userId, projectIds)) return "ok"
  const submitted = await prisma.formSubmission.count({ where: { taskId, submitterId: userId } })
  return submitted > 0 ? "ok" : "forbidden"
}

/** The response for a task that is not "ok" — 404 for an unknown id (same text as GET /api/tasks/{id}), 403 otherwise. */
export function taskReadRefusal(verdict: Exclude<ReadVerdict, "ok">) {
  return verdict === "not_found"
    ? NextResponse.json({ error: "Task not found" }, { status: 404 })
    : NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

/**
 * Who may open something that belongs to a project and is reachable from search (a doc): a system
 * admin, a member of the project's workspace, or a ProjectMember of the project.
 */
export async function canReadProjectContent(userId: string, projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
  if (project && (await isMemberOfAnyWorkspace(userId, [project.workspaceId]))) return true
  if (await isSystemAdminUser(userId)) return true
  return isMemberOfAnyProject(userId, [projectId])
}

/** Workspace-owned items (a goal, a portfolio): the lists show them to members of the workspace; admins too. */
export async function isWorkspaceMemberOrAdmin(userId: string, workspaceId: string): Promise<boolean> {
  if (await isMemberOfAnyWorkspace(userId, [workspaceId])) return true
  return isSystemAdminUser(userId)
}

/** The ids of the workspaces a user belongs to (the activity feed without a project/task filter). */
export async function workspaceIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })
  return rows.map((row) => row.workspaceId)
}

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hasProjectLevel } from "@/lib/rbac"

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
 *  - checkProjectAccess (board, comments, attachments) lets BoD / One Above All of the workspace and
 *    project members through.
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
  // Project access by membership (owner 13 Oct 2026): any access level in the task's project or a project it
  // is linked into (BoD / One Above All have every project). Being in the same WORKSPACE no
  // longer opens a task (QA R2 Manager N1). The calendar's own previews (/api/calendar/*) are a separate,
  // pending owner decision and don't go through here.
  for (const id of projectIds) if (await hasProjectLevel(userId, id, "VIEW")) return "ok"
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
 * Who may open something that belongs to a project (a doc): anyone with an access level in the project.
 */
export async function canReadProjectContent(userId: string, projectId: string): Promise<boolean> {
  // Any access level in the project (membership-only access, owner 13 Oct 2026); was any workspace member.
  return hasProjectLevel(userId, projectId, "VIEW")
}

/** Workspace-owned items (a goal, a portfolio): the lists show them to members of the workspace. */
export async function isWorkspaceMemberOf(userId: string, workspaceId: string): Promise<boolean> {
  return isMemberOfAnyWorkspace(userId, [workspaceId])
}

/** The ids of the workspaces a user belongs to (the activity feed without a project/task filter). */
export async function workspaceIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })
  return rows.map((row) => row.workspaceId)
}

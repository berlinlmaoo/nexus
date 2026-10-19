import prisma from "@/lib/prisma"
import { hasProjectWideAccess, memberAccessLevel, projectAccessLevel } from "@/lib/rbac"

/**
 * Where GIDEON may put a new task when the person did not name a project (owner, 18 Oct 2026): the create_task card
 * gets a project picker instead of GIDEON asking "which project?" in the chat. The picker lists ONLY projects the
 * person can edit (Can edit or Full), that are open (ACTIVE) and that hold tasks (type TASK — Pipeline, Outlet Sales
 * and Social Media Report boards are dashboards, not task lists). Apply checks the chosen one again
 * (taskTargetEditable), so a list that went stale never grants anything.
 */
export type TaskTargetProject = { id: string; name: string; icon: string | null; color: string | null }
export type TaskTargetSection = { id: string; name: string; taskStatus: string | null; color: string | null }
export type TaskTargetMember = { id: string; name: string; avatar: string | null }

const TASK_TYPE = "TASK"
const EDIT_LEVELS = new Set(["EDIT", "FULL"])
export const TASK_TARGET_MAX = 300

export async function editableTaskProjects(userId: string): Promise<TaskTargetProject[]> {
  const workspaces = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true, role: true } })
  if (!workspaces.length) return []
  const wide = workspaces.filter((w) => hasProjectWideAccess(w.role)).map((w) => w.workspaceId)
  const rest = workspaces.filter((w) => !hasProjectWideAccess(w.role)).map((w) => w.workspaceId)
  const rows = await prisma.project.findMany({
    where: {
      type: TASK_TYPE,
      status: "ACTIVE",
      OR: [
        ...(wide.length ? [{ workspaceId: { in: wide } }] : []),
        ...(rest.length ? [{ workspaceId: { in: rest }, members: { some: { userId, role: { in: ["LEAD", "MEMBER"] as ("LEAD" | "MEMBER")[] } } } }] : []),
      ],
    },
    select: { id: true, name: true, icon: true, color: true, workspaceId: true, members: { where: { userId }, select: { role: true, accessLevel: true }, take: 1 } },
    orderBy: [{ updatedAt: "desc" }],
    take: TASK_TARGET_MAX,
  })
  const wideSet = new Set(wide)
  return rows
    .filter((p) => wideSet.has(p.workspaceId) || EDIT_LEVELS.has(memberAccessLevel(p.members[0]) ?? ""))
    .map((p) => ({ id: p.id, name: p.name, icon: p.icon ?? null, color: p.color ?? null }))
}

/** Can this person put a task in this project right now (Can edit+, ACTIVE, a task project)? */
export async function taskTargetEditable(userId: string, projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { type: true, status: true } })
  if (!project || project.type !== TASK_TYPE || project.status !== "ACTIVE") return false
  const level = await projectAccessLevel(userId, projectId)
  return !!level && EDIT_LEVELS.has(level)
}

/** The card's column and PIC choices for one project: its sections and its members (PIC = project members only). */
export async function taskTargetOptions(userId: string, projectId: string): Promise<{ sections: TaskTargetSection[]; members: TaskTargetMember[] } | null> {
  if (!(await taskTargetEditable(userId, projectId))) return null
  const [sections, members] = await Promise.all([
    prisma.taskList.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, taskStatus: true, color: true } }),
    prisma.projectMember.findMany({
      where: { projectId, user: { deactivatedAt: null } },
      select: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ])
  return {
    sections: sections.map((s) => ({ id: s.id, name: s.name, taskStatus: s.taskStatus ?? null, color: s.color ?? null })),
    members: members.map((m) => ({ id: m.user.id, name: m.user.name ?? "?", avatar: m.user.avatar ?? null })),
  }
}

/**
 * A create_task call with no project id and no section id: the card picks the project (a project NAME the model
 * passed only preselects it there). Pure, so needsApproval can use it.
 */
export function createTaskNeedsProject(input: Record<string, unknown>): boolean {
  const has = (k: string) => typeof input[k] === "string" && (input[k] as string).trim() !== ""
  return !["projectId", "project_id", "taskListId", "task_list_id"].some(has)
}

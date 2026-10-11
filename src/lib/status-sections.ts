/**
 * Sections are the project's status options (owner, 12 Oct 2026, Notion's logic): every section stands
 * for a task status (TaskList.taskStatus), and the statuses fall in three groups — To-do (TODO),
 * In progress (IN_PROGRESS, IN_REVIEW) and Complete (DONE, CANCELLED). A board column IS a status:
 *  - moving a task into a section gives it that section's status (task PATCH / POST, automations);
 *  - giving a task a status moves it to the section of that status (this file), wherever the change comes
 *    from: the web board's checkbox, the task popup, the list, the table, GIDEON, automations, MCP, the
 *    WhatsApp bot and the released iOS / Android apps (they PATCH the enum status as always).
 * A section with no status (projects not yet migrated, see prisma/sql/2026-10-12-views-status-sections.sql)
 * keeps the old behaviour: the task stays where it is.
 */
import type { TaskStatus } from "@/generated/prisma/client"

export const STATUS_GROUPS = {
  todo: ["TODO"],
  in_progress: ["IN_PROGRESS", "IN_REVIEW"],
  complete: ["DONE", "CANCELLED"],
} as const satisfies Record<string, readonly TaskStatus[]>
export type StatusGroup = keyof typeof STATUS_GROUPS

export function statusGroup(status: string | null | undefined): StatusGroup | null {
  if (!status) return null
  for (const [g, list] of Object.entries(STATUS_GROUPS) as [StatusGroup, readonly string[]][]) if (list.includes(status)) return g
  return null
}

type Section = { id: string; taskStatus: string | null; position: number }

/**
 * Pure: the section a task in `currentId` should move to when its status becomes `status`, or null to
 * stay. The first section of exactly that status wins; else, when the task's current section is in
 * another group, the first section of the new status's group. A task already in a section of the same
 * group with no exact match stays (In review in an "In progress" column is fine). Manual order inside a
 * column is the caller's (the task keeps its position number).
 */
export function pickStatusSection(sections: Section[], currentId: string | null | undefined, status: string): string | null {
  const sorted = [...sections].sort((a, b) => a.position - b.position)
  const current = sorted.find((s) => s.id === currentId)
  if (!current?.taskStatus) return null // plain section: old behaviour
  if (current.taskStatus === status) return null
  const exact = sorted.find((s) => s.taskStatus === status)
  if (exact) return exact.id === current.id ? null : exact.id
  const group = statusGroup(status)
  if (!group || statusGroup(current.taskStatus) === group) return null
  const sameGroup = sorted.find((s) => statusGroup(s.taskStatus) === group)
  return sameGroup && sameGroup.id !== current.id ? sameGroup.id : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { taskList: { findMany: (args: any) => Promise<Array<{ id: string; taskStatus: unknown; position: number }>> } }

/** pickStatusSection over the project's sections, read from the database. */
export async function sectionForStatus(db: Db, projectId: string, currentId: string | null | undefined, status: string): Promise<string | null> {
  const sections = await db.taskList.findMany({ where: { projectId }, select: { id: true, taskStatus: true, position: true } })
  return pickStatusSection(sections.map((s) => ({ ...s, taskStatus: s.taskStatus ? String(s.taskStatus) : null })), currentId, status)
}

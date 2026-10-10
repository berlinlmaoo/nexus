import type { NextRequest } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { syncProjectRoomSafe } from "@/lib/chat-membership"
import { ensureProjectSheet } from "@/lib/project-sheets"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { stageGroupOf } from "@/lib/pipeline"

/**
 * Won → execution, by hand (owner, 10 Oct 2026: "soal won itu jangan dibuat otomatis tpi siapin aja tombol
 * untuk 'Create execution project' nanti langsung lo buatin 1 folder di project yg isinya Master Calendar
 * sama Master Task").
 *
 * Nothing happens on its own any more when a deal reaches Won. "Create execution project" on a won deal
 * (POST …/pipeline/:dealId/execution) makes ONE folder named after the deal, inside the client's folder,
 * holding two Task projects named the way the company already names them ("ANKER: Master Calendar",
 * "ANKER: General Task"):
 *   <deal>: Master Calendar   ← the deal's event / main date lands here as a task (syncMainDateTask)
 *   <deal>: Master Task
 * Both have whoever pressed the button (LEAD) and the deal's BD and PM (when they are still in the
 * workspace) as members. Folders have no members of their own — every workspace member sees the folder
 * tree and project membership decides what is inside (api/project-folders) — so nothing else is needed
 * for the members to see it.
 *
 * The deal keeps all three ids: executionFolderId, executionCalendarProjectId, and executionProjectId,
 * which points at the Master Task so a client from before this change still opens something sensible.
 * A deal made by the 9 Oct version (one project, no folder) keeps that project; the button opens it.
 */

/** A deal that has been won (and not lost) may have its execution folder made. */
export function canHaveExecutionProject(stage: string): boolean {
  const g = stageGroupOf(stage)
  return g === "Pre-Execution" || g === "Execution" || g === "Closed"
}

/**
 * Where client projects live in the company's folder tree today: "THE Z CREATIVE › Projects: Ongoing &
 * Onboarding", one subfolder per client (ANKER, JIM BEAM, …). Found by name, not id: no client folder
 * means the deal's folder goes straight under "Projects: Ongoing & Onboarding", and without that one it
 * goes to the root.
 */
const EXECUTION_FOLDER_NAME = "Projects: Ongoing & Onboarding"

/** "JIMBEAM" and "JIM BEAM" are the same client. */
const folderKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

async function executionParentFolderId(tx: Tx, workspaceId: string, brand: string): Promise<string | null> {
  const parent = await tx.projectFolder.findFirst({
    where: { workspaceId, name: { equals: EXECUTION_FOLDER_NAME, mode: "insensitive" } },
    select: { id: true },
  })
  if (!parent) return null
  const key = folderKey(brand)
  if (key) {
    const children = await tx.projectFolder.findMany({ where: { workspaceId, parentFolderId: parent.id }, select: { id: true, name: true } })
    const client = children.find((f) => folderKey(f.name) === key)
    if (client) return client.id
  }
  return parent.id
}

/**
 * Folder names are unique per workspace (ProjectFolder @@unique([workspaceId, name])), and a deal is often
 * named like its client ("ANKER"), so a taken name gets the deal's code: "ANKER (TZN-26001)".
 */
async function freeFolderName(tx: Tx, workspaceId: string, name: string, code: string): Promise<string> {
  const base = name.trim().slice(0, 180) || code
  const candidates = [base, `${base} (${code})`]
  for (let i = 2; i <= 20; i++) candidates.push(`${base} (${code}) ${i}`)
  const taken = new Set(
    (await tx.projectFolder.findMany({
      where: { workspaceId, name: { in: candidates, mode: "insensitive" } },
      select: { name: true },
    })).map((f) => f.name.toLowerCase()),
  )
  return candidates.find((c) => !taken.has(c.toLowerCase())) ?? `${base} (${code}) ${Date.now()}`
}

export type ExecutionResult = {
  /** The Master Task (or the single project of a 9 Oct deal) — what older clients open. */
  projectId: string
  calendarProjectId: string | null
  folderId: string | null
  created: boolean
}

const STANDARD_LISTS = [
  { name: "To Do", position: 0 },
  { name: "In Progress", position: 1 },
  { name: "Done", position: 2 },
]

/**
 * Makes the deal's execution folder and its two projects unless it already has an execution project.
 * Safe to press twice at once: the deal row is locked while it decides. Returns null when the deal is gone.
 */
export async function ensureExecutionProject(
  dealId: string,
  actorId: string,
  opts: { request?: NextRequest } = {},
): Promise<ExecutionResult | null> {
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PipelineDeal" WHERE id = ${dealId} FOR UPDATE`
    const deal = await tx.pipelineDeal.findUnique({
      where: { id: dealId },
      select: {
        code: true, name: true, brand: true, bdUserId: true, pmUserId: true,
        executionProjectId: true, executionCalendarProjectId: true, executionFolderId: true,
        project: { select: { workspaceId: true } },
      },
    })
    if (!deal) return null
    const existing = deal.executionProjectId ?? deal.executionCalendarProjectId
    if (existing) {
      return {
        created: false as const,
        result: { projectId: existing, calendarProjectId: deal.executionCalendarProjectId, folderId: deal.executionFolderId, created: false },
      }
    }

    const workspaceId = deal.project.workspaceId
    // BD and PM join only while they are still in the workspace (the deal keeps a departed person's id).
    const wanted = [...new Set([actorId, deal.bdUserId, deal.pmUserId].filter((id): id is string => !!id))]
    const inWorkspace = new Set(
      (await tx.workspaceMember.findMany({ where: { workspaceId, userId: { in: wanted } }, select: { userId: true } })).map((m) => m.userId),
    )
    const memberIds = wanted.filter((id) => id === actorId || inWorkspace.has(id))

    const parentFolderId = await executionParentFolderId(tx, workspaceId, deal.brand)
    const lastFolder = await tx.projectFolder.findFirst({
      where: { workspaceId, parentFolderId },
      orderBy: { position: "desc" },
      select: { position: true },
    })
    const folder = await tx.projectFolder.create({
      data: {
        name: await freeFolderName(tx, workspaceId, deal.name, deal.code),
        workspaceId,
        parentFolderId,
        position: (lastFolder?.position ?? -1) + 1,
      },
      select: { id: true, name: true, parentFolderId: true },
    })

    const makeProject = (suffix: string, position: number) =>
      tx.project.create({
        data: {
          name: `${deal.name.slice(0, 180)}: ${suffix}`,
          description: `Eksekusi deal ${deal.code} dari Pipeline.`,
          type: "TASK",
          workspaceId,
          folderId: folder.id,
          position,
          members: { create: memberIds.map((userId) => ({ userId, role: userId === actorId ? ("LEAD" as const) : ("MEMBER" as const) })) },
          taskLists: { create: STANDARD_LISTS },
        },
        select: { id: true, name: true },
      })
    const calendar = await makeProject("Master Calendar", 0)
    const tasks = await makeProject("Master Task", 1)

    await tx.pipelineDeal.update({
      where: { id: dealId },
      data: {
        executionFolderId: folder.id,
        executionCalendarProjectId: calendar.id,
        executionProjectId: tasks.id,
        executionCreatedAt: new Date(),
      },
    })
    return { created: true as const, deal, folder, projects: [calendar, tasks], memberIds, workspaceId,
      result: { projectId: tasks.id, calendarProjectId: calendar.id, folderId: folder.id, created: true } }
  })
  if (!outcome) return null

  if (outcome.created) {
    const { folder, projects, memberIds, workspaceId, deal } = outcome
    logAudit({
      action: "create",
      entityType: "project_folder",
      entityId: folder.id,
      entityName: folder.name,
      userId: actorId,
      request: opts.request,
      metadata: { fromPipelineDeal: dealId, code: deal.code, parentFolderId: folder.parentFolderId, workspaceId },
    })
    emitWorkspaceChanged(workspaceId, { kind: "folders", folderId: folder.id, actorId })
    for (const project of projects) {
      logAudit({
        action: "create",
        entityType: "project",
        entityId: project.id,
        entityName: project.name,
        userId: actorId,
        request: opts.request,
        metadata: { fromPipelineDeal: dealId, code: deal.code, folderId: folder.id },
      })
      await syncProjectRoomSafe(project.id, "pipeline-execution")
      emitWorkspaceChanged(workspaceId, { kind: "projects", projectId: project.id, folderId: folder.id, actorId }, memberIds)
      ensureProjectSheet(project.id, actorId).catch((err) => console.error("Failed to pre-create sheet for execution project", project.id, err))
    }
  }
  await syncMainDateTask(dealId, actorId)
  return outcome.result
}

/**
 * Keeps the deal's event / main date on the Master Calendar: one task in the execution folder's Master
 * Calendar project (or, for a 9 Oct deal without one, its single execution project), due on mainDate
 * (00:00 UTC, the calendar's "date without a time"), assigned to the PM and BD. Made when the deal has a
 * date and somewhere to put it; moved when the date changes; left without a due date when the date is
 * cleared (never deleted — people may have commented on it). A task deleted by hand is made again on the
 * next date change.
 */
export async function syncMainDateTask(dealId: string, actorId: string): Promise<void> {
  try {
    const deal = await prisma.pipelineDeal.findUnique({
      where: { id: dealId },
      select: {
        code: true, name: true, mainDate: true, mainDateTaskId: true,
        executionProjectId: true, executionCalendarProjectId: true, bdUserId: true, pmUserId: true,
      },
    })
    const targetProjectId = deal?.executionCalendarProjectId ?? deal?.executionProjectId
    if (!deal || !targetProjectId) return
    const existing = deal.mainDateTaskId
      ? await prisma.task.findFirst({
          where: { id: deal.mainDateTaskId, taskList: { projectId: targetProjectId } },
          select: { id: true, dueDate: true },
        })
      : null

    if (existing) {
      const same = (existing.dueDate?.getTime() ?? null) === (deal.mainDate?.getTime() ?? null)
      if (!same) await prisma.task.update({ where: { id: existing.id }, data: { dueDate: deal.mainDate } })
      return
    }
    if (!deal.mainDate) return

    const list = await prisma.taskList.findFirst({
      where: { projectId: targetProjectId },
      orderBy: { position: "asc" },
      select: { id: true, project: { select: { workspaceId: true } } },
    })
    if (!list) return
    const people = [...new Set([deal.pmUserId, deal.bdUserId].filter((id): id is string => !!id))]
    const assignees = people.length
      ? (await prisma.workspaceMember.findMany({ where: { workspaceId: list.project.workspaceId, userId: { in: people } }, select: { userId: true } })).map((m) => m.userId)
      : []
    const last = await prisma.task.findFirst({ where: { taskListId: list.id }, orderBy: { position: "desc" }, select: { position: true } })
    const task = await prisma.task.create({
      data: {
        title: `Tanggal Event · ${deal.name}`.slice(0, 250),
        description: `Tanggal event / main date deal ${deal.code} di Pipeline. Ubah tanggalnya di Pipeline, task ini ikut pindah.`,
        dueDate: deal.mainDate,
        taskListId: list.id,
        creatorId: actorId,
        position: (last?.position ?? -1) + 1,
        assignees: { create: assignees.map((userId) => ({ userId })) },
      },
      select: { id: true },
    })
    await prisma.pipelineDeal.update({ where: { id: dealId }, data: { mainDateTaskId: task.id } })
  } catch (error) {
    // The deal itself is saved; a calendar entry that failed is made again on the next date change.
    console.error("Pipeline: could not sync the main-date task of deal", dealId, error)
  }
}

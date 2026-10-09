import type { NextRequest } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { syncProjectRoomSafe } from "@/lib/chat-membership"
import { ensureProjectSheet } from "@/lib/project-sheets"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { stageGroupOf } from "@/lib/pipeline"

/**
 * Won → execution (owner/GM, 9 Oct 2026): "after udah won lebih enak kalo kebentuk Master Calendar sama
 * Master Task buat projectnya".
 *
 * When a deal first enters a Won stage, a Task project is made for its execution: named after the deal,
 * in the board's (company) workspace, with the deal's BD and PM (when they are NEXUS users) and whoever
 * moved it as members. The deal keeps its id (executionProjectId) and both clients show "Open execution
 * project". Its event / main date becomes a task in that project, assigned to the PM and BD, so the
 * Master Calendar — which is made of tasks, "there is no event kind" (lib/calendar/core.ts, rule 3) —
 * shows it under their Bagan cards, or under the project's folder when they are not on the Bagan.
 *
 * Once per deal: executionCreatedAt stays set even if the project is deleted later, so moving the deal
 * between stages afterwards does not build another one. "Create execution project" on the deal (any won
 * stage, POST …/pipeline/:dealId/execution) makes one by hand when there is none — the GM's 41 imported
 * deals came in already won and got none on their own.
 */

/** Entering one of these (from any other stage) makes the execution project. */
export const EXECUTION_TRIGGER_STAGES = ["Won – Contract Pending", "Won – In Execution"] as const

/** A deal that has been won (and not lost) may have an execution project made by hand. */
export function canHaveExecutionProject(stage: string): boolean {
  const g = stageGroupOf(stage)
  return g === "Pre-Execution" || g === "Execution" || g === "Closed"
}

/**
 * Where client projects live in the company's folder tree today: "THE Z CREATIVE › Projects: Ongoing &
 * Onboarding", one subfolder per client (ANKER, JIM BEAM, …). Found by name, not id, so a renamed or
 * missing folder only means the project lands at the root.
 */
const EXECUTION_FOLDER_NAME = "Projects: Ongoing & Onboarding"

/** "JIMBEAM" and "JIM BEAM" are the same client. */
const folderKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")

async function executionFolderId(workspaceId: string, brand: string): Promise<string | null> {
  const parent = await prisma.projectFolder.findFirst({
    where: { workspaceId, name: { equals: EXECUTION_FOLDER_NAME, mode: "insensitive" } },
    select: { id: true },
  })
  if (!parent) return null
  const key = folderKey(brand)
  if (key) {
    const children = await prisma.projectFolder.findMany({ where: { workspaceId, parentFolderId: parent.id }, select: { id: true, name: true } })
    const client = children.find((f) => folderKey(f.name) === key)
    if (client) return client.id
  }
  return parent.id
}

export type ExecutionResult = { projectId: string; created: boolean }

/**
 * Makes the deal's execution project unless it has one. `auto` (a stage move) also stops when one was
 * made before and has since been deleted. Safe to call twice at once: the deal row is locked while it
 * decides. Returns null when nothing was made and there is nothing to open.
 */
export async function ensureExecutionProject(
  dealId: string,
  actorId: string,
  opts: { auto: boolean; request?: NextRequest },
): Promise<ExecutionResult | null> {
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PipelineDeal" WHERE id = ${dealId} FOR UPDATE`
    const deal = await tx.pipelineDeal.findUnique({
      where: { id: dealId },
      select: {
        code: true, name: true, brand: true, bdUserId: true, pmUserId: true,
        executionProjectId: true, executionCreatedAt: true,
        project: { select: { workspaceId: true } },
      },
    })
    if (!deal) return null
    if (deal.executionProjectId) return { projectId: deal.executionProjectId, created: false, deal }
    if (opts.auto && deal.executionCreatedAt) return null

    const workspaceId = deal.project.workspaceId
    // BD and PM join only while they are still in the workspace (the deal keeps a departed person's id).
    const wanted = [...new Set([actorId, deal.bdUserId, deal.pmUserId].filter((id): id is string => !!id))]
    const inWorkspace = new Set(
      (await tx.workspaceMember.findMany({ where: { workspaceId, userId: { in: wanted } }, select: { userId: true } })).map((m) => m.userId),
    )
    const memberIds = wanted.filter((id) => id === actorId || inWorkspace.has(id))
    const folderId = await executionFolderId(workspaceId, deal.brand)

    const project = await tx.project.create({
      data: {
        name: deal.name.slice(0, 200),
        description: `Eksekusi deal ${deal.code} dari Pipeline.`,
        type: "TASK",
        workspaceId,
        folderId,
        members: { create: memberIds.map((userId) => ({ userId, role: userId === actorId ? ("LEAD" as const) : ("MEMBER" as const) })) },
        taskLists: {
          create: [
            { name: "To Do", position: 0 },
            { name: "In Progress", position: 1 },
            { name: "Done", position: 2 },
          ],
        },
      },
      select: { id: true, name: true, folderId: true },
    })
    await tx.pipelineDeal.update({
      where: { id: dealId },
      data: { executionProjectId: project.id, executionCreatedAt: new Date() },
    })
    return { projectId: project.id, created: true, deal, project, memberIds, workspaceId }
  })
  if (!outcome) return null

  if (outcome.created && "project" in outcome && outcome.project) {
    const { project, memberIds, workspaceId, deal } = outcome
    logAudit({
      action: "create",
      entityType: "project",
      entityId: project.id,
      entityName: project.name,
      userId: actorId,
      request: opts.request,
      metadata: { fromPipelineDeal: dealId, code: deal.code, auto: opts.auto },
    })
    await syncProjectRoomSafe(project.id, "pipeline-execution")
    emitWorkspaceChanged(workspaceId, { kind: "projects", projectId: project.id, folderId: project.folderId ?? undefined, actorId }, memberIds)
    ensureProjectSheet(project.id, actorId).catch((err) => console.error("Failed to pre-create sheet for execution project", project.id, err))
  }
  await syncMainDateTask(dealId, actorId)
  return { projectId: outcome.projectId, created: outcome.created }
}

/**
 * Keeps the deal's event / main date on the Master Calendar: one task in the execution project, due on
 * mainDate (00:00 UTC, the calendar's "date without a time"), assigned to the PM and BD. Made when the
 * deal has a date and an execution project; moved when the date changes; left without a due date when
 * the date is cleared (never deleted — people may have commented on it). A task deleted by hand is made
 * again on the next date change.
 */
export async function syncMainDateTask(dealId: string, actorId: string): Promise<void> {
  try {
    const deal = await prisma.pipelineDeal.findUnique({
      where: { id: dealId },
      select: { code: true, name: true, mainDate: true, mainDateTaskId: true, executionProjectId: true, bdUserId: true, pmUserId: true },
    })
    if (!deal?.executionProjectId) return
    const existing = deal.mainDateTaskId
      ? await prisma.task.findFirst({
          where: { id: deal.mainDateTaskId, taskList: { projectId: deal.executionProjectId } },
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
      where: { projectId: deal.executionProjectId },
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

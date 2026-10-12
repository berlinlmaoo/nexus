export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { USER_CARD_SELECT } from "@/lib/user-card-select"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { deleteKeepingSnapshot } from "@/lib/deletion-snapshot"
import { checkProjectAccess, isSystemAdminUser } from "@/lib/rbac"
import {
  normalizeAutoAssignConfig,
  ProjectAutoAssignConfigError,
} from "@/lib/project-auto-assign"
import { syncProjectLinkedTeamAccess } from "@/lib/team-sync"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { normalizeHiddenTabs } from "@/lib/project-tabs"

async function canManageProject(userId: string, projectId: string) {
  if (await isSystemAdminUser(userId)) {
    return { allowed: true, reason: "system-admin" as const }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      workspaceId: true,
      members: {
        where: { userId },
        select: { role: true },
      },
    },
  })

  if (!project) {
    return { allowed: false, reason: "Project not found" as const }
  }

  const projectRole = project.members[0]?.role ?? null
  if (projectRole === "LEAD") {
    return { allowed: true, reason: "project-lead" as const }
  }

  const workspaceMembership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId: project.workspaceId,
      },
    },
    select: { role: true },
  })

  const workspaceRole = workspaceMembership?.role ?? null
  if (workspaceRole === "BOD" || workspaceRole === "MANAGER" || workspaceRole === "ONE_ABOVE_ALL") {
    return { allowed: true, reason: "workspace-admin" as const }
  }

  return { allowed: false, reason: "forbidden" as const }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // `?lite=1` (web, perf pass 12 Oct 2026): each task's customFieldValues come WITHOUT the nested
    // `customField {name,type,options}` — the same three fields repeated on every value, about a third of
    // a big project's payload. The project's own `customFields` (below) carries them once. Without the
    // param the payload is exactly as before (released iOS/Android apps read the nested object).
    const lite = request.nextUrl.searchParams.get("lite") === "1"
    const cfvSelect = lite
      ? { customFieldId: true, value: true }
      : { customFieldId: true, value: true, customField: { select: { name: true, type: true, options: true } } }

    await syncProjectLinkedTeamAccess((await params).projectId)

    const project = await prisma.project.findUnique({
      where: { id: (await params).projectId },
      include: {
        taskLists: {
          include: {
            tasks: {
              // Asana-style: subtasks never appear as their own card on Board/List/Calendar —
              // they live inside the parent's panel. The minimal subtasks select feeds the
              // parent card's "☑ done/total" progress chip.
              where: { parentId: null },
              include: {
                assignees: { include: { user: { select: USER_CARD_SELECT } } },
                subtasks: { select: { id: true, status: true } },
                customFieldValues: { select: cfvSelect },
              },
              orderBy: { position: "asc" },
            },
            // Tasks linked into this project from other projects ("Also in projects").
            taskProjects: {
              orderBy: { position: "asc" },
              include: {
                task: {
                  include: {
                    assignees: { include: { user: { select: USER_CARD_SELECT } } },
                    customFieldValues: {
                      select: {
                        customFieldId: true,
                        value: true,
                        customField: { select: { name: true, type: true, options: true } },
                      },
                    },
                    taskList: { select: { id: true, name: true, projectId: true, project: { select: { id: true, name: true } } } },
                  },
                },
              },
            },
          },
          orderBy: { position: "asc" },
        },
        members: {
          include: { user: { select: USER_CARD_SELECT } },
        },
        pages: {
          orderBy: { createdAt: "asc" },
        },
        customFields: {
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Attach task-bundle quest membership to each card (board/list "🏆 +X XP" badge).
    const taskQuests = await prisma.quest.findMany({
      where: { workspaceId: project.workspaceId, isActive: true, requirementType: "specific_tasks" },
      select: { id: true, title: true, xpReward: true, taskIds: true },
    })
    if (taskQuests.length) {
      const byTask = new Map<string, { id: string; title: string; xpReward: number }[]>()
      for (const q of taskQuests) {
        for (const tid of q.taskIds) {
          const arr = byTask.get(tid) ?? []
          arr.push({ id: q.id, title: q.title, xpReward: q.xpReward })
          byTask.set(tid, arr)
        }
      }
      for (const list of project.taskLists ?? []) {
        for (const t of list.tasks ?? []) (t as { quests?: unknown }).quests = byTask.get(t.id) ?? []
        for (const tp of list.taskProjects ?? []) if (tp.task) (tp.task as { quests?: unknown }).quests = byTask.get(tp.task.id) ?? []
      }
    }

    return NextResponse.json(project)
  } catch (error) {
    console.error("Error fetching project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const {
      name,
      description,
      color,
      icon,
      status,
      folderId,
      position,
      autoAssignEnabled,
      autoAssignAssigneeIds,
      tableColumns,
      hiddenTabs,
    } = body
    // enableTaskBatchDuplicate, enablePnlDashboard, financeEnabled, requireAttachmentForDone and
    // disableTaskStatus are retired (owner, 11 Oct 2026 — lib/project-retired-flags.ts). Released apps
    // still send them; they are accepted and ignored, never an error.

    const existing = await prisma.project.findUnique({
      where: { id: (await params).projectId },
      select: {
        id: true,
        workspaceId: true,
        members: {
          select: { userId: true },
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["LEAD"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: LEAD role required to update projects" }, { status: 403 })
    }

    let normalizedAutoAssignConfig:
      | { autoAssignEnabled: boolean; autoAssignAssigneeIds: string[] }
      | undefined

    if (autoAssignEnabled !== undefined || autoAssignAssigneeIds !== undefined) {
      try {
        normalizedAutoAssignConfig = normalizeAutoAssignConfig(
          {
            autoAssignEnabled,
            autoAssignAssigneeIds,
          },
          {
            memberIds: existing.members.map((member) => member.userId),
          }
        )
      } catch (error) {
        if (error instanceof ProjectAutoAssignConfigError) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    }

    if (folderId !== undefined && folderId !== null) {
      const folder = await prisma.projectFolder.findUnique({
        where: { id: folderId },
        select: { workspaceId: true },
      })

      if (!folder || folder.workspaceId !== existing.workspaceId) {
        return NextResponse.json({ error: "Folder must belong to the same workspace as the project" }, { status: 400 })
      }
    }

    // Which tabs the project shows (owner, 9 Oct 2026): a project setting like the others, so LEAD
    // (checked above). Validated here, because a client that hid both Board and List would leave a
    // task project with no way to see its tasks.
    let normalizedHiddenTabs: string[] | undefined
    if (hiddenTabs !== undefined) {
      const tabs = normalizeHiddenTabs(hiddenTabs)
      if (!tabs.ok) {
        return NextResponse.json({ error: tabs.error, code: tabs.code, ...(tabs.tab !== undefined && { tab: tabs.tab }) }, { status: 400 })
      }
      normalizedHiddenTabs = tabs.hiddenTabs
    }

    const project = await prisma.project.update({
      where: { id: (await params).projectId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(icon !== undefined && { icon }),
        ...(status !== undefined && { status }),
        ...(folderId !== undefined && { folderId }),
        ...(Number.isInteger(position) && position >= 0 && { position }),
        ...(normalizedHiddenTabs !== undefined && { hiddenTabs: normalizedHiddenTabs }),
        ...(Array.isArray(tableColumns) && { tableColumns: tableColumns.filter((c: unknown) => typeof c === "string") }),
        ...(normalizedAutoAssignConfig && normalizedAutoAssignConfig),
      },
      include: {
        taskLists: true,
        members: { include: { user: true } },
      },
    })

    logAudit({
      action: "update", entityType: "project", entityId: (await params).projectId, entityName: project.name,
      userId: session.user.id!, request, metadata: { changes: body },
    })

    // Any PATCH (folder, name, colour, icon, status/archive, position, settings) shows up live for everyone
    // with the sidebar, the projects page, a folder page or this project open. Its members' own rooms too:
    // a guest added from outside the workspace is not in the workspace room.
    emitWorkspaceChanged(
      existing.workspaceId,
      { kind: "projects", projectId: project.id, actorId: session.user.id! },
      existing.members.map((m) => m.userId),
    )


    return NextResponse.json(project)
  } catch (error) {
    console.error("Error updating project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.project.findUnique({
      where: { id: (await params).projectId },
      // Only for the realtime ping below: members outside the workspace get it in their own room.
      include: { members: { select: { userId: true } } },
    })

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const { allowed } = await canManageProject(session.user.id!, (await params).projectId)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: project lead or workspace admin required to delete projects" }, { status: 403 })
    }

    const projectId = (await params).projectId
    const auditLogId = await logAudit({
      action: "delete", entityType: "project", entityId: projectId, entityName: existing.name,
      userId: session.user.id!, request,
    })

    // Everything the delete takes with it is kept first, so Control Room → Audit can restore it.
    await deleteKeepingSnapshot({
      entityType: "project", entityId: projectId, entityName: existing.name, workspaceId: existing.workspaceId,
      deletedById: session.user.id!, auditLogId,
      meta: { open: { type: "project", id: projectId }, projectId },
      remove: (tx) => tx.project.delete({ where: { id: projectId } }),
    })

    // Gone from every open sidebar / projects page / folder page, and an open project page refetches into its 404.
    emitWorkspaceChanged(
      existing.workspaceId,
      { kind: "projects", projectId, actorId: session.user.id! },
      existing.members.map((m) => m.userId),
    )

    return NextResponse.json({ message: "Project deleted" })
  } catch (error) {
    console.error("Error deleting project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

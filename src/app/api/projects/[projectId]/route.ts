import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess, isSystemAdminUser } from "@/lib/rbac"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import {
  normalizeAutoAssignConfig,
  ProjectAutoAssignConfigError,
} from "@/lib/project-auto-assign"
import { syncProjectLinkedTeamAccess } from "@/lib/team-sync"

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
  if (workspaceRole === "OWNER" || workspaceRole === "ADMIN") {
    return { allowed: true, reason: "workspace-admin" as const }
  }

  return { allowed: false, reason: "forbidden" as const }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await syncProjectLinkedTeamAccess(params.projectId)

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        taskLists: {
          include: {
            tasks: {
              include: {
                assignees: { include: { user: true } },
              },
              orderBy: { position: "asc" },
            },
          },
          orderBy: { position: "asc" },
        },
        members: {
          include: { user: true },
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

    const { allowed } = await checkProjectAccess(session.user.id!, params.projectId, ["MEMBER"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(project)
  } catch (error) {
    console.error("Error fetching project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string } }
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
      enableTaskBatchDuplicate,
      autoAssignEnabled,
      autoAssignAssigneeIds,
    } = body

    const existing = await prisma.project.findUnique({
      where: { id: params.projectId },
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

    const { allowed } = await checkProjectAccess(session.user.id!, params.projectId, ["LEAD"])
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

    const project = await prisma.project.update({
      where: { id: params.projectId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(icon !== undefined && { icon }),
        ...(status !== undefined && { status }),
        ...(folderId !== undefined && { folderId }),
        ...(enableTaskBatchDuplicate !== undefined && { enableTaskBatchDuplicate }),
        ...(normalizedAutoAssignConfig && normalizedAutoAssignConfig),
      },
      include: {
        taskLists: true,
        members: { include: { user: true } },
      },
    })

    logAudit({
      action: "update", entityType: "project", entityId: params.projectId, entityName: project.name,
      userId: session.user.id!, request, metadata: { changes: body },
    })

    // Webhook: project.updated
    dispatchWebhookEvent("project.updated", {
      projectId: params.projectId,
      name: project.name,
      changes: body,
    }, params.projectId).catch(() => {})

    return NextResponse.json(project)
  } catch (error) {
    console.error("Error updating project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const existing = await prisma.project.findUnique({
      where: { id: params.projectId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const { allowed } = await canManageProject(session.user.id!, params.projectId)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: project lead or workspace admin required to delete projects" }, { status: 403 })
    }

    logAudit({
      action: "delete", entityType: "project", entityId: params.projectId, entityName: existing.name,
      userId: session.user.id!, request,
    })

    await prisma.project.delete({
      where: { id: params.projectId },
    })

    return NextResponse.json({ message: "Project deleted" })
  } catch (error) {
    console.error("Error deleting project:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

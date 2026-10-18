export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { notifyProjectInvite } from "@/lib/notification-service"
import { logAudit } from "@/lib/audit"
import { syncProjectLinkedTeamAccess } from "@/lib/team-sync"
import { checkProjectAccess, isAccessLevel, memberAccessLevel, roleForLevel, type AccessLevel } from "@/lib/rbac"
import { syncProjectRoomSafe } from "@/lib/chat-membership"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { emitProjectChanged } from "@/lib/workspace-realtime"
import type { Prisma, ProjectRole } from "@/generated/prisma/client"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Who is in a project is visible to the people who can see the project (it answered anyone signed in).
    if (!(await checkProjectAccess(session.user.id!, (await params).projectId, ["VIEWER"])).allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    await syncProjectLinkedTeamAccess((await params).projectId)

    const members = await prisma.projectMember.findMany({
      where: { projectId: (await params).projectId },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    })

    return NextResponse.json(members)
  } catch (error) {
    console.error("Error fetching project members:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST takes one person — `{ userId, role }`, what every shipped app sends — or several at once —
// `{ userIds: string[], role }` (owner, 9 Oct 2026: "gabisa select multiple org"; the searchable
// multi-select on web and iOS/Mac). Same permission rule either way; each person added gets their own
// audit entry and their own "added to project" notification, exactly as one-by-one adds did.
// The single form answers as before (the member, 201; 400 when already in). The bulk form answers
// `{ success, added: Member[], alreadyMembers: string[], unknown: string[] }`: people already in are
// skipped rather than failing the whole batch.
const MAX_BULK = 200

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { projectId } = await params
    const body = await request.json().catch(() => ({}))
    // Access level for everyone in this batch (Notion's invite dropdown, owner 13 Oct 2026): FULL | EDIT |
    // COMMENT | VIEW, default EDIT. The released apps send `role` instead (LEAD/MEMBER/VIEWER/GUEST): it maps
    // onto the same levels, and role is always written to match (lib/rbac.ts roleForLevel).
    const ROLES: ProjectRole[] = ["LEAD", "MEMBER", "VIEWER", "GUEST"]
    const level: AccessLevel = isAccessLevel(body?.accessLevel)
      ? body.accessLevel
      : (memberAccessLevel({ role: ROLES.includes(body?.role) ? body.role : "MEMBER" }) ?? "EDIT")
    const role: ProjectRole = roleForLevel(level)
    const bulk = Array.isArray(body?.userIds)
    const requested: string[] = bulk
      ? Array.from(new Set((body.userIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)))
      : (typeof body?.userId === "string" && body.userId ? [body.userId] : [])

    if (requested.length === 0) {
      return NextResponse.json({ error: bulk ? "userIds is required" : "userId is required" }, { status: 400 })
    }
    if (requested.length > MAX_BULK) {
      return NextResponse.json({ error: `At most ${MAX_BULK} people at once` }, { status: 400 })
    }

    // Adding people is Full access (the Project Owner, BoD / One Above All).
    const { allowed } = await checkProjectAccess(session.user.id!, projectId, ["LEAD"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: you need Full access to the project to add members", code: "NEEDS_FULL_ACCESS" }, { status: 403 })
    }

    const existingRows = await prisma.projectMember.findMany({
      where: { projectId, userId: { in: requested } },
      select: { userId: true },
    })
    const already = new Set(existingRows.map((r) => r.userId))

    if (!bulk && already.size > 0) {
      return NextResponse.json({ error: "User is already a member" }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, workspaceId: true },
    })

    // Bulk: ids that are no account at all are reported, not thrown on (the single form keeps its
    // old behaviour).
    let toAdd = requested.filter((id) => !already.has(id))
    let unknown: string[] = []
    if (bulk && toAdd.length > 0) {
      const real = await prisma.user.findMany({ where: { id: { in: toAdd } }, select: { id: true } })
      const realIds = new Set(real.map((u) => u.id))
      unknown = toAdd.filter((id) => !realIds.has(id))
      toAdd = toAdd.filter((id) => realIds.has(id))
    }

    const added: Array<Prisma.ProjectMemberGetPayload<{ include: { user: true } }>> = []
    for (const userId of toAdd) {
      try {
        added.push(await prisma.projectMember.create({
          data: { userId, projectId, role, accessLevel: level },
          include: { user: true },
        }))
      } catch (e) {
        // Added by someone else a moment ago (unique userId+projectId): already in, not an error.
        if (bulk && (e as { code?: string })?.code === "P2002") { already.add(userId); continue }
        // Single add racing another add of the same person: same answer as the pre-check above, not a 500.
        if ((e as { code?: string })?.code === "P2002") return NextResponse.json({ error: "User is already a member" }, { status: 400 })
        throw e
      }
    }

    if (added.length > 0) {
      // Into the project's chat room now, not whenever they next open the chat list.
      await syncProjectRoomSafe(projectId, "project-member-added")

      // Who sees the project changed: the workspace's open views refetch, and so does each new
      // member's sidebar (their own room: they may not be in this workspace).
      emitWorkspaceChanged(
        project?.workspaceId,
        { kind: "projects", projectId, actorId: session.user.id! },
        added.map((m) => m.userId),
      )
    }

    for (const member of added) {
      // Notify the invited user
      if (member.userId !== session.user.id) {
        notifyProjectInvite({
          userId: member.userId,
          projectId,
          projectName: project?.name || "Unknown Project",
          invitedByName: session.user.name || "Someone",
          actorId: session.user.id,
          role,
        }).catch((err) => console.error("Project invite notification error:", err))
      }
      logAudit({ action: "create", entityType: "project_member", entityId: member.id, entityName: member.user?.name || member.userId, userId: session.user.id!, request, metadata: { projectId, role, accessLevel: level } })
    }

    if (!bulk) return NextResponse.json(added[0], { status: 201 })
    return NextResponse.json(
      { success: true, added, alreadyMembers: requested.filter((id) => already.has(id)), unknown },
      { status: added.length > 0 ? 201 : 200 },
    )
  } catch (error) {
    console.error("Error adding project member:", error)
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

    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    // Removing people is Full access.
    const { allowed } = await checkProjectAccess(session.user.id!, (await params).projectId, ["LEAD"])
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: you need Full access to the project to remove members", code: "NEEDS_FULL_ACCESS" }, { status: 403 })
    }

    const existing = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId,
          projectId: (await params).projectId,
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }
    // Same rule as PATCH: removing the last Project Owner would leave nobody but the BoD to manage it (QA BoD R2 N01).
    if (existing.role === "LEAD") {
      const owners = await prisma.projectMember.count({ where: { projectId: (await params).projectId, role: "LEAD" } })
      if (owners <= 1) {
        return NextResponse.json({ error: "A project keeps at least one Project Owner. Give someone else Full access first.", code: "LAST_OWNER" }, { status: 409 })
      }
    }

    await prisma.projectMember.delete({
      where: {
        userId_projectId: {
          userId,
          projectId: (await params).projectId,
        },
      },
    })

    // Out of the project's chat room: no more pushes, no more reading it (CHAT-CONTRACT security).
    await syncProjectRoomSafe((await params).projectId, "project-member-removed")

    // The removed person's sidebar drops it live; the workspace's member counts move.
    await emitProjectChanged((await params).projectId, { actorId: session.user.id!, userIds: [userId] })

    logAudit({ action: "delete", entityType: "project_member", entityId: existing.userId, entityName: userId, userId: session.user.id!, request, metadata: { projectId: (await params).projectId } })

    return NextResponse.json({ message: "Member removed" })
  } catch (error) {
    console.error("Error removing project member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}


/**
 * PATCH { userId, accessLevel } — change one member's level (the per-row dropdown, Notion-style). Full access
 * only. The project keeps at least one Project Owner unless the caller has workspace-wide Full access, so a
 * project never ends up with nobody but the BoD able to manage it by accident.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params
    const body = await request.json().catch(() => ({}))
    const userId = typeof body?.userId === "string" ? body.userId : ""
    if (!userId || !isAccessLevel(body?.accessLevel)) {
      return NextResponse.json({ error: "userId and accessLevel (FULL, EDIT, COMMENT or VIEW) are required" }, { status: 400 })
    }
    const level: AccessLevel = body.accessLevel
    if (!(await checkProjectAccess(session.user.id!, projectId, ["LEAD"])).allowed) {
      return NextResponse.json({ error: "Forbidden: you need Full access to the project to change access", code: "NEEDS_FULL_ACCESS" }, { status: 403 })
    }
    const existing = await prisma.projectMember.findUnique({ where: { userId_projectId: { userId, projectId } } })
    if (!existing) return NextResponse.json({ error: "Member not found" }, { status: 404 })
    if (memberAccessLevel(existing) === "FULL" && level !== "FULL") {
      const owners = await prisma.projectMember.count({ where: { projectId, role: "LEAD" } })
      if (owners <= 1) {
        return NextResponse.json({ error: "A project keeps at least one Project Owner. Give someone else Full access first.", code: "LAST_OWNER" }, { status: 409 })
      }
    }
    const member = await prisma.projectMember.update({
      where: { userId_projectId: { userId, projectId } },
      data: { role: roleForLevel(level), accessLevel: level },
      include: { user: true },
    })
    await emitProjectChanged(projectId, { actorId: session.user.id!, userIds: [userId] })
    logAudit({ action: "update", entityType: "project_member", entityId: member.id, entityName: member.user?.name || userId, userId: session.user.id!, request, metadata: { projectId, accessLevel: { from: memberAccessLevel(existing), to: level } } })
    return NextResponse.json(member)
  } catch (error) {
    console.error("Error changing project member access:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

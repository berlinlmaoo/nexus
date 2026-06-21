export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import type { SystemRole } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { logAudit } from "@/lib/audit"

const SYSTEM_ROLES: SystemRole[] = ["ADMIN", "MEMBER"]

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { context } = await getAdminSessionContext()

    if (!context?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!context.canAccessUserManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const [user, workspaceMemberships, teamMemberships, projectMemberships, availableWorkspaces] =
      await prisma.$transaction([
        prisma.user.findUnique({
          where: { id: (await params).userId },
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.workspaceMember.findMany({
          where: { userId: (await params).userId },
          include: {
            workspace: {
              select: { id: true, name: true, slug: true },
            },
          },
          orderBy: [
            { workspace: { name: "asc" } },
            { joinedAt: "asc" },
          ],
        }),
        prisma.teamMember.findMany({
          where: { userId: (await params).userId },
          include: {
            team: {
              select: {
                id: true,
                name: true,
                color: true,
                workspaceId: true,
              },
            },
          },
          orderBy: { team: { name: "asc" } },
        }),
        prisma.projectMember.findMany({
          where: { userId: (await params).userId },
          include: {
            project: {
              select: {
                id: true,
                name: true,
                color: true,
                icon: true,
                status: true,
                workspaceId: true,
              },
            },
          },
          orderBy: { project: { name: "asc" } },
        }),
        prisma.workspace.findMany({
          select: { id: true, name: true, slug: true },
          orderBy: { name: "asc" },
        }),
      ])

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const memberships = workspaceMemberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      joinedAt: membership.joinedAt,
      workspace: membership.workspace,
      teams: teamMemberships
        .filter((teamMembership) => teamMembership.team.workspaceId === membership.workspaceId)
        .map((teamMembership) => ({
          id: teamMembership.team.id,
          name: teamMembership.team.name,
          color: teamMembership.team.color,
          role: teamMembership.role,
        })),
      projects: projectMemberships
        .filter((projectMembership) => projectMembership.project.workspaceId === membership.workspaceId)
        .map((projectMembership) => ({
          id: projectMembership.project.id,
          name: projectMembership.project.name,
          color: projectMembership.project.color,
          icon: projectMembership.project.icon,
          status: projectMembership.project.status,
          role: projectMembership.role,
          source: projectMembership.source,
        })),
    }))

    return NextResponse.json({
      user: {
        ...user,
        workspaceMemberships: memberships,
      },
      availableWorkspaces,
    })
  } catch (error) {
    console.error("Error fetching admin user detail:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { session, context } = await getAdminSessionContext()

    if (!context?.user || !session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!context.canAccessUserManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const role = body.role as SystemRole | undefined

    if (!role || !SYSTEM_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid system role" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({
      where: { id: (await params).userId },
      select: { id: true, name: true, role: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const updated = await prisma.user.update({
      where: { id: (await params).userId },
      data: { role },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    await logAudit({
      action: "update",
      entityType: "admin_user_role",
      entityId: (await params).userId,
      entityName: updated.email,
      userId: session.user.id,
      request,
      metadata: {
        previousRole: existing.role,
        role,
      },
    })

    return NextResponse.json({ user: updated })
  } catch (error) {
    console.error("Error updating admin user role:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Permanently delete a user account. Stricter than role edits: only a system ADMIN or an org
// BoD / One Above All may purge an account (plain Managers may NOT). Guards: can't delete yourself,
// can't delete a system ADMIN unless you're one too, can't delete the LAST system admin, and the
// target must already be removed from every workspace (so an active staffer can't be nuked by
// accident — match the "remove from Members first, then delete the ghost" flow). SHARED/owned content
// the user created (tasks, attachments, portfolios, quests, workflow bundles, proof annotations,
// goals + their milestones/links, docs, team calendar events, room bookings) is REASSIGNED to the
// acting admin so nothing team-visible is lost; personal/ephemeral rows (status updates, pending
// invites, the target's own audit trail) are removed; everything else cascades via the schema's
// onDelete rules (note: the user's own comments cascade, which can remove threaded replies under them).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { session, context } = await getAdminSessionContext()

    if (!context?.user || !session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const canDelete =
      context.isSystemAdmin ||
      context.workspaceMemberships.some((m) => m.role === "BOD" || m.role === "ONE_ABOVE_ALL")
    if (!canDelete) {
      return NextResponse.json({ error: "Forbidden — hanya system admin / BoD yang bisa hapus akun." }, { status: 403 })
    }

    const userId = (await params).userId
    const actorId = session.user.id

    if (userId === actorId) {
      return NextResponse.json({ error: "Gak bisa hapus akun kamu sendiri." }, { status: 400 })
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        workspaceMembers: { select: { workspace: { select: { name: true } } } },
      },
    })

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    if (target.role === "ADMIN" && !context.isSystemAdmin) {
      return NextResponse.json({ error: "Akun ini system-admin — cuma sesama system-admin yang bisa hapus." }, { status: 403 })
    }

    // Never delete the last system admin — that would lock everyone out of user management permanently.
    if (target.role === "ADMIN") {
      const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", id: { not: userId } } })
      if (otherAdmins === 0) {
        return NextResponse.json({ error: "Gak bisa hapus system-admin terakhir — harus ada minimal satu admin." }, { status: 409 })
      }
    }

    if (target.workspaceMembers.length > 0) {
      const names = Array.from(new Set(target.workspaceMembers.map((m) => m.workspace.name)))
      // Human message in `error` so the client (which reads payload.error) shows it directly; keep a
      // machine `code` + `workspaces` for any programmatic handling.
      return NextResponse.json(
        {
          error: `Masih anggota workspace: ${names.join(", ")}. Hapus dari Members dulu baru bisa hapus akunnya.`,
          code: "still-member",
          workspaces: names,
        },
        { status: 409 }
      )
    }

    // Reassign owned content → actor; purge personal/ephemeral; then delete (rest cascades).
    // Sequential awaits (not Promise.all) — Prisma interactive transactions expect serial ops on the
    // tx client. Raised timeout so accounts with lots of authored rows don't trip the 5s default.
    const summary = await prisma.$transaction(
      async (tx) => {
        // Re-assert the zero-membership invariant inside the tx — guards against a concurrent re-add
        // between the check above and the delete (TOCTOU). Throw → whole tx rolls back, nothing deleted.
        const stillMember = await tx.workspaceMember.count({ where: { userId } })
        if (stillMember > 0) throw new Error("still-member-race")

        const tasks = await tx.task.updateMany({ where: { creatorId: userId }, data: { creatorId: actorId } })
        const attachments = await tx.attachment.updateMany({ where: { uploaderId: userId }, data: { uploaderId: actorId } })
        const portfolios = await tx.portfolio.updateMany({ where: { ownerId: userId }, data: { ownerId: actorId } })
        const bundles = await tx.workflowBundle.updateMany({ where: { createdById: userId }, data: { createdById: actorId } })
        const quests = await tx.quest.updateMany({ where: { createdById: userId }, data: { createdById: actorId } })
        const proofs = await tx.proofAnnotation.updateMany({ where: { userId }, data: { userId: actorId } })
        // Shared/team content with a required Cascade FK to the user — reassign so it survives the delete.
        const goals = await tx.goal.updateMany({ where: { ownerId: userId }, data: { ownerId: actorId } })
        const docs = await tx.doc.updateMany({ where: { authorId: userId }, data: { authorId: actorId } })
        const calendarEvents = await tx.teamCalendarEvent.updateMany({ where: { createdById: userId }, data: { createdById: actorId } })
        const roomBookings = await tx.roomBooking.updateMany({ where: { createdById: userId }, data: { createdById: actorId } })

        const statusUpdates = await tx.statusUpdate.deleteMany({ where: { authorId: userId } })
        const invites = await tx.inviteToken.deleteMany({ where: { inviterId: userId } })
        const audits = await tx.auditLog.deleteMany({ where: { userId } })
        await tx.user.delete({ where: { id: userId } })
        return {
          reassigned: {
            tasks: tasks.count,
            attachments: attachments.count,
            portfolios: portfolios.count,
            workflowBundles: bundles.count,
            quests: quests.count,
            proofAnnotations: proofs.count,
            goals: goals.count,
            docs: docs.count,
            calendarEvents: calendarEvents.count,
            roomBookings: roomBookings.count,
          },
          purged: { statusUpdates: statusUpdates.count, inviteTokens: invites.count, auditLogs: audits.count },
        }
      },
      { timeout: 30000, maxWait: 10000 }
    )

    await logAudit({
      action: "delete",
      entityType: "admin_user",
      entityId: userId,
      entityName: target.email,
      userId: actorId,
      request,
      metadata: { deletedName: target.name, deletedRole: target.role, ...summary },
    })

    return NextResponse.json({ ok: true, deletedUser: { id: target.id, name: target.name, email: target.email }, ...summary })
  } catch (error) {
    console.error("Error deleting admin user:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

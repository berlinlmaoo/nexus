export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import type { SystemRole } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { directoryConfigured, getDirectoryAccount } from "@/lib/google-directory"
import { logAudit } from "@/lib/audit"
import { createInAppNotification } from "@/lib/notification-service"
import bcrypt from "bcryptjs"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { WORKSPACE_HIERARCHY } from "@/lib/rbac"
import type { WorkspaceRole } from "@/generated/prisma/client"

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
    // Penautan akun Google dikirim lewat endpoint yang sama, jadi `role` tidak lagi wajib —
    // tapi salah satu dari keduanya harus ada, kalau tidak PATCH kosong akan lolos diam-diam
    // dan memanggilnya terasa berhasil padahal tidak mengubah apa pun.
    const hasWorkspaceEmail = Object.prototype.hasOwnProperty.call(body, "googleWorkspaceEmail")

    // Identitas akun — nama, email login, sandi — hanya BoD ke atas (atau system admin).
    // `canAccessUserManagement` di atas masih meloloskan Manager; untuk peran dan tautan Google
    // itu memang cukup, untuk mengganti sandi orang tidak.
    const wantsName = typeof body.name === "string"
    const wantsEmail = typeof body.email === "string"
    const wantsPassword = typeof body.password === "string"
    const touchesAccount = wantsName || wantsEmail || wantsPassword
    if (touchesAccount) {
      const orgRole = await getUserOrgRole(session.user.id)
      if (!context.isSystemAdmin && !isBodPlus(orgRole)) {
        return NextResponse.json({ error: "Hanya BoD ke atas yang bisa mengubah nama, email, atau sandi akun." }, { status: 403 })
      }
    }

    if (role !== undefined && !SYSTEM_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid system role" }, { status: 400 })
    }
    if (role === undefined && !hasWorkspaceEmail && !touchesAccount) {
      return NextResponse.json({ error: "Tidak ada yang diubah" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({
      where: { id: (await params).userId },
      select: { id: true, name: true, role: true, googleWorkspaceEmail: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // targetTierGuard (audit 28 Sep 2026). The system role (ADMIN/MEMBER) is only ever given or
    // taken by a system admin: `canAccessUserManagement` lets Managers through, and a Manager could
    // PATCH themselves to ADMIN. And nobody but a system admin touches a system admin's account, or
    // an account at or above their own workspace tier (One Above All excepted), except their own —
    // otherwise a BoD could reset an OAA's email and password and sign in as them.
    if (role !== undefined && role !== existing.role && !context.isSystemAdmin) {
      return NextResponse.json({ error: "Hanya system admin yang bisa mengubah peran sistem." }, { status: 403 })
    }
    const isSelf = existing.id === session.user.id
    if (!isSelf && !context.isSystemAdmin && (touchesAccount || hasWorkspaceEmail)) {
      if (existing.role === "ADMIN") {
        return NextResponse.json({ error: "Akun ini system admin — cuma sesama system admin yang bisa mengubahnya." }, { status: 403 })
      }
      const [callerRole, targetRole] = await Promise.all([getUserOrgRole(session.user.id), getUserOrgRole(existing.id)])
      const callerTier = WORKSPACE_HIERARCHY[callerRole as WorkspaceRole] ?? 0
      const targetTier = WORKSPACE_HIERARCHY[targetRole as WorkspaceRole] ?? 0
      if (callerTier !== WORKSPACE_HIERARCHY.ONE_ABOVE_ALL && targetTier >= callerTier) {
        return NextResponse.json({ error: "Kamu tidak bisa mengubah akun orang yang setara atau di atas level kamu." }, { status: 403 })
      }
    }

    const data: {
      role?: SystemRole
      googleWorkspaceEmail?: string | null
      name?: string
      email?: string
      password?: string
      sessionVersion?: { increment: number }
    } = {}
    if (role !== undefined) data.role = role

    if (wantsName) {
      const name = String(body.name).trim()
      if (name.length < 2 || name.length > 80) return NextResponse.json({ error: "Nama 2–80 karakter." }, { status: 400 })
      data.name = name
    }
    if (wantsEmail) {
      const email = String(body.email).trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Email tidak valid." }, { status: 400 })
      // Email adalah kunci login. Disebutkan SIAPA yang sudah memakainya, bukan galat unik database.
      const taken = await prisma.user.findFirst({ where: { email, id: { not: (await params).userId } }, select: { name: true } })
      if (taken) return NextResponse.json({ error: `${email} sudah dipakai ${taken.name ?? "akun lain"}.` }, { status: 409 })
      data.email = email
    }
    if (wantsPassword) {
      const pw = String(body.password)
      if (pw.length < 8) return NextResponse.json({ error: "Sandi minimal 8 karakter." }, { status: 400 })
      // Cost yang sama dengan pendaftaran. Sandi lama tidak diminta: ini BoD mengatur ulang
      // sandi orang lain, dan orang itu memang tidak ada di sini untuk mengetiknya.
      data.password = await bcrypt.hash(pw, 12)
      // Someone else set this password: every session of the account's owner ends (lib/session-version.ts),
      // as after a reset by email. Not when the caller sets their own here — that would sign them out.
      if ((await params).userId !== session.user.id) data.sessionVersion = { increment: 1 }
    }

    if (hasWorkspaceEmail) {
      const raw = body.googleWorkspaceEmail
      if (raw === null || raw === "") {
        data.googleWorkspaceEmail = null
      } else if (typeof raw !== "string") {
        return NextResponse.json({ error: "googleWorkspaceEmail harus teks atau null" }, { status: 400 })
      } else {
        const email = raw.trim().toLowerCase()
        // Alamatnya dibuktikan ADA di Google sebelum disimpan. Alamat yang salah ketik terlihat
        // persis sama dengan yang benar di database, dan baru ketahuan salah pada hari seseorang
        // mencoba mengirim surat ke sana.
        if (!directoryConfigured()) {
          return NextResponse.json(
            { error: "Google Workspace belum disambungkan, jadi akun tidak bisa diverifikasi." },
            { status: 409 },
          )
        }
        const account = await getDirectoryAccount(email)
        if (!account) {
          return NextResponse.json(
            { error: `Akun ${email} tidak ada di Google Workspace.` },
            { status: 404 },
          )
        }
        // Indeks uniknya parsial dan akan menolak ini juga, tapi pesannya akan berupa galat
        // database. Diperiksa di sini supaya jawabannya menyebut SIAPA yang sudah memakainya.
        const taken = await prisma.user.findFirst({
          where: { googleWorkspaceEmail: account.email, id: { not: existing.id } },
          select: { name: true },
        })
        if (taken) {
          return NextResponse.json(
            { error: `${account.email} sudah ditautkan ke ${taken.name}.` },
            { status: 409 },
          )
        }
        data.googleWorkspaceEmail = account.email
      }
    }

    const updated = await prisma.user.update({
      where: { id: (await params).userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        googleWorkspaceEmail: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    await logAudit({
      action: "update",
      entityType: touchesAccount ? "admin_user_account" : "admin_user_role",
      entityId: (await params).userId,
      entityName: updated.email,
      userId: session.user.id,
      request,
      metadata: {
        previousRole: existing.role,
        role,
        previousGoogleWorkspaceEmail: existing.googleWorkspaceEmail,
        googleWorkspaceEmail: data.googleWorkspaceEmail,
        // Sandinya sendiri tidak pernah masuk audit — cukup fakta bahwa ia diganti.
        ...(wantsName ? { name: data.name } : {}),
        ...(wantsEmail ? { email: data.email } : {}),
        ...(wantsPassword ? { passwordReset: true } : {}),
      },
    })

    // Linking is done BY a BoD TO somebody else, who is not in the room. Tell them — otherwise the
    // first they hear of their company address is a calendar invite they cannot open.
    if (data.googleWorkspaceEmail && data.googleWorkspaceEmail !== existing.googleWorkspaceEmail) {
      await createInAppNotification({
        userId: updated.id,
        type: "google_workspace_linked",
        title: "Akun Google Workspace kamu ditautkan",
        message: `${data.googleWorkspaceEmail} sekarang tersambung ke akun NEXUS kamu. Kalender, Meet, dan email kantor memakai alamat ini.`,
        link: "/settings",
        push: true,
      }).catch(() => null)
    }

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

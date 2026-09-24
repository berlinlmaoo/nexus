export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { readdir, unlink } from "fs/promises"
import path from "path"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { deleteGideonAttachmentFiles } from "@/lib/gideon-attachments"
import {
  DELETED_ACCOUNT_NAME,
  deletedAccountEmail,
  isDeletedAccountEmail,
} from "@/lib/account-deletion"

/**
 * POST /api/user/account/delete — the signed-in person deletes their own account.
 *
 * Body: { "confirm": "DELETE" }. 200 { ok: true } on success; every failure is { error } with a
 * sentence meant for the person, because both the web and the iOS app show it verbatim.
 *
 * DEACTIVATE + ANONYMISE, never a hard delete (owner's decision). The User row keeps its id so the
 * company's attendance, task, XP, chat and approval history still resolve — to "Deleted account".
 * The admin DELETE in /api/admin/users/[userId] is NOT reused: it hard-deletes and lets the schema
 * cascade away the very history that has to stay.
 *
 * What goes:
 *  - identity on the User row: name, email (→ deleted-<id>@deleted.invalid, freeing the real one),
 *    password, avatar, phone, Google Workspace link, WhatsApp link, DND/onboarding, system role;
 *  - every way back in: OAuth accounts, passkeys (+ pending challenges), NextAuth/SAML sessions,
 *    MCP/API + OAuth tokens and auth codes, push devices, OTPs for the old address. The session JWT
 *    itself is stateless and cannot be deleted; lib/auth.ts and pages/api/socket.ts refuse any
 *    token whose user carries the deleted-email marker, which kills it on its next use;
 *  - rosters: workspace, team and project memberships (removing them cascades NOTHING — no model
 *    references those rows), and approver-chart edges that pointed at this person (so their staff
 *    fall back to BoD instead of waiting on someone who can never answer);
 *  - personal-only data: notification preferences (hold a WA phone and Slack webhook), GIDEON chat
 *    history and its uploaded files, the avatar file.
 *
 * What stays: attendance records/requests/corrections, tasks + assignments + comments, XP, streaks,
 * quests, messages and conversation memberships, feed posts, vault files, audit log.
 */

const CONFIRM_WORD = "DELETE"

class DeletionRefused extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

/** Workspaces this person is the only ONE_ABOVE_ALL of while other people are still in them. */
async function workspacesLeftOwnerless(db: Pick<typeof prisma, "workspaceMember">, userId: string) {
  const owned = await db.workspaceMember.findMany({
    where: { userId, role: "ONE_ABOVE_ALL" },
    select: { workspaceId: true, workspace: { select: { name: true } } },
  })
  const blocked: { name: string; others: number }[] = []
  for (const m of owned) {
    const otherOwners = await db.workspaceMember.count({
      where: { workspaceId: m.workspaceId, role: "ONE_ABOVE_ALL", userId: { not: userId } },
    })
    if (otherOwners > 0) continue
    const others = await db.workspaceMember.count({
      where: { workspaceId: m.workspaceId, userId: { not: userId } },
    })
    // A personal workspace with only them in it is fine: nobody is left behind without an owner.
    if (others > 0) blocked.push({ name: m.workspace.name, others })
  }
  return blocked
}

function ownerlessMessage(blocked: { name: string; others: number }[]) {
  const first = blocked[0]
  const people = `${first.others} other ${first.others === 1 ? "person" : "people"}`
  const more = blocked.length > 1 ? ` (and ${blocked.length - 1} more workspace${blocked.length > 2 ? "s" : ""})` : ""
  return `You're the only One Above All of "${first.name}"${more}, which still has ${people} in it. Make someone else One Above All first, then delete your account.`
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: "You need to be signed in to delete your account." }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object" || (body as { confirm?: unknown }).confirm !== CONFIRM_WORD) {
      return NextResponse.json({ error: `Type ${CONFIRM_WORD} to confirm that you want to delete your account.` }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true },
    })
    if (!user) {
      return NextResponse.json({ error: "We couldn't find your account." }, { status: 404 })
    }
    if (isDeletedAccountEmail(user.email)) {
      return NextResponse.json({ error: "This account has already been deleted." }, { status: 410 })
    }

    const summary = await prisma.$transaction(
      async (tx) => {
        // Guards run INSIDE the transaction, so an owner handover (or a role change) racing this
        // request cannot slip between the check and the writes.
        const blocked = await workspacesLeftOwnerless(tx, userId)
        if (blocked.length > 0) throw new DeletionRefused(409, ownerlessMessage(blocked))

        if (user.role === "ADMIN") {
          const otherAdmins = await tx.user.count({ where: { role: "ADMIN", id: { not: userId } } })
          if (otherAdmins === 0) {
            throw new DeletionRefused(
              409,
              "You're the last system admin of NEXUS. Make someone else a system admin first, then delete your account.",
            )
          }
        }

        // Personal workspace (created by sign-up without a code) that only they are in: it would be
        // left with no members at all. Take their name off it and close its join code, so a stranger
        // with the old code can't walk into what is left of it.
        const soleWorkspaces = await tx.workspace.findMany({
          where: { members: { some: { userId }, every: { userId } } },
          select: { id: true, name: true },
        })
        for (const ws of soleWorkspaces) {
          await tx.workspace.update({
            where: { id: ws.id },
            data: {
              joinCode: null,
              ...(ws.name === `${user.name}'s workspace` ? { name: `${DELETED_ACCOUNT_NAME}'s workspace` } : {}),
            },
          })
        }

        // Approver-chart edges pointing at them. The FK is onDelete: SetNull, but the User row is not
        // deleted, so it has to be done by hand. null = "falls back to BoD", the chart's safety net.
        const approverEdges = await tx.workspaceMember.updateMany({
          where: { approverId: userId },
          data: { approverId: null },
        })

        // Rosters. No model has a relation to WorkspaceMember/TeamMember/ProjectMember, so these
        // deletes cascade nothing; the history rows point at the User, not at the membership.
        const workspaces = await tx.workspaceMember.deleteMany({ where: { userId } })
        const teams = await tx.teamMember.deleteMany({ where: { userId } })
        const projects = await tx.projectMember.deleteMany({ where: { userId } })

        // Every way back in.
        const accounts = await tx.account.deleteMany({ where: { userId } })
        const passkeys = await tx.passkey.deleteMany({ where: { userId } })
        await tx.passkeyChallenge.deleteMany({ where: { userId } })
        const sessions = await tx.userSession.deleteMany({ where: { userId } })
        const apiTokens = await tx.apiToken.deleteMany({ where: { userId } })
        await tx.oAuthAuthCode.deleteMany({ where: { userId } })
        const devices = await tx.deviceInstallation.deleteMany({ where: { userId } })
        await tx.emailOtpVerification.deleteMany({
          where: { OR: [{ userId }, { email: { equals: user.email, mode: "insensitive" } }] },
        })

        // Personal-only data.
        await tx.notificationPreference.deleteMany({ where: { userId } })
        const gideonRows = await tx.gideonMessage.findMany({ where: { userId }, select: { attachments: true } })
        await tx.gideonMessage.deleteMany({ where: { userId } })

        await tx.user.update({
          where: { id: userId },
          data: {
            name: DELETED_ACCOUNT_NAME,
            email: deletedAccountEmail(userId),
            password: null,
            avatar: null,
            googleWorkspaceEmail: null,
            phoneNumber: null,
            whatsappId: null,
            waLinkCode: null,
            waLinkExpiresAt: null,
            dndUntil: null,
            onboardedAt: null,
            role: "MEMBER",
          },
        })

        return {
          gideonAttachments: gideonRows.map((row) => row.attachments),
          counts: {
            workspaceMemberships: workspaces.count,
            teamMemberships: teams.count,
            projectMemberships: projects.count,
            approverEdgesCleared: approverEdges.count,
            soleWorkspacesClosed: soleWorkspaces.length,
            oauthAccounts: accounts.count,
            passkeys: passkeys.count,
            sessions: sessions.count,
            apiTokens: apiTokens.count,
            devices: devices.count,
            gideonMessages: gideonRows.length,
          },
        }
      },
      { timeout: 30000, maxWait: 10000 },
    )

    // Files only after the rows are gone (a stray file is invisible; a row naming a missing file
    // is not). Best effort: the account is already deleted whatever happens here.
    await deleteGideonAttachmentFiles(summary.gideonAttachments).catch((error) => {
      console.error("account delete: gideon attachment cleanup failed", error)
      return 0
    })
    try {
      const avatarDir = path.join(process.cwd(), "public", "uploads", "avatars")
      for (const f of await readdir(avatarDir)) {
        if (f.startsWith(`${userId}.`)) await unlink(path.join(avatarDir, f))
      }
    } catch {
      /* no avatar directory or file — nothing to remove */
    }

    // The audit row is written against the same (now anonymised) user id. The old email is
    // deliberately NOT recorded: keeping it here would undo the anonymisation.
    await logAudit({
      action: "delete",
      entityType: "user_account",
      entityId: userId,
      entityName: DELETED_ACCOUNT_NAME,
      userId,
      request,
      metadata: { selfService: true, previousRole: user.role, ...summary.counts },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof DeletionRefused) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error deleting own account:", error)
    return NextResponse.json(
      { error: "Something went wrong and your account was not deleted. Please try again." },
      { status: 500 },
    )
  }
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import { syncUserRoomsSafe } from "@/lib/chat-membership"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"

/**
 * Join a workspace with its code from an existing account (owner, 16 Oct 2026, option a).
 *
 * For an account that signed up without a code and so only has its own personal workspace (it is the only
 * member there). Sign-up already takes a code (auth/register/verify); this is the same step afterwards. On join
 * the personal workspace is DELETED with everything in it (owner: its content is not moved anywhere).
 *
 * GET  → 200 { eligible, personalWorkspace: { id, name } | null }
 *        eligible = every workspace the account is in has no other member.
 * POST { code } (spaces, dashes and case ignored) →
 *   200 { ok: true, workspace: { id, name }, removedWorkspaces: string[] }  — the account is STAFF there now
 *   400 { code: "INVALID_CODE" }   — empty or unknown code
 *   403 { code: "NOT_ELIGIBLE" }   — the account already shares a workspace with someone
 *   409 { code: "ALREADY_MEMBER" } — the code is for a workspace the account is in
 *   429                            — 10 tries / 15 min per account
 * Joining by code makes you STAFF, as at sign-up: a code says where to go, not who you are.
 */

const RATE = { limit: 10, windowSeconds: 15 * 60 }

/** The account's memberships, each with whether anyone else is in that workspace. */
async function membershipsOf(userId: string) {
  const rows = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { id: true, workspaceId: true, workspace: { select: { id: true, name: true, _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "asc" },
  })
  return rows.map((r) => ({ memberId: r.id, id: r.workspace.id, name: r.workspace.name, solo: r.workspace._count.members <= 1 }))
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const rows = await membershipsOf(session.user.id)
    const eligible = rows.every((r) => r.solo)
    const personal = eligible ? rows[0] ?? null : null
    return NextResponse.json({ eligible, personalWorkspace: personal ? { id: personal.id, name: personal.name } : null })
  } catch (error) {
    console.error("workspaces/join GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const limit = checkRateLimitByKey("workspace-join", userId, RATE)
    if (!limit.allowed) return rateLimitResponse(limit.resetAt)

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null
    // People retype these off a screen, so spacing, dashes and case are theirs to get wrong (as at sign-up).
    const joinCode = (typeof body?.code === "string" ? body.code : "").replace(/[\s-]/g, "").toUpperCase()
    const invalid = NextResponse.json({ error: "That workspace code is not valid.", code: "INVALID_CODE" }, { status: 400 })
    if (!joinCode || joinCode.length > 64) return invalid
    const target = await prisma.workspace.findUnique({ where: { joinCode }, select: { id: true, name: true } })
    if (!target) return invalid

    const rows = await membershipsOf(userId)
    if (rows.some((r) => r.id === target.id)) {
      return NextResponse.json({ error: `You are already in ${target.name}.`, code: "ALREADY_MEMBER" }, { status: 409 })
    }
    if (!rows.every((r) => r.solo)) {
      return NextResponse.json(
        { error: "Your account already shares a workspace with other people. Ask that workspace's admin to add you instead.", code: "NOT_ELIGIBLE" },
        { status: 403 },
      )
    }

    // In first, so the account is never left without a workspace if a delete below fails.
    const member = await prisma.workspaceMember.create({
      data: { userId, workspaceId: target.id, role: "STAFF" },
      select: { id: true },
    })

    // The personal workspace(s) go, with everything in them (owner: nothing is moved). Portfolios are the one
    // child without a cascade. If the delete still fails (a row elsewhere pointing in), the account leaves it
    // and its code is closed, so nobody can reach what is left; it is reported in the audit entry.
    const removed: string[] = []
    const orphaned: string[] = []
    for (const ws of rows) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.portfolio.deleteMany({ where: { workspaceId: ws.id } })
          await tx.workspace.delete({ where: { id: ws.id } })
        }, { timeout: 30000, maxWait: 10000 })
      } catch (error) {
        console.error("workspaces/join: personal workspace not deleted, leaving it instead", ws.id, error)
        await prisma.workspaceMember.deleteMany({ where: { id: ws.memberId } })
        await prisma.workspace.update({ where: { id: ws.id }, data: { joinCode: null } }).catch(() => {})
        orphaned.push(ws.id)
      }
      removed.push(ws.name)
    }

    // Into the chat rooms of the projects they are a member of there (none yet, but the same path as an invite).
    await syncUserRoomsSafe(userId, "workspace-joined-by-code")
    emitWorkspaceChanged(target.id, { kind: "projects", actorId: userId }, [userId])

    await logAudit({
      action: "create",
      entityType: "workspace_member",
      entityId: member.id,
      entityName: target.name,
      userId,
      request,
      metadata: { via: "join_code", workspaceId: target.id, removedWorkspaces: removed, ...(orphaned.length ? { leftNotDeleted: orphaned } : {}) },
    })

    return NextResponse.json({ ok: true, workspace: { id: target.id, name: target.name }, removedWorkspaces: removed })
  } catch (error) {
    console.error("workspaces/join POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { WORKSPACE_HIERARCHY, isSystemAdminUser } from "@/lib/rbac"
import type { WorkspaceRole } from "@/generated/prisma/client"

// POST { password } → a BoD-or-above resets another member's login password.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { password } = await req.json()
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password minimal 8 karakter" }, { status: 400 })
    }

    const targetMember = await prisma.workspaceMember.findUnique({
      where: { id: (await params).memberId },
      select: { role: true, workspaceId: true, userId: true, user: { select: { id: true, name: true, email: true } } },
    })
    if (!targetMember) return NextResponse.json({ error: "Member not found" }, { status: 404 })

    const isSystemAdmin = await isSystemAdminUser(session.user.id)
    const caller = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.user.id, workspaceId: targetMember.workspaceId } },
      select: { role: true },
    })

    const callerTier = isSystemAdmin ? 4 : (caller ? WORKSPACE_HIERARCHY[caller.role] : 0)
    // BoD ke atas only.
    if (callerTier < WORKSPACE_HIERARCHY.BOD) {
      return NextResponse.json({ error: "Cuma BoD ke atas yang bisa reset password" }, { status: 403 })
    }
    // Can't reset your own here (use the normal change-password flow), and can't reset
    // someone at or above your tier (One Above All / tier 4 can reset anyone).
    if (targetMember.userId === session.user.id) {
      return NextResponse.json({ error: "Pakai ganti password sendiri di Security" }, { status: 400 })
    }
    const targetTier = WORKSPACE_HIERARCHY[targetMember.role as WorkspaceRole]
    if (callerTier !== 4 && targetTier >= callerTier) {
      return NextResponse.json({ error: "Nggak bisa reset password orang yang levelnya sama / di atas kamu" }, { status: 403 })
    }

    const hashed = await bcrypt.hash(password, 12)
    await prisma.user.update({ where: { id: targetMember.user.id }, data: { password: hashed } })

    // Log the EVENT (who reset whose password, when, from where) — never the password value.
    const targetLabel = targetMember.user.name ?? targetMember.user.email ?? targetMember.user.id
    logAudit({ action: "reset_password", entityType: "user_password", entityId: targetMember.user.id, entityName: `Reset password — ${targetLabel}`, userId: session.user.id, request: req, metadata: { workspaceId: targetMember.workspaceId, targetUserId: targetMember.user.id, targetEmail: targetMember.user.email } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Admin password reset error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

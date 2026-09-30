import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getAdminAccessContext } from "@/lib/admin-access"
import { ORG_WORKSPACE_ID } from "@/lib/org"

/**
 * Bagan IP & Divisi — shared guard. Reading: anyone who may open Control Room's user management
 * (BoD / Manager / One Above All of the company workspace, or system admin), like Bagan Approval.
 * Changing: BoD / One Above All / system admin only. Always the COMPANY workspace.
 *
 * The chart grants nothing (owner, 30 Sep 2026): no project access, no attendance rule. Nothing
 * here may touch ProjectMember or approverId.
 */
export async function orgChartGuard(mode: "read" | "write"): Promise<{ userId: string } | NextResponse> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const ctx = await getAdminAccessContext(userId)
  if (!ctx.canAccessUserManagement) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (mode === "write" && !(ctx.isSystemAdmin || ctx.orgRole === "BOD" || ctx.orgRole === "ONE_ABOVE_ALL")) {
    return NextResponse.json({ error: "Hanya BoD / One Above All yang bisa mengubah bagan." }, { status: 403 })
  }
  return { userId }
}

export const ORG_CHART_WORKSPACE = ORG_WORKSPACE_ID

/** A unit of the company workspace, or null. */
export function findUnit(id: string) {
  return prisma.orgUnit.findFirst({ where: { id, workspaceId: ORG_WORKSPACE_ID }, select: { id: true, parentId: true, name: true, logoUrl: true } })
}

/** True when making `parentId` the parent of `unitId` would close a loop (itself or a descendant). */
export async function wouldLoop(unitId: string, parentId: string): Promise<boolean> {
  if (unitId === parentId) return true
  const rows = await prisma.orgUnit.findMany({ where: { workspaceId: ORG_WORKSPACE_ID }, select: { id: true, parentId: true } })
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]))
  const seen = new Set<string>()
  let cur: string | null | undefined = parentId
  while (cur && !seen.has(cur)) {
    if (cur === unitId) return true
    seen.add(cur)
    cur = parentOf.get(cur) ?? null
  }
  return false
}

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.replace(/[\r\n\t]+/g, " ").trim().slice(0, 80)
  return s.length ? s : null
}

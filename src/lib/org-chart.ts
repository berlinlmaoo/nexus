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
  return prisma.orgUnit.findFirst({ where: { id, workspaceId: ORG_WORKSPACE_ID }, select: { id: true, parentId: true, name: true, logoUrl: true, kind: true } })
}

/** "IP" carries a logo, "DIVISION" does not, "GROUP" only arranges cards (no logo, no people, no lead). */
export const UNIT_KINDS = ["IP", "DIVISION", "GROUP"] as const
export type UnitKind = (typeof UNIT_KINDS)[number]
export function isUnitKind(v: unknown): v is UnitKind {
  return typeof v === "string" && (UNIT_KINDS as readonly string[]).includes(v)
}

async function treeOf() {
  const rows = await prisma.orgUnit.findMany({ where: { workspaceId: ORG_WORKSPACE_ID }, select: { id: true, parentId: true, kind: true } })
  return new Map(rows.map((r) => [r.id, r]))
}

/**
 * The card a unit placed under `parentId` really belongs to: `parentId` itself, or — when that is a
 * group — the nearest card above the group(s). A group only arranges cards, so a card inside one is led
 * by a BoD/Manager of the card above the group.
 */
export async function effectiveParentId(parentId: string | null): Promise<string | null> {
  const byId = await treeOf()
  const seen = new Set<string>()
  let cur: string | null = parentId
  while (cur && !seen.has(cur)) {
    const r = byId.get(cur)
    if (!r) return null
    if (r.kind !== "GROUP") return cur
    seen.add(cur)
    cur = r.parentId
  }
  return null
}

/** True when `parentId` is a group or sits anywhere inside one. */
export async function insideGroup(parentId: string | null): Promise<boolean> {
  const byId = await treeOf()
  const seen = new Set<string>()
  let cur: string | null = parentId
  while (cur && !seen.has(cur)) {
    const r = byId.get(cur)
    if (!r) return false
    if (r.kind === "GROUP") return true
    seen.add(cur)
    cur = r.parentId
  }
  return false
}

/** Every unit below `unitId` (not `unitId` itself). */
export async function descendantIds(unitId: string): Promise<string[]> {
  const byId = await treeOf()
  const kids = new Map<string, string[]>()
  for (const r of byId.values()) if (r.parentId) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r.id])
  const out: string[] = []
  const seen = new Set<string>([unitId])
  const queue = [...(kids.get(unitId) ?? [])]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    queue.push(...(kids.get(id) ?? []))
  }
  return out
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

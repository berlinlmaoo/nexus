import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { ORG_WORKSPACE_ID } from "@/lib/org"

/**
 * Who may see the Pipeline Dashboard (owner/GM, 9 Oct 2026): "Board ini dari awal didesain buat BOD +
 * Agency + Management (IT, Legal, Finance) aja." The board holds every deal's money, so nobody else sees
 * it — not even a Manager, who otherwise sees every project of the workspace.
 *
 * Allowed: system admins, One Above All / BoD of the company workspace, and company members who sit in a
 * Bagan IP & Divisi card (OrgUnit) whose name — or the name of a card above it — contains one of
 * PIPELINE_UNIT_NAMES as a word, ignoring case. "Above it" because "Agency" is an IP card (Framework
 * Agency) whose people are mostly in the divisions under it (Multimedia, Project Management, …).
 *
 * Applied server-side in checkProjectAccess (every route of a PIPELINE project, the socket's project room)
 * and in project lists; clients read `canAccessPipeline` from GET /api/workspaces/members to draw the
 * "Pipeline" entry. Changing who is in which card on the Bagan changes access at once — nothing is cached.
 */
export const PIPELINE_UNIT_NAMES = ["Agency", "IT", "Legal", "Finance"] as const

/** "Finance & Tech" → ["finance", "tech"]; a unit matches when one of its words is an allowed name. */
export function isPipelineUnitName(name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean)
  return PIPELINE_UNIT_NAMES.some((allowed) => words.includes(allowed.toLowerCase()))
}

/** The ids of every company card that grants access: a matching card and every card below it. */
async function pipelineUnitIds(): Promise<Set<string>> {
  const units = await prisma.orgUnit.findMany({
    where: { workspaceId: ORG_WORKSPACE_ID },
    select: { id: true, name: true, parentId: true },
  })
  const byId = new Map(units.map((u) => [u.id, u]))
  const granted = new Set<string>()
  for (const unit of units) {
    // Walk up; the seen-set stops a parent loop (the chart forbids one, but a bad row must not hang a request).
    const seen = new Set<string>()
    for (let u: typeof unit | undefined = unit; u && !seen.has(u.id); u = u.parentId ? byId.get(u.parentId) : undefined) {
      seen.add(u.id)
      if (isPipelineUnitName(u.name)) { granted.add(unit.id); break }
    }
  }
  return granted
}

/** May this person see and edit the Pipeline Dashboard? */
export async function canAccessPipeline(userId: string): Promise<boolean> {
  const [user, member] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: ORG_WORKSPACE_ID } },
      select: { role: true },
    }),
  ])
  if (user?.role === "ADMIN") return true
  // Someone offboarded (no longer in the company workspace) keeps no access through an old Bagan row.
  if (!member) return false
  if (member.role === "ONE_ABOVE_ALL" || member.role === "BOD") return true
  const mine = await prisma.orgUnitMember.findMany({
    where: { userId, workspaceId: ORG_WORKSPACE_ID },
    select: { unitId: true },
  })
  if (mine.length === 0) return false
  const granted = await pipelineUnitIds()
  return mine.some((m) => granted.has(m.unitId))
}

/**
 * The company's one Pipeline board (owner/GM, 9 Oct 2026: "cuma satu papan/pipeline utama buat semua deal,
 * lintas BD dan brand"). The oldest PIPELINE project of the company workspace; null until it is created.
 */
export async function companyPipelineProject(): Promise<{ id: string; name: string } | null> {
  return prisma.project.findFirst({
    where: { workspaceId: ORG_WORKSPACE_ID, type: "PIPELINE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  })
}

/** A project-list filter: PIPELINE projects are left out for anyone who may not open them. */
export async function pipelineListFilter(userId: string): Promise<Prisma.ProjectWhereInput> {
  return (await canAccessPipeline(userId)) ? {} : { type: { not: "PIPELINE" } }
}

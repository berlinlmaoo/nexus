import prisma from "@/lib/prisma"

/**
 * Who a quest is for (owner decision 13 Oct 2026): divisions/units of the IP & Division Chart (OrgUnit),
 * replacing the retired Crew Hub teams. A quest with no units and no (legacy) teams is for everyone. A
 * person sees a unit's quest when they are in that unit OR in any unit below it (a sub-unit of a division
 * belongs to the division). Legacy `teamIds` still count for a team that exists. A quest can also be for chosen
 * people (`userIds`, owner 16 Oct 2026): a person listed there sees it, whatever their units.
 */
export type QuestAudience = { userId: string; teamIds: Set<string>; unitIds: Set<string> }

/** The teams and units a person counts as part of: their own units plus every unit above them. */
export async function audienceOf(userId: string): Promise<QuestAudience> {
  const [teams, placements] = await Promise.all([
    prisma.teamMember.findMany({ where: { userId }, select: { teamId: true } }),
    prisma.orgUnitMember.findMany({ where: { userId }, select: { unitId: true, workspaceId: true } }),
  ])
  const unitIds = new Set<string>()
  if (placements.length) {
    const units = await prisma.orgUnit.findMany({ where: { workspaceId: { in: [...new Set(placements.map((p) => p.workspaceId))] } }, select: { id: true, parentId: true } })
    const parentOf = new Map(units.map((u) => [u.id, u.parentId]))
    for (const p of placements) {
      let cur: string | null | undefined = p.unitId
      for (let hops = 0; cur && hops < 50 && !unitIds.has(cur); hops++) { unitIds.add(cur); cur = parentOf.get(cur) }
    }
  }
  return { userId, teamIds: new Set(teams.map((t) => t.teamId)), unitIds }
}

export function questVisibleTo(q: { teamIds?: string[] | null; unitIds?: string[] | null; userIds?: string[] | null }, a: QuestAudience): boolean {
  const teams = q.teamIds ?? []
  const units = q.unitIds ?? []
  const users = q.userIds ?? []
  if (teams.length === 0 && units.length === 0 && users.length === 0) return true
  return users.includes(a.userId) || teams.some((t) => a.teamIds.has(t)) || units.some((u) => a.unitIds.has(u))
}

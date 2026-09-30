import prisma from "@/lib/prisma"

/**
 * The Bagan Approval as a tree (WorkspaceMember.approverId = the person above).
 *
 * Owner's rules (30 Sep 2026): a manager sees and decides only the people directly under them; a BoD
 * sees and decides everyone in their own tree, at any time, and nothing of another BoD's tree; One
 * Above All sees everything, and is the one who decides a request from someone with nobody above
 * them (a BoD at the top of a tree). A request left undecided for 2 working days is told to the BoD
 * at the top of the requester's tree.
 */
export type ChartRow = { userId: string; role: string; approverId: string | null }

export async function loadChart(workspaceId: string): Promise<ChartRow[]> {
  return prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true, role: true, approverId: true },
  })
}

/** Everyone below `userId`, at any depth. Never includes `userId`; safe against a loop in the data. */
export function subtreeOf(userId: string, rows: ChartRow[]): string[] {
  const children = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.approverId || r.approverId === r.userId) continue
    const list = children.get(r.approverId) ?? []
    list.push(r.userId)
    children.set(r.approverId, list)
  }
  const seen = new Set<string>([userId])
  const out: string[] = []
  const queue = [...(children.get(userId) ?? [])]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    queue.push(...(children.get(id) ?? []))
  }
  return out
}

/** The highest BoD above `userId` in the chart (the top of their tree), or null when there is none. */
export function topBodOf(userId: string, rows: ChartRow[]): string | null {
  const byId = new Map(rows.map((r) => [r.userId, r]))
  const seen = new Set<string>([userId])
  let top: string | null = null
  let cur = byId.get(userId)?.approverId ?? null
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const row = byId.get(cur)
    if (row?.role === "BOD") top = cur
    cur = row?.approverId ?? null
  }
  return top
}

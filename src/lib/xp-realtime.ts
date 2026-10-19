import prisma from "@/lib/prisma"
import { emitXpChanged } from "@/lib/socket-emitter"

/**
 * Leaderboard realtime (QA final 19 Oct 2026, C-D2: "leaderboard MUST update in realtime when XP changes").
 *
 * Every XP change goes through lib/gamification applyXpDelta, which calls noteXpChanged inside its transaction.
 * Changes are gathered for FLUSH_MS and sent as ONE `xp-changed` { userIds } per workspace those people are in:
 * the per-minute late accrual touches many people at once and must not become one refetch per person. The
 * delay also lets the caller's transaction commit before clients refetch. A rolled-back change costs one
 * needless refetch, nothing more.
 */
const FLUSH_MS = 1500

const g = globalThis as unknown as { __nexusXpRealtime?: { users: Set<string>; timer: ReturnType<typeof setTimeout> | null } }
function state() {
  if (!g.__nexusXpRealtime) g.__nexusXpRealtime = { users: new Set(), timer: null }
  return g.__nexusXpRealtime
}

export function noteXpChanged(userId: string): void {
  if (!userId) return
  const s = state()
  s.users.add(userId)
  if (s.timer) return
  s.timer = setTimeout(() => void flush(), FLUSH_MS)
  s.timer.unref?.()
}

async function flush(): Promise<void> {
  const s = state()
  s.timer = null
  const userIds = [...s.users]
  s.users.clear()
  if (!userIds.length) return
  try {
    const rows = await prisma.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true, userId: true } })
    const byWs = new Map<string, string[]>()
    for (const r of rows) byWs.set(r.workspaceId, [...(byWs.get(r.workspaceId) ?? []), r.userId])
    for (const [ws, ids] of byWs) emitXpChanged([ws], ids)
  } catch (error) {
    console.warn("[xp-realtime] flush failed", error)
  }
}

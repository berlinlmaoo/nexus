import type { Prisma } from "@/generated/prisma"

/** The columns every day-off-bonus response carries (GET list, POST result, DELETE result). */
export const DAY_OFF_BONUS_SELECT = {
  id: true,
  workspaceId: true,
  userId: true,
  periodKey: true,
  days: true,
  reason: true,
  createdAt: true,
  revokedAt: true,
  user: { select: { id: true, name: true, email: true, avatar: true } },
  grantedBy: { select: { id: true, name: true } },
  revokedBy: { select: { id: true, name: true } },
} satisfies Prisma.DayOffBonusSelect

export type DayOffBonusRow = Prisma.DayOffBonusGetPayload<{ select: typeof DAY_OFF_BONUS_SELECT }>

/**
 * Wire shape (stable — the iOS client decodes it):
 *   { id, userId, user: {id, name, email, avatar} | null, periodKey, days, reason,
 *     createdAt (ISO), grantedBy: {id, name} | null, revokedAt (ISO) | null, revokedBy: {id, name} | null,
 *     active: boolean }
 */
export function serializeDayOffBonus(row: DayOffBonusRow) {
  return {
    id: row.id,
    userId: row.userId,
    user: row.user ? { id: row.user.id, name: row.user.name, email: row.user.email, avatar: row.user.avatar } : null,
    periodKey: row.periodKey,
    days: row.days,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    grantedBy: row.grantedBy ? { id: row.grantedBy.id, name: row.grantedBy.name } : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedBy: row.revokedBy ? { id: row.revokedBy.id, name: row.revokedBy.name } : null,
    active: row.revokedAt === null,
  }
}

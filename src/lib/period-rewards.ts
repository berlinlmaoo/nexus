/**
 * RETIRED — the monthly attendance reward (zero-alpha +50 bonus + Excellent/Good/Review tier
 * perks) was removed. XP is now 100% quest-only (assigned by BoD). Kept as a no-op so the
 * /api/attendance/xp-rewards route (and any cron reference) stay valid without awarding anything.
 */
export async function applyMonthlyXpRewards(workspaceId: string, monthKey: string) {
  return { workspaceId, monthKey, members: 0, rewarded: 0, disabled: true as const }
}

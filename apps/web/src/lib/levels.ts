// NEXUS Phaëthon — level tiers + XP curve. Mirror of backend src/lib/gamification.ts LEVELS.
// `floor` = the period score required to BE at that level (the level is the period's level only).

export type LevelTier = { level: number; name: string; floor: number };

// Period-based scoring: everyone starts each period at 1000 XP = Diamond. The period runs from the
// 28th 00:00 WIB to the 27th, like attendance (server: LEADERBOARD_RESET_DAY, leaderboard `resetDay`).
// Quests and BoD adjustments move a score up; attendance penalties and BoD adjustments move it down.
export const PERIOD_BASELINE_XP = 1000;
export const LEVELS: LevelTier[] = [
  { level: 1, name: "Iron", floor: 0 },
  { level: 2, name: "Bronze", floor: 200 },
  { level: 3, name: "Silver", floor: 400 },
  { level: 4, name: "Gold", floor: 600 },
  { level: 5, name: "Platinum", floor: 800 },
  { level: 6, name: "Diamond", floor: 1000 },
  { level: 7, name: "Master", floor: 1150 },
  { level: 8, name: "Elite", floor: 1280 },
  { level: 9, name: "Supreme", floor: 1400 },
  { level: 10, name: "Anak Kesayangan AA", floor: 1500 },
];

export type LevelInfo = {
  level: number;
  name: string;
  floor: number;
  nextFloor: number | null; // null = max tier
  intoLevel: number;        // XP accumulated within the current tier
  span: number;             // XP span of the current tier (0 at max)
  pct: number;              // 0..100 progress to next tier (100 at max)
  isMax: boolean;
};

export function levelForXp(totalXp: number): LevelInfo {
  const xp = Math.max(0, Math.floor(totalXp || 0));
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].floor) idx = i;
  }
  const tier = LEVELS[idx];
  const next = LEVELS[idx + 1] ?? null;
  const isMax = !next;
  const span = next ? next.floor - tier.floor : 0;
  const intoLevel = xp - tier.floor;
  const pct = isMax ? 100 : Math.min(100, Math.round((intoLevel / span) * 100));
  return { level: tier.level, name: tier.name, floor: tier.floor, nextFloor: next?.floor ?? null, intoLevel, span, pct, isMax };
}

/** Short tier emoji for flair (no extra assets needed). */
export function tierEmoji(level: number): string {
  return ["🔩", "🥉", "🥈", "🥇", "💠", "💎", "🔱", "👑", "🏆", "⭐"][Math.max(0, Math.min(9, level - 1))];
}

/**
 * A level as people read it, one format everywhere: "Level 6 · Diamond" (UI tour run 11, WM-17: the
 * leaderboard said "Level 5 – Platinum" and the dashboard "6 · Diamond"). Both come from the same score
 * (baseline 1000 ± this period's XP) and the same table; only the wording differed.
 */
export function levelLabel(level: number, name: string | null | undefined, t: (key: string, vars?: Record<string, string | number>) => string): string {
  return name ? t("Level {n} · {name}", { n: level, name }) : t("Level {n}", { n: level });
}

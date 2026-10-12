// Standard competition ranking ("1224") for the Leaderboard (owner decision via QA 13 Oct 2026): equal XP
// shares a rank and the next rank skips (1, 1, 1, 4…). Within a tie people are listed by name; the order
// says nothing about who is "ahead". Before, seven people at 1,000 XP got ranks 1–7 and three of them crowns.

export type Ranked<T> = T & { rank: number };

/** Sort by `score` (high first), then by `name` (A–Z, case-insensitive, Indonesian collation), and rank. */
export function competitionRank<T>(rows: T[], score: (r: T) => number, name: (r: T) => string): Ranked<T>[] {
  const sorted = rows.slice().sort((a, b) => score(b) - score(a) || name(a).localeCompare(name(b), "id", { sensitivity: "base" }));
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || score(r) !== score(sorted[i - 1])) rank = i + 1;
    return { ...r, rank };
  });
}

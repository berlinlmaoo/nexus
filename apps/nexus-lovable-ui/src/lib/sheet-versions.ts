// Version history (File ▸ Version history) built from the per-cell revision log. Sheets shows
// "versions": bursts of edits close together in time, grouped by day, newest first, with named
// versions kept apart. Looking at a version = the current cells with every later edit undone.
// Pure; tested in sheet-versions.test.mjs.

/** The fields of NexusSheetRevision this file needs (kept structural so the lib has no app imports). */
export type RevisionLike = {
  id?: string;
  rowId: string;
  columnId: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  author: { id: string; name: string | null } | null;
};
export type NamedVersionLike = { id?: string; name: string; at: string };
export type VersionAuthor = { id: string; name: string | null };
export type VersionEntry = {
  /** ISO time of the version's last edit — the id used to select, name and restore it. */
  at: string;
  /** ISO time of its first edit. */
  from: string;
  authors: VersionAuthor[];
  /** Edits in this version. */
  count: number;
  name?: string;
  /** The newest version ("Current version"). */
  current?: true;
};
export type VersionDay = { day: string; versions: VersionEntry[] };

const ms = (iso: string) => new Date(iso).getTime();

/** YYYY-MM-DD of an instant at a fixed UTC offset (Asia/Jakarta, +420 minutes, by default). */
export function dayKey(iso: string, offsetMinutes = 420): string {
  const d = new Date(ms(iso) + offsetMinutes * 60_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Group revisions into versions. A new version starts when consecutive edits are `gapMinutes` or more
 * apart, at a day boundary, and at every named version (so naming a version keeps it whole even when
 * more edits follow a minute later). Days and versions come newest first; the first one is current.
 */
export function groupVersions(
  revisions: RevisionLike[],
  named: NamedVersionLike[] = [],
  opts: { gapMinutes?: number; offsetMinutes?: number } = {},
): VersionDay[] {
  const gap = (opts.gapMinutes ?? 30) * 60_000;
  const offset = opts.offsetMinutes ?? 420;
  const revs = [...revisions].filter((r) => Number.isFinite(ms(r.createdAt))).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const cuts = named.map((n) => ms(n.at)).filter(Number.isFinite);
  const bursts: RevisionLike[][] = [];
  for (const r of revs) {
    const cur = bursts[bursts.length - 1];
    const prev = cur?.[cur.length - 1];
    const split = !prev
      || ms(prev.createdAt) - ms(r.createdAt) >= gap
      || dayKey(prev.createdAt, offset) !== dayKey(r.createdAt, offset)
      || cuts.some((c) => ms(r.createdAt) <= c && c < ms(prev.createdAt));
    if (split) bursts.push([r]); else cur.push(r);
  }
  const versions: VersionEntry[] = bursts.map((b) => {
    const authors = new Map<string, VersionAuthor>();
    for (const r of b) {
      const id = r.author?.id ?? "";
      if (!authors.has(id)) authors.set(id, { id, name: r.author?.name ?? null });
    }
    return { at: b[0].createdAt, from: b[b.length - 1].createdAt, authors: [...authors.values()], count: b.length };
  });
  // A name sits on the newest version at or before its time; the latest naming wins.
  const sortedNames = [...named].sort((a, b) => ms(a.at) - ms(b.at));
  for (const n of sortedNames) {
    const v = versions.find((x) => ms(x.at) <= ms(n.at));
    if (v) v.name = n.name;
  }
  if (versions[0]) versions[0].current = true;
  const days: VersionDay[] = [];
  for (const v of versions) {
    const day = dayKey(v.at, offset);
    const last = days[days.length - 1];
    if (last && last.day === day) last.versions.push(v); else days.push({ day, versions: [v] });
  }
  return days;
}

type RowLike = { id: string; cells: Record<string, unknown> };
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isBlank = (v: unknown) => v === null || v === undefined;

/**
 * The cells as they were at `at`: start from the current rows and undo every revision made after
 * `at`, newest first (cell = oldValue; null removes it). Revisions for rows that no longer exist are
 * skipped. `changed` lists "rowId:colId" of every cell that differs from now.
 */
export function stateAt<R extends RowLike>(rows: R[], revisions: RevisionLike[], at: string): { rows: R[]; changed: Set<string> } {
  const t = ms(at);
  const out = rows.map((r) => ({ ...r, cells: { ...r.cells } }));
  const byId = new Map(out.map((r) => [r.id, r]));
  const later = revisions.filter((r) => ms(r.createdAt) > t).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const touched = new Set<string>();
  for (const rev of later) {
    const row = byId.get(rev.rowId);
    if (!row) continue;
    if (isBlank(rev.oldValue)) delete row.cells[rev.columnId];
    else row.cells[rev.columnId] = rev.oldValue;
    touched.add(`${rev.rowId}:${rev.columnId}`);
  }
  const changed = new Set<string>();
  for (const key of touched) {
    const [rowId, colId] = splitKey(key);
    const now = rows.find((r) => r.id === rowId)?.cells[colId];
    if (!same(now, byId.get(rowId)?.cells[colId])) changed.add(key);
  }
  return { rows: out, changed };
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(":");
  return [key.slice(0, i), key.slice(i + 1)];
}

/** "rowId:colId" of every cell edited after `at` (exclusive), mapped to the last editor's id. */
export function changedSince(revisions: RevisionLike[], at: string): Map<string, string> {
  return changedBetween(revisions, at, null);
}

/**
 * Cells edited in (after, upTo] — the "Show changes" highlight for one version is
 * changedBetween(revisions, <previous version's at>, version.at). Values are the editor's id of the
 * latest such edit ("" when the account was deleted), so the grid can tint by person.
 */
export function changedBetween(revisions: RevisionLike[], after: string | null, upTo: string | null): Map<string, string> {
  const a = after ? ms(after) : -Infinity;
  const b = upTo ? ms(upTo) : Infinity;
  const out = new Map<string, string>();
  const sorted = [...revisions].sort((x, y) => ms(x.createdAt) - ms(y.createdAt));
  for (const r of sorted) {
    const t = ms(r.createdAt);
    if (t > a && t <= b) out.set(`${r.rowId}:${r.columnId}`, r.author?.id ?? "");
  }
  return out;
}

/** The `at` of the version just before `at` in a grouped list, or null for the oldest one. */
export function previousVersionAt(days: VersionDay[], at: string): string | null {
  const all = days.flatMap((d) => d.versions);
  const i = all.findIndex((v) => v.at === at);
  return i >= 0 && i + 1 < all.length ? all[i + 1].at : null;
}

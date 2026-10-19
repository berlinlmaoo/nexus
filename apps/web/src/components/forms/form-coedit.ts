/**
 * Live co-editing of a form in the builder (A-12, 19 Oct 2026) — the client half, pure.
 *
 * The builder keeps three copies:
 *   base   the form as the server last told us (an ops reply or a `form-ops` event), at `version`
 *   draft  what is on screen (base + this person's edits that are not saved yet or still in flight)
 *   theirs a newer server copy arriving (someone else's change, or our own reply)
 *
 * diffOps(base, draft) is what a save sends: only what this person changed, as field-level ops.
 * rebaseDraft(base, draft, theirs) is the new screen when a newer copy arrives: every part this person did
 * NOT change takes theirs; every part they changed (typing not saved yet, a save in flight) stays theirs —
 * the person's — so a remote change never steals the text under the caret. Same part changed by both: the
 * local one stays on screen and goes out with the next save, i.e. last writer wins at field level, the same
 * rule the server applies (src/lib/form-ops.ts).
 *
 * Parts: name, description, isPublic, requireAuth, accessSchedule, each key of branding and of settings,
 * each key of each question, the question order, the question set (adds / deletes).
 */
import type { FormDraft, RichField } from "./form-model";

/** What a save writes (payloadOf in FormStudio): cleaned fields, the title placeholder, null description. */
export type FormPayload = {
  name: string;
  description: string | null;
  fields: RichField[];
  isPublic: boolean;
  requireAuth: boolean;
  accessSchedule: Record<string, unknown> | null;
  branding: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
};

export type FormOp =
  | { op: "set_title"; value: string }
  | { op: "set_description"; value: string | null }
  | { op: "set_settings"; isPublic?: boolean; requireAuth?: boolean; accessSchedule?: Record<string, unknown> | null; branding?: Record<string, unknown> | null; settings?: Record<string, unknown> | null }
  | { op: "add_question"; question: RichField; afterId?: string | null }
  | { op: "update_question"; id: string; fields: Record<string, unknown>; unset?: string[] }
  | { op: "move_question"; id: string; afterId: string | null }
  | { op: "delete_question"; id: string };

/** JSON with sorted keys: two objects with the same content compare equal whatever order their keys were set in. */
export function stable(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}
export const same = (a: unknown, b: unknown) => stable(a ?? null) === stable(b ?? null);
const keysOf = (...objs: (Record<string, unknown> | null | undefined)[]) => Array.from(new Set(objs.flatMap((o) => (o ? Object.keys(o) : [])))).filter((k) => k !== "id");

/** Patch that turns `from` into `to`, key by key (null = remove the key). null when equal. */
function objectPatch(from: Record<string, unknown> | null, to: Record<string, unknown> | null): Record<string, unknown> | null | undefined {
  if (same(from, to)) return undefined;
  if (!to || Object.keys(to).length === 0) return null;
  const patch: Record<string, unknown> = {};
  for (const k of keysOf(from, to)) {
    const a = from?.[k], b = to[k];
    if (same(a, b)) continue;
    patch[k] = b === undefined ? null : b;
  }
  return patch;
}

/** Longest increasing subsequence (indexes into `seq`): the questions that keep their place in a reorder. */
function lis(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (seq[tails[mid]] < seq[i]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) { keep.add(k); k = prev[k]; }
  return keep;
}

/** The ops that turn the server's copy (`base`) into this person's (`mine`). Both are save payloads. */
export function diffOps(base: FormPayload, mine: FormPayload): FormOp[] {
  const ops: FormOp[] = [];
  if (mine.name !== base.name) ops.push({ op: "set_title", value: mine.name });
  if ((mine.description ?? null) !== (base.description ?? null)) ops.push({ op: "set_description", value: mine.description ?? null });

  const settings: Extract<FormOp, { op: "set_settings" }> = { op: "set_settings" };
  if (mine.isPublic !== base.isPublic) settings.isPublic = mine.isPublic;
  if (mine.requireAuth !== base.requireAuth) settings.requireAuth = mine.requireAuth;
  if (!same(mine.accessSchedule, base.accessSchedule)) settings.accessSchedule = mine.accessSchedule ?? null;
  const branding = objectPatch(base.branding, mine.branding);
  if (branding !== undefined) settings.branding = branding;
  const formSettings = objectPatch(base.settings, mine.settings);
  if (formSettings !== undefined) settings.settings = formSettings;
  if (Object.keys(settings).length > 1) ops.push(settings);

  const baseById = new Map(base.fields.map((f) => [f.id, f]));
  const mineIds = new Set(mine.fields.map((f) => f.id));
  // Deletes first, so a re-add of the same id (undo) after a delete still lands in one batch.
  for (const f of base.fields) if (!mineIds.has(f.id)) ops.push({ op: "delete_question", id: f.id });
  // Order as the server will have it after the deletes and adds below.
  const sim: string[] = base.fields.filter((f) => mineIds.has(f.id)).map((f) => f.id);
  mine.fields.forEach((f, i) => {
    const prev = baseById.get(f.id);
    if (!prev) {
      const afterId = i === 0 ? null : mine.fields[i - 1].id;
      ops.push({ op: "add_question", question: f, afterId });
      const at = afterId === null ? 0 : sim.indexOf(afterId) + 1;
      sim.splice(at < 0 ? sim.length : at, 0, f.id);
      return;
    }
    const fields: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const k of keysOf(prev as Record<string, unknown>, f as Record<string, unknown>)) {
      const a = (prev as Record<string, unknown>)[k], b = (f as Record<string, unknown>)[k];
      if (same(a, b) && (a === undefined) === (b === undefined)) continue;
      if (b === undefined) unset.push(k);
      else fields[k] = b;
    }
    if (Object.keys(fields).length || unset.length) ops.push({ op: "update_question", id: f.id, fields, ...(unset.length ? { unset } : {}) });
  });
  // Reorder: the questions on the longest run already in order stay; each other one moves after its
  // predecessor in `mine` (in mine's order, so every anchor is already where it belongs).
  const want = mine.fields.map((f) => f.id);
  const pos = new Map(sim.map((id, i) => [id, i]));
  const keep = lis(want.map((id) => pos.get(id) ?? -1));
  want.forEach((id, i) => { if (!keep.has(i)) ops.push({ op: "move_question", id, afterId: i === 0 ? null : want[i - 1] }); });
  return ops;
}

/** Each key of a question: mine if I changed it since base, else theirs. */
function mergeQuestion(base: RichField, mine: RichField, theirs: RichField): RichField {
  const out: Record<string, unknown> = { id: mine.id };
  const b = base as Record<string, unknown>, m = mine as Record<string, unknown>, t = theirs as Record<string, unknown>;
  for (const k of keysOf(b, m, t)) {
    const v = same(m[k], b[k]) && (m[k] === undefined) === (b[k] === undefined) ? t[k] : m[k];
    if (v !== undefined) out[k] = v;
  }
  return out as RichField;
}

function mergeObject(base: Record<string, unknown> | null, mine: Record<string, unknown> | null, theirs: Record<string, unknown> | null) {
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  const out: Record<string, unknown> = {};
  for (const k of keysOf(base, mine, theirs)) {
    const v = same(mine?.[k], base?.[k]) ? theirs?.[k] : mine?.[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function mergeOrder(baseIds: string[], mineIds: string[], theirIds: string[], keepIds: Set<string>): string[] {
  const common = (list: string[], other: Set<string>) => list.filter((id) => other.has(id));
  const baseSet = new Set(baseIds), mineSet = new Set(mineIds);
  const iReordered = !same(common(mineIds, baseSet), common(baseIds, mineSet));
  // The order everything follows: mine when I moved something, else theirs.
  const lead = iReordered ? mineIds : theirIds;
  const other = iReordered ? theirIds : mineIds;
  const out = lead.filter((id) => keepIds.has(id));
  // Questions only the other side has: right after their predecessor there (or first).
  other.forEach((id, i) => {
    if (!keepIds.has(id) || out.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const p = out.indexOf(other[j]); if (p >= 0) { at = p + 1; break; } }
    out.splice(at, 0, id);
  });
  return out;
}

/**
 * The screen after a newer server copy (`theirs`) arrives, keeping every local change made on top of `base`.
 * A question I deleted stays deleted; one I added stays; one THEY deleted goes, even if I edited it (the
 * server skips an edit of a deleted question: delete wins).
 */
export function rebaseDraft(base: FormDraft, mine: FormDraft, theirs: FormDraft): FormDraft {
  const pick = <K extends keyof FormDraft>(k: K): FormDraft[K] => (same(mine[k], base[k]) ? theirs[k] : mine[k]);
  const baseById = new Map(base.fields.map((f) => [f.id, f]));
  const mineById = new Map(mine.fields.map((f) => [f.id, f]));
  const theirById = new Map(theirs.fields.map((f) => [f.id, f]));
  const keep = new Set<string>();
  for (const f of theirs.fields) if (mineById.has(f.id) || !baseById.has(f.id)) keep.add(f.id); // not deleted by me
  for (const f of mine.fields) if (!baseById.has(f.id)) keep.add(f.id); // added by me
  const order = mergeOrder(base.fields.map((f) => f.id), mine.fields.map((f) => f.id), theirs.fields.map((f) => f.id), keep);
  const fields = order.map((id) => {
    const m = mineById.get(id), t = theirById.get(id), b = baseById.get(id);
    if (m && t && b) return mergeQuestion(b, m, t);
    return (m ?? t)!;
  });
  return {
    name: pick("name"),
    description: pick("description"),
    isPublic: pick("isPublic"),
    requireAuth: pick("requireAuth"),
    accessSchedule: pick("accessSchedule"),
    branding: mergeObject(base.branding as Record<string, unknown> | null, mine.branding as Record<string, unknown> | null, theirs.branding as Record<string, unknown> | null) as FormDraft["branding"],
    settings: mergeObject(base.settings, mine.settings, theirs.settings),
    fields,
  };
}

/** Question ids a newer copy changed (for a brief highlight of someone else's edit). */
export function changedQuestionIds(before: FormDraft, after: FormDraft): string[] {
  const prev = new Map(before.fields.map((f) => [f.id, f]));
  return after.fields.filter((f) => !same(prev.get(f.id), f)).map((f) => f.id);
}

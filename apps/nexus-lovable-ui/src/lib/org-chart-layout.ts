/**
 * Bagan IP & Divisi — layout engine. Pure: no React, no DOM, so it can be tested on its own.
 *
 * 1. tidyLayout: a tidy tree built bottom-up from MEASURED sizes. A card's own block is the card with
 *    its BoD and Manager boxes stacked under it; its row (sub-units, the staff box in the middle, the
 *    "di bawah" boxes) sits under that block, side by side and centred; a group is a frame around its
 *    own row. Blocks never overlap by construction.
 * 2. applyManual: manual positions move a card's whole subtree (or one box). Anything that would then
 *    overlap something else is pushed to the nearest free place (8px grid), so the chart never stacks.
 * 3. route: right-angled connectors that go round cards and boxes instead of through them.
 */
export type Size = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export const LAYOUT = {
  margin: 24,
  rootGap: 56,
  gapX: 28,
  vOwn: 20,
  bandMin: 48,
  gPadX: 22,
  gPadTop: 12,
  gBand: 38,
  gPadBottom: 20,
  gEmpty: 46,
  gMinW: 200,
  snap: 8,
  /** Room kept between a moved item and everything else. */
  clear: 16,
} as const;

export type TreeSpec = {
  roots: string[];
  isGroup: (id: string) => boolean;
  /** Non-group: its card and BoD/Manager boxes, top to bottom ("c:<id>", "b:<id>:bod", "b:<id>:manager"). */
  stack: (id: string) => string[];
  /** Items of the row under a card ("u:<childId>" or a box key) or inside a group ("u:<childId>"), left to right. */
  row: (id: string) => string[];
  /** Vertical room between a card's own block and its row, for the connectors. */
  band: (id: string) => number;
  /** Measured size of "c:<id>" (cards), "b:…" (boxes) and "t:<groupId>" (group titles). */
  size: (key: string) => Size;
};

export type Placement = {
  /** "c:<id>" is a card, or a group's frame; "t:<id>" a group's title; "b:…" a people box. */
  rects: Map<string, Rect>;
  /** Unit id → every element key of its block (itself and everything below it). */
  subtree: Map<string, string[]>;
  width: number;
  height: number;
};

type Block = { w: number; h: number; items: Array<[string, Rect]> };

export function tidyLayout(spec: TreeSpec): Placement {
  const subtree = new Map<string, string[]>();
  const visiting = new Set<string>();
  const put = (items: Array<[string, Rect]>, b: Block, dx: number, dy: number) => {
    for (const [k, r] of b.items) items.push([k, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }]);
  };
  const leaf = (key: string): Block => {
    const s = spec.size(key);
    return { w: s.w, h: s.h, items: [[key, { x: 0, y: 0, w: s.w, h: s.h }]] };
  };
  function unit(id: string): Block {
    if (visiting.has(id)) return { w: 0, h: 0, items: [] }; // a loop in the data: drawn once
    visiting.add(id);
    const kids = spec.row(id).map((k) => (k.startsWith("u:") ? unit(k.slice(2)) : leaf(k))).filter((b) => b.w > 0);
    const rowW = kids.reduce((s, b) => s + b.w, 0) + LAYOUT.gapX * Math.max(0, kids.length - 1);
    const rowH = kids.reduce((m, b) => Math.max(m, b.h), 0);
    const items: Array<[string, Rect]> = [];
    let w: number;
    let h: number;
    let rowTop: number;
    if (spec.isGroup(id)) {
      const t = spec.size(`t:${id}`);
      w = Math.max(t.w, rowW, LAYOUT.gMinW - 2 * LAYOUT.gPadX) + 2 * LAYOUT.gPadX;
      rowTop = LAYOUT.gPadTop + t.h + LAYOUT.gBand;
      h = kids.length ? rowTop + rowH + LAYOUT.gPadBottom : LAYOUT.gPadTop + t.h + LAYOUT.gEmpty;
      items.push([`c:${id}`, { x: 0, y: 0, w, h }], [`t:${id}`, { x: (w - t.w) / 2, y: LAYOUT.gPadTop, w: t.w, h: t.h }]);
    } else {
      const stack = spec.stack(id).map((k) => [k, spec.size(k)] as const);
      const ownW = Math.max(0, ...stack.map(([, s]) => s.w));
      const ownH = stack.reduce((s, [, z]) => s + z.h, 0) + LAYOUT.vOwn * Math.max(0, stack.length - 1);
      w = Math.max(ownW, rowW);
      let y = 0;
      for (const [k, s] of stack) {
        items.push([k, { x: (w - s.w) / 2, y, w: s.w, h: s.h }]);
        y += s.h + LAYOUT.vOwn;
      }
      rowTop = ownH + (kids.length ? Math.max(LAYOUT.bandMin, spec.band(id)) : 0);
      h = kids.length ? rowTop + rowH : ownH;
    }
    let x = (w - rowW) / 2;
    for (const b of kids) {
      put(items, b, x, rowTop);
      x += b.w + LAYOUT.gapX;
    }
    visiting.delete(id);
    subtree.set(id, items.map(([k]) => k));
    return { w, h, items };
  }
  const rects = new Map<string, Rect>();
  let x = LAYOUT.margin;
  let height = 0;
  for (const id of spec.roots) {
    const b = unit(id);
    if (b.w <= 0) continue;
    for (const [k, r] of b.items) rects.set(k, { x: Math.round(r.x + x), y: Math.round(r.y + LAYOUT.margin), w: r.w, h: r.h });
    x += b.w + LAYOUT.rootGap;
    height = Math.max(height, b.h);
  }
  return { rects, subtree, width: Math.max(0, x - LAYOUT.rootGap) + LAYOUT.margin, height: height + 2 * LAYOUT.margin };
}

// ── manual positions ────────────────────────────────────────────────────────────────────────────

export type ManualItem = {
  /** Id this item is reported under (the card's unit id, or the box key). */
  id: string;
  /** Elements that move together (a card's whole subtree, or one box). */
  keys: string[];
  /** The element whose top-left is `pos`. */
  anchor: string;
  pos: Pt;
  /** Push it to the nearest free place when it lands on something. */
  resolve: boolean;
};

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}
export function bboxOf(rs: Rect[]): Rect {
  const x1 = Math.min(...rs.map((r) => r.x)), y1 = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
const up8 = (v: number) => Math.ceil(v / LAYOUT.snap) * LAYOUT.snap;
const down8 = (v: number) => Math.floor(v / LAYOUT.snap) * LAYOUT.snap;

/**
 * The nearest top-left for `box` (8px grid, never left of / above the margin) where it keeps
 * LAYOUT.clear away from every rect in `others`.
 */
export function nearestFree(box: Rect, others: Rect[]): Pt {
  const G = LAYOUT.clear;
  const xs = new Set<number>([Math.max(LAYOUT.margin, Math.round(box.x))]);
  const ys = new Set<number>([Math.max(LAYOUT.margin, Math.round(box.y))]);
  for (const o of others) {
    xs.add(up8(o.x + o.w + G));
    xs.add(down8(o.x - box.w - G));
    ys.add(up8(o.y + o.h + G));
    ys.add(down8(o.y - box.h - G));
  }
  const cands: Array<{ x: number; y: number; d: number }> = [];
  for (const x of xs) {
    if (x < LAYOUT.margin) continue;
    for (const y of ys) {
      if (y < LAYOUT.margin) continue;
      cands.push({ x, y, d: (x - box.x) ** 2 + (y - box.y) ** 2 });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const r = { x: c.x, y: c.y, w: box.w, h: box.h };
    if (!others.some((o) => overlaps(r, o, G - 1))) return { x: c.x, y: c.y };
  }
  const right = Math.max(LAYOUT.margin, ...others.map((o) => o.x + o.w));
  return { x: up8(right + G), y: Math.max(LAYOUT.margin, Math.round(box.y)) };
}

/**
 * Apply manual positions in order. An item with `resolve` that ends up closer than half the clearance
 * to anything outside itself moves, as a whole, to the nearest free place.
 */
export function applyManual(base: Map<string, Rect>, items: ManualItem[]): { rects: Map<string, Rect>; resolved: Map<string, Pt> } {
  const rects = new Map(base);
  const resolved = new Map<string, Pt>();
  const shift = (keys: string[], dx: number, dy: number) => {
    if (!dx && !dy) return;
    for (const k of keys) {
      const r = rects.get(k);
      if (r) rects.set(k, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
    }
  };
  for (const it of items) {
    const a = rects.get(it.anchor);
    if (!a) continue;
    const keys = it.keys.filter((k) => rects.has(k));
    shift(keys, Math.round(it.pos.x - a.x), Math.round(it.pos.y - a.y));
    if (it.resolve && keys.length) {
      const mine = new Set(keys);
      const others: Rect[] = [];
      for (const [k, r] of rects) if (!mine.has(k)) others.push(r);
      const moved = keys.map((k) => rects.get(k)!);
      const half = LAYOUT.clear / 2;
      if (moved.some((m) => m.x < 0 || m.y < 0 || others.some((o) => overlaps(m, o, half)))) {
        const box = bboxOf(moved);
        const to = nearestFree(box, others);
        shift(keys, to.x - box.x, to.y - box.y);
      }
    }
    const fa = rects.get(it.anchor)!;
    resolved.set(it.id, { x: fa.x, y: fa.y });
  }
  return { rects, resolved };
}

// ── connectors ──────────────────────────────────────────────────────────────────────────────────

/** Does the axis-parallel segment a–b run through the inside of `r` (touching an edge is fine)? */
export function segmentHits(a: Pt, b: Pt, r: Rect): boolean {
  const e = 1;
  if (Math.abs(a.x - b.x) < 0.5) {
    if (a.x <= r.x + e || a.x >= r.x + r.w - e) return false;
    return Math.max(a.y, b.y) > r.y + e && Math.min(a.y, b.y) < r.y + r.h - e;
  }
  if (a.y <= r.y + e || a.y >= r.y + r.h - e) return false;
  return Math.max(a.x, b.x) > r.x + e && Math.min(a.x, b.x) < r.x + r.w - e;
}
function hitsOf(pts: Pt[], obstacles: Rect[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) for (const o of obstacles) if (segmentHits(pts[i - 1], pts[i], o)) n++;
  return n;
}
function lengthOf(pts: Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return n;
}
function tidyPath(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = out[out.length - 1];
    if (last && last.x === q.x && last.y === q.y) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((prev.x === last.x && last.x === q.x) || (prev.y === last.y && last.y === q.y))) out[out.length - 1] = q;
    else out.push(q);
  }
  return out;
}

/**
 * Right-angled path from s (the bottom of the source) to t (the top of the target). First choice: down,
 * across at `prefY`, down. When that runs through something: other heights, then a detour down–across–
 * (up or down)–across–down along a free column. `quick` skips the search (while dragging).
 */
export function route(s: Pt, t: Pt, obstacles: Rect[], prefY: number, quick = false): Pt[] {
  const elbow = (my: number): Pt[] => [s, { x: s.x, y: my }, { x: t.x, y: my }, t];
  const below = t.y > s.y + 8;
  const clampY = (y: number) => Math.min(t.y - 4, Math.max(s.y + 4, y));
  if (quick) return tidyPath(below ? elbow(clampY(prefY)) : [s, { x: s.x, y: s.y + 12 }, { x: t.x, y: s.y + 12 }, t]);

  const first: Pt[][] = [];
  if (below) {
    const mys = [prefY, t.y - 16, s.y + 12, (s.y + t.y) / 2];
    for (const o of obstacles) {
      if (o.y > s.y && o.y < t.y) mys.push(o.y - 10);
      const ob = o.y + o.h;
      if (ob > s.y && ob < t.y) mys.push(ob + 10);
    }
    for (const my of mys) if (my > s.y + 3 && my < t.y - 3) first.push(elbow(my));
  }
  for (const p of first) if (hitsOf(p, obstacles) === 0) return tidyPath(p);

  const around: Pt[][] = [];
  const yas = [s.y + 12, s.y + 8, s.y + 18];
  const ybs = [prefY, t.y - 12, t.y - 18, t.y - 8].filter((y) => y < t.y - 3);
  const xcs = new Set<number>([s.x, t.x]);
  for (const o of obstacles) { xcs.add(o.x - 12); xcs.add(o.x + o.w + 12); }
  for (const ya of yas) for (const yb of ybs) for (const xc of xcs) {
    around.push([s, { x: s.x, y: ya }, { x: xc, y: ya }, { x: xc, y: yb }, { x: t.x, y: yb }, t]);
  }
  around.sort((a, b) => lengthOf(a) - lengthOf(b));
  for (const p of around) if (hitsOf(p, obstacles) === 0) return tidyPath(p);

  const maze = mazeRoute(s, t, obstacles);
  if (maze) return tidyPath(maze);

  const all = [...first, ...around];
  let best = all[0] ?? elbow((s.y + t.y) / 2);
  let bestHits = Infinity;
  for (const p of all) {
    const h = hitsOf(p, obstacles);
    if (h < bestHits || (h === bestHits && lengthOf(p) < lengthOf(best))) { best = p; bestHits = h; }
  }
  return tidyPath(best);
}

/**
 * Last resort when no simple shape is clear: the shortest right-angled path (few bends preferred) over
 * a grid made of the obstacles' edges, leaving the source downwards and entering the target from above.
 */
function mazeRoute(s: Pt, t: Pt, obstacles: Rect[]): Pt[] | null {
  const pad = 10;
  const sy = s.y + pad, ty = t.y - pad;
  const xsSet = new Set<number>([s.x, t.x]);
  const ysSet = new Set<number>([sy, ty]);
  for (const o of obstacles) {
    xsSet.add(o.x - pad); xsSet.add(o.x + o.w + pad);
    ysSet.add(o.y - pad); ysSet.add(o.y + o.h + pad);
  }
  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));
  const inside = (x: number, y: number) => obstacles.some((o) => x > o.x + 1 && x < o.x + o.w - 1 && y > o.y + 1 && y < o.y + o.h - 1);
  if (!(segmentClear({ x: s.x, y: s.y }, { x: s.x, y: sy }, obstacles) && segmentClear({ x: t.x, y: ty }, t, obstacles))) return null;
  const memo = new Map<string, boolean>();
  const clear = (a: Pt, b: Pt, key: string) => {
    let v = memo.get(key);
    if (v === undefined) { v = segmentClear(a, b, obstacles); memo.set(key, v); }
    return v;
  };
  const W = xs.length, H = ys.length;
  const start = xi.get(s.x)! + yi.get(sy)! * W;
  const goal = xi.get(t.x)! + yi.get(ty)! * W;
  const BEND = 40;
  // state = node * 4 + dir (0 right, 1 left, 2 down, 3 up); entering the start going down.
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap: Array<[number, number]> = [];
  const push = (d: number, st: number) => {
    heap.push([d, st]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = (): [number, number] | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  // A*: priority = cost so far + straight-line (Manhattan) distance left.
  const hOf = (node: number) => { const cx = node % W; return Math.abs(xs[cx] - t.x) + Math.abs(ys[(node - cx) / W] - ty); };
  const s0 = start * 4 + 2;
  dist.set(s0, 0);
  push(hOf(start), s0);
  let found = -1;
  let guard = 0;
  while (heap.length && guard++ < 250000) {
    const [f, st] = pop()!;
    const node = st >> 2, dir = st & 3;
    const d = dist.get(st) ?? Infinity;
    if (f > d + hOf(node) + 1e-6) continue;
    if (node === goal) { found = st; break; }
    const cx = node % W, cy = (node - cx) / W;
    const steps: Array<[number, number, number]> = [[cx + 1, cy, 0], [cx - 1, cy, 1], [cx, cy + 1, 2], [cx, cy - 1, 3]];
    for (const [nx, ny, nd] of steps) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if ((dir ^ nd) === 1 && Math.floor(dir / 2) === Math.floor(nd / 2)) continue; // no U-turn
      const a = { x: xs[cx], y: ys[cy] }, b = { x: xs[nx], y: ys[ny] };
      if (inside(b.x, b.y)) continue;
      const key = nd < 2 ? `h${Math.min(cx, nx)}:${cy}` : `v${cx}:${Math.min(cy, ny)}`;
      if (!clear(a, b, key)) continue;
      const nst = (nx + ny * W) * 4 + nd;
      const nd2 = d + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (nd === dir ? 0 : BEND);
      if (nd2 < (dist.get(nst) ?? Infinity)) { dist.set(nst, nd2); prev.set(nst, st); push(nd2 + hOf(nx + ny * W), nst); }
    }
  }
  if (found < 0) return null;
  const pts: Pt[] = [t];
  for (let st: number | undefined = found; st !== undefined; st = prev.get(st)) {
    const node = st >> 2;
    const cx = node % W;
    pts.push({ x: xs[cx], y: ys[(node - cx) / W] });
  }
  pts.push(s);
  return pts.reverse();
}
function segmentClear(a: Pt, b: Pt, obstacles: Rect[]): boolean {
  for (const o of obstacles) if (segmentHits(a, b, o)) return false;
  return true;
}

export const pathD = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");

/** The same right-angled path with its bends rounded (radius r, smaller where a leg is short). */
export function pathRounded(pts: Pt[], r = 8): string {
  if (pts.length < 3) return pathD(pts);
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) { d += ` L${b.x} ${b.y}`; continue; }
    const p = { x: b.x + ((a.x - b.x) / l1) * rr, y: b.y + ((a.y - b.y) / l1) * rr };
    const q = { x: b.x + ((c.x - b.x) / l2) * rr, y: b.y + ((c.y - b.y) / l2) * rr };
    d += ` L${p.x} ${p.y} Q${b.x} ${b.y} ${q.x} ${q.y}`;
  }
  const z = pts[pts.length - 1];
  return `${d} L${z.x} ${z.y}`;
}

/**
 * Rows placed by hand are rarely exactly level (owner, 5 Oct 2026: PATS' business lines sat 8–40px
 * apart). Siblings whose tops are within `tol` of each other, chained, are lined up on the highest of
 * them, each one moving with its whole block — unless that would land it on something.
 */
export function alignRows(base: Map<string, Rect>, rows: string[][], blockOf: (key: string) => string[], tol = 28): Map<string, Rect> {
  const rects = new Map(base);
  for (const row of rows) {
    const items = row
      .map((k) => [k, rects.get(k)] as const)
      .filter((x): x is readonly [string, Rect] => !!x[1])
      .sort((a, b) => a[1].y - b[1].y);
    for (let i = 0; i < items.length; ) {
      let j = i;
      while (j + 1 < items.length && items[j + 1][1].y - items[j][1].y <= tol) j++;
      const target = items[i][1].y;
      for (let k = i + 1; k <= j; k++) {
        const [key, r] = items[k];
        const dy = target - r.y;
        if (!dy) continue;
        const keys = new Set([key, ...blockOf(key).filter((x) => rects.has(x))]);
        const moved = [...keys].map((x) => { const q = rects.get(x)!; return [x, { ...q, y: q.y + dy }] as const; });
        const others: Rect[] = [];
        for (const [x, q] of rects) if (!keys.has(x)) others.push(q);
        if (moved.some(([, m]) => m.y < 0 || others.some((o) => overlaps(m, o, 4)))) continue;
        for (const [x, m] of moved) rects.set(x, m);
      }
      i = j + 1;
    }
  }
  return rects;
}

/**
 * Lines that run along each other are pulled apart (owner, 5 Oct 2026: lines 2–6px apart read as one
 * smudge and nobody could tell which went where). A horizontal leg between two vertical ones is a track;
 * the legs of one bundle (lines leaving the same point) at one height are one track and move together,
 * and a bundle's tracks that nearly meet are merged into one. Tracks of different bundles that overlap
 * and sit closer than `gap` are spread `gap` apart around their middle — each within the room its
 * neighbouring vertical legs leave, never above `minY` (inside its own box) and never through a card.
 * Moves `pts` in place.
 */
export function separateLines(
  lines: Array<{ bundle: string; pts: Pt[]; minY: number }>,
  blocked: (line: number, a: Pt, b: Pt) => boolean,
  gap = 12,
): void {
  type Track = { bundle: string; y: number; legs: Array<{ li: number; i: number }>; x1: number; x2: number; lo: number; hi: number };
  const M = 6;
  const tracksNow = (): Track[] => {
    const m = new Map<string, Track>();
    lines.forEach((ln, li) => {
      const p = ln.pts;
      for (let i = 1; i + 2 < p.length; i++) {
        if (Math.abs(p[i].y - p[i + 1].y) > 0.5) continue;
        if (Math.abs(p[i - 1].x - p[i].x) > 0.5 || Math.abs(p[i + 1].x - p[i + 2].x) > 0.5) continue;
        const y = p[i].y;
        let lo = ln.minY, hi = Number.POSITIVE_INFINITY;
        if (p[i - 1].y < y) lo = Math.max(lo, p[i - 1].y + M); else hi = Math.min(hi, p[i - 1].y - M);
        if (p[i + 2].y > y) hi = Math.min(hi, p[i + 2].y - M); else lo = Math.max(lo, p[i + 2].y + M);
        const x1 = Math.min(p[i].x, p[i + 1].x), x2 = Math.max(p[i].x, p[i + 1].x);
        const key = `${ln.bundle}|${Math.round(y)}`;
        const t = m.get(key);
        if (t) { t.legs.push({ li, i }); t.x1 = Math.min(t.x1, x1); t.x2 = Math.max(t.x2, x2); t.lo = Math.max(t.lo, lo); t.hi = Math.min(t.hi, hi); }
        else m.set(key, { bundle: ln.bundle, y, legs: [{ li, i }], x1, x2, lo, hi });
      }
    });
    return [...m.values()];
  };
  const overlapX = (a: Track, b: Track) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const canMove = (t: Track, ny: number) => {
    if (ny < t.lo || ny > t.hi) return false;
    for (const { li, i } of t.legs) {
      const p = lines[li].pts;
      const a = { x: p[i].x, y: ny }, b = { x: p[i + 1].x, y: ny };
      if (blocked(li, a, b) || blocked(li, p[i - 1], a) || blocked(li, b, p[i + 2])) return false;
    }
    return true;
  };
  const move = (t: Track, ny: number) => {
    for (const { li, i } of t.legs) { lines[li].pts[i].y = ny; lines[li].pts[i + 1].y = ny; }
    t.y = ny;
  };

  // 1. One bundle, one height: legs of the same bundle that nearly meet join the busier one.
  const byBundle = new Map<string, Track[]>();
  for (const t of tracksNow()) byBundle.set(t.bundle, [...(byBundle.get(t.bundle) ?? []), t]);
  for (const list of byBundle.values()) {
    list.sort((a, b) => a.y - b.y);
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1], b = list[k];
      if (b.y - a.y < gap && b.y - a.y > 0.5 && overlapX(a, b) > -gap) {
        const [from, to] = b.legs.length > a.legs.length ? [a, b] : [b, a];
        if (canMove(from, to.y)) move(from, to.y);
      }
    }
  }

  // 2. Different bundles: spread every cluster of too-close, overlapping tracks `gap` apart.
  for (let round = 0; round < 3; round++) {
    const ts = tracksNow();
    const up = ts.map((_, i) => i);
    const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])));
    let any = false;
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      if (ts[i].bundle !== ts[j].bundle && Math.abs(ts[i].y - ts[j].y) < gap - 0.5 && overlapX(ts[i], ts[j]) > 2) { up[find(i)] = find(j); any = true; }
    }
    if (!any) return;
    const clusters = new Map<number, Track[]>();
    ts.forEach((t, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), t]));
    let moved = false;
    for (const c of clusters.values()) {
      if (c.length < 2) continue;
      c.sort((a, b) => a.y - b.y || a.x1 - b.x1);
      const mean = c.reduce((s, t) => s + t.y, 0) / c.length;
      const want = c.map((_, k) => mean - (gap * (c.length - 1)) / 2 + k * gap);
      for (let k = 0; k < c.length; k++) {
        want[k] = Math.min(c[k].hi, Math.max(c[k].lo, want[k]));
        if (k > 0) want[k] = Math.max(want[k], want[k - 1] + gap);
      }
      for (let k = c.length - 2; k >= 0; k--) want[k] = Math.max(c[k].lo, Math.min(want[k], want[k + 1] - gap));
      for (let k = 0; k < c.length; k++) {
        const ny = Math.round(want[k]);
        if (Math.abs(ny - c[k].y) > 0.5 && canMove(c[k], ny)) { move(c[k], ny); moved = true; }
      }
    }
    if (!moved) return;
  }
}

/** Everything a line has to go round: all elements except its own two ends and the group frames it
 *  starts or ends inside (a line has to cross those to get in). */
export function obstaclesOf(e: { from: string; to: string; s: Pt; t: Pt }, rects: Map<string, Rect>, isFrame: (key: string) => boolean): Rect[] {
  const inside = (r: Rect, p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const out: Rect[] = [];
  for (const [k, r] of rects) if (k !== e.from && k !== e.to && !(isFrame(k) && (inside(r, e.s) || inside(r, e.t)))) out.push(r);
  return out;
}

export type EdgeSpec = {
  /** Source element (a card, box or group title) — the line may start inside it. */
  from: string;
  /** Target element — the line ends on its top edge. */
  to: string;
  s: Pt;
  t: Pt;
  prefY: number;
};

/**
 * Route every edge around every element except its own two ends and the group frames it starts or
 * ends inside (a line has to cross those to get in).
 */
export function routeAll(edges: EdgeSpec[], rects: Map<string, Rect>, isFrame: (key: string) => boolean, quick = false): Array<EdgeSpec & { pts: Pt[] }> {
  const routed = edges.map((e) => ({ ...e, pts: route(e.s, e.t, quick ? [] : obstaclesOf(e, rects, isFrame), e.prefY, quick) }));
  if (quick) return routed;
  const obstacles = routed.map((e) => obstaclesOf(e, rects, isFrame));
  separateLines(
    routed.map((e) => {
      const r = rects.get(e.from);
      return { bundle: `${e.from}@${Math.round(e.s.x)},${Math.round(e.s.y)}`, pts: e.pts, minY: (r ? r.y + r.h : e.s.y) + 6 };
    }),
    (li, a, b) => obstacles[li].some((o) => segmentHits(a, b, o)),
  );
  return routed;
}

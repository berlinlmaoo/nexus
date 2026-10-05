import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpToLine, Building2, Check, ChevronRight, Download, Focus, ImagePlus, LayoutGrid, Loader2, Maximize2, Minimize2, Plus, Scan, Search, Trash2, Users, Wand2, X, ZoomIn, ZoomOut } from "lucide-react";
import { toPng } from "html-to-image";
import { ApiError, nexusApi, type OrgChartPerson, type OrgUnit } from "@/lib/nexus-api";
import {
  LAYOUT, alignRows, applyManual, pathRounded, routeAll, tidyLayout,
  type EdgeSpec, type ManualItem, type Placement, type Pt, type Rect, type Size,
} from "@/lib/org-chart-layout";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Bagan IP & Divisi — IP, divisi dan team perusahaan sebagai satu pohon bebas bertingkat, masing-masing
 * dengan logo dan orang-orangnya. Satu orang boleh ada di beberapa IP/Team.
 *
 * Bagan ini TIDAK memberi akses apa pun: bukan akses project, bukan aturan absensi. Akses project
 * tetap lewat undangan langsung dari project-nya.
 *
 * Memindahkan: seret kartu IP/Team ke kartu lain untuk menaruhnya di bawahnya; seret orang ke kartu
 * IP/Team untuk MENAMBAHKANNYA ke sana (tetap di kartu lamanya); × di kartu orang = lepas dari kartu
 * itu saja. Klik kartu = ubah (nama, logo, induk, hapus); klik orang = centang IP/Team-nya.
 * Kanvasnya sama dengan Bagan Approval: scroll/pinch = zoom, seret area kosong = geser.
 *
 * Tiga tampilan (owner, 5 Oct 2026: satu kanvas selebar 4.800 px tidak enak dilihat): Ringkas = puncak
 * dan kartu tepat di bawahnya; satu IP/Team = isinya saja; keduanya selalu disusun otomatis. Lengkap =
 * semuanya, dengan posisi yang digeser sendiri — satu-satunya tampilan yang menyimpan posisi.
 */
type Drag = { kind: "person"; id: string; fromUnitId: string | null } | null;
type Mode = "ringkas" | "lengkap" | "fokus";
const VIEW_KEY = "nexus.orgChart.view";
/** What the hidden tray measured: every card, people box and group title, and where each leader's chip sits in its box. */
type Measured = {
  sizes: Record<string, Size>;
  chips: Record<string, { box: string; dx: number; dy: number; w: number; h: number }>;
};
const snap = (v: number) => Math.max(0, Math.round(v / LAYOUT.snap) * LAYOUT.snap);

export function OrgChart() {
  const qc = useQueryClient();
  const chart = useQuery({ queryKey: ["nexus", "org-chart"], queryFn: nexusApi.orgChart, retry: false });
  const [drag, setDrag] = useState<Drag>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrgUnit | null>(null);
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["nexus", "org-chart"] });
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: e instanceof ApiError ? e.message : "Coba lagi." });

  const moveUnit = useMutation({
    mutationFn: ({ unit, parentId }: { unit: OrgUnit; parentId: string | null }) => nexusApi.updateOrgUnit(unit.id, { parentId, layoutX: null, layoutY: null, boxLayout: null }),
    onSuccess: (_r, v) => {
      refresh();
      const to = v.parentId ? unitsById.get(v.parentId)?.name : null;
      toast.success(to ? `${v.unit.name} → di bawah ${to}` : `${v.unit.name} jadi puncak`);
    },
    onError: fail("Gagal memindahkan"),
  });
  const addPerson = useMutation({
    mutationFn: ({ person, unitId }: { person: OrgChartPerson; unitId: string }) => nexusApi.addOrgUnitMember(person.userId, unitId),
    onSuccess: (_r, v) => { refresh(); toast.success(`${v.person.name ?? "Orang"} + ${unitsById.get(v.unitId)?.name ?? "IP/Team"}`); },
    onError: fail("Gagal menambahkan"),
  });
  const setReportsTo = useMutation({
    mutationFn: ({ person, unitId, to }: { person: OrgChartPerson; unitId: string; to: string | null }) => nexusApi.setOrgUnitMemberReportsTo(person.userId, unitId, to),
    onSuccess: (_r, v) => {
      refresh();
      const who = v.to ? people.find((p) => p.userId === v.to)?.name : null;
      toast.success(who ? `${v.person.name ?? "Orang"} di bawah ${who}` : `${v.person.name ?? "Orang"} tidak lagi di bawah siapa pun`);
    },
    onError: fail("Gagal memindahkan"),
  });
  const resetLayout = useMutation({
    mutationFn: () => nexusApi.resetOrgChartLayout(),
    onSuccess: () => { setTemp({}); refresh(); toast.success("Bagan dirapikan otomatis"); },
    onError: fail("Gagal merapikan"),
  });
  const [confirmReset, setConfirmReset] = useState(false);
  // "Di bawah siapa" from the person dialog: put them in the leader's card first (if not there yet),
  // then under the leader (owner, 30 Sep 2026: click Mey → under Abraham, in one step).
  const [placingUnder, setPlacingUnder] = useState(false);
  const placeUnder = async (person: OrgChartPerson, leaderId: string, unitId: string) => {
    setPlacingUnder(true);
    try {
      if (!person.unitIds.includes(unitId)) await nexusApi.addOrgUnitMember(person.userId, unitId);
      await nexusApi.setOrgUnitMemberReportsTo(person.userId, unitId, leaderId);
      await qc.invalidateQueries({ queryKey: ["nexus", "org-chart"] });
      const lead = people.find((p) => p.userId === leaderId);
      toast.success(`${person.name ?? "Orang"} di bawah ${lead?.name ?? "atasannya"}`);
    } catch (e) {
      fail("Gagal menaruh di bawah")(e);
      refresh();
    } finally { setPlacingUnder(false); }
  };
  const removePerson = useMutation({
    mutationFn: ({ person, unitId }: { person: OrgChartPerson; unitId: string }) => nexusApi.removeOrgUnitMember(person.userId, unitId),
    onSuccess: (_r, v) => { refresh(); toast.success(`${v.person.name ?? "Orang"} dilepas dari ${unitsById.get(v.unitId)?.name ?? "IP/Team"}`); },
    onError: fail("Gagal melepas"),
  });

  const units = chart.data?.units ?? [];
  const people = chart.data?.people ?? [];
  const unitsById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  // "ringkas" | "lengkap" | "u:<unitId>", remembered per browser.
  const [view, setViewRaw] = useState<string>(() => { try { return localStorage.getItem(VIEW_KEY) ?? "ringkas"; } catch { return "ringkas"; } });
  // Fit the canvas to the screen on the first layouts after the view changes (cards are re-measured).
  const fitUntil = useRef(Number.POSITIVE_INFINITY);
  const setView = (v: string) => {
    fitUntil.current = Date.now() + 800;
    setViewRaw(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* blocked storage: the view just isn't remembered */ }
  };
  const focusId = view.startsWith("u:") && unitsById.has(view.slice(2)) ? view.slice(2) : null;
  const mode: Mode = focusId ? "fokus" : view === "lengkap" ? "lengkap" : "ringkas";
  const childUnits = useMemo(() => {
    const m = new Map<string, OrgUnit[]>();
    for (const u of units) if (u.parentId) m.set(u.parentId, [...(m.get(u.parentId) ?? []), u]);
    for (const list of m.values()) list.sort(byPos);
    return m;
  }, [units]);
  const membersOf = useMemo(() => {
    const m = new Map<string, OrgChartPerson[]>();
    for (const p of people) for (const id of p.unitIds) m.set(id, [...(m.get(id) ?? []), p]);
    for (const list of m.values()) list.sort((a, b) => label(a).localeCompare(label(b), "id"));
    return m;
  }, [people]);
  const descendantsOf = useCallback((id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(childUnits.get(id) ?? [])];
    while (stack.length) { const c = stack.pop()!; if (!out.has(c.id)) { out.add(c.id); stack.push(...(childUnits.get(c.id) ?? [])); } }
    return out;
  }, [childUnits]);

  // ── Kanvas bebas (sama persis dengan Bagan Approval) ──────────────────────────────────────
  // Semua hook di atas return awal — kalau tidak, jumlah hook berubah saat data selesai dimuat.
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ x: 0, y: 0, s: 1 });
  const [zoomLabel, setZoomLabel] = useState(100);
  const labelRaf = useRef(0);
  const applyView = useCallback((v: { x: number; y: number; s: number }) => {
    viewRef.current = v;
    const el = innerRef.current;
    if (el) el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    cancelAnimationFrame(labelRaf.current);
    labelRaf.current = requestAnimationFrame(() => setZoomLabel(Math.round(v.s * 100)));
  }, []);
  const [full, setFull] = useState(false);
  const MIN_S = 0.2, MAX_S = 2.5;
  const clampS = (v: number) => Math.min(MAX_S, Math.max(MIN_S, v));
  const fitView = useCallback(() => {
    const w = wrapRef.current?.clientWidth ?? 0, h = wrapRef.current?.clientHeight ?? 0;
    const nw = innerRef.current?.scrollWidth ?? 0, nh = innerRef.current?.scrollHeight ?? 0;
    if (!w || !h || !nw || !nh) return;
    const s = clampS(Math.min((w - 32) / nw, (h - 32) / nh, 1.2));
    applyView({ s, x: (w - nw * s) / 2, y: Math.max(16, (h - nh * s) / 2) });
  }, [applyView]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    fitView();
    const ro = new ResizeObserver(fitView);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [fitView, full, units.length, people.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Groups (kind GROUP, owner 2 Oct 2026) only arrange cards. A card inside one belongs to the nearest
  // card ABOVE the group(s) — that card's BoD/Manager lead it — and is laid out automatically inside
  // the group's frame (manual positions of anything inside a group are ignored).
  const tree = useMemo(() => {
    const parentOf = (id: string) => unitsById.get(id)?.parentId ?? null;
    /** Parents of a unit, nearest first. */
    const ancestors = (id: string): string[] => {
      const out: string[] = [];
      const seen = new Set([id]);
      for (let p = parentOf(id); p && unitsById.has(p) && !seen.has(p); p = parentOf(p)) { out.push(p); seen.add(p); }
      return out;
    };
    const effParentOf = (id: string): string | null => ancestors(id).find((p) => unitsById.get(p)?.kind !== "GROUP") ?? null;
    const groupDepth = (id: string) => ancestors(id).filter((p) => unitsById.get(p)?.kind === "GROUP").length;
    const depthOf = (id: string) => ancestors(id).length;
    /** Cards (not groups) above a unit: 0 = the top. */
    const levelOf = (id: string) => ancestors(id).filter((p) => unitsById.get(p)?.kind !== "GROUP").length;
    const inGroup = (id: string) => groupDepth(id) > 0;
    const leaderOrder = (unitId: string) => {
      const all = membersOf.get(unitId) ?? [];
      const ordered = [...all.filter((p) => p.role === "BOD" || p.role === "ONE_ABOVE_ALL"), ...all.filter((p) => p.role === "MANAGER")];
      return new Map(ordered.map((p, i) => [p.userId, i]));
    };
    const validLead = (k: OrgUnit) => {
      if (k.kind === "GROUP" || !k.leadUserId) return false;
      const P = effParentOf(k.id);
      return !!P && leaderOrder(P).has(k.leadUserId);
    };
    const groups = new Map(units.map((u): [string, Group] => {
      const kids = childUnits.get(u.id) ?? [];
      if (u.kind !== "GROUP") return [u.id, groupUnit(u, kids, membersOf.get(u.id) ?? [])];
      // Inside a group: the cards led from the card above it first, in the order of their leaders there.
      const above = effParentOf(u.id);
      const idx = above ? leaderOrder(above) : new Map<string, number>();
      const led = kids.filter(validLead).sort((a, b) => (idx.get(a.leadUserId!) ?? 0) - (idx.get(b.leadUserId!) ?? 0) || byPos(a, b));
      return [u.id, { bods: [], managers: [], staff: [], rt: [], led, free: kids.filter((k) => !validLead(k)), leaderIdx: new Map() }];
    }));
    const roots = units.filter((u) => !u.parentId || !unitsById.has(u.parentId)).sort(byPos);
    return { effParentOf, groupDepth, depthOf, levelOf, inGroup, groups, roots };
  }, [units, unitsById, childUnits, membersOf]);

  // The view chips: the cards right under the top (through any groups), in chart order.
  const topUnits = useMemo(() => {
    const out: OrgUnit[] = [];
    const seen = new Set<string>();
    const walk = (id: string) => {
      for (const k of childUnits.get(id) ?? []) {
        if (seen.has(k.id)) continue;
        seen.add(k.id);
        if (k.kind === "GROUP") walk(k.id); else out.push(k);
      }
    };
    for (const r of tree.roots) walk(r.id);
    return out;
  }, [childUnits, tree.roots]);

  /** How a card looks: its tone by kind and level, the line under its name and, in Ringkas, the faces
   *  of its BoD/Manager (its people and sub-units are not drawn there). */
  const cardInfo = (u: OrgUnit): { tone: CardTone; meta: string; faces: OrgChartPerson[] } => {
    const level = tree.levelOf(u.id);
    const above = tree.effParentOf(u.id);
    const tone: CardTone = u.kind === "IP" ? (level === 0 ? "root" : "ip") : above && unitsById.get(above)?.kind === "DIVISION" ? "sub" : "division";
    const own = membersOf.get(u.id) ?? [];
    if (mode === "ringkas" && level >= 1) {
      const below = [...descendantsOf(u.id)];
      const all = new Set<string>();
      for (const id of [u.id, ...below]) for (const p of membersOf.get(id) ?? []) all.add(p.userId);
      const parts = below.filter((id) => unitsById.get(id)?.kind !== "GROUP").length;
      const meta = [all.size > 0 ? `${all.size} orang` : "belum ada orang", parts > 0 ? `${parts} bagian` : null].filter(Boolean).join(" · ");
      return { tone, meta, faces: own.filter((p) => LEAD_ROLES.has(p.role)) };
    }
    return { tone, meta: own.length > 0 ? `${own.length} orang` : "belum ada orang", faces: [] };
  };

  // Free canvas, laid out in code (owner, 2 Oct 2026: "Rapikan otomatis" stacked cards on each other).
  // Every card, people box and group title is rendered once in a hidden tray and MEASURED; a tidy tree is
  // built from those sizes (lib/org-chart-layout), manual positions move whole subtrees and are pushed
  // to the nearest free place when they land on something, and connectors are routed around cards.
  const trayRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured>({ sizes: {}, chips: {} });
  useLayoutEffect(() => {
    const tray = trayRef.current;
    if (!tray) return;
    const run = () => {
      const next: Measured = { sizes: {}, chips: {} };
      for (const el of Array.from(tray.querySelectorAll<HTMLElement>("[data-oc-m]"))) {
        const key = el.dataset.ocM!;
        next.sizes[key] = { w: el.offsetWidth, h: el.offsetHeight };
        for (const chip of Array.from(el.querySelectorAll<HTMLElement>("[data-oc-chip]"))) {
          const o = offsetIn(chip, el);
          next.chips[chip.dataset.ocChip!] = { box: key, dx: o.x, dy: o.y, w: chip.offsetWidth, h: chip.offsetHeight };
        }
      }
      setMeasured((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    run();
    const ro = new ResizeObserver(run);
    for (const el of Array.from(tray.querySelectorAll<HTMLElement>("[data-oc-m]"))) ro.observe(el);
    return () => ro.disconnect();
  }, [units, people, mode]);

  // Positions not saved yet (being dragged, or on their way to the server) and the element being dragged.
  const [temp, setTemp] = useState<Record<string, Pt>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  // The card or group a dragged card would land in.
  const [dropCard, setDropCard] = useState<string | null>(null);
  const elDrag = useRef<{ key: string; pointerId: number; sx: number; sy: number; ox: number; oy: number; moved: boolean; last: Pt | null } | null>(null);
  // Connectors routed while nothing moves; reused while dragging for the ones whose ends stay put.
  const routedRef = useRef(new Map<string, Pt[]>());

  const layout = useMemo(() => {
    if (Object.keys(measured.sizes).length === 0) return null;
    const { groups, inGroup, depthOf, levelOf, effParentOf, roots } = tree;
    const sizeOf = (k: string): Size => measured.sizes[k] ?? { w: 0, h: 0 };
    // Ringkas: the top card(s) with their people, then only the cards right under them (through groups).
    const shallow = mode === "ringkas";
    const base = tidyLayout({
      roots: focusId ? [focusId] : roots.map((u) => u.id),
      isGroup: (id) => unitsById.get(id)?.kind === "GROUP",
      stack: (id) => (shallow && levelOf(id) >= 1 ? [`c:${id}`] : stackOf(id, groups.get(id)!)),
      row: (id) => {
        const u = unitsById.get(id)!;
        if (shallow && (u.kind === "GROUP" ? levelOf(id) > 1 : levelOf(id) >= 1)) return [];
        return rowOf(u, groups.get(id)!);
      },
      // Room for one elbow per led sub-unit / "di bawah" box above the shared crossbar.
      band: (id) => 46 + 12 * (groups.get(id)!.led.length + groups.get(id)!.rt.length),
      size: sizeOf,
    });
    // Saved positions count in Lengkap only; elsewhere only the card being dragged leaves its place.
    const items = manualItems(units, inGroup, depthOf, base, temp, dragKey, mode === "lengkap");
    let { rects } = applyManual(base.rects, items);
    if (mode === "lengkap" && !dragKey) {
      const rows: string[][] = [];
      for (const u of units) {
        if (u.kind === "GROUP" || inGroup(u.id)) continue; // laid out automatically, already level
        const keys = rowOf(u, groups.get(u.id)!).filter((k) => k.startsWith("u:")).map((k) => `c:${k.slice(2)}`);
        if (keys.length > 1) rows.push(keys);
      }
      rects = alignRows(rects, rows, (k) => base.subtree.get(k.slice(2)) ?? []);
    }
    const edges = buildEdges(units, groups, effParentOf, rects, measured.chips);
    const isFrame = (k: string) => k.startsWith("c:") && unitsById.get(k.slice(2))?.kind === "GROUP";
    const id = (e: EdgeSpec) => `${e.from}>${e.to}`;
    let lines: Array<EdgeSpec & { pts: Pt[] }>;
    if (!dragKey) {
      lines = routeAll(edges, rects, isFrame);
      routedRef.current = new Map(lines.map((e) => [id(e), e.pts]));
    } else {
      // While dragging: plain elbows for what moves, the last good route for everything else.
      lines = edges.map((e) => {
        const pts = routedRef.current.get(id(e));
        const same = pts && pts[0].x === Math.round(e.s.x) && pts[0].y === Math.round(e.s.y) && pts[pts.length - 1].x === Math.round(e.t.x) && pts[pts.length - 1].y === Math.round(e.t.y);
        return same ? { ...e, pts } : routeAll([e], rects, isFrame, true)[0];
      });
    }
    let width = 0, height = 0;
    for (const r of rects.values()) { width = Math.max(width, r.x + r.w); height = Math.max(height, r.y + r.h); }
    for (const l of lines) for (const p of l.pts) { width = Math.max(width, p.x); height = Math.max(height, p.y); }
    const lifted = new Set(dragKey ? items.find((i) => i.id === dragKey)?.keys ?? [] : []);
    return { base, rects, lines, lifted, width: width + LAYOUT.margin, height: height + LAYOUT.margin };
  }, [measured, tree, units, unitsById, temp, dragKey, mode, focusId]);
  useLayoutEffect(() => {
    if (!layout || Date.now() > fitUntil.current) return;
    fitView();
    if (fitUntil.current === Number.POSITIVE_INFINITY) fitUntil.current = Date.now() + 800;
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const v = viewRef.current;
    const s = clampS(v.s * factor);
    const k = s / v.s;
    applyView({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  };
  const zoomCenter = (factor: number) => {
    const w = wrapRef.current?.clientWidth ?? 0, h = wrapRef.current?.clientHeight ?? 0;
    zoomAt(factor, w / 2, h / 2);
  };
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) { const p = localPoint(e); zoomAt(Math.exp(-e.deltaY * 0.01), p.x, p.y); }
      else applyView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [units.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; vx: number; vy: number; dist: number; s: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[draggable='true'],button,input,[data-oc-drag]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (pts.length === 1) { gesture.current = { x: p.x, y: p.y, vx: v.x, vy: v.y, dist: 0, s: v.s }; setPanning(true); }
    else if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vx: v.x, vy: v.y, dist: Math.hypot(a.x - b.x, a.y - b.y), s: v.s };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, localPoint(e));
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 1) applyView({ s: viewRef.current.s, x: g.vx + (pts[0].x - g.x), y: g.vy + (pts[0].y - g.y) });
    else if (pts.length >= 2 && g.dist > 0) {
      const [a, b] = pts;
      const s = clampS(g.s * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist));
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const k = s / g.s;
      applyView({ s, x: cx - (g.x - g.vx) * k, y: cy - (g.y - g.vy) * k });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const v = viewRef.current;
    if (pointers.current.size === 0) { gesture.current = null; setPanning(false); }
    else if (pointers.current.size === 1) { const [p] = [...pointers.current.values()]; gesture.current = { x: p.x, y: p.y, vx: v.x, vy: v.y, dist: 0, s: v.s }; }
  };

  const [exporting, setExporting] = useState(false);
  const exportPng = async () => {
    const el = innerRef.current; if (!el || exporting) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true, style: { transform: "none" } });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `bagan-ip-divisi-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    } catch (e) {
      console.error(e);
      toast.error("Gagal membuat PNG", { description: "Coba lagi. Kalau terus gagal, ada logo atau foto yang tidak bisa dimuat." });
    } finally {
      setExporting(false);
    }
  };
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  if (chart.isLoading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (chart.isError || !chart.data) return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">Bagan tidak bisa dimuat — butuh akses BoD.</div>;

  const unplaced = people.filter((p) => p.unitIds.length === 0);
  const busy = moveUnit.isPending || addPerson.isPending || removePerson.isPending || setReportsTo.isPending || placingUnder;

  /** Zona jatuh untuk ORANG. Ke kartu = tambah (atau, kalau sudah di sana, lepas dari "di bawah");
   *  ke baki = lepas dari kartu asalnya saja. Kartu dipindah dengan seret bebas, bukan di sini. */
  const dropProps = (unitId: string | null, zone: string) => ({
    onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); setOverId(zone); },
    onDragLeave: () => setOverId((c) => (c === zone ? null : c)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setOverId(null);
      const d = drag; setDrag(null);
      if (!d) return;
      const person = people.find((p) => p.userId === d.id);
      if (!person) return;
      if (unitId && !person.unitIds.includes(unitId)) addPerson.mutate({ person, unitId });
      else if (unitId && person.reportsTo?.[unitId]) setReportsTo.mutate({ person, unitId, to: null });
      else if (!unitId && d.fromUnitId) removePerson.mutate({ person, unitId: d.fromUnitId });
    },
  });
  /** Orang dijatuhkan ke chip BoD/Manager di kartu yang sama = "di bawah" orang itu. */
  const chipDrop = (unitId: string, leader: OrgChartPerson) => {
    const zone = `chip:${unitId}:${leader.userId}`;
    const ok = () => {
      if (!drag || drag.fromUnitId !== unitId || drag.id === leader.userId) return false;
      const p = people.find((x) => x.userId === drag.id);
      return !!p && p.role !== "BOD" && p.role !== "ONE_ABOVE_ALL";
    };
    return {
      over: overId === zone,
      onDragOver: (e: React.DragEvent) => { if (!ok()) return; e.preventDefault(); e.stopPropagation(); setOverId(zone); },
      onDragLeave: () => setOverId((c) => (c === zone ? null : c)),
      onDrop: (e: React.DragEvent) => {
        if (!ok()) return;
        e.preventDefault(); e.stopPropagation(); setOverId(null);
        const p = people.find((x) => x.userId === drag!.id)!; setDrag(null);
        setReportsTo.mutate({ person: p, unitId, to: leader.userId });
      },
    };
  };

  const personProps = (p: OrgChartPerson, fromUnitId: string | null = null): PersonChipProps => ({
    p, busy, dragging: drag?.kind === "person" && drag.id === p.userId && drag.fromUnitId === fromUnitId,
    onDragStart: () => setDrag({ kind: "person", id: p.userId, fromUnitId }), onDragEnd: () => { setDrag(null); setOverId(null); },
    onClick: () => setPlacingId(p.userId),
    onRemove: fromUnitId ? () => removePerson.mutate({ person: p, unitId: fromUnitId }) : undefined,
    extra: p.unitIds.length > 1 ? p.unitIds.length - 1 : 0,
    jobTitle: fromUnitId ? p.titles?.[fromUnitId] ?? null : null,
  });

  const { groups, groupDepth, inGroup } = tree;
  const canvasPoint = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (e.clientX - (r?.left ?? 0) - v.x) / v.s, y: (e.clientY - (r?.top ?? 0) - v.y) / v.s };
  };
  const startElDrag = (key: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || busy) return;
    if ((e.target as HTMLElement).closest("[data-oc-add]")) return; // the "+" under a card
    if (key.startsWith("b:") && mode !== "lengkap") return; // people boxes move freely in Lengkap only
    if ((e.target as HTMLElement).closest("[draggable='true'],input,select")) return; // a person chip: HTML5 drag
    if (key.startsWith("b:") && (e.target as HTMLElement).closest("button")) return; // × on a chip
    const r = layout?.rects.get(key);
    if (!r) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    elDrag.current = { key, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y, moved: false, last: null };
  };
  const moveElDrag = (e: React.PointerEvent) => {
    const d = elDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const s = viewRef.current.s;
    const dx = (e.clientX - d.sx) / s, dy = (e.clientY - d.sy) / s;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) { d.moved = true; setDragKey(d.key); }
    d.last = { x: snap(d.ox + dx), y: snap(d.oy + dy) };
    // Lengkap: a card let go near the height of a sibling lines up with it exactly.
    if (mode === "lengkap" && d.key.startsWith("c:") && layout) {
      const id = d.key.slice(2);
      const parent = unitsById.get(id)?.parentId ?? null;
      let best: number | null = null;
      for (const u of units) {
        if (u.id === id || u.parentId !== parent || inGroup(u.id)) continue;
        const r = layout.rects.get(`c:${u.id}`);
        if (r && Math.abs(r.y - d.last.y) <= 14 && (best === null || Math.abs(r.y - d.last.y) < Math.abs(best - d.last.y))) best = r.y;
      }
      if (best !== null) d.last = { x: d.last.x, y: best };
    }
    const pos = d.last;
    setTemp((t) => ({ ...t, [d.key]: pos }));
    if (d.key.startsWith("c:") && layout) {
      const id = d.key.slice(2);
      const banned = descendantsOf(id).add(id);
      const pt = canvasPoint(e);
      // The innermost card or group frame under the pointer (a frame contains the cards inside it).
      // Its own parent counts too, but is not a target: dropping inside the frame it already sits in
      // must not fall through to the frame around that one.
      let best: { id: string; area: number } | null = null;
      for (const u of units) {
        if (banned.has(u.id)) continue;
        const r = layout.rects.get(`c:${u.id}`);
        if (!r || pt.x < r.x || pt.x > r.x + r.w || pt.y < r.y || pt.y > r.y + r.h) continue;
        if (!best || r.w * r.h < best.area) best = { id: u.id, area: r.w * r.h };
      }
      const parent = unitsById.get(id)?.parentId ?? null;
      setDropCard(best && best.id !== parent ? best.id : null);
    }
  };
  const endElDrag = (e: React.PointerEvent) => {
    const d = elDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    elDrag.current = null;
    const target = dropCard;
    setDropCard(null);
    setDragKey(null);
    const [t, id, ...rest] = d.key.split(":");
    if (!d.moved) { if (t === "c") { const u = unitsById.get(id); if (u) setEditing(u); } return; }
    const clear = () => setTemp((m) => { const n = { ...m }; delete n[d.key]; return n; });
    const u = unitsById.get(id);
    if (!u || !layout) { clear(); return; }
    if (t === "c" && target && target !== u.parentId) { clear(); moveUnit.mutate({ unit: u, parentId: target }); return; }
    if (mode !== "lengkap") {
      clear();
      toast("Tampilan ini disusun otomatis", { description: "Untuk menggeser bebas, buka tampilan Lengkap. Jatuhkan kartu di atas kartu atau grup lain untuk memindahkannya." });
      return;
    }
    if (inGroup(id)) {
      clear();
      toast("Kartu di dalam grup disusun otomatis", { description: "Jatuhkan di atas kartu atau grup lain untuk memindahkannya, atau geser grupnya." });
      return;
    }
    // Never leave it on top of something: the nearest free place instead (8px grid), saved as such.
    const want = d.last ?? { x: snap(d.ox), y: snap(d.oy) };
    const items = manualItems(units, inGroup, tree.depthOf, layout.base, { ...temp, [d.key]: want }, null, true);
    const pos = applyManual(layout.base.rects, items).resolved.get(d.key) ?? want;
    setTemp((m) => ({ ...m, [d.key]: pos }));
    if (pos.x !== want.x || pos.y !== want.y) toast("Digeser ke tempat kosong terdekat", { description: "Tempat itu sudah terisi kartu atau kotak lain." });
    const save = t === "c" ? nexusApi.updateOrgUnit(id, { layoutX: pos.x, layoutY: pos.y }) : nexusApi.updateOrgUnit(id, { boxLayout: { [rest.join(":")]: pos } });
    save
      .then(() => qc.invalidateQueries({ queryKey: ["nexus", "org-chart"] }))
      .then(clear)
      .catch((err) => { clear(); fail("Gagal menyimpan posisi")(err); });
  };
  const dragHandlers = (key: string) => ({ "data-oc-drag": "", onPointerDown: startElDrag(key), onPointerMove: moveElDrag, onPointerUp: endElDrag, onPointerCancel: endElDrag });

  const placing = placingId ? people.find((p) => p.userId === placingId) ?? null : null;
  const focusUnit = focusId ? unitsById.get(focusId) ?? null : null;
  // The chip that stays lit while looking inside one of the top cards (or deeper in it).
  const activeTop = (() => {
    if (!focusId) return null;
    const tops = new Set(topUnits.map((u) => u.id));
    const seen = new Set<string>();
    for (let id: string | null = focusId; id && !seen.has(id); id = unitsById.get(id)?.parentId ?? null) {
      if (tops.has(id)) return id;
      seen.add(id);
    }
    return null;
  })();
  // Fokus: where this part sits, top first; each step opens that part.
  const trail = (() => {
    const out: OrgUnit[] = [];
    const seen = new Set<string>();
    for (let u = focusUnit; u && !seen.has(u.id); u = u.parentId ? unitsById.get(u.parentId) ?? null : null) { out.unshift(u); seen.add(u.id); }
    return out;
  })();

  return (
    <div className="space-y-4">
      <style>{`
        .oc-leaves{display:flex;flex-direction:column;padding:6px;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:0 1px 2px rgba(15,23,42,.05)}
        .oc-group{border:1px solid var(--oc-group-line);border-radius:18px;background:var(--oc-group)}
        .oc-group-title{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;padding:3px 10px;border-radius:999px;border:1px solid var(--oc-group-line);background:var(--card);color:var(--muted-foreground);box-shadow:0 1px 2px rgba(15,23,42,.05)}
        .oc-group-empty{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted-foreground)}
        .oc-leaves-label{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted-foreground);text-align:center;padding:1px 4px 5px}
      `}</style>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs shadow-soft">
        <Stat n={chart.data.stats.units} label="IP/Team" />
        {(chart.data.stats.groups ?? 0) > 0 && <Stat n={chart.data.stats.groups ?? 0} label="grup" />}
        <Stat n={chart.data.stats.placed} of={chart.data.stats.people} label="orang sudah ditaruh" />
        <Stat n={unplaced.length} label="belum ditaruh" tone={unplaced.length > 0 ? "warn" : "ok"} />
        <span className="text-muted-foreground">Seret kartu atau kotak orang ke mana saja; seret orang ke chip atasannya.</span>
        <button type="button" onClick={() => setAdding({ parentId: focusId ?? (tree.roots.length === 1 ? tree.roots[0].id : null) })} title="Tambah IP/perusahaan, divisi, atau grup" className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90">
          <Plus className="h-3.5 w-3.5" /> Tambah
        </button>
      </div>

      {units.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center shadow-soft">
          <div className="text-base font-bold">Belum ada IP/Team</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Mulai dari IP paling atas, misalnya Z Networks atau PATS Group. Setelah itu tambahkan divisi dan team di bawahnya, pasang logonya, lalu seret orang ke team-nya.
          </p>
          <button type="button" onClick={() => setAdding({ parentId: null })} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Tambah IP pertama
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft [--oc-line:#b4c1d3] dark:[--oc-line:#3e4c61] [--oc-group:rgba(30,58,95,.045)] dark:[--oc-group:rgba(148,163,184,.06)] [--oc-group-line:rgba(30,58,95,.11)] dark:[--oc-group-line:rgba(148,163,184,.16)]">
          <section className={cn(full ? "fixed inset-0 z-[60] flex flex-col bg-card" : "border-b border-border")}>
            <div className={cn("flex flex-wrap items-center gap-2 px-5", full ? "border-b border-border py-3" : "pt-4 pb-2")}>
              <div className="min-w-0 flex-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {full ? "Bagan IP & Divisi" : "IP, divisi & team"} <span className="hidden normal-case tracking-normal text-muted-foreground/70 lg:inline">· {HINT[mode]}</span>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <button type="button" onClick={() => zoomCenter(1 / 1.2)} className="rounded-md border border-border p-1 hover:bg-accent" aria-label="Perkecil"><ZoomOut className="h-3.5 w-3.5" /></button>
                <span className="w-10 text-center tabular-nums">{zoomLabel}%</span>
                <button type="button" onClick={() => zoomCenter(1.2)} className="rounded-md border border-border p-1 hover:bg-accent" aria-label="Perbesar"><ZoomIn className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={fitView} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent"><Scan className="h-3.5 w-3.5" /> Pas layar</button>
                {mode === "lengkap" && (
                  <button type="button" onClick={() => setConfirmReset(true)} disabled={resetLayout.isPending} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent disabled:opacity-50" title="Hapus semua posisi manual; bagan disusun ulang otomatis">
                    {resetLayout.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Rapikan otomatis
                  </button>
                )}
                <button type="button" onClick={exportPng} disabled={exporting} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent disabled:opacity-50" title="Unduh bagan sebagai PNG tajam (2x), apa pun zoom di layar">
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PNG
                </button>
                <button type="button" onClick={() => setFull((f) => !f)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent">
                  {full ? <><Minimize2 className="h-3.5 w-3.5" /> Tutup</> : <><Maximize2 className="h-3.5 w-3.5" /> Layar penuh</>}
                </button>
              </div>
            </div>
            <div role="tablist" aria-label="Tampilan bagan" className={cn("flex items-center gap-1.5 overflow-x-auto px-5 pb-2.5 [scrollbar-width:none]", full && "pt-2.5")}>
              <ViewChip active={mode === "ringkas"} onClick={() => setView("ringkas")} title="Puncak dan IP/Team tepat di bawahnya">Ringkas</ViewChip>
              <ViewChip active={mode === "lengkap"} onClick={() => setView("lengkap")} title="Semua IP/Team sekaligus, dengan posisi yang digeser sendiri">Lengkap</ViewChip>
              {topUnits.length > 0 && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />}
              {topUnits.map((u) => (
                <ViewChip key={u.id} active={activeTop === u.id} onClick={() => setView(`u:${u.id}`)} title={`Isi ${u.name} saja`}>
                  {u.kind === "IP" && u.logoUrl && <ChipLogo u={u} />}{u.name}
                </ViewChip>
              ))}
            </div>
            {mode === "fokus" && trail.length > 1 && (
              <nav aria-label="Letak bagian ini" className="flex items-center gap-0.5 overflow-x-auto px-5 pb-2 text-xs text-muted-foreground [scrollbar-width:none]">
                {trail.map((u, i) => (
                  <Fragment key={u.id}>
                    {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />}
                    {i === trail.length - 1
                      ? <span className="shrink-0 px-1 font-semibold text-foreground">{u.name}</span>
                      : <button type="button" onClick={() => setView(i === 0 ? "ringkas" : `u:${u.id}`)} className="shrink-0 rounded px-1 hover:bg-accent hover:text-foreground">{u.name}</button>}
                  </Fragment>
                ))}
              </nav>
            )}
            <div
              ref={wrapRef}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("[draggable='true'],button")) fitView(); }}
              className={cn("relative w-full select-none overflow-hidden border-t border-border/60 bg-[radial-gradient(circle,rgba(15,39,66,.07)_1px,transparent_1px)] [background-size:20px_20px] dark:bg-[radial-gradient(circle,rgba(255,255,255,.05)_1px,transparent_1px)]", full ? "min-h-0 flex-1" : "h-[min(72vh,820px)]", panning ? "cursor-grabbing" : "cursor-grab")}
              style={{ touchAction: "none" }}
            >
              <div ref={innerRef} data-oc-canvas="" className="absolute left-0 top-0 w-max" style={{ transformOrigin: "0 0", willChange: "transform" }}>
                {/* Every element once, measured but never seen: the layout is computed from these sizes. */}
                <div ref={trayRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
                  {units.map((u) => {
                    const g = groups.get(u.id);
                    if (!g) return null;
                    if (u.kind === "GROUP") {
                      return (
                        <div key={u.id} data-oc-m={`t:${u.id}`} className="absolute left-0 top-0 w-max">
                          <div className="oc-group-title">{u.name} · {childUnits.get(u.id)?.length ?? 0}</div>
                        </div>
                      );
                    }
                    return (
                      <Fragment key={u.id}>
                        <div data-oc-m={`c:${u.id}`} className="absolute left-0 top-0 w-max"><UnitCard u={u} busy={false} {...cardInfo(u)} dragging={false} /></div>
                        {boxKinds(g).map((kind) => (
                          <div key={kind} data-oc-m={`b:${u.id}:${kind}`} className="absolute left-0 top-0 w-max">
                            <PeopleBox unitId={u.id} kind={kind} list={boxPeople(g, kind)} title={boxTitle(g, kind, people)} personProps={personProps} />
                          </div>
                        ))}
                      </Fragment>
                    );
                  })}
                </div>
                {layout && (
                  <>
                    <div style={{ width: layout.width, height: layout.height }} />
                    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ zIndex: 5 }} width={layout.width} height={layout.height} aria-hidden>
                      {layout.lines.map((l) => <path key={`${l.from}>${l.to}`} data-oc-from={l.from} data-oc-to={l.to} d={pathRounded(l.pts)} fill="none" style={{ stroke: "var(--oc-line)" }} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />)}
                    </svg>
                    {[...layout.rects].map(([key, r]) => {
                      const [t, id, ...rest] = key.split(":");
                      const u = unitsById.get(id);
                      if (!u) return null;
                      const lift = layout.lifted.has(key) ? 40 : 0;
                      if (t === "t") {
                        return (
                          <div key={key} data-oc-key={key} className="oc-group-title pointer-events-none absolute" style={{ left: r.x, top: r.y, zIndex: 6 + lift }}>
                            {u.name} · {childUnits.get(u.id)?.length ?? 0}
                          </div>
                        );
                      }
                      if (t === "c" && u.kind === "GROUP") {
                        // A dashed frame around the cards it groups; its title and cards are drawn on top, separately.
                        const n = childUnits.get(u.id)?.length ?? 0;
                        return (
                          <div key={key} data-oc-key={key} {...dragHandlers(key)} role="button" tabIndex={0} aria-label={`Grup ${u.name}, ${n} isi`}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(u); } }}
                            title="Klik untuk mengubah · seret untuk memindah (isinya ikut) · jatuhkan kartu di sini = masuk grup"
                            className={cn("oc-group absolute cursor-grab touch-none active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", dropCard === u.id && "ring-2 ring-primary ring-offset-2")}
                            style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: 1 + Math.min(3, groupDepth(u.id)) + lift }}>
                            {n === 0 && <div className="oc-group-empty" style={{ height: LAYOUT.gEmpty }}>Seret kartu ke sini</div>}
                          </div>
                        );
                      }
                      const style = { left: r.x, top: r.y, width: r.w, zIndex: (t === "c" ? 11 : 10) + lift };
                      if (t === "c") {
                        return (
                          <div key={key} data-oc-key={key} {...dragHandlers(key)} {...dropProps(u.id, u.id)} className={cn("group/card absolute cursor-grab touch-none rounded-xl active:cursor-grabbing", (dropCard === u.id || overId === u.id) && "ring-2 ring-primary ring-offset-2")} style={style}>
                            <UnitCard u={u} busy={busy} {...cardInfo(u)} dragging={dragKey === key} onKeyOpen={() => setEditing(u)} />
                            {!dragKey && !busy && (
                              <button type="button" data-oc-add="" onClick={(e) => { e.stopPropagation(); setAdding({ parentId: u.id }); }} aria-label={`Tambah di bawah ${u.name}`} title={`Tambah di bawah ${u.name}`}
                                className="absolute -bottom-3 left-1/2 z-10 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition hover:border-[#1e3a5f] hover:text-[#1e3a5f] focus-visible:opacity-100 group-hover/card:opacity-100 dark:hover:border-[#9fb6d6] dark:hover:text-[#9fb6d6]">
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      }
                      const g = groups.get(id)!;
                      const kind = rest.join(":");
                      // Inside a group, and outside Lengkap, everything is laid out automatically: the box is not moved on its own.
                      const locked = inGroup(id) || mode !== "lengkap";
                      return (
                        <div key={key} data-oc-key={key} {...(locked ? {} : dragHandlers(key))} className={cn("absolute", !locked && "cursor-grab touch-none active:cursor-grabbing")} style={style}>
                          <PeopleBox unitId={id} kind={kind} list={boxPeople(g, kind)} title={boxTitle(g, kind, people)} personProps={personProps} chipDrop={chipDrop} />
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </section>

          <section {...dropProps(null, "__tray__")} className={cn("rounded-b-2xl px-5 py-4 transition", overId === "__tray__" ? "bg-rose-50" : "bg-muted/20")}>
            <div className="flex items-baseline justify-between gap-3">
              <Eyebrow>Belum ditaruh <span className="normal-case tracking-normal text-muted-foreground/70">· {unplaced.length} orang · seret ke kartu IP/Team</span></Eyebrow>
              {drag?.kind === "person" && drag.fromUnitId && <span className="text-[11px] font-semibold text-rose-700">Jatuhkan di sini untuk melepas dari {unitsById.get(drag.fromUnitId)?.name ?? "kartu itu"}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {unplaced.map((p) => <PersonChip key={p.userId} {...personProps(p)} />)}
              {unplaced.length === 0 && <span className="text-xs text-emerald-700">Kosong — semua orang sudah ada di suatu IP/Team.</span>}
            </div>
          </section>
        </div>
      )}

      {units.length === 0 && unplaced.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-soft">
          {unplaced.length} orang menunggu ditaruh setelah IP/Team pertama dibuat.
        </div>
      )}

      {adding && (
        <UnitDialog
          units={units}
          excluded={new Set()}
          initial={{ name: "", parentId: adding.parentId }}
          people={people}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); refresh(); }}
        />
      )}
      {editing && (
        <UnitDialog
          unit={editing}
          units={units}
          excluded={descendantsOf(editing.id).add(editing.id)}
          initial={{ name: editing.name, parentId: editing.parentId }}
          people={people}
          members={membersOf.get(editing.id)?.length ?? 0}
          subUnits={childUnits.get(editing.id)?.length ?? 0}
          onAddChild={() => { const parentId = editing.id; setEditing(null); setAdding({ parentId }); }}
          onFocus={focusId === editing.id ? undefined : () => { const id = editing.id; setEditing(null); setView(`u:${id}`); }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="z-[80]">
          <AlertDialogHeader>
            <AlertDialogTitle>Rapikan otomatis?</AlertDialogTitle>
            <AlertDialogDescription>Semua posisi yang sudah digeser (kartu dan kotak orang) dihapus, dan bagan disusun ulang otomatis. Induk, orang, jabatan, dan pemimpin tidak berubah.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetLayout.mutate()}>Rapikan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {placing && (
        <UnitPicker
          person={placing}
          units={units}
          busy={busy}
          people={people}
          onToggle={(unitId, on) => (on ? addPerson : removePerson).mutate({ person: placing, unitId })}
          onPlaceUnder={placeUnder}
          onRelease={(unitId) => setReportsTo.mutate({ person: placing, unitId, to: null })}
          onClose={() => setPlacingId(null)}
        />
      )}
    </div>
  );
}

const byPos = (a: OrgUnit, b: OrgUnit) => a.position - b.position || a.name.localeCompare(b.name, "id");
const HINT: Record<Mode, string> = {
  ringkas: "ringkasan · pilih IP/Team di bawah untuk melihat isinya · scroll/pinch = zoom",
  fokus: "disusun otomatis · jatuhkan kartu di atas kartu atau grup = pindah induk · scroll/pinch = zoom",
  lengkap: "seret kartu/kotak ke mana saja · jatuhkan kartu di atas kartu atau grup = pindah induk · scroll/pinch = zoom",
};

function ViewChip({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} title={title}
      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition",
        active ? "border-[#1e3a5f] bg-[#1e3a5f] text-white dark:border-[#9fb6d6] dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : "border-border bg-background text-muted-foreground hover:border-[#1e3a5f]/40 hover:text-foreground")}>
      {children}
    </button>
  );
}
function ChipLogo({ u }: { u: OrgUnit }) {
  const [broken, setBroken] = useState(false);
  const tone = useLogoTone(u.logoUrl && !broken ? u.logoUrl : null);
  if (!u.logoUrl || broken) return null;
  return <img src={u.logoUrl} alt="" onError={() => setBroken(true)} className={cn("-ml-1.5 h-[18px] w-[18px] shrink-0 rounded-full object-contain p-px", tone === "light" ? "bg-[#0f1b2d]" : "bg-white ring-1 ring-black/5")} />;
}
const label = (p: OrgChartPerson) => p.name ?? p.email;
const ROLE_SUB: Record<string, string> = { ONE_ABOVE_ALL: "One Above All", BOD: "BoD", MANAGER: "Manager", STAFF: "Staff" };
function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{children}</div>;
}
function Stat({ n, of, label, tone }: { n: number; of?: number; label: string; tone?: "warn" | "ok" }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1", tone === "warn" && "text-amber-700", tone === "ok" && "text-emerald-700")}>
      <b className="text-sm tabular-nums">{n}</b>{of !== undefined && <span className="text-muted-foreground">/ {of}</span>}<span className={cn(!tone && "text-muted-foreground")}>{label}</span>
    </span>
  );
}

type PersonChipProps = { p: OrgChartPerson; busy: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void; onRemove?: () => void; extra: number; jobTitle?: string | null; variant?: "chip" | "row" };

const LEAD_ROLES = new Set(["ONE_ABOVE_ALL", "BOD", "MANAGER"]);

/** How one card's people and sub-units are arranged: BoD box, Manager box, staff box, one box per
 *  leader for the people who sit under them ("di bawah"), sub-units led by one of the card's leaders
 *  (first, in the order of their leaders) and the rest. */
type Group = { bods: OrgChartPerson[]; managers: OrgChartPerson[]; staff: OrgChartPerson[]; rt: Array<[string, OrgChartPerson[]]>; led: OrgUnit[]; free: OrgUnit[]; leaderIdx: Map<string, number> };
function groupUnit(u: OrgUnit, kids: OrgUnit[], all: OrgChartPerson[]): Group {
  const bods = all.filter((p) => p.role === "BOD" || p.role === "ONE_ABOVE_ALL");
  const allManagers = all.filter((p) => p.role === "MANAGER");
  const leaderIdx = new Map([...bods, ...allManagers].map((p, i) => [p.userId, i]));
  const rtOf = (p: OrgChartPerson) => {
    const to = p.reportsTo?.[u.id];
    return to && to !== p.userId && leaderIdx.has(to) && p.role !== "BOD" && p.role !== "ONE_ABOVE_ALL" ? to : null;
  };
  const rtMap = new Map<string, OrgChartPerson[]>();
  for (const p of all) { const to = rtOf(p); if (to) rtMap.set(to, [...(rtMap.get(to) ?? []), p]); }
  const rt = [...rtMap.entries()].sort((a, b) => leaderIdx.get(a[0])! - leaderIdx.get(b[0])!);
  const isLed = (k: OrgUnit) => k.kind !== "GROUP" && !!k.leadUserId && leaderIdx.has(k.leadUserId);
  const led = kids.filter(isLed).sort((a, b) => leaderIdx.get(a.leadUserId!)! - leaderIdx.get(b.leadUserId!)! || byPos(a, b));
  return {
    bods, managers: allManagers.filter((p) => !rtOf(p)), staff: all.filter((p) => !LEAD_ROLES.has(p.role) && !rtOf(p)),
    rt, led, free: kids.filter((k) => !isLed(k)), leaderIdx,
  };
}
function boxPeople(g: Group, kind: string): OrgChartPerson[] {
  if (kind === "bod") return g.bods;
  if (kind === "manager") return g.managers;
  if (kind === "staff") return g.staff;
  return g.rt.find(([id]) => `rt:${id}` === kind)?.[1] ?? [];
}
function boxTitle(g: Group, kind: string, people: OrgChartPerson[]): string {
  const n = boxPeople(g, kind).length;
  if (kind === "bod") return `BoD · ${n}`;
  if (kind === "manager") return `Manager · ${n}`;
  if (kind === "staff") return `${n} orang`;
  const lead = people.find((p) => `rt:${p.userId}` === kind);
  return `Di bawah ${(lead?.name ?? "?").split(" ")[0]} · ${n}`;
}

/** A card with its BoD and Manager boxes under it, top to bottom. */
function stackOf(id: string, g: Group): string[] {
  return [`c:${id}`, ...(g.bods.length ? [`b:${id}:bod`] : []), ...(g.managers.length ? [`b:${id}:manager`] : [])];
}
/** Left to right under a card: sub-units led by one of its leaders (in the order of the leaders), the
 *  "di bawah" boxes and the other sub-units, with the staff box in the middle. Inside a group: its cards. */
function rowOf(u: OrgUnit, g: Group): string[] {
  if (u.kind === "GROUP") return [...g.led, ...g.free].map((k) => `u:${k.id}`);
  // Led sub-units and "di bawah" boxes together, in the order of their leaders in the card's boxes, so
  // the lines from neighbouring leaders never cross (owner, 5 Oct 2026: Abraham's line to Mey crossed
  // Gerald's and Henryca's).
  const byLeader = [
    ...g.led.map((k) => ({ key: `u:${k.id}`, at: g.leaderIdx.get(k.leadUserId!) ?? 0, box: 0 })),
    ...g.rt.map(([id]) => ({ key: `b:${u.id}:rt:${id}`, at: g.leaderIdx.get(id) ?? 0, box: 1 })),
  ].sort((a, b) => a.at - b.at || a.box - b.box).map((x) => x.key);
  const row = [...byLeader, ...g.free.map((k) => `u:${k.id}`)];
  if (g.staff.length > 0) row.splice(Math.floor(row.length / 2), 0, `b:${u.id}:staff`);
  return row;
}
/** The people boxes a card has. */
function boxKinds(g: Group): string[] {
  return [...(g.bods.length ? ["bod"] : []), ...(g.managers.length ? ["manager"] : []), ...(g.staff.length ? ["staff"] : []), ...g.rt.map(([id]) => `rt:${id}`)];
}

/**
 * Manual positions in the order they are applied: cards outside groups, shallow first (a card takes its
 * whole subtree along; a deeper card with a position of its own then moves again), then people boxes.
 * `temp` holds positions not saved yet. Each one is pushed to the nearest free place when it lands on
 * something — except the one being dragged, which follows the pointer until it is dropped.
 */
function manualItems(units: OrgUnit[], inGroup: (id: string) => boolean, depthOf: (id: string) => number, base: Placement, temp: Record<string, Pt>, dragKey: string | null, useSaved: boolean): ManualItem[] {
  const cards: Array<ManualItem & { depth: number }> = [];
  const boxes: ManualItem[] = [];
  for (const u of units) {
    const key = `c:${u.id}`;
    if (!base.rects.has(key)) continue;
    const grouped = inGroup(u.id);
    // A card inside a group only moves while it is dragged (to be dropped on another card).
    const pos = temp[key] ?? (useSaved && !grouped && u.layoutX != null && u.layoutY != null ? { x: u.layoutX, y: u.layoutY } : null);
    if (pos) cards.push({ id: key, keys: base.subtree.get(u.id) ?? [key], anchor: key, pos, resolve: key !== dragKey, depth: depthOf(u.id) });
    if (grouped || u.kind === "GROUP") continue;
    const prefix = `b:${u.id}:`;
    const kinds = new Set([...(useSaved ? Object.keys(u.boxLayout ?? {}) : []), ...Object.keys(temp).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))]);
    for (const kind of kinds) {
      const bk = prefix + kind;
      const p = temp[bk] ?? (useSaved ? u.boxLayout?.[kind] : undefined);
      if (p && base.rects.has(bk)) boxes.push({ id: bk, keys: [bk], anchor: bk, pos: p, resolve: bk !== dragKey });
    }
  }
  cards.sort((a, b) => a.depth - b.depth);
  return [...cards, ...boxes];
}

/** A people box: BoD / Manager chips side by side, staff and "di bawah" boxes stacked. Leaders' chips
 *  carry data-oc-chip (for the connectors) and, on the visible chart, take a person dropped on them. */
function PeopleBox({ unitId, kind, list, title, personProps, chipDrop }: {
  unitId: string; kind: string; list: OrgChartPerson[]; title: string;
  personProps: (p: OrgChartPerson, fromUnitId?: string | null) => PersonChipProps;
  chipDrop?: (unitId: string, leader: OrgChartPerson) => { over: boolean; onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void };
}) {
  const row = kind === "bod" || kind === "manager";
  // Seven people in one column made Multimedia twice as tall as its row (owner, 5 Oct 2026).
  const twoCols = !row && list.length >= 6;
  return (
    <div className="oc-leaves">
      <div className="oc-leaves-label">{title}</div>
      <div className={cn(row ? "flex flex-row gap-1" : twoCols ? "grid grid-cols-2 gap-x-1 gap-y-0.5" : "flex flex-col gap-0.5")}>
        {list.map((p) => {
          const leader = LEAD_ROLES.has(p.role);
          const drop = leader && chipDrop ? chipDrop(unitId, p) : null;
          return (
            <div key={p.userId} data-oc-chip={leader ? `${unitId}:${p.userId}` : undefined}
              onDragOver={drop?.onDragOver} onDragLeave={drop?.onDragLeave} onDrop={drop?.onDrop}
              className={cn("rounded-lg", drop?.over && "ring-2 ring-primary ring-offset-1")}>
              <PersonChip {...personProps(p, unitId)} variant="row" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Every connector, between ACTUAL positions: card → BoD box → Manager box; the last of those (a group:
 *  its title) → the staff box and the unled sub-units on one crossbar; a leader's chip → the sub-unit
 *  they lead and the box of the people under them, each elbow at its own height. */
function buildEdges(units: OrgUnit[], groups: Map<string, Group>, effParentOf: (id: string) => string | null, rects: Map<string, Rect>, chips: Measured["chips"]): EdgeSpec[] {
  const edges: EdgeSpec[] = [];
  const bottom = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h });
  const top = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y });
  const chipAt = (key: string) => {
    const c = chips[key];
    const b = c && rects.get(c.box);
    return b ? { box: c.box, r: { x: b.x + c.dx, y: b.y + c.dy, w: c.w, h: c.h } } : null;
  };
  for (const u of units) {
    const g = groups.get(u.id);
    if (!g || !rects.has(`c:${u.id}`)) continue;
    let srcKey = `t:${u.id}`;
    if (u.kind !== "GROUP") {
      const stack = stackOf(u.id, g);
      for (let i = 1; i < stack.length; i++) {
        const a = rects.get(stack[i - 1]), b = rects.get(stack[i]);
        if (a && b) edges.push({ from: stack[i - 1], to: stack[i], s: bottom(a), t: top(b), prefY: (a.y + a.h + b.y) / 2 });
      }
      srcKey = stack[stack.length - 1];
    }
    const src = rects.get(srcKey);
    if (!src) continue;
    const s = bottom(src);
    // Led cards inside a group are led from the card above the group.
    const fromChip: Array<[string, string]> = [
      ...g.led.map((k): [string, string] => [`${u.kind === "GROUP" ? effParentOf(k.id) : u.id}:${k.leadUserId}`, `c:${k.id}`]),
      ...g.rt.map(([id]): [string, string] => [`${u.id}:${id}`, `b:${u.id}:rt:${id}`]),
    ];
    const led = fromChip.flatMap(([chipKey, to]) => {
      const c = chipAt(chipKey), r = rects.get(to);
      return c && r ? [{ from: c.box, to, s: bottom(c.r), t: top(r) }] : [];
    });
    // One 12px track per leader line, the one going farthest out highest, so neighbouring leaders'
    // lines nest instead of crossing; left-going first, then right-going.
    const out = [...led.filter((e) => e.t.x < e.s.x).sort((a, b) => a.t.x - b.t.x), ...led.filter((e) => e.t.x >= e.s.x).sort((a, b) => b.t.x - a.t.x)];
    out.forEach((e, k) => edges.push({ ...e, prefY: s.y + 12 + 12 * k }));
    const bus = [...(g.staff.length ? [`b:${u.id}:staff`] : []), ...g.free.map((k) => `c:${k.id}`)].filter((k) => rects.has(k));
    if (bus.length) {
      const tops = bus.map((k) => rects.get(k)!.y).filter((y) => y > s.y + 8);
      const busY = tops.length ? Math.min(...tops) - 18 : s.y + 14;
      // The crossbar's stem leaves the box above the middle of its own cards (still inside the box), so
      // it does not cut through the leaders' lines beside it; clear of the leaders' own drops.
      const xs = bus.map((k) => { const r = rects.get(k)!; return r.x + r.w / 2; });
      let x = u.kind === "GROUP" ? s.x : Math.min(src.x + src.w - 18, Math.max(src.x + 18, (Math.min(...xs) + Math.max(...xs)) / 2));
      if (Math.abs(x - s.x) < 24) x = s.x;
      else {
        // Off the middle it leaves through a gap between two people, never from under one of them —
        // a stem under Mimiw read as Mimiw leading every IP.
        const inBox = Object.keys(chips).filter((k) => chips[k].box === srcKey).map((k) => chipAt(k)!.r).sort((a, b) => a.x - b.x);
        const gaps = inBox.slice(1).map((r, i) => (inBox[i].x + inBox[i].w + r.x) / 2);
        if (gaps.length) x = gaps.reduce((best, g) => (Math.abs(g - x) < Math.abs(best - x) ? g : best), gaps[0]);
      }
      for (let k = 0; k < 6 && led.some((e) => Math.abs(e.s.x - x) < 10); k++) x = x + 12 <= src.x + src.w - 12 ? x + 12 : x - 12;
      const stem = { x, y: s.y };
      for (const k of bus) edges.push({ from: srcKey, to: k, s: stem, t: top(rects.get(k)!), prefY: busY });
    }
  }
  return edges;
}

/** Position of `el` inside `root` in unscaled layout pixels (offsets, not getBoundingClientRect — the
 *  canvas is CSS-scaled). Every positioned ancestor on the way is an offsetParent. */
function offsetIn(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0, y = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== root) { x += cur.offsetLeft; y += cur.offsetTop; cur = cur.offsetParent as HTMLElement | null; }
  return { x, y };
}

/**
 * Whether a logo is mostly light (white text on a transparent PNG) or dark, from its own pixels, so it
 * gets a background it can be read on: light logos on the card's dark blue, dark ones on white
 * (owner, 30 Sep 2026: a white logo vanished on the white tile). Cached per URL.
 */
const logoTone = new Map<string, "light" | "dark">();
function useLogoTone(url: string | null): "light" | "dark" | null {
  const [tone, setTone] = useState<"light" | "dark" | null>(url ? logoTone.get(url) ?? null : null);
  useEffect(() => {
    if (!url) { setTone(null); return; }
    const known = logoTone.get(url);
    if (known) { setTone(known); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 32; c.height = 32;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 32, 32);
        const d = ctx.getImageData(0, 0, 32, 32).data;
        let sum = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3] / 255;
          if (a < 0.2) continue;
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          n++;
        }
        const t = n > 0 && sum / n > 0.72 ? "light" : "dark";
        logoTone.set(url, t);
        setTone(t);
      } catch { /* unreadable pixels: keep the white tile */ }
    };
    img.src = url;
  }, [url]);
  return tone;
}

function UnitLogo({ u, size }: { u: OrgUnit; size: number }) {
  const [broken, setBroken] = useState(false);
  const tone = useLogoTone(u.logoUrl && !broken ? u.logoUrl : null);
  if (u.logoUrl && !broken) {
    return <img src={u.logoUrl} alt="" onError={() => setBroken(true)} style={{ width: size, height: size }} className={cn("shrink-0 rounded-lg object-contain p-0.5 ring-1 ring-white/30", tone === "light" ? "bg-[#0f1b2d]" : "bg-white")} />;
  }
  return <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-lg bg-white/15 text-[11px] font-bold">{initialsOf(u.name)}</span>;
}

type CardTone = "root" | "ip" | "division" | "sub";
/** The top IP darkest, IPs navy, divisions a light navy tint, a division's own sub-divisions white —
 *  so the level reads before the name does (owner, 5 Oct 2026). */
const CARD_TONE: Record<CardTone, string> = {
  root: "bg-[#0f2742] text-white shadow-[0_1px_2px_rgba(15,39,66,.3),0_8px_20px_-8px_rgba(15,39,66,.5)]",
  ip: "bg-[#1e3a5f] text-white shadow-[0_1px_2px_rgba(15,39,66,.25),0_6px_14px_-8px_rgba(15,39,66,.45)]",
  division: "border border-[#c6d4e7] bg-[#edf2f9] text-[#15304f] shadow-[0_1px_2px_rgba(15,39,66,.06)] dark:border-[#2e4565] dark:bg-[#1a2a41] dark:text-[#dce7f6]",
  sub: "border border-[#d8e0eb] bg-white text-[#22344d] shadow-[0_1px_2px_rgba(15,39,66,.05)] dark:border-[#2b3547] dark:bg-[#151b26] dark:text-[#d4dce8]",
};
const FACE_RING: Record<CardTone, string> = {
  root: "ring-[#0f2742]", ip: "ring-[#1e3a5f]", division: "ring-[#edf2f9] dark:ring-[#1a2a41]", sub: "ring-white dark:ring-[#151b26]",
};

/** Kartu IP/Team: logo (IP saja) + nama + jumlah orang. Diseret oleh kanvas; klik = ubah. */
function UnitCard({ u, busy, tone, meta, faces = [], dragging, onKeyOpen }: { u: OrgUnit; busy: boolean; tone: CardTone; meta: string; faces?: OrgChartPerson[]; dragging: boolean; onKeyOpen?: () => void }) {
  const onDark = tone === "root" || tone === "ip";
  return (
    <div className="relative rounded-xl">
      <button
        type="button"
        // A pointer click is handled by the canvas (it tells a click from a drag); a keyboard one is here.
        onClick={(e) => { if (e.detail === 0) onKeyOpen?.(); }}
        disabled={busy}
        title="Klik untuk mengubah · seret untuk memindah · jatuhkan di atas kartu lain untuk pindah induk"
        className={cn("pointer-events-none flex min-w-[176px] max-w-[232px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition disabled:opacity-50", CARD_TONE[tone], tone === "root" && "min-w-[212px] py-3", dragging && "opacity-80 shadow-lg")}
      >
        {/* Only an IP carries a logo; a division is just its name (owner, 30 Sep 2026). */}
        {u.kind === "IP" && <UnitLogo u={u} size={tone === "root" ? 40 : 34} />}
        <span className="min-w-0 flex-1">
          <span className={cn("line-clamp-2 font-semibold leading-tight [overflow-wrap:anywhere]", tone === "root" ? "text-[14px]" : "text-[13px]")} title={u.name}>{u.name}</span>
          <span className={cn("mt-0.5 block text-[10.5px] leading-tight", onDark ? "text-white/70" : "text-[#5a6b83] dark:text-[#9fb0c8]")}>{meta}</span>
          {faces.length > 0 && (
            <span className="mt-1.5 flex items-center">
              {faces.slice(0, 4).map((p, i) => (p.avatar
                ? <img key={p.userId} src={p.avatar} alt="" title={label(p)} className={cn("h-5 w-5 shrink-0 rounded-full object-cover ring-2", FACE_RING[tone], i > 0 && "-ml-1.5")} />
                : <span key={p.userId} title={label(p)} className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8px] font-bold ring-2", onDark ? "bg-white/20" : "bg-[#1e3a5f]/10 text-[#1e3a5f]", FACE_RING[tone], i > 0 && "-ml-1.5")}>{initialsOf(p.name)}</span>))}
              {faces.length > 4 && <span className={cn("ml-1 text-[10px] font-semibold", onDark ? "text-white/70" : "text-[#5a6b83]")}>+{faces.length - 4}</span>}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

function PersonChip({ p, busy, dragging, onDragStart, onDragEnd, onClick, onRemove, extra, jobTitle, variant = "chip" }: PersonChipProps) {
  const row = variant === "row";
  return (
    <div className="group relative">
    <button
      type="button"
      draggable={!busy}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.userId); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      disabled={busy}
      title="Klik untuk pilih IP/Team, atau seret ke kartunya"
      className={cn(
        row
          ? "flex w-full min-w-[148px] max-w-[212px] cursor-grab items-center gap-2 rounded-lg px-1.5 py-1 text-left text-foreground transition hover:bg-muted active:cursor-grabbing disabled:opacity-50"
          : "flex w-[156px] cursor-grab items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left text-foreground shadow-sm transition hover:border-primary active:cursor-grabbing disabled:opacity-50",
        dragging && "opacity-40")}
    >
      {p.avatar
        ? <img src={p.avatar} alt="" className={cn("shrink-0 rounded-full object-cover", row ? "h-[26px] w-[26px]" : "h-7 w-7")} />
        : <span className={cn("grid shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary", row ? "h-[26px] w-[26px]" : "h-7 w-7")}>{initialsOf(p.name)}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold leading-tight" title={label(p)}>{label(p)}</span>
        <span className="block truncate text-[10px] leading-tight text-muted-foreground">
          {jobTitle ? <b className="font-semibold text-foreground">{jobTitle} · </b> : null}{ROLE_SUB[p.role] ?? p.role}{extra > 0 && ` · +${extra} IP/Team lain`}
        </span>
      </span>
    </button>
    {onRemove && (
      <button type="button" onClick={onRemove} disabled={busy} aria-label={`Lepas ${label(p)} dari kartu ini`} title="Lepas dari kartu ini"
        className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition hover:text-rose-700 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40">
        <X className="h-3 w-3" />
      </button>
    )}
    </div>
  );
}

/** Label induk dengan jalurnya, "PATS Group › PATS X", supaya dua team bernama sama bisa dibedakan. */
function pathOf(u: OrgUnit, byId: Map<string, OrgUnit>): string {
  const names = [u.name];
  const seen = new Set([u.id]);
  let cur = u.parentId ? byId.get(u.parentId) : undefined;
  while (cur && !seen.has(cur.id)) { names.unshift(cur.name); seen.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
  return names.join(" › ");
}

const KIND_ICON = { IP: Building2, DIVISION: Users, GROUP: LayoutGrid } as const;
const KIND_LABEL: Record<OrgUnit["kind"], string> = { IP: "IP / Perusahaan", DIVISION: "Divisi / Team", GROUP: "Grup" };
const KIND_SUB: Record<OrgUnit["kind"], string> = { IP: "Punya logo sendiri", DIVISION: "Tim kerja, tanpa logo", GROUP: "Cuma mengelompokkan kartu" };

/** A unit's small square: its logo (an IP that has one) or the icon of its kind. */
function KindTile({ kind, logoUrl, size = 28 }: { kind: OrgUnit["kind"]; logoUrl?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const showLogo = kind === "IP" && !!logoUrl && !broken;
  const tone = useLogoTone(showLogo ? logoUrl! : null);
  if (showLogo) {
    return <img src={logoUrl!} alt="" onError={() => setBroken(true)} style={{ width: size, height: size }} className={cn("shrink-0 rounded-lg object-contain p-0.5 ring-1 ring-black/5", tone === "light" ? "bg-[#0f1b2d]" : "bg-white")} />;
  }
  const Icon = KIND_ICON[kind];
  return (
    <span style={{ width: size, height: size }} className={cn("grid shrink-0 place-items-center rounded-lg",
      kind === "IP" ? "bg-[#1e3a5f] text-white" : kind === "DIVISION" ? "bg-[#edf2f9] text-[#1e3a5f] dark:bg-[#1a2a41] dark:text-[#dce7f6]" : "bg-muted text-muted-foreground")}>
      <Icon className="h-[55%] w-[55%]" />
    </span>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{children}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** "PT. The Z Networks › Framework Agency" — the path ABOVE a unit. */
function parentTrail(u: OrgUnit, byId: Map<string, OrgUnit>): string {
  const full = pathOf(u, byId);
  const i = full.lastIndexOf(" › ");
  return i >= 0 ? full.slice(0, i) : "";
}

/**
 * Where a card sits (owner, 5 Oct 2026: the long "Di bawah" dropdown was cut off and confusing). Shows
 * the current place; "Ganti" opens the whole chart as an indented list, and typing turns it into a flat
 * list of paths. The card's own branch is left out — it cannot sit inside itself.
 */
function ParentPicker({ units, value, excluded, onChange }: { units: OrgUnit[]; value: string; excluded: Set<string>; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const rows = useMemo(() => {
    const kids = new Map<string | null, OrgUnit[]>();
    for (const u of units) {
      const p = u.parentId && byId.has(u.parentId) ? u.parentId : null;
      kids.set(p, [...(kids.get(p) ?? []), u]);
    }
    for (const list of kids.values()) list.sort(byPos);
    const out: Array<{ u: OrgUnit; depth: number }> = [];
    const seen = new Set<string>();
    const walk = (p: string | null, depth: number) => {
      for (const u of kids.get(p) ?? []) {
        if (seen.has(u.id) || excluded.has(u.id)) continue;
        seen.add(u.id);
        out.push({ u, depth });
        walk(u.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [units, byId, excluded]);
  const current = value ? byId.get(value) ?? null : null;
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => pathOf(r.u, byId).toLowerCase().includes(needle)) : rows;
  const choose = (id: string) => { onChange(id); setOpen(false); setQ(""); };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2 text-left transition hover:border-[#1e3a5f]/50">
        {current
          ? <KindTile kind={current.kind} logoUrl={current.logoUrl} size={28} />
          : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><ArrowUpToLine className="h-3.5 w-3.5" /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{current ? current.name : "Paling atas"}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{current ? parentTrail(current, byId) || "paling atas" : "tanpa induk"}</span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-[#1e3a5f] dark:text-[#9fb6d6]">Ganti</span>
      </button>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[#1e3a5f]/40 bg-background dark:border-[#9fb6d6]/40">
      <div className="relative border-b border-border">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); setQ(""); } }}
          placeholder="Cari IP, divisi, atau grup…" className="w-full bg-transparent py-2.5 pl-8 pr-16 text-sm outline-none" />
        <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-0.5 text-xs font-semibold text-muted-foreground hover:bg-accent">Tutup</button>
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {!needle && (
          <PickRow selected={!value} onClick={() => choose("")} depth={0} label="Paling atas" sub="tanpa induk"
            icon={<span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><ArrowUpToLine className="h-3 w-3" /></span>} />
        )}
        {shown.map(({ u, depth }) => (
          <PickRow key={u.id} selected={value === u.id} onClick={() => choose(u.id)} depth={needle ? 0 : depth} label={u.name}
            sub={needle ? parentTrail(u, byId) || undefined : u.kind === "GROUP" ? "grup" : undefined}
            icon={<KindTile kind={u.kind} logoUrl={u.logoUrl} size={22} />} />
        ))}
        {shown.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">Nggak ada yang cocok.</div>}
      </div>
    </div>
  );
}
function PickRow({ selected, onClick, depth, icon, label, sub }: { selected: boolean; onClick: () => void; depth: number; icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <button type="button" onClick={onClick} style={{ paddingLeft: 8 + depth * 18 }}
      className={cn("flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm transition hover:bg-accent", selected && "bg-[#1e3a5f]/[0.07] font-semibold dark:bg-[#9fb6d6]/10")}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate text-[11px] font-normal text-muted-foreground">{sub}</span>}
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-[#1e3a5f] dark:text-[#9fb6d6]" />}
    </button>
  );
}

/** Tambah atau ubah satu kartu: jenis, nama, logo, letak, pemimpin, dan jabatan orang-orangnya. */
function UnitDialog({ unit, units, excluded, initial, people = [], members = 0, subUnits = 0, onAddChild, onFocus, onClose, onSaved }: {
  unit?: OrgUnit; units: OrgUnit[]; excluded: Set<string>; initial: { name: string; parentId: string | null }; people?: OrgChartPerson[];
  members?: number; subUnits?: number; onAddChild?: () => void; onFocus?: () => void; onClose: () => void; onSaved: () => void;
}) {
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const [name, setName] = useState(initial.name);
  const [parentId, setParentId] = useState<string>(initial.parentId ?? "");
  // A new card guesses its kind from the cards it will sit next to (a company under the top, a division
  // under a company) until a kind is picked by hand.
  const guessKind = (pid: string): OrgUnit["kind"] => {
    if (!pid) return "IP";
    const next = units.filter((u) => u.parentId === pid && u.kind !== "GROUP");
    if (next.length) return next.filter((u) => u.kind === "IP").length * 2 > next.length ? "IP" : "DIVISION";
    const p = byId.get(pid);
    return p && !p.parentId && p.kind !== "GROUP" ? "IP" : "DIVISION";
  };
  const [kind, setKindRaw] = useState<OrgUnit["kind"]>(unit?.kind ?? guessKind(initial.parentId ?? ""));
  const [kindPicked, setKindPicked] = useState(!!unit);
  const setKind = (k: OrgUnit["kind"]) => { setKindRaw(k); setKindPicked(true); };
  const changeParent = (pid: string) => { setParentId(pid); if (!kindPicked) setKindRaw(guessKind(pid)); };
  const [logo, setLogo] = useState<string | null>(unit?.logoUrl ?? null);
  // A new IP's logo waits here and is uploaded right after the card exists.
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const pendingUrl = useMemo(() => (pendingLogo ? URL.createObjectURL(pendingLogo) : null), [pendingLogo]);
  useEffect(() => () => { if (pendingUrl) URL.revokeObjectURL(pendingUrl); }, [pendingUrl]);
  const shownLogo = pendingUrl ?? logo;
  const previewTone = useLogoTone(shownLogo);
  const [leadUserId, setLeadUserId] = useState<string>(unit?.leadUserId ?? "");
  // Who may lead: the BoD / One Above All / Manager people of the chosen parent card — or, when the
  // parent is a group, of the card above the group(s).
  const leadCard = (() => {
    const seen = new Set<string>();
    let p: string | null = parentId || null;
    while (p && byId.get(p)?.kind === "GROUP" && !seen.has(p)) { seen.add(p); p = byId.get(p)?.parentId ?? null; }
    return p && byId.get(p)?.kind !== "GROUP" ? p : null;
  })();
  const viaGroup = !!parentId && byId.get(parentId)?.kind === "GROUP";
  const leadCandidates = leadCard ? people.filter((p) => p.unitIds.includes(leadCard) && LEAD_ROLES.has(p.role)) : [];
  const leadValid = !leadUserId || leadCandidates.some((p) => p.userId === leadUserId);
  const cardPeople = unit ? people.filter((p) => p.unitIds.includes(unit.id)) : [];
  const isGroup = kind === "GROUP";
  const groupBlocked = isGroup && unit?.kind !== "GROUP" && cardPeople.length > 0;
  const parent = parentId ? byId.get(parentId) ?? null : null;
  // Under a division a division is a sub-division (owner, 5 Oct 2026: "sub divisi baru").
  const kindTitle = (k: OrgUnit["kind"]) => (k === "DIVISION" && parent?.kind === "DIVISION" ? "Sub-divisi" : KIND_LABEL[k]);
  const examples = units.filter((u) => u.kind === kind && u.id !== unit?.id && (kind !== "IP" || !!u.parentId)).slice(0, 3).map((u) => u.name);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const title = unit ? unit.name : parent ? `Tambah di bawah ${parent.name}` : "Tambah ke bagan";
  const subtitle = unit
    ? [kindTitle(unit.kind), `${members} orang`, subUnits > 0 ? `${subUnits} di bawahnya` : null].filter(Boolean).join(" · ")
    : "Pilih jenisnya, beri nama, lalu cek letaknya.";

  const save = async () => {
    const clean = name.trim();
    if (!clean) { toast.error("Namanya diisi dulu."); return; }
    setSaving(true);
    try {
      if (unit) {
        await nexusApi.updateOrgUnit(unit.id, { name: clean, kind, parentId: parentId || null, leadUserId: isGroup ? null : leadValid ? leadUserId || null : null });
        toast.success("Tersimpan");
      } else {
        const { unit: made } = await nexusApi.createOrgUnit({ name: clean, kind, parentId: parentId || null });
        if (!isGroup && leadValid && leadUserId) await nexusApi.updateOrgUnit(made.id, { leadUserId });
        if (kind === "IP" && pendingLogo) {
          try { await nexusApi.uploadOrgUnitLogo(made.id, pendingLogo); }
          catch { toast.error("Logo gagal diunggah", { description: "Kartunya sudah dibuat — pasang logonya lagi dari kartu itu." }); }
        }
        toast.success(`${clean} ditambahkan`);
      }
      onSaved();
    } catch (e) {
      toast.error("Gagal menyimpan", { description: e instanceof ApiError ? e.message : "Coba lagi." });
    } finally { setSaving(false); }
  };
  const pickLogo = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo maksimal 2 MB."); return; }
    if (!unit) { setPendingLogo(file); return; }
    setUploading(true);
    try {
      const r = await nexusApi.uploadOrgUnitLogo(unit.id, file);
      setLogo(r.unit.logoUrl);
      toast.success("Logo terpasang");
    } catch (e) {
      toast.error("Gagal mengunggah logo", { description: e instanceof ApiError ? e.message : "Coba lagi." });
    } finally { setUploading(false); }
  };
  const removeLogo = async () => {
    if (!unit) { setPendingLogo(null); return; }
    setUploading(true);
    try { await nexusApi.updateOrgUnit(unit.id, { logoUrl: null }); setLogo(null); }
    catch (e) { toast.error("Gagal menghapus logo", { description: e instanceof ApiError ? e.message : "Coba lagi." }); }
    finally { setUploading(false); }
  };
  const remove = async () => {
    if (!unit) return;
    setSaving(true);
    try {
      await nexusApi.deleteOrgUnit(unit.id);
      toast.success(`${unit.name} dihapus`);
      onSaved();
    } catch (e) {
      toast.error("Gagal menghapus", { description: e instanceof ApiError ? e.message : "Coba lagi." });
      setSaving(false);
    }
  };
  const leadTitle = (p: OrgChartPerson) => (leadCard ? p.titles?.[leadCard] : null) ?? ROLE_SUB[p.role] ?? p.role;

  return (
    <>
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="oc-unit-title" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(92vh,780px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <KindTile kind={kind} logoUrl={shownLogo} size={40} />
          <div className="min-w-0 flex-1">
            <div id="oc-unit-title" className="line-clamp-2 text-[15px] font-bold leading-tight">{title}</div>
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{subtitle}</div>
          </div>
          {onFocus && (
            <button type="button" onClick={onFocus} title="Tampilkan bagian ini saja, disusun otomatis" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#1e3a5f] hover:bg-accent dark:text-[#9fb6d6]">
              <Focus className="h-3.5 w-3.5" /> Lihat isinya
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <FieldLabel>{unit ? "Jenis" : "Mau nambah apa?"}</FieldLabel>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Jenis">
              {(["IP", "DIVISION", "GROUP"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                  className={cn("flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition sm:flex-col sm:items-start sm:gap-1.5",
                    kind === k ? "border-[#1e3a5f] bg-[#1e3a5f]/[0.06] ring-1 ring-[#1e3a5f] dark:border-[#9fb6d6] dark:bg-[#9fb6d6]/10 dark:ring-[#9fb6d6]" : "border-border hover:border-[#1e3a5f]/40")}>
                  <KindTile kind={k} size={26} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-tight">{kindTitle(k)}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{KIND_SUB[k]}</span>
                  </span>
                </button>
              ))}
            </div>
            {examples.length > 0 && <p className="mt-1.5 text-[11px] text-muted-foreground">Contoh di bagan: {examples.join(", ")}</p>}
            {isGroup && (
              <div className={cn("mt-2 rounded-lg px-3 py-2 text-[11px]", groupBlocked ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "bg-muted/60 text-muted-foreground")}>
                {groupBlocked
                  ? `Kartu ini masih berisi ${cardPeople.length} orang. Lepas orangnya dulu sebelum dijadikan Grup.`
                  : "Grup hanya mengelompokkan kartu — tanpa logo, tanpa orang, tanpa pemimpin. Isinya disusun otomatis di dalamnya."}
              </div>
            )}
          </section>

          <section>
            <FieldLabel>Nama</FieldLabel>
            <input autoFocus={!unit} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} maxLength={80}
              placeholder={kind === "IP" ? "Misal: PATS" : kind === "GROUP" ? "Misal: Creative" : "Misal: Multimedia"}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/15 dark:focus:border-[#9fb6d6]" />
          </section>

          {kind === "IP" && (
            <section>
              <FieldLabel hint="PNG, JPG, atau WebP · maks 2 MB">Logo</FieldLabel>
              <div className="flex items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted/50">
                  {shownLogo
                    ? <img src={shownLogo} alt="" className={cn("h-full w-full object-contain p-1", previewTone === "light" ? "bg-[#0f1b2d]" : "bg-white")} />
                    : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickLogo(e.target.files?.[0])} />
                  <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50">
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} {shownLogo ? "Ganti logo" : "Pasang logo"}
                  </button>
                  {shownLogo && <button type="button" disabled={uploading} onClick={removeLogo} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent disabled:opacity-50">Hapus logo</button>}
                  <span className="w-full text-[11px] text-muted-foreground">{unit ? "Sebaiknya persegi." : "Opsional, bisa juga nanti. Sebaiknya persegi."}</span>
                </div>
              </div>
            </section>
          )}

          <section>
            <FieldLabel>Letaknya</FieldLabel>
            <ParentPicker units={units} value={parentId} excluded={excluded} onChange={changeParent} />
          </section>

          {!isGroup && parentId && leadCandidates.length > 0 && (
            <section>
              <FieldLabel hint="opsional">Dipimpin oleh</FieldLabel>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Dipimpin oleh">
                <LeadChip on={!leadUserId || !leadValid} onClick={() => setLeadUserId("")}>Tidak ada</LeadChip>
                {leadCandidates.map((p) => (
                  <LeadChip key={p.userId} on={leadUserId === p.userId} onClick={() => setLeadUserId(p.userId)}>
                    {p.avatar
                      ? <img src={p.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
                      : <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[8px] font-bold text-primary">{initialsOf(p.name)}</span>}
                    <span className="font-semibold">{label(p)}</span>
                    <span className="text-muted-foreground">{leadTitle(p)}</span>
                  </LeadChip>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {viaGroup ? `Dari BoD/Manager ${byId.get(leadCard!)?.name ?? "kartu di atas grup"}. ` : ""}Kartu ini digambar di bawah orang yang dipilih, dan garisnya ditarik dari dia.
              </p>
            </section>
          )}

          {unit && !isGroup && cardPeople.length > 0 && (
            <section>
              <FieldLabel hint="jabatan tampil di bagan">Orang di kartu ini · {cardPeople.length}</FieldLabel>
              <div className="-mx-1 space-y-0.5">
                {cardPeople.map((p) => <TitleRow key={p.userId} person={p} unitId={unit.id} leaders={cardPeople.filter((x) => x.userId !== p.userId && LEAD_ROLES.has(x.role))} />)}
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center gap-1.5 border-t border-border bg-muted/30 px-5 py-3">
          {unit && (
            <button type="button" disabled={saving} onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/40">
              <Trash2 className="h-3.5 w-3.5" /> Hapus
            </button>
          )}
          {unit && onAddChild && (
            <button type="button" onClick={onAddChild} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#1e3a5f] hover:bg-accent dark:text-[#9fb6d6]">
              <Plus className="h-3.5 w-3.5" /> {unit.kind === "GROUP" ? "Tambah ke grup ini" : "Tambah di bawahnya"}
            </button>
          )}
          {!unit && <button type="button" onClick={onClose} className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">Batal</button>}
          <button type="button" disabled={saving || groupBlocked} onClick={save} className={cn("inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50", unit && "ml-auto")}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {unit ? "Simpan" : "Tambah"}
          </button>
        </div>
      </div>
    </div>

      {unit && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent className="z-[80]">
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus {unit.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {members > 0 ? `${members} orang dilepas dari kartu ini (tetap di IP/Team lainnya). ` : ""}
                {subUnits > 0 ? `${subUnits} sub-IP/Team naik ke induknya. ` : ""}
                Tidak ada akses project yang berubah.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction onClick={remove} className="bg-rose-600 hover:bg-rose-700">Hapus</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
function LeadChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
        on ? "border-[#1e3a5f] bg-[#1e3a5f]/[0.07] ring-1 ring-[#1e3a5f] dark:border-[#9fb6d6] dark:bg-[#9fb6d6]/10 dark:ring-[#9fb6d6]" : "border-border hover:border-[#1e3a5f]/40")}>
      {children}
    </button>
  );
}

/** Centang IP/Team untuk satu orang — boleh lebih dari satu. Tiap centang langsung tersimpan. */
function UnitPicker({ person, units, people, busy, onToggle, onPlaceUnder, onRelease, onClose }: {
  person: OrgChartPerson; units: OrgUnit[]; people: OrgChartPerson[]; busy: boolean;
  onToggle: (unitId: string, on: boolean) => void;
  onPlaceUnder: (person: OrgChartPerson, leaderId: string, unitId: string) => void;
  onRelease: (unitId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const parentPath = (u: OrgUnit) => { const full = pathOf(u, byId); const i = full.lastIndexOf(" › "); return i >= 0 ? full.slice(0, i) : ""; };
  const rows = units.filter((u) => u.kind !== "GROUP").map((u) => ({ id: u.id, u, path: pathOf(u, byId), parent: parentPath(u) }))
    .filter((r) => !needle || r.path.toLowerCase().includes(needle))
    .sort((a, b) => a.path.localeCompare(b.path, "id"));
  // Every BoD / One Above All / Manager, once per card they sit in. A BoD never goes under anyone.
  const canBeUnder = person.role !== "BOD" && person.role !== "ONE_ABOVE_ALL";
  const leaderRows = canBeUnder
    ? people.filter((p) => p.userId !== person.userId && LEAD_ROLES.has(p.role))
      .flatMap((p) => p.unitIds.map((unitId) => ({ p, unitId, unit: byId.get(unitId), title: p.titles?.[unitId] ?? null })))
      .filter((r): r is { p: OrgChartPerson; unitId: string; unit: OrgUnit; title: string | null } => !!r.unit && r.unit.kind !== "GROUP")
      .filter((r) => !needle || `${label(r.p)} ${r.title ?? ""} ${r.unit.name}`.toLowerCase().includes(needle))
      .sort((a, b) => label(a.p).localeCompare(label(b.p), "id") || a.unit.name.localeCompare(b.unit.name, "id"))
    : [];
  const current = Object.entries(person.reportsTo ?? {})
    .map(([unitId, leaderId]) => ({ unitId, unit: byId.get(unitId), leader: people.find((p) => p.userId === leaderId) }))
    .filter((c) => c.unit && c.leader);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-bold">{label(person)}</div>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">Taruh di bawah seseorang, atau centang IP/Team-nya. Tidak mengubah akses project.</p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, jabatan, atau IP/Team…" className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {canBeUnder && (
            <section>
              <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Di bawah siapa</div>
              {current.map((c) => (
                <div key={c.unitId} className="mb-1 flex items-center gap-2 rounded-lg bg-primary/10 px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">Sekarang di bawah: <b>{c.leader!.name}</b> · {c.unit!.name}</span>
                  <button type="button" disabled={busy} onClick={() => onRelease(c.unitId)} className="shrink-0 rounded-md px-2 py-0.5 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Lepas</button>
                </div>
              ))}
              <div className="space-y-0.5">
                {leaderRows.map((r) => {
                  const on = person.reportsTo?.[r.unitId] === r.p.userId;
                  return (
                    <button key={`${r.p.userId}:${r.unitId}`} type="button" disabled={busy || on} onClick={() => onPlaceUnder(person, r.p.userId, r.unitId)}
                      className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-accent disabled:cursor-default", on && "bg-primary/10", busy && "opacity-60")}>
                      {r.p.avatar
                        ? <img src={r.p.avatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                        : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">{initialsOf(r.p.name)}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{label(r.p)}{r.title ? <span className="font-normal text-muted-foreground"> — {r.title}</span> : null}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{r.unit.name}</span>
                      </span>
                      {on && <span className="shrink-0 text-[11px] font-semibold text-primary">sekarang</span>}
                    </button>
                  );
                })}
                {leaderRows.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">{needle ? "Nggak ada yang cocok." : "Belum ada BoD atau Manager di kartu mana pun."}</div>}
              </div>
            </section>
          )}
          <section>
            <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">IP/Team</div>
            <div className="space-y-0.5">
              {rows.map((r) => { const on = person.unitIds.includes(r.id); return (
                <label key={r.id} className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-accent", on && "bg-primary/10 text-primary", busy && "pointer-events-none opacity-60")}>
                  <input type="checkbox" checked={on} disabled={busy} onChange={(e) => onToggle(r.id, e.target.checked)} className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
                  <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-[#1e3a5f] text-[9px] font-bold text-white">
                    {r.u.logoUrl ? <img src={r.u.logoUrl} alt="" className="h-full w-full bg-white object-contain" /> : initialsOf(r.u.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold" title={r.path}>{r.u.name}</span>
                    {r.parent && <span className="block truncate text-[11px] text-muted-foreground" title={r.parent}>{r.parent}</span>}
                  </span>
                </label>
              ); })}
              {rows.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">{units.length === 0 ? "Belum ada IP/Team. Tambahkan dulu." : "Nggak ada yang cocok."}</div>}
            </div>
          </section>
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Selesai</button>
      </div>
    </div>
  );
}

/** One person's title on one card. Saved on blur or Enter; empty = no title. */
function TitleRow({ person, unitId, leaders }: { person: OrgChartPerson; unitId: string; leaders: OrgChartPerson[] }) {
  const qc = useQueryClient();
  const initial = person.titles?.[unitId] ?? "";
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const next = v.trim();
    if (next === initial) return;
    setSaving(true);
    try {
      await nexusApi.setOrgUnitMemberTitle(person.userId, unitId, next || null);
      qc.invalidateQueries({ queryKey: ["nexus", "org-chart"] });
    } catch (e) {
      toast.error("Gagal menyimpan jabatan", { description: e instanceof ApiError ? e.message : "Coba lagi." });
      setV(initial);
    } finally { setSaving(false); }
  };
  const saveReportsTo = async (to: string | null) => {
    setSaving(true);
    try {
      await nexusApi.setOrgUnitMemberReportsTo(person.userId, unitId, to);
      qc.invalidateQueries({ queryKey: ["nexus", "org-chart"] });
    } catch (e) {
      toast.error("Gagal menyimpan atasan", { description: e instanceof ApiError ? e.message : "Coba lagi." });
    } finally { setSaving(false); }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/50">
      {person.avatar
        ? <img src={person.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
        : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initialsOf(person.name)}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight">{label(person)}</span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">{ROLE_SUB[person.role] ?? person.role}</span>
      </span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        maxLength={40} placeholder="Jabatan" disabled={saving} aria-label={`Jabatan ${label(person)}`}
        className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-[#1e3a5f] disabled:opacity-60 dark:focus:border-[#9fb6d6]" />
      {person.role !== "BOD" && person.role !== "ONE_ABOVE_ALL" && leaders.length > 0 && (
        <select value={person.reportsTo?.[unitId] ?? ""} disabled={saving} onChange={(e) => saveReportsTo(e.target.value || null)} title="Di bawah siapa" aria-label={`Atasan ${label(person)}`}
          className="w-28 rounded-lg border border-border bg-background px-1.5 py-1.5 text-xs outline-none focus:border-[#1e3a5f] disabled:opacity-60">
          <option value="">— di bawah —</option>
          {leaders.map((l) => <option key={l.userId} value={l.userId}>{label(l)}</option>)}
        </select>
      )}
    </div>
  );
}

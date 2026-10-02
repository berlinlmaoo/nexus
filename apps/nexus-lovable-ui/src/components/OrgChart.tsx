import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ImagePlus, Loader2, Maximize2, Minimize2, Plus, Scan, Search, Trash2, Wand2, X, ZoomIn, ZoomOut } from "lucide-react";
import { toPng } from "html-to-image";
import { ApiError, nexusApi, type OrgChartPerson, type OrgUnit } from "@/lib/nexus-api";
import {
  LAYOUT, applyManual, pathD, routeAll, tidyLayout,
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
 */
type Drag = { kind: "person"; id: string; fromUnitId: string | null } | null;
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
  const MIN_S = 0.3, MAX_S = 2.5;
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
    return { effParentOf, groupDepth, depthOf, inGroup, groups, roots };
  }, [units, unitsById, childUnits, membersOf]);

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
  }, [units, people]);

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
    const { groups, inGroup, depthOf, effParentOf, roots } = tree;
    const sizeOf = (k: string): Size => measured.sizes[k] ?? { w: 0, h: 0 };
    const base = tidyLayout({
      roots: roots.map((u) => u.id),
      isGroup: (id) => unitsById.get(id)?.kind === "GROUP",
      stack: (id) => stackOf(id, groups.get(id)!),
      row: (id) => rowOf(unitsById.get(id)!, groups.get(id)!),
      // Room for one elbow per led sub-unit / "di bawah" box above the shared crossbar.
      band: (id) => 46 + 6 * (groups.get(id)!.led.length + groups.get(id)!.rt.length),
      size: sizeOf,
    });
    const items = manualItems(units, inGroup, depthOf, base, temp, dragKey);
    const { rects } = applyManual(base.rects, items);
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
  }, [measured, tree, units, unitsById, temp, dragKey]);
  useLayoutEffect(() => { if (layout) fitView(); }, [!!layout]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (inGroup(id)) {
      clear();
      toast("Kartu di dalam grup disusun otomatis", { description: "Jatuhkan di atas kartu atau grup lain untuk memindahkannya, atau geser grupnya." });
      return;
    }
    // Never leave it on top of something: the nearest free place instead (8px grid), saved as such.
    const want = d.last ?? { x: snap(d.ox), y: snap(d.oy) };
    const items = manualItems(units, inGroup, tree.depthOf, layout.base, { ...temp, [d.key]: want }, null);
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

  return (
    <div className="space-y-4">
      <style>{`
        .oc-leaves{display:flex;flex-direction:column;gap:6px;padding:6px;border:1.5px dashed var(--oc-line);border-radius:12px;background:rgba(127,127,127,.04)}
        .oc-group{border:1.5px dashed var(--oc-line);border-radius:18px;background:rgba(127,127,127,.035)}
        .oc-group-title{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;padding:2px 10px;border-radius:999px;border:1px solid var(--oc-line)}
        .oc-group-empty{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#94a3b8}
        .oc-leaves-label{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7b8494;text-align:center;padding-bottom:2px}
      `}</style>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs shadow-soft">
        <Stat n={chart.data.stats.units} label="IP/Team" />
        {(chart.data.stats.groups ?? 0) > 0 && <Stat n={chart.data.stats.groups ?? 0} label="grup" />}
        <Stat n={chart.data.stats.placed} of={chart.data.stats.people} label="orang sudah ditaruh" />
        <Stat n={unplaced.length} label="belum ditaruh" tone={unplaced.length > 0 ? "warn" : "ok"} />
        <span className="text-muted-foreground">Seret kartu atau kotak orang ke mana saja; seret orang ke chip atasannya.</span>
        <button type="button" onClick={() => setAdding({ parentId: null })} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90">
          <Plus className="h-3.5 w-3.5" /> Tambah IP/Team
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
        <div className="rounded-2xl border border-border bg-card shadow-soft" style={{ ["--oc-line" as string]: "#c7cfdb" }}>
          <section className={cn(full ? "fixed inset-0 z-[60] flex flex-col bg-card" : "border-b border-border")}>
            <div className={cn("flex items-center gap-2 px-5", full ? "border-b border-border py-3" : "pt-4 pb-2")}>
              <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {full ? "Bagan IP & Divisi" : "IP, divisi & team"} <span className="normal-case tracking-normal text-muted-foreground/70">· seret kartu/kotak ke mana saja · jatuhkan kartu di atas kartu atau grup = pindah induk · scroll/pinch = zoom</span>
              </div>
              <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <button type="button" onClick={() => zoomCenter(1 / 1.2)} className="rounded-md border border-border p-1 hover:bg-accent" aria-label="Perkecil"><ZoomOut className="h-3.5 w-3.5" /></button>
                <span className="w-10 text-center tabular-nums">{zoomLabel}%</span>
                <button type="button" onClick={() => zoomCenter(1.2)} className="rounded-md border border-border p-1 hover:bg-accent" aria-label="Perbesar"><ZoomIn className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={fitView} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent"><Scan className="h-3.5 w-3.5" /> Pas layar</button>
                <button type="button" onClick={() => setConfirmReset(true)} disabled={resetLayout.isPending} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent disabled:opacity-50" title="Hapus semua posisi manual; bagan disusun ulang otomatis">
                  {resetLayout.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Rapikan otomatis
                </button>
                <button type="button" onClick={exportPng} disabled={exporting} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent disabled:opacity-50" title="Unduh bagan sebagai PNG tajam (2x), apa pun zoom di layar">
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PNG
                </button>
                <button type="button" onClick={() => setFull((f) => !f)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent">
                  {full ? <><Minimize2 className="h-3.5 w-3.5" /> Tutup</> : <><Maximize2 className="h-3.5 w-3.5" /> Layar penuh</>}
                </button>
              </div>
            </div>
            <div
              ref={wrapRef}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("[draggable='true'],button")) fitView(); }}
              className={cn("relative w-full select-none overflow-hidden bg-[radial-gradient(circle,rgba(0,0,0,.06)_1px,transparent_1px)] [background-size:18px_18px]", full ? "min-h-0 flex-1" : "h-[min(72vh,820px)]", panning ? "cursor-grabbing" : "cursor-grab")}
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
                          <div className="oc-group-title bg-background text-muted-foreground">{u.name} · {childUnits.get(u.id)?.length ?? 0}</div>
                        </div>
                      );
                    }
                    return (
                      <Fragment key={u.id}>
                        <div data-oc-m={`c:${u.id}`} className="absolute left-0 top-0 w-max"><UnitCard u={u} busy={false} count={membersOf.get(u.id)?.length ?? 0} dragging={false} /></div>
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
                      {layout.lines.map((l) => <path key={`${l.from}>${l.to}`} data-oc-from={l.from} data-oc-to={l.to} d={pathD(l.pts)} fill="none" stroke="#c7cfdb" strokeWidth={2} strokeLinejoin="round" />)}
                    </svg>
                    {[...layout.rects].map(([key, r]) => {
                      const [t, id, ...rest] = key.split(":");
                      const u = unitsById.get(id);
                      if (!u) return null;
                      const lift = layout.lifted.has(key) ? 40 : 0;
                      if (t === "t") {
                        return (
                          <div key={key} data-oc-key={key} className="oc-group-title pointer-events-none absolute bg-background text-muted-foreground" style={{ left: r.x, top: r.y, zIndex: 6 + lift }}>
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
                          <div key={key} data-oc-key={key} {...dragHandlers(key)} {...dropProps(u.id, u.id)} className={cn("absolute cursor-grab touch-none rounded-xl active:cursor-grabbing", (dropCard === u.id || overId === u.id) && "ring-2 ring-primary ring-offset-2")} style={style}>
                            <UnitCard u={u} busy={busy} count={membersOf.get(u.id)?.length ?? 0} dragging={dragKey === key} onKeyOpen={() => setEditing(u)} />
                          </div>
                        );
                      }
                      const g = groups.get(id)!;
                      const kind = rest.join(":");
                      // Inside a group everything is laid out automatically: the box is not moved on its own.
                      const locked = inGroup(id);
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
          title="Tambah IP/Team"
          units={units}
          excluded={new Set()}
          initial={{ name: "", parentId: adding.parentId }}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); refresh(); }}
        />
      )}
      {editing && (
        <UnitDialog
          title={`Ubah ${editing.name}`}
          unit={editing}
          units={units}
          excluded={descendantsOf(editing.id).add(editing.id)}
          initial={{ name: editing.name, parentId: editing.parentId }}
          people={people}
          members={membersOf.get(editing.id)?.length ?? 0}
          subUnits={childUnits.get(editing.id)?.length ?? 0}
          onAddChild={() => { const parentId = editing.id; setEditing(null); setAdding({ parentId }); }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
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

type PersonChipProps = { p: OrgChartPerson; busy: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void; onRemove?: () => void; extra: number; jobTitle?: string | null };

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
  const row = [...g.led.map((k) => `u:${k.id}`), ...g.rt.map(([id]) => `b:${u.id}:rt:${id}`), ...g.free.map((k) => `u:${k.id}`)];
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
function manualItems(units: OrgUnit[], inGroup: (id: string) => boolean, depthOf: (id: string) => number, base: Placement, temp: Record<string, Pt>, dragKey: string | null): ManualItem[] {
  const cards: Array<ManualItem & { depth: number }> = [];
  const boxes: ManualItem[] = [];
  for (const u of units) {
    const key = `c:${u.id}`;
    if (!base.rects.has(key)) continue;
    const grouped = inGroup(u.id);
    // A card inside a group only moves while it is dragged (to be dropped on another card).
    const pos = temp[key] ?? (!grouped && u.layoutX != null && u.layoutY != null ? { x: u.layoutX, y: u.layoutY } : null);
    if (pos) cards.push({ id: key, keys: base.subtree.get(u.id) ?? [key], anchor: key, pos, resolve: key !== dragKey, depth: depthOf(u.id) });
    if (grouped || u.kind === "GROUP") continue;
    const prefix = `b:${u.id}:`;
    const kinds = new Set([...Object.keys(u.boxLayout ?? {}), ...Object.keys(temp).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))]);
    for (const kind of kinds) {
      const bk = prefix + kind;
      const p = temp[bk] ?? u.boxLayout?.[kind];
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
  return (
    <div className="oc-leaves">
      <div className="oc-leaves-label">{title}</div>
      <div className={cn("flex gap-1.5", row ? "flex-row" : "flex-col")}>
        {list.map((p) => {
          const leader = LEAD_ROLES.has(p.role);
          const drop = leader && chipDrop ? chipDrop(unitId, p) : null;
          return (
            <div key={p.userId} data-oc-chip={leader ? `${unitId}:${p.userId}` : undefined}
              onDragOver={drop?.onDragOver} onDragLeave={drop?.onDragLeave} onDrop={drop?.onDrop}
              className={cn("rounded-lg", drop?.over && "ring-2 ring-primary ring-offset-1")}>
              <PersonChip {...personProps(p, unitId)} />
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
    const bus = [...(g.staff.length ? [`b:${u.id}:staff`] : []), ...g.free.map((k) => `c:${k.id}`)].filter((k) => rects.has(k));
    const tops = bus.map((k) => rects.get(k)!.y).filter((y) => y > s.y + 8);
    const busY = tops.length ? Math.min(...tops) - 18 : s.y + 14;
    for (const k of bus) edges.push({ from: srcKey, to: k, s, t: top(rects.get(k)!), prefY: busY });
    // Led cards inside a group are led from the card above the group.
    const fromChip: Array<[string, string]> = [
      ...g.led.map((k): [string, string] => [`${u.kind === "GROUP" ? effParentOf(k.id) : u.id}:${k.leadUserId}`, `c:${k.id}`]),
      ...g.rt.map(([id]): [string, string] => [`${u.id}:${id}`, `b:${u.id}:rt:${id}`]),
    ];
    fromChip.forEach(([chipKey, to], rank) => {
      const c = chipAt(chipKey), r = rects.get(to);
      if (c && r) edges.push({ from: c.box, to, s: bottom(c.r), t: top(r), prefY: s.y + 10 + 6 * rank });
    });
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

/** Kartu IP/Team: logo + nama + jumlah orang. Diseret oleh kanvas (bebas); klik = ubah. */
function UnitCard({ u, busy, count, dragging, onKeyOpen }: { u: OrgUnit; busy: boolean; count: number; dragging: boolean; onKeyOpen?: () => void }) {
  return (
    <div className="relative rounded-xl">
      <button
        type="button"
        // A pointer click is handled by the canvas (it tells a click from a drag); a keyboard one is here.
        onClick={(e) => { if (e.detail === 0) onKeyOpen?.(); }}
        disabled={busy}
        title="Klik untuk mengubah · seret untuk memindah · jatuhkan di atas kartu lain untuk pindah induk"
        className={cn("pointer-events-none flex w-[180px] items-center gap-2.5 rounded-lg bg-[#1e3a5f] px-2.5 py-2 text-left text-white shadow-[0_2px_0_rgba(0,0,0,.2)] transition disabled:opacity-50", dragging && "opacity-80 shadow-lg")}
      >
        {/* Only an IP carries a logo; a division is just its name (owner, 30 Sep 2026). */}
        {u.kind === "IP" && <UnitLogo u={u} size={34} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold leading-tight" title={u.name}>{u.name}</span>
          <span className="block text-[10px] leading-tight opacity-75">{count > 0 ? `${count} orang` : "belum ada orang"}</span>
        </span>
      </button>
    </div>
  );
}

function PersonChip({ p, busy, dragging, onDragStart, onDragEnd, onClick, onRemove, extra, jobTitle }: PersonChipProps) {
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
      className={cn("flex w-[156px] cursor-grab items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left text-foreground shadow-sm transition hover:border-primary active:cursor-grabbing disabled:opacity-50", dragging && "opacity-40")}
    >
      {p.avatar
        ? <img src={p.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
        : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initialsOf(p.name)}</span>}
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

/** Tambah atau ubah satu IP/Team: nama, induk, logo, hapus. */
function UnitDialog({ title, unit, units, excluded, initial, people = [], members = 0, subUnits = 0, onAddChild, onClose, onSaved }: {
  title: string; unit?: OrgUnit; units: OrgUnit[]; excluded: Set<string>; initial: { name: string; parentId: string | null }; people?: OrgChartPerson[];
  members?: number; subUnits?: number; onAddChild?: () => void; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [parentId, setParentId] = useState<string>(initial.parentId ?? "");
  const [logo, setLogo] = useState<string | null>(unit?.logoUrl ?? null);
  const [kind, setKind] = useState<"IP" | "DIVISION" | "GROUP">(unit?.kind ?? "DIVISION");
  const [leadUserId, setLeadUserId] = useState<string>(unit?.leadUserId ?? "");
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  // Who may lead: the BoD / One Above All / Manager people of the chosen parent card — or, when the
  // parent is a group, of the card above the group(s).
  const leadCard = (() => {
    const seen = new Set<string>();
    let p: string | null = parentId || null;
    while (p && unitById.get(p)?.kind === "GROUP" && !seen.has(p)) { seen.add(p); p = unitById.get(p)?.parentId ?? null; }
    return p && unitById.get(p)?.kind !== "GROUP" ? p : null;
  })();
  const viaGroup = !!parentId && unitById.get(parentId)?.kind === "GROUP";
  const leadCandidates = leadCard ? people.filter((p) => p.unitIds.includes(leadCard) && LEAD_ROLES.has(p.role)) : [];
  const leadValid = !leadUserId || leadCandidates.some((p) => p.userId === leadUserId);
  const cardPeople = unit ? people.filter((p) => p.unitIds.includes(unit.id)) : [];
  const isGroup = kind === "GROUP";
  const groupBlocked = isGroup && unit?.kind !== "GROUP" && cardPeople.length > 0;
  const previewTone = useLogoTone(logo);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const parents = units.filter((u) => !excluded.has(u.id)).map((u) => ({ id: u.id, path: pathOf(u, byId) })).sort((a, b) => a.path.localeCompare(b.path, "id"));

  const save = async () => {
    const clean = name.trim();
    if (!clean) { toast.error("Nama IP/Team wajib diisi."); return; }
    setSaving(true);
    try {
      if (unit) await nexusApi.updateOrgUnit(unit.id, { name: clean, kind, parentId: parentId || null, leadUserId: isGroup ? null : leadValid ? leadUserId || null : null });
      else await nexusApi.createOrgUnit({ name: clean, kind, parentId: parentId || null });
      toast.success(unit ? "Tersimpan" : `${clean} ditambahkan`);
      onSaved();
    } catch (e) {
      toast.error("Gagal menyimpan", { description: e instanceof ApiError ? e.message : "Coba lagi." });
    } finally { setSaving(false); }
  };
  const upload = async (file: File | undefined) => {
    if (!file || !unit) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo maksimal 2 MB."); return; }
    setUploading(true);
    try {
      const r = await nexusApi.uploadOrgUnitLogo(unit.id, file);
      setLogo(r.unit.logoUrl);
      toast.success("Logo terpasang");
    } catch (e) {
      toast.error("Gagal mengunggah logo", { description: e instanceof ApiError ? e.message : "Coba lagi." });
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const removeLogo = async () => {
    if (!unit) return;
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

  return (
    <>
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="truncate text-sm font-bold">{title}</div>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Jenis</label>
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-0.5">
          {([["IP", "IP", "pakai logo"], ["DIVISION", "Divisi", "tanpa logo"], ["GROUP", "Grup", "pengelompokan"]] as const).map(([k, name, sub]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded-md px-2 py-1.5 text-center leading-tight transition-colors", kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
              <span className="block text-xs font-semibold">{name}</span>
              <span className={cn("block text-[10px]", kind === k ? "opacity-80" : "opacity-70")}>{sub}</span>
            </button>
          ))}
        </div>
        {isGroup && (
          <div className={cn("mb-3 rounded-lg px-3 py-2 text-[11px]", groupBlocked ? "bg-rose-50 text-rose-700" : "bg-muted/50 text-muted-foreground")}>
            {groupBlocked
              ? `Kartu ini masih berisi ${cardPeople.length} orang. Lepas orangnya dulu sebelum dijadikan Grup.`
              : "Grup hanya mengelompokkan kartu — tanpa logo, tanpa orang, tanpa pemimpin. Isinya disusun otomatis di dalam bingkainya."}
          </div>
        )}

        {unit && kind === "IP" && (
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#1e3a5f] text-white">
              {logo ? <img src={logo} alt="" className={cn("h-full w-full object-contain p-1", previewTone === "light" ? "bg-[#0f1b2d]" : "bg-white")} /> : <span className="text-sm font-bold">{initialsOf(name || unit.name)}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
              <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} {logo ? "Ganti logo" : "Pasang logo"}
              </button>
              {logo && <button type="button" disabled={uploading} onClick={removeLogo} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent disabled:opacity-50">Hapus logo</button>}
              <div className="w-full text-[10.5px] text-muted-foreground">PNG, JPG, atau WebP · maks 2 MB · sebaiknya persegi</div>
            </div>
          </div>
        )}

        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Nama</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} maxLength={80} placeholder="Misal: Framework Agency" className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />

        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Di bawah</label>
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
          <option value="">— Puncak (tanpa induk) —</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
        </select>

        {unit && parentId && !isGroup && (
          <>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Dipimpin oleh</label>
            <select value={leadValid ? leadUserId : ""} onChange={(e) => setLeadUserId(e.target.value)} disabled={leadCandidates.length === 0} className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
              <option value="">— Tidak ada —</option>
              {leadCandidates.map((p) => <option key={p.userId} value={p.userId}>{label(p)} · {ROLE_SUB[p.role] ?? p.role}</option>)}
            </select>
            <div className="mb-4 text-[10.5px] text-muted-foreground">
              {leadCandidates.length === 0
                ? viaGroup ? "Kartu di atas grup ini belum punya BoD atau Manager." : "Kartu induknya belum punya BoD atau Manager."
                : viaGroup ? `Dipilih dari BoD/Manager ${unitById.get(leadCard!)?.name ?? "kartu di atas grup"} — garisnya ditarik dari orang itu.` : "Kartu ini digambar di bawah orang itu, di kartu induknya."}
            </div>
          </>
        )}

        {unit && cardPeople.length > 0 && !isGroup && (
          <div className="mb-4">
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Jabatan & atasan di kartu ini</div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {cardPeople.map((p) => <TitleRow key={p.userId} person={p} unitId={unit.id} leaders={cardPeople.filter((x) => x.userId !== p.userId && LEAD_ROLES.has(x.role))} />)}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          {unit && (
            <button type="button" disabled={saving} onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" /> Hapus
            </button>
          )}
          {unit && onAddChild && (
            <button type="button" onClick={onAddChild} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-primary hover:bg-accent">
              <Plus className="h-3.5 w-3.5" /> {unit.kind === "GROUP" ? "Isi grup" : "Sub-team"}
            </button>
          )}
          <button type="button" disabled={saving || groupBlocked} onClick={save} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {unit ? "Simpan" : "Tambah"}
          </button>
        </div>
      </div>
    </div>

      {unit && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
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
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs">{label(person)} <span className="text-muted-foreground">· {ROLE_SUB[person.role] ?? person.role}</span></span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        maxLength={40} placeholder="Jabatan" disabled={saving}
        className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-60" />
      {person.role !== "BOD" && person.role !== "ONE_ABOVE_ALL" && leaders.length > 0 && (
        <select value={person.reportsTo?.[unitId] ?? ""} disabled={saving} onChange={(e) => saveReportsTo(e.target.value || null)} title="Di bawah siapa"
          className="w-28 rounded-md border border-border bg-background px-1.5 py-1 text-xs outline-none focus:border-primary disabled:opacity-60">
          <option value="">— di bawah —</option>
          {leaders.map((l) => <option key={l.userId} value={l.userId}>{label(l)}</option>)}
        </select>
      )}
    </div>
  );
}

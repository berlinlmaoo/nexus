import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ImagePlus, Loader2, Maximize2, Minimize2, Plus, Scan, Search, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { toPng } from "html-to-image";
import { ApiError, nexusApi, type OrgChartPerson, type OrgUnit } from "@/lib/nexus-api";
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
type Drag = { kind: "unit"; id: string } | { kind: "person"; id: string; fromUnitId: string | null } | null;

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
    mutationFn: ({ unit, parentId }: { unit: OrgUnit; parentId: string | null }) => nexusApi.updateOrgUnit(unit.id, { parentId }),
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
  const forbidden = useMemo(() => (drag?.kind === "unit" ? descendantsOf(drag.id).add(drag.id) : new Set<string>()), [drag, descendantsOf]);

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
    if ((e.target as HTMLElement).closest("[draggable='true'],button,input")) return;
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

  const roots = units.filter((u) => !u.parentId).sort(byPos);
  const unplaced = people.filter((p) => p.unitIds.length === 0);
  const busy = moveUnit.isPending || addPerson.isPending || removePerson.isPending;

  /** Zona jatuh. `unitId` null = puncak (untuk IP/Team) atau "belum ditaruh" (untuk orang). */
  const dropProps = (unitId: string | null, zone: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag) return;
      if (drag.kind === "unit" && unitId && forbidden.has(unitId)) return;
      if (drag.kind === "person" && zone === "__top__") return;
      if (drag.kind === "unit" && zone === "__tray__") return;
      e.preventDefault(); setOverId(zone);
    },
    onDragLeave: () => setOverId((c) => (c === zone ? null : c)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setOverId(null);
      const d = drag; setDrag(null);
      if (!d) return;
      if (d.kind === "unit") {
        const unit = unitsById.get(d.id);
        if (unit && unit.parentId !== unitId && !(unitId && forbidden.has(unitId))) moveUnit.mutate({ unit, parentId: unitId });
      } else {
        // Ke kartu = tambah (bukan pindah). Ke baki = lepas dari kartu asalnya saja.
        const person = people.find((p) => p.userId === d.id);
        if (!person) return;
        if (unitId && !person.unitIds.includes(unitId)) addPerson.mutate({ person, unitId });
        else if (!unitId && d.fromUnitId) removePerson.mutate({ person, unitId: d.fromUnitId });
      }
    },
  });

  const unitProps = (u: OrgUnit): UnitCardProps => ({
    u, busy, count: membersOf.get(u.id)?.length ?? 0,
    dragging: drag?.kind === "unit" && drag.id === u.id,
    over: overId === u.id,
    droppable: !!drag && !(drag.kind === "unit" && forbidden.has(u.id)),
    onDragStart: () => setDrag({ kind: "unit", id: u.id }), onDragEnd: () => { setDrag(null); setOverId(null); },
    onClick: () => setEditing(u), drop: dropProps(u.id, u.id),
  });
  const personProps = (p: OrgChartPerson, fromUnitId: string | null = null): PersonChipProps => ({
    p, busy, dragging: drag?.kind === "person" && drag.id === p.userId && drag.fromUnitId === fromUnitId,
    onDragStart: () => setDrag({ kind: "person", id: p.userId, fromUnitId }), onDragEnd: () => { setDrag(null); setOverId(null); },
    onClick: () => setPlacingId(p.userId),
    onRemove: fromUnitId ? () => removePerson.mutate({ person: p, unitId: fromUnitId }) : undefined,
    extra: p.unitIds.length > 1 ? p.unitIds.length - 1 : 0,
    jobTitle: fromUnitId ? p.titles?.[fromUnitId] ?? null : null,
  });
  const placing = placingId ? people.find((p) => p.userId === placingId) ?? null : null;

  return (
    <div className="space-y-4">
      <style>{`
        .oc-node{display:flex;flex-direction:column;align-items:center}
        .oc-kids{display:flex;align-items:flex-start;position:relative;padding-top:22px}
        .oc-kids::before{content:"";position:absolute;top:0;left:50%;width:2px;height:22px;background:var(--oc-line);transform:translateX(-50%)}
        .oc-kid{position:relative;padding:22px 6px 0}
        .oc-kid::before{content:"";position:absolute;top:0;left:50%;width:2px;height:22px;background:var(--oc-line);transform:translateX(-50%)}
        .oc-kid::after{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:var(--oc-line)}
        .oc-kid:first-child::after{left:50%}
        .oc-kid:last-child::after{right:50%}
        .oc-kid:only-child::after{display:none}
        .oc-own{position:relative;padding-top:22px;display:flex;justify-content:center}
        .oc-own::before{content:"";position:absolute;top:0;left:50%;width:2px;height:22px;background:var(--oc-line);transform:translateX(-50%)}
        .oc-leaves{display:flex;flex-direction:column;gap:6px;padding:6px;border:1.5px dashed var(--oc-line);border-radius:12px;background:rgba(127,127,127,.04)}
        .oc-leaves-label{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7b8494;text-align:center;padding-bottom:2px}
      `}</style>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs shadow-soft">
        <Stat n={chart.data.stats.units} label="IP/Team" />
        <Stat n={chart.data.stats.placed} of={chart.data.stats.people} label="orang sudah ditaruh" />
        <Stat n={unplaced.length} label="belum ditaruh" tone={unplaced.length > 0 ? "warn" : "ok"} />
        <span className="text-muted-foreground">Seret kartu ke kartu lain, atau klik kartunya.</span>
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
                {full ? "Bagan IP & Divisi" : "IP, divisi & team"} <span className="normal-case tracking-normal text-muted-foreground/70">· scroll/pinch = zoom · seret area kosong = geser · klik dua kali = pas layar</span>
              </div>
              <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <button type="button" onClick={() => zoomCenter(1 / 1.2)} className="rounded-md border border-border p-1 hover:bg-accent" aria-label="Perkecil"><ZoomOut className="h-3.5 w-3.5" /></button>
                <span className="w-10 text-center tabular-nums">{zoomLabel}%</span>
                <button type="button" onClick={() => zoomCenter(1.2)} className="rounded-md border border-border p-1 hover:bg-accent" aria-label="Perbesar"><ZoomIn className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={fitView} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent"><Scan className="h-3.5 w-3.5" /> Pas layar</button>
                <button type="button" onClick={exportPng} disabled={exporting} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent disabled:opacity-50" title="Unduh bagan sebagai PNG tajam (2x), apa pun zoom di layar">
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PNG
                </button>
                <button type="button" onClick={() => setFull((f) => !f)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent">
                  {full ? <><Minimize2 className="h-3.5 w-3.5" /> Tutup</> : <><Maximize2 className="h-3.5 w-3.5" /> Layar penuh</>}
                </button>
              </div>
            </div>
            {drag?.kind === "unit" && (
              <div {...dropProps(null, "__top__")} className={cn("mx-5 mb-2 rounded-lg border border-dashed px-3 py-2 text-center text-[11px] font-semibold transition", overId === "__top__" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                Jatuhkan di sini untuk menjadikannya puncak (tanpa induk)
              </div>
            )}
            <div
              ref={wrapRef}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("[draggable='true'],button")) fitView(); }}
              className={cn("relative w-full select-none overflow-hidden bg-[radial-gradient(circle,rgba(0,0,0,.06)_1px,transparent_1px)] [background-size:18px_18px]", full ? "min-h-0 flex-1" : "h-[min(72vh,820px)]", panning ? "cursor-grabbing" : "cursor-grab")}
              style={{ touchAction: "none" }}
            >
              <div ref={innerRef} className="absolute left-0 top-0 w-max" style={{ transformOrigin: "0 0", willChange: "transform" }}>
                <div className="flex items-start gap-10 p-4">
                  {roots.map((u) => <UnitNode key={u.id} u={u} childUnits={childUnits} membersOf={membersOf} unitProps={unitProps} personProps={personProps} />)}
                </div>
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
      {placing && (
        <UnitPicker
          person={placing}
          units={units}
          busy={busy}
          onToggle={(unitId, on) => (on ? addPerson : removePerson).mutate({ person: placing, unitId })}
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

type DropProps = { onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void };
type UnitCardProps = {
  u: OrgUnit; busy: boolean; count: number; dragging: boolean; over: boolean; droppable: boolean;
  onDragStart: () => void; onDragEnd: () => void; onClick: () => void; drop: DropProps;
};
type PersonChipProps = { p: OrgChartPerson; busy: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void; onRemove?: () => void; extra: number; jobTitle?: string | null };

/** Satu IP/Team beserta turunannya. Orang-orangnya ditumpuk dalam satu kotak, sub-IP/Team berjejer.
 *  Di tingkat modul supaya React tidak me-mount ulang pohon setiap render. */
const LEAD_ROLES = new Set(["ONE_ABOVE_ALL", "BOD", "MANAGER"]);

function UnitNode({ u, childUnits, membersOf, unitProps, personProps }: {
  u: OrgUnit; childUnits: Map<string, OrgUnit[]>; membersOf: Map<string, OrgChartPerson[]>;
  unitProps: (u: OrgUnit) => UnitCardProps; personProps: (p: OrgChartPerson, fromUnitId?: string | null) => PersonChipProps;
}) {
  const kids = childUnits.get(u.id) ?? [];
  const all = membersOf.get(u.id) ?? [];
  // Leaders (BoD, One Above All, Manager) hang straight under the card; staff are one branch beside
  // the sub-units, in the middle of the row (owner, 30 Sep 2026: the C-suite and Agency's Gerro/Riri
  // directly under their card, Mey level with Geneziz and Z Foundation).
  // BoD (and One Above All) and managers are two separate boxes, BoD first (owner, 30 Sep 2026).
  const bods = all.filter((p) => p.role === "BOD" || p.role === "ONE_ABOVE_ALL");
  const managers = all.filter((p) => p.role === "MANAGER");
  const members = all.filter((p) => !LEAD_ROLES.has(p.role));
  // "Dipimpin oleh" (owner, 30 Sep 2026): a sub-unit whose lead is one of THIS card's BoD/Manager
  // people hangs under that person's chip. A lead who is no longer here is simply not drawn.
  const leaderIds = new Set([...bods, ...managers].map((p) => p.userId));
  const ledBy = new Map<string, OrgUnit[]>();
  for (const k of kids) if (k.leadUserId && leaderIds.has(k.leadUserId)) ledBy.set(k.leadUserId, [...(ledBy.get(k.leadUserId) ?? []), k]);
  const free = kids.filter((k) => !(k.leadUserId && leaderIds.has(k.leadUserId)));
  const branches: Array<OrgUnit | "people"> = [...free];
  if (members.length > 0) branches.splice(Math.floor(free.length / 2), 0, "people");
  return (
    <div className="oc-node">
      <UnitCard {...unitProps(u)} />
      {([["BoD", bods], ["Manager", managers]] as const).map(([label, list]) =>
        list.length === 0 ? null : list.some((p) => ledBy.has(p.userId)) ? (
          // Someone in this row leads a sub-unit: every person is a column — chip, line, their units.
          <div key={label} className="oc-own">
            <div className="flex flex-col items-center">
              <div className="oc-leaves-label">{label} · {list.length}</div>
              <div className="flex items-start gap-3">
                {list.map((p) => {
                  const led = ledBy.get(p.userId) ?? [];
                  return (
                    <div key={p.userId} className="oc-node">
                      <PersonChip {...personProps(p, u.id)} />
                      {led.length > 0 && (
                        <div className="oc-kids">
                          {led.map((k) => (
                            <div key={k.id} className="oc-kid">
                              <UnitNode u={k} childUnits={childUnits} membersOf={membersOf} unitProps={unitProps} personProps={personProps} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div key={label} className="oc-own">
            <div className="oc-leaves">
              <div className="oc-leaves-label">{label} · {list.length}</div>
              {/* Side by side, like a C-suite row (owner, 30 Sep 2026). */}
              <div className="flex gap-1.5">
                {list.map((p) => <PersonChip key={p.userId} {...personProps(p, u.id)} />)}
              </div>
            </div>
          </div>
        ),
      )}
      {/* The unit's own people are one branch beside its sub-units, at the same level (owner: Mey sits
          next to Geneziz and Z Foundation under Kantor CEO), placed in the MIDDLE of the row so they
          hang right under the card (the holding's C-suite had ended up at the far left). */}
      {(free.length > 0 || members.length > 0) && (
        <div className="oc-kids">
          {branches.map((b) =>
            b === "people" ? (
              <div key="people" className="oc-kid">
                <div className="oc-leaves">
                  <div className="oc-leaves-label">{members.length} orang</div>
                  {members.map((p) => <PersonChip key={p.userId} {...personProps(p, u.id)} />)}
                </div>
              </div>
            ) : (
              <div key={b.id} className="oc-kid">
                <UnitNode u={b} childUnits={childUnits} membersOf={membersOf} unitProps={unitProps} personProps={personProps} />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
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

/** Kartu IP/Team: logo + nama + jumlah orang. Zona jatuhnya kartu itu sendiri. */
function UnitCard({ u, busy, count, dragging, over, droppable, onDragStart, onDragEnd, onClick, drop }: UnitCardProps) {
  return (
    <div {...drop} className={cn("relative rounded-xl transition", over && "ring-2 ring-primary ring-offset-2", droppable && !over && "ring-1 ring-dashed ring-primary/40")}>
      <button
        type="button"
        draggable={!busy}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", u.id); onDragStart(); }}
        onDragEnd={onDragEnd}
        onClick={onClick}
        disabled={busy}
        title="Klik untuk mengubah, atau seret ke IP/Team induknya"
        className={cn("flex w-[180px] cursor-grab items-center gap-2.5 rounded-lg bg-[#1e3a5f] px-2.5 py-2 text-left text-white shadow-[0_2px_0_rgba(0,0,0,.2)] transition active:cursor-grabbing disabled:opacity-50", dragging && "opacity-40")}
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
  const [kind, setKind] = useState<"IP" | "DIVISION">(unit?.kind ?? "DIVISION");
  const [leadUserId, setLeadUserId] = useState<string>(unit?.leadUserId ?? "");
  // Who may lead: the BoD / One Above All / Manager people of the chosen PARENT card.
  const leadCandidates = parentId ? people.filter((p) => p.unitIds.includes(parentId) && LEAD_ROLES.has(p.role)) : [];
  const leadValid = !leadUserId || leadCandidates.some((p) => p.userId === leadUserId);
  const cardPeople = unit ? people.filter((p) => p.unitIds.includes(unit.id)) : [];
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
      if (unit) await nexusApi.updateOrgUnit(unit.id, { name: clean, kind, parentId: parentId || null, leadUserId: leadValid ? leadUserId || null : null });
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
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-0.5">
          {(["IP", "DIVISION"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded-md px-3 py-1.5 text-xs font-semibold transition-colors", kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
              {k === "IP" ? "IP · pakai logo" : "Divisi · tanpa logo"}
            </button>
          ))}
        </div>

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

        {unit && parentId && (
          <>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Dipimpin oleh</label>
            <select value={leadValid ? leadUserId : ""} onChange={(e) => setLeadUserId(e.target.value)} disabled={leadCandidates.length === 0} className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
              <option value="">— Tidak ada —</option>
              {leadCandidates.map((p) => <option key={p.userId} value={p.userId}>{label(p)} · {ROLE_SUB[p.role] ?? p.role}</option>)}
            </select>
            <div className="mb-4 text-[10.5px] text-muted-foreground">
              {leadCandidates.length === 0 ? "Kartu induknya belum punya BoD atau Manager." : "Kartu ini digambar di bawah orang itu, di kartu induknya."}
            </div>
          </>
        )}

        {unit && cardPeople.length > 0 && (
          <div className="mb-4">
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Jabatan di kartu ini</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {cardPeople.map((p) => <TitleRow key={p.userId} person={p} unitId={unit.id} />)}
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
              <Plus className="h-3.5 w-3.5" /> Sub-team
            </button>
          )}
          <button type="button" disabled={saving} onClick={save} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
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
function UnitPicker({ person, units, busy, onToggle, onClose }: { person: OrgChartPerson; units: OrgUnit[]; busy: boolean; onToggle: (unitId: string, on: boolean) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const rows = units.map((u) => ({ id: u.id, u, path: pathOf(u, byId) }))
    .filter((r) => !q.trim() || r.path.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.path.localeCompare(b.path, "id"));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-bold">IP/Team untuk {label(person)}</div>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">Centang semua IP/Team-nya — boleh lebih dari satu. Tidak mengubah akses project.</p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari IP/Team…" className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {rows.map((r) => { const on = person.unitIds.includes(r.id); return (
            <label key={r.id} className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-accent", on && "bg-primary/10 font-semibold text-primary", busy && "pointer-events-none opacity-60")}>
              <input type="checkbox" checked={on} disabled={busy} onChange={(e) => onToggle(r.id, e.target.checked)} className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-[#1e3a5f] text-[9px] font-bold text-white">
                {r.u.logoUrl ? <img src={r.u.logoUrl} alt="" className="h-full w-full bg-white object-contain" /> : initialsOf(r.u.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.path}</span>
            </label>
          ); })}
          {rows.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">{units.length === 0 ? "Belum ada IP/Team. Tambahkan dulu." : "Nggak ada yang cocok."}</div>}
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Selesai</button>
      </div>
    </div>
  );
}

/** One person's title on one card. Saved on blur or Enter; empty = no title. */
function TitleRow({ person, unitId }: { person: OrgChartPerson; unitId: string }) {
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
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs">{label(person)} <span className="text-muted-foreground">· {ROLE_SUB[person.role] ?? person.role}</span></span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        maxLength={40} placeholder="Jabatan" disabled={saving}
        className="w-28 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-60" />
    </div>
  );
}

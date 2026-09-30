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
 * dengan logo dan orang-orangnya. Satu orang paling banyak di satu IP/Team.
 *
 * Bagan ini TIDAK memberi akses apa pun: bukan akses project, bukan aturan absensi. Akses project
 * tetap lewat undangan langsung dari project-nya.
 *
 * Memindahkan: seret kartu IP/Team ke kartu lain untuk menaruhnya di bawahnya; seret orang ke kartu
 * IP/Team untuk memasukkannya. Klik kartu = ubah (nama, logo, induk, hapus); klik orang = pilih IP/Team.
 * Kanvasnya sama dengan Bagan Approval: scroll/pinch = zoom, seret area kosong = geser.
 */
type Drag = { kind: "unit"; id: string } | { kind: "person"; id: string } | null;

export function OrgChart() {
  const qc = useQueryClient();
  const chart = useQuery({ queryKey: ["nexus", "org-chart"], queryFn: nexusApi.orgChart, retry: false });
  const [drag, setDrag] = useState<Drag>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrgUnit | null>(null);
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [placing, setPlacing] = useState<OrgChartPerson | null>(null);

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
  const placePerson = useMutation({
    mutationFn: ({ person, orgUnitId }: { person: OrgChartPerson; orgUnitId: string | null }) => nexusApi.setOrgUnitMember(person.userId, orgUnitId),
    onSuccess: (_r, v) => {
      refresh();
      const to = v.orgUnitId ? unitsById.get(v.orgUnitId)?.name : null;
      toast.success(to ? `${v.person.name ?? "Orang"} → ${to}` : `${v.person.name ?? "Orang"} dilepas dari bagan`);
    },
    onError: fail("Gagal memindahkan"),
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
    for (const p of people) if (p.orgUnitId) m.set(p.orgUnitId, [...(m.get(p.orgUnitId) ?? []), p]);
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
  const unplaced = people.filter((p) => !p.orgUnitId);
  const busy = moveUnit.isPending || placePerson.isPending;

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
        const person = people.find((p) => p.userId === d.id);
        if (person && person.orgUnitId !== unitId) placePerson.mutate({ person, orgUnitId: unitId });
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
  const personProps = (p: OrgChartPerson): PersonChipProps => ({
    p, busy, dragging: drag?.kind === "person" && drag.id === p.userId,
    onDragStart: () => setDrag({ kind: "person", id: p.userId }), onDragEnd: () => { setDrag(null); setOverId(null); },
    onClick: () => setPlacing(p),
  });

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
              {drag?.kind === "person" && <span className="text-[11px] font-semibold text-rose-700">Jatuhkan di sini untuk melepas dari bagan</span>}
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
          onPick={(orgUnitId) => { const person = placing; setPlacing(null); if (person.orgUnitId !== orgUnitId) placePerson.mutate({ person, orgUnitId }); }}
          onClose={() => setPlacing(null)}
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
type PersonChipProps = { p: OrgChartPerson; busy: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void };

/** Satu IP/Team beserta turunannya. Orang-orangnya ditumpuk dalam satu kotak, sub-IP/Team berjejer.
 *  Di tingkat modul supaya React tidak me-mount ulang pohon setiap render. */
function UnitNode({ u, childUnits, membersOf, unitProps, personProps }: {
  u: OrgUnit; childUnits: Map<string, OrgUnit[]>; membersOf: Map<string, OrgChartPerson[]>;
  unitProps: (u: OrgUnit) => UnitCardProps; personProps: (p: OrgChartPerson) => PersonChipProps;
}) {
  const kids = childUnits.get(u.id) ?? [];
  const members = membersOf.get(u.id) ?? [];
  return (
    <div className="oc-node">
      <UnitCard {...unitProps(u)} />
      {(kids.length > 0 || members.length > 0) && (
        <div className="oc-kids">
          {members.length > 0 && (
            <div className="oc-kid">
              <div className="oc-leaves">
                <div className="oc-leaves-label">{members.length} orang</div>
                {members.map((p) => <PersonChip key={p.userId} {...personProps(p)} />)}
              </div>
            </div>
          )}
          {kids.map((k) => (
            <div key={k.id} className="oc-kid">
              <UnitNode u={k} childUnits={childUnits} membersOf={membersOf} unitProps={unitProps} personProps={personProps} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UnitLogo({ u, size }: { u: OrgUnit; size: number }) {
  const [broken, setBroken] = useState(false);
  if (u.logoUrl && !broken) {
    return <img src={u.logoUrl} alt="" onError={() => setBroken(true)} style={{ width: size, height: size }} className="shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-white/30" />;
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
        <UnitLogo u={u} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold leading-tight" title={u.name}>{u.name}</span>
          <span className="block text-[10px] leading-tight opacity-75">{count > 0 ? `${count} orang` : "belum ada orang"}</span>
        </span>
      </button>
    </div>
  );
}

function PersonChip({ p, busy, dragging, onDragStart, onDragEnd, onClick }: PersonChipProps) {
  return (
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
        <span className="block truncate text-[10px] leading-tight text-muted-foreground">{ROLE_SUB[p.role] ?? p.role}</span>
      </span>
    </button>
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
function UnitDialog({ title, unit, units, excluded, initial, members = 0, subUnits = 0, onAddChild, onClose, onSaved }: {
  title: string; unit?: OrgUnit; units: OrgUnit[]; excluded: Set<string>; initial: { name: string; parentId: string | null };
  members?: number; subUnits?: number; onAddChild?: () => void; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [parentId, setParentId] = useState<string>(initial.parentId ?? "");
  const [logo, setLogo] = useState<string | null>(unit?.logoUrl ?? null);
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
      if (unit) await nexusApi.updateOrgUnit(unit.id, { name: clean, parentId: parentId || null });
      else await nexusApi.createOrgUnit({ name: clean, parentId: parentId || null });
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

        {unit && (
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#1e3a5f] text-white">
              {logo ? <img src={logo} alt="" className="h-full w-full bg-white object-contain p-1" /> : <span className="text-sm font-bold">{initialsOf(name || unit.name)}</span>}
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
                {members > 0 ? `${members} orang di dalamnya jadi "belum ditaruh". ` : ""}
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

/** Pilih IP/Team untuk satu orang. Satu orang paling banyak di satu IP/Team. */
function UnitPicker({ person, units, onPick, onClose }: { person: OrgChartPerson; units: OrgUnit[]; onPick: (orgUnitId: string | null) => void; onClose: () => void }) {
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
        <p className="mb-3 text-[11px] text-muted-foreground">Satu orang hanya di satu IP/Team. Tidak mengubah akses project.</p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari IP/Team…" className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => onPick(r.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-accent", r.id === person.orgUnitId && "bg-primary/10 font-semibold text-primary")}>
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md bg-[#1e3a5f] text-[9px] font-bold text-white">
                {r.u.logoUrl ? <img src={r.u.logoUrl} alt="" className="h-full w-full bg-white object-contain" /> : initialsOf(r.u.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.path}</span>
            </button>
          ))}
          {rows.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">{units.length === 0 ? "Belum ada IP/Team. Tambahkan dulu." : "Nggak ada yang cocok."}</div>}
        </div>
        {person.orgUnitId && (
          <button type="button" onClick={() => onPick(null)} className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">
            Lepas dari bagan
          </button>
        )}
      </div>
    </div>
  );
}

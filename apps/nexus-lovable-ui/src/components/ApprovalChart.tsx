import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search, X } from "lucide-react";
import { ApiError, nexusApi, ORG_ROLE_LABEL, type ApprovalChartPerson } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/**
 * Bagan Approval — siapa menyetujui absensi siapa. Rantai bebas, digambar sebagai bagan organisasi.
 *
 * Tiga wilayah, dari atas:
 *   1. Board — BoD/OAA yang tidak punya bawahan di bagan: baris chip kecil. Mereka puncak, tapi
 *      tidak perlu pohon kalau tidak ada yang lapor ke mereka.
 *   2. Pohon — setiap orang tanpa atasan yang PUNYA bawahan, berdampingan, dengan garis penghubung.
 *      Akar yang bukan BoD diberi tanda "tanpa atasan": pohonnya sah, tapi puncaknya sendiri masih
 *      jatuh ke kelompok BoD.
 *   3. Belum ditaruh — orang yang benar-benar sendirian: tanpa atasan DAN tanpa bawahan. Chip
 *      kecil, tanpa pohon. Dulu pohon-pohon tanpa atasan ikut masuk ke sini dan kotaknya jadi hutan.
 *
 * Memindahkan: seret kartu ke kartu atasannya, atau klik → pemilih. Server menolak lingkaran;
 * di sini kartu yang akan bikin lingkaran cuma tidak diberi zona jatuh.
 */
export function ApprovalChart() {
  const qc = useQueryClient();
  const chart = useQuery({ queryKey: ["nexus", "approval-chart"], queryFn: nexusApi.approvalChart, retry: false });
  const [picker, setPicker] = useState<ApprovalChartPerson | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const setApprover = useMutation({
    mutationFn: ({ person, approverId }: { person: ApprovalChartPerson; approverId: string | null }) =>
      nexusApi.updateWorkspaceMember({ memberId: person.memberId, approverId, workspaceId: chart.data?.workspaceId }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["nexus", "approval-chart"] });
      qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] });
      const to = v.approverId ? chart.data?.people.find((p) => p.userId === v.approverId)?.name : null;
      toast.success(to ? `${v.person.name ?? "Orang"} → ${to}` : `${v.person.name ?? "Orang"} dilepas — request-nya ke BoD`);
    },
    onError: (e: unknown) => toast.error("Gagal memindahkan", { description: e instanceof ApiError ? e.message : "Coba lagi." }),
  });
  const move = (person: ApprovalChartPerson, approverId: string | null) => { setPicker(null); setApprover.mutate({ person, approverId }); };

  const people = chart.data?.people ?? [];
  const byId = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);
  const children = useMemo(() => {
    const m = new Map<string, ApprovalChartPerson[]>();
    for (const p of people) if (p.approverId) m.set(p.approverId, [...(m.get(p.approverId) ?? []), p]);
    for (const list of m.values()) list.sort((a, b) => tier(a.role) - tier(b.role) || label(a).localeCompare(label(b), "id"));
    return m;
  }, [people]);
  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(children.get(id) ?? [])];
    while (stack.length) { const c = stack.pop()!; if (!out.has(c.userId)) { out.add(c.userId); stack.push(...(children.get(c.userId) ?? [])); } }
    return out;
  };
  const dragged = dragId ? byId.get(dragId) ?? null : null;
  const forbidden = useMemo(() => (dragged ? descendantsOf(dragged.userId).add(dragged.userId) : new Set<string>()), [dragged, children]); // eslint-disable-line react-hooks/exhaustive-deps

  if (chart.isLoading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (chart.isError || !chart.data) return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">Bagan tidak bisa dimuat — butuh akses BoD.</div>;

  const roots = people.filter((p) => !p.approverId).sort((a, b) => tier(a.role) - tier(b.role) || label(a).localeCompare(label(b), "id"));
  const isSenior = (p: ApprovalChartPerson) => p.role === "BOD" || p.role === "ONE_ABOVE_ALL";
  const hasKids = (p: ApprovalChartPerson) => (children.get(p.userId)?.length ?? 0) > 0;
  const board = roots.filter((p) => isSenior(p) && !hasKids(p));
  const trees = roots.filter(hasKids);
  const alone = roots.filter((p) => !isSenior(p) && !hasKids(p));
  const unplacedCount = roots.filter((p) => !isSenior(p)).length; // pohon tanpa atasan ikut dihitung
  const busy = setApprover.isPending;

  const dropProps = (targetId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (dragged && !(targetId && forbidden.has(targetId))) { e.preventDefault(); setOverId(targetId ?? "__none__"); } },
    onDragLeave: () => setOverId((c) => (c === (targetId ?? "__none__") ? null : c)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOverId(null); if (dragged) move(dragged, targetId); setDragId(null); },
  });

  const cardProps = (p: ApprovalChartPerson) => ({
    p, busy, dragging: dragId === p.userId, over: overId === p.userId, droppable: !!dragged && !forbidden.has(p.userId),
    reports: children.get(p.userId)?.length ?? 0, rootless: !p.approverId && !isSenior(p),
    onDragStart: () => setDragId(p.userId), onDragEnd: () => { setDragId(null); setOverId(null); }, onClick: () => setPicker(p),
    drop: dropProps(p.userId),
  });

  /** Satu orang beserta seluruh bawahannya. Garisnya digambar CSS (.oc-*), bukan div — lihat <style>. */
  const Node = ({ p }: { p: ApprovalChartPerson }) => {
    const kids = children.get(p.userId) ?? [];
    return (
      <div className="oc-node">
        <PersonCard {...cardProps(p)} />
        {kids.length > 0 && (
          <div className="oc-kids">
            {kids.map((k) => <div key={k.userId} className="oc-kid"><Node p={k} /></div>)}
          </div>
        )}
      </div>
    );
  };

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
      `}</style>

      {/* Ringkasan — satu baris, tiga angka, tanpa kalimat panjang. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs shadow-soft">
        <Stat n={chart.data.stats.withApprover} of={chart.data.stats.total} label="punya atasan" />
        <Stat n={trees.length} label="pohon" />
        <Stat n={unplacedCount} label="belum ditaruh" tone={unplacedCount > 0 ? "warn" : "ok"} />
        <span className="ml-auto text-muted-foreground">Seret kartu ke kartu atasannya, atau klik kartunya.</span>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft" style={{ ["--oc-line" as string]: "#c7cfdb" }}>
        {/* 1 · Board */}
        <section className="border-b border-border px-5 py-4">
          <Eyebrow>Board of Directors <span className="normal-case tracking-normal text-muted-foreground/70">· request tanpa atasan masuk ke semua orang di sini</span></Eyebrow>
          <div className="mt-2 flex flex-wrap gap-2">
            {board.map((p) => <PersonCard key={p.userId} {...cardProps(p)} compact />)}
            {board.length === 0 && <span className="text-xs text-muted-foreground">Semua BoD sudah punya bawahan — lihat pohon di bawah.</span>}
          </div>
        </section>

        {/* 2 · Pohon */}
        <section className="border-b border-border px-5 py-5">
          <Eyebrow>Rantai approval</Eyebrow>
          <div className="mt-3 overflow-x-auto pb-2">
            <div className="flex items-start gap-10">
              {trees.map((p) => <Node key={p.userId} p={p} />)}
              {trees.length === 0 && <span className="text-xs text-muted-foreground">Belum ada yang ditaruh di bawah siapa pun.</span>}
            </div>
          </div>
        </section>

        {/* 3 · Sendirian — zona jatuh untuk MELEPAS */}
        <section {...dropProps(null)} className={cn("rounded-b-2xl px-5 py-4 transition", overId === "__none__" ? "bg-rose-50" : "bg-muted/20")}>
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Belum ditaruh <span className="normal-case tracking-normal text-muted-foreground/70">· {alone.length} orang · request-nya ke semua BoD</span></Eyebrow>
            {dragged && <span className="text-[11px] font-semibold text-rose-700">Jatuhkan di sini untuk melepas dari bagan</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {alone.map((p) => <PersonCard key={p.userId} {...cardProps(p)} compact />)}
            {alone.length === 0 && <span className="text-xs text-emerald-700">Kosong — semua orang sudah ada di suatu pohon.</span>}
          </div>
        </section>
      </div>

      {picker && (
        <ApproverPicker
          person={picker}
          candidates={people.filter((p) => p.userId !== picker.userId && !descendantsOf(picker.userId).has(p.userId))}
          reportsOf={(id) => children.get(id)?.length ?? 0}
          currentApproverId={picker.approverId}
          onPick={(approverId) => move(picker, approverId)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

const tier = (r: string) => ({ ONE_ABOVE_ALL: 0, BOD: 1, MANAGER: 2, STAFF: 3 }[r] ?? 4);
const label = (p: ApprovalChartPerson) => p.name ?? p.email;
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

type CardProps = {
  p: ApprovalChartPerson; busy: boolean; dragging: boolean; over: boolean; droppable: boolean; reports: number; rootless: boolean; compact?: boolean;
  onDragStart: () => void; onDragEnd: () => void; onClick: () => void;
  drop: { onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void };
};

/**
 * Kartu orang. Warna ikut PERAN, bukan kedalaman — kedalaman bisa berapa saja sekarang, dan peran
 * yang menjawab "orang ini siapa". Zona jatuhnya adalah kartu itu sendiri: cincin muncul hanya saat
 * ada yang diseret dan kartu ini sah jadi tujuannya.
 */
function PersonCard({ p, busy, dragging, over, droppable, reports, rootless, compact, onDragStart, onDragEnd, onClick, drop }: CardProps) {
  const senior = p.role === "BOD" || p.role === "ONE_ABOVE_ALL";
  const manager = p.role === "MANAGER";
  const filled = senior || manager;
  return (
    <div {...drop} className={cn("relative rounded-xl transition", over && "ring-2 ring-primary ring-offset-2", droppable && !over && "ring-1 ring-dashed ring-primary/40")}>
      <button
        type="button"
        draggable={!busy}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.userId); onDragStart(); }}
        onDragEnd={onDragEnd}
        onClick={onClick}
        disabled={busy}
        title="Klik untuk pilih atasan, atau seret ke kartu atasannya"
        className={cn(
          "flex cursor-grab items-center gap-2.5 rounded-xl text-left transition active:cursor-grabbing disabled:opacity-50",
          compact ? "w-[168px] px-2.5 py-2" : "w-[176px] px-3 py-2.5",
          senior ? "bg-[#1e3a5f] text-white shadow-[0_2px_0_rgba(0,0,0,.2)]" : manager ? "bg-[#2c5282] text-white shadow-[0_2px_0_rgba(0,0,0,.2)]" : "border border-border bg-background text-foreground shadow-sm hover:border-primary",
          dragging && "opacity-40",
        )}
      >
        {p.avatar ? (
          <img src={p.avatar} alt="" className={cn("h-8 w-8 shrink-0 rounded-full object-cover", filled && "ring-1 ring-white/30")} />
        ) : (
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold", filled ? "bg-white/15" : "bg-primary/10 text-primary")}>{initialsOf(p.name)}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight" title={label(p)}>{label(p)}</span>
          <span className={cn("block truncate text-[10.5px] leading-tight", filled ? "opacity-75" : "text-muted-foreground")}>
            {ROLE_SUB[p.role] ?? p.role}{reports > 0 && ` · ${reports} bawahan`}
          </span>
        </span>
      </button>
      {/* Akar yang bukan BoD: pohonnya sah, tapi puncaknya sendiri masih jatuh ke kelompok BoD. */}
      {rootless && !compact && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[9.5px] font-bold text-amber-800">tanpa atasan</span>
      )}
    </div>
  );
}

/** Pemilih atasan — semua orang di workspace kecuali dirinya dan keturunannya (itu lingkaran).
 *  Dikelompokkan per peran supaya "cari BoD-nya" tidak perlu mengeja nama. */
function ApproverPicker({ person, candidates, reportsOf, currentApproverId, onPick, onClose }: { person: ApprovalChartPerson; candidates: ApprovalChartPerson[]; reportsOf: (id: string) => number; currentApproverId: string | null; onPick: (approverId: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const rows = candidates.filter((m) => !q.trim() || label(m).toLowerCase().includes(q.toLowerCase()));
  const groups: Array<[string, ApprovalChartPerson[]]> = (["ONE_ABOVE_ALL", "BOD", "MANAGER", "STAFF"] as const)
    .map((r) => [r, rows.filter((m) => m.role === r)] as [string, ApprovalChartPerson[]])
    .filter(([, list]) => list.length > 0);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-bold">Atasan untuk {label(person)}</div>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">Request absensinya akan masuk ke orang ini saja. BoD tetap bisa override.</p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama…" className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {groups.map(([role, list]) => (
            <div key={role}>
              <div className="px-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{ORG_ROLE_LABEL[role] ?? role}</div>
              {list.map((m) => (
                <button key={m.userId} type="button" onClick={() => onPick(m.userId)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-accent", m.userId === currentApproverId && "bg-primary/10 font-semibold text-primary")}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initialsOf(m.name)}</span>
                  <span className="min-w-0 flex-1 truncate">{label(m)}</span>
                  {reportsOf(m.userId) > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">{reportsOf(m.userId)} bawahan</span>}
                </button>
              ))}
            </div>
          ))}
          {rows.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">Nggak ada yang cocok.</div>}
        </div>
        {currentApproverId && (
          <button type="button" onClick={() => onPick(null)} className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">
            Lepas dari bagan — request-nya ke semua BoD
          </button>
        )}
      </div>
    </div>
  );
}

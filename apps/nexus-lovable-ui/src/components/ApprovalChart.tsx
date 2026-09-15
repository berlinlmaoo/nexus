import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search, X, ChevronDown } from "lucide-react";
import { ApiError, nexusApi, ORG_ROLE_LABEL, type ApprovalChartPerson } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/**
 * Bagan Approval — siapa menyetujui absensi siapa. Rantai bebas.
 *
 * Bukan tiga tingkat tetap. Berlin: "willy approve anak-anaknya, willy ke gerro, gerro ke riri" —
 * jadi bagannya hutan: tiap orang punya paling banyak satu atasan, siapa pun perannya. Akar =
 * orang tanpa atasan. Akar yang BoD/OAA memang puncak; akar yang Staff/Manager berarti "belum
 * ditaruh" dan request-nya jatuh ke kelompok BoD.
 *
 * Memindahkan: seret kartu ke kartu orang lain (jadi bawahannya), atau klik kartu → pemilih.
 * Server menolak lingkaran; di sini kartu yang akan bikin lingkaran cuma tidak diberi zona jatuh.
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
    return m;
  }, [people]);
  // Keturunan seseorang — untuk mematikan zona jatuh yang akan bikin lingkaran.
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

  const tier = (r: string) => ({ ONE_ABOVE_ALL: 0, BOD: 1, MANAGER: 2, STAFF: 3 }[r] ?? 4);
  const roots = people.filter((p) => !p.approverId).sort((a, b) => tier(a.role) - tier(b.role) || (a.name ?? a.email).localeCompare(b.name ?? b.email, "id"));
  const tops = roots.filter((p) => p.role === "BOD" || p.role === "ONE_ABOVE_ALL");
  const unplaced = roots.filter((p) => p.role !== "BOD" && p.role !== "ONE_ABOVE_ALL");
  const busy = setApprover.isPending;

  const dropProps = (targetId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (dragged && !(targetId && forbidden.has(targetId))) { e.preventDefault(); setOverId(targetId ?? "__none__"); } },
    onDragLeave: () => setOverId((c) => (c === (targetId ?? "__none__") ? null : c)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOverId(null); if (dragged) move(dragged, targetId); setDragId(null); },
  });

  /** Satu orang beserta seluruh bawahannya, ke bawah. */
  const Node = ({ p, depth }: { p: ApprovalChartPerson; depth: number }) => {
    const kids = (children.get(p.userId) ?? []).sort((a, b) => tier(a.role) - tier(b.role) || (a.name ?? a.email).localeCompare(b.name ?? b.email, "id"));
    const isOver = overId === p.userId;
    const canDrop = dragged && !forbidden.has(p.userId);
    return (
      <div className="flex flex-col items-center">
        <div {...dropProps(p.userId)} className={cn("rounded-xl border-2 p-0.5 transition", isOver ? "border-primary bg-primary/10" : canDrop ? "border-dashed border-border" : "border-transparent")}>
          <PersonCard p={p} depth={depth} busy={busy} dragging={dragId === p.userId}
            onDragStart={() => setDragId(p.userId)} onDragEnd={() => { setDragId(null); setOverId(null); }}
            onClick={() => setPicker(p)} reports={kids.length} />
        </div>
        {kids.length > 0 && (
          <>
            <div className="h-4 w-0.5 bg-border" />
            <div className="flex items-start gap-3 border-t-2 border-border pt-4">
              {kids.map((k) => <Node key={k.userId} p={k} depth={depth + 1} />)}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span><b className="text-foreground">{chart.data.stats.withApprover}</b> dari <b className="text-foreground">{chart.data.stats.total}</b> orang punya atasan di bagan</span>
        {unplaced.length > 0 ? (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">{unplaced.length} belum ditaruh — request mereka masuk ke semua BoD</span>
        ) : (
          <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">Semua sudah ditaruh</span>
        )}
        <span className="ml-auto">Seret kartu ke kartu atasannya, atau klik kartunya. Siapa pun bisa di bawah siapa pun.</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="inline-flex min-w-full flex-col items-center gap-6">
          <div className="flex items-start gap-6">
            {tops.map((p) => <Node key={p.userId} p={p} depth={0} />)}
            {tops.length === 0 && <span className="text-xs text-muted-foreground">Belum ada BoD.</span>}
          </div>

          {/* Belum ditaruh — zona jatuh untuk MELEPAS */}
          <div {...dropProps(null)} className={cn("flex w-full max-w-3xl flex-col gap-2 rounded-xl border-2 border-dashed p-3 transition", overId === "__none__" ? "border-rose-400 bg-rose-50/60" : "border-border bg-muted/20")}>
            <div className="text-center">
              <div className="text-xs font-bold text-muted-foreground">Belum ditaruh</div>
              <div className="text-[11px] text-muted-foreground/70">{unplaced.length} orang · request-nya ke semua BoD · jatuhkan kartu di sini untuk melepas</div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {unplaced.map((p) => <Node key={p.userId} p={p} depth={0} />)}
              {unplaced.length === 0 && <div className="py-2 text-[11px] text-emerald-700">Kosong — bagus.</div>}
            </div>
          </div>
        </div>
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

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const ROLE_SUB: Record<string, string> = { ONE_ABOVE_ALL: "One Above All", BOD: "BoD", MANAGER: "Manager", STAFF: "Staff" };

/** Kartu gaya "Direktur / Director". Warna turun mengikuti peran, bukan kedalaman — kedalaman bisa
 *  berapa saja sekarang, dan peran yang menjawab "orang ini siapa". */
function PersonCard({ p, busy, dragging, onDragStart, onDragEnd, onClick, reports }: { p: ApprovalChartPerson; depth: number; busy: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void; reports: number }) {
  const senior = p.role === "BOD" || p.role === "ONE_ABOVE_ALL";
  const manager = p.role === "MANAGER";
  return (
    <button
      type="button"
      draggable={!busy}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.userId); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      disabled={busy}
      title="Klik untuk pilih atasan, atau seret ke kartu atasannya"
      className={cn(
        "flex w-40 cursor-grab flex-col items-center rounded-lg px-3 py-2 text-center transition active:cursor-grabbing disabled:opacity-50",
        senior ? "bg-[#1e3a5f] text-white shadow-[0_2px_0_rgba(0,0,0,.18)]" : manager ? "bg-[#2c5282] text-white shadow-[0_2px_0_rgba(0,0,0,.18)]" : "border border-border bg-background text-foreground hover:border-primary",
        dragging && "opacity-40",
      )}
    >
      <div className="flex w-full items-center justify-center gap-2">
        {p.avatar ? (
          <img src={p.avatar} alt="" className={cn("h-6 w-6 shrink-0 rounded-full object-cover", senior || manager ? "ring-1 ring-white/30" : "")} />
        ) : (
          <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold", senior || manager ? "bg-white/15" : "bg-primary/10 text-primary")}>{initialsOf(p.name)}</span>
        )}
        <span className="min-w-0 truncate text-[13px] font-semibold leading-tight" title={p.name ?? p.email}>{p.name ?? p.email}</span>
      </div>
      <div className={cn("mt-0.5 flex items-center gap-1 text-[10px]", senior || manager ? "opacity-75" : "text-muted-foreground")}>
        {ROLE_SUB[p.role] ?? p.role}{reports > 0 && <span>· {reports} ↓</span>}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </div>
    </button>
  );
}

/** Pemilih atasan — semua orang di workspace kecuali dirinya dan keturunannya (itu lingkaran).
 *  Dikelompokkan per peran supaya "cari BoD-nya" tidak perlu mengeja nama. */
function ApproverPicker({ person, candidates, reportsOf, currentApproverId, onPick, onClose }: { person: ApprovalChartPerson; candidates: ApprovalChartPerson[]; reportsOf: (id: string) => number; currentApproverId: string | null; onPick: (approverId: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const rows = candidates.filter((m) => !q.trim() || (m.name ?? m.email).toLowerCase().includes(q.toLowerCase()));
  const groups: Array<[string, ApprovalChartPerson[]]> = (["ONE_ABOVE_ALL", "BOD", "MANAGER", "STAFF"] as const)
    .map((r) => [r, rows.filter((m) => m.role === r)] as [string, ApprovalChartPerson[]])
    .filter(([, list]) => list.length > 0);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-bold">Atasan untuk {person.name ?? person.email}</div>
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
                  <span className="min-w-0 flex-1 truncate">{m.name ?? m.email}</span>
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

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search, X, ChevronDown } from "lucide-react";
import { ApiError, nexusApi, type ApprovalChartPerson } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

/**
 * Bagan Approval — siapa menyetujui absensi siapa.
 *
 * Tiga tingkat, meniru bagan organisasi Corpnet yang dikirim Berlin:
 *
 *   One Above All
 *   Board of Directors      ← satu KELOMPOK, bukan target seret. Request Manager masuk ke sini.
 *   Manager → Staff         ← tepi yang diatur di sini: WorkspaceMember.approverId
 *   [ Belum ditaruh ]       ← staff tanpa approver; request-nya jatuh ke BoD sampai ditaruh
 *
 * Dua cara memindahkan, keduanya sengaja ada: seret kartu ke kolom manager (cepat, di laptop), dan
 * klik kartu → pemilih (jalan di layar sempit dan tanpa mouse). Keduanya memanggil PATCH yang sama.
 *
 * Manager tanpa bawahan TETAP digambar sebagai kolom kosong. Kolom kosong adalah informasi — ada
 * manager yang belum punya siapa-siapa — dan menyembunyikannya membuat orang itu hilang dari bagan.
 */
export function ApprovalChart() {
  const qc = useQueryClient();
  const chart = useQuery({ queryKey: ["nexus", "approval-chart"], queryFn: nexusApi.approvalChart, retry: false });
  const [picker, setPicker] = useState<ApprovalChartPerson | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const setApprover = useMutation({
    mutationFn: ({ person, approverId }: { person: ApprovalChartPerson; approverId: string | null }) =>
      nexusApi.updateWorkspaceMember({ memberId: person.memberId, approverId, workspaceId: chart.data?.workspaceId }),
    onSuccess: (_r, v) => {
      // Daftar anggota ikut disegarkan: kolom "Approver" di tab Users membaca data yang sama.
      qc.invalidateQueries({ queryKey: ["nexus", "approval-chart"] });
      qc.invalidateQueries({ queryKey: ["nexus", "workspace-members"] });
      const to = v.approverId ? chart.data?.managers.find((m) => m.userId === v.approverId)?.name : null;
      toast.success(to ? `${v.person.name ?? "Staff"} → ${to}` : `${v.person.name ?? "Staff"} dilepas dari bagan`);
    },
    onError: (e: unknown) => toast.error("Gagal memindahkan", { description: e instanceof ApiError ? e.message : "Coba lagi." }),
  });

  const move = (person: ApprovalChartPerson, approverId: string | null) => {
    setPicker(null);
    setApprover.mutate({ person, approverId });
  };

  // Kartu yang sedang diseret, dicari sekali — dipakai saat drop ke kolom mana pun.
  const dragged = useMemo(() => {
    if (!dragId || !chart.data) return null;
    for (const m of chart.data.managers) { const f = m.reports.find((r) => r.userId === dragId); if (f) return f; }
    return chart.data.unassigned.find((r) => r.userId === dragId) ?? null;
  }, [dragId, chart.data]);

  if (chart.isLoading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (chart.isError || !chart.data) return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">Bagan tidak bisa dimuat — butuh akses BoD.</div>;

  const d = chart.data;
  const busy = setApprover.isPending;

  const dropProps = (colId: string, approverId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (dragged) { e.preventDefault(); setOverCol(colId); } },
    onDragLeave: () => setOverCol((c) => (c === colId ? null : c)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOverCol(null);
      if (dragged) move(dragged, approverId);
      setDragId(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span><b className="text-foreground">{d.stats.assigned}</b> dari <b className="text-foreground">{d.stats.staff}</b> staff sudah ditaruh</span>
        {d.stats.unassigned > 0 ? (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">{d.stats.unassigned} belum — request mereka masih masuk ke BoD</span>
        ) : (
          <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">Semua staff sudah punya manager</span>
        )}
        <span className="ml-auto">Seret kartu ke kolom manager, atau klik kartunya.</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="min-w-[720px]">
          {/* Tingkat 1 — One Above All */}
          <TierLabel>One Above All</TierLabel>
          <div className="flex justify-center gap-3">
            {d.oaa.map((p) => <PersonBox key={p.userId} person={p} tone="navy" sub="One Above All" />)}
          </div>
          <Pipe />

          {/* Tingkat 2 — BoD sebagai kelompok */}
          <TierLabel>Board of Directors <span className="normal-case tracking-normal text-muted-foreground/70">· request Manager masuk ke semua BoD</span></TierLabel>
          <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2 rounded-xl border border-border bg-muted/20 p-3">
            {d.bod.map((p) => <PersonBox key={p.userId} person={p} tone="navy" sub="BoD" small />)}
            {d.bod.length === 0 && <span className="text-xs text-muted-foreground">Belum ada BoD.</span>}
          </div>
          <Pipe />

          {/* Tingkat 3 — Manager → Staff, ditambah kolom "Belum ditaruh" */}
          <TierLabel>Manager → Staff <span className="normal-case tracking-normal text-muted-foreground/70">· request Staff masuk ke manager-nya saja</span></TierLabel>
          <div className="flex items-start gap-3">
            {d.managers.map((m) => (
              <div
                key={m.userId}
                {...dropProps(m.userId, m.userId)}
                className={cn(
                  "flex w-44 shrink-0 flex-col items-stretch gap-1.5 rounded-xl border-2 border-transparent p-1.5 transition",
                  overCol === m.userId && "border-primary bg-primary/5",
                  dragged && overCol !== m.userId && "border-dashed border-border",
                )}
              >
                <PersonBox person={m} tone="navy" sub="Manager" />
                <div className="mx-auto h-2 w-0.5 bg-border" />
                {m.reports.map((r) => (
                  <StaffCard key={r.userId} person={r} busy={busy} dragging={dragId === r.userId}
                    onDragStart={() => setDragId(r.userId)} onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => setPicker(r)} />
                ))}
                {m.reports.length === 0 && (
                  // Kolom kosong digambar dengan sengaja — lihat komentar komponen.
                  <div className="rounded-lg border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground/70">Belum ada staff</div>
                )}
              </div>
            ))}
            {d.managers.length === 0 && <div className="text-xs text-muted-foreground">Belum ada Manager — atur peran dulu di tab Users.</div>}

            {/* Belum ditaruh */}
            <div
              {...dropProps("__none__", null)}
              className={cn(
                "ml-auto flex w-48 shrink-0 flex-col items-stretch gap-1.5 rounded-xl border-2 border-dashed p-1.5 transition",
                overCol === "__none__" ? "border-rose-400 bg-rose-50/60" : "border-border bg-muted/20",
              )}
            >
              <div className="rounded-lg px-2 py-1.5 text-center">
                <div className="text-xs font-bold text-muted-foreground">Belum ditaruh</div>
                <div className="text-[11px] text-muted-foreground/70">{d.unassigned.length} orang · masuk ke BoD</div>
              </div>
              {d.unassigned.map((r) => (
                <StaffCard key={r.userId} person={r} busy={busy} muted dragging={dragId === r.userId}
                  onDragStart={() => setDragId(r.userId)} onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  onClick={() => setPicker(r)} />
              ))}
              {d.unassigned.length === 0 && <div className="px-2 py-3 text-center text-[11px] text-emerald-700">Kosong — bagus.</div>}
            </div>
          </div>
        </div>
      </div>

      {picker && (
        <ManagerPicker
          person={picker}
          managers={d.managers}
          currentApproverId={d.managers.find((m) => m.reports.some((r) => r.userId === picker.userId))?.userId ?? null}
          onPick={(approverId) => move(picker, approverId)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function TierLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-center text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{children}</div>;
}
function Pipe() { return <div className="mx-auto my-2 h-5 w-0.5 bg-border" />; }

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Kartu gaya "Direktur / Director": nama tebal, sub-label peran di bawahnya. */
function PersonBox({ person, sub, tone, small }: { person: ApprovalChartPerson; sub: string; tone: "navy"; small?: boolean }) {
  void tone;
  return (
    <div className={cn("rounded-lg bg-[#1e3a5f] text-center text-white shadow-[0_2px_0_rgba(0,0,0,.18)]", small ? "min-w-[110px] px-2.5 py-1.5" : "px-3 py-2")}>
      <div className="flex items-center justify-center gap-2">
        {person.avatar ? (
          <img src={person.avatar} alt="" className={cn("shrink-0 rounded-full object-cover ring-1 ring-white/30", small ? "h-5 w-5" : "h-6 w-6")} />
        ) : (
          <span className={cn("grid shrink-0 place-items-center rounded-full bg-white/15 font-bold", small ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]")}>{initialsOf(person.name)}</span>
        )}
        <span className={cn("truncate font-semibold leading-tight", small ? "max-w-[120px] text-[12px]" : "max-w-[130px] text-[13px]")} title={person.name ?? person.email}>{person.name ?? person.email}</span>
      </div>
      <div className="text-[10px] font-normal opacity-75">{sub}</div>
    </div>
  );
}

function StaffCard({ person, busy, muted, dragging, onDragStart, onDragEnd, onClick }: { person: ApprovalChartPerson; busy: boolean; muted?: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void }) {
  return (
    <button
      type="button"
      draggable={!busy}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", person.userId); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      disabled={busy}
      title="Klik untuk pilih manager, atau seret ke kolom manager"
      className={cn(
        "flex w-full cursor-grab items-center gap-2 rounded-lg border bg-background px-2 py-1.5 text-left text-[12px] transition active:cursor-grabbing disabled:opacity-50",
        muted ? "border-border text-muted-foreground" : "border-border text-foreground hover:border-primary",
        dragging && "opacity-40",
      )}
    >
      {person.avatar ? (
        <img src={person.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">{initialsOf(person.name)}</span>
      )}
      <span className="min-w-0 flex-1 truncate font-semibold" title={person.name ?? person.email}>{person.name ?? person.email}</span>
      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

/** Pemilih manager untuk satu staff — daftar 8 MANAGER saja (bukan BoD; request Manager ke BoD
 *  tanpa tepi). Bisa dicari, karena nama-nama di sini mirip-mirip dan salah pilih tidak terlihat
 *  sampai ada request yang nyasar. */
function ManagerPicker({ person, managers, currentApproverId, onPick, onClose }: { person: ApprovalChartPerson; managers: Array<ApprovalChartPerson & { reports: ApprovalChartPerson[] }>; currentApproverId: string | null; onPick: (approverId: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const rows = managers.filter((m) => !q.trim() || (m.name ?? m.email).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-bold">Manager untuk {person.name ?? person.email}</div>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">Request absensinya akan masuk ke orang ini saja. BoD tetap bisa override.</p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari manager…" className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {rows.map((m) => (
            <button key={m.userId} type="button" onClick={() => onPick(m.userId)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-accent", m.userId === currentApproverId && "bg-primary/10 font-semibold text-primary")}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initialsOf(m.name)}</span>
              <span className="min-w-0 flex-1 truncate">{m.name ?? m.email}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{m.reports.length} staff</span>
            </button>
          ))}
          {rows.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">Nggak ada yang cocok.</div>}
        </div>
        {currentApproverId && (
          <button type="button" onClick={() => onPick(null)} className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">
            Lepas dari bagan — request-nya kembali ke BoD
          </button>
        )}
      </div>
    </div>
  );
}

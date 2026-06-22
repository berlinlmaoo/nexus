import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, Plus, X, Search, Loader2, Undo2, Scale, Flame, MessageSquareWarning, Camera } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { nexusApi, ORG_HIERARCHY, type PeerReport, type NexusUser } from "@/lib/nexus-api";
import { ComingSoon } from "@/components/ComingSoon";

export const Route = createFileRoute("/_app/peer-reports")({ component: IntegrityGate });

// Role gate — Integrity belum dibuka untuk Manager ke bawah (belum ada ETA rilis). BoD+ akses penuh;
// selain itu lihat halaman "Coming Soon". Wrapper terpisah supaya hooks di IntegrityPage tetap konsisten.
function IntegrityGate() {
  const roleQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const roleLoaded = roleQ.isSuccess || roleQ.isError;
  const fullAccess = (ORG_HIERARCHY[roleQ.data?.role ?? ""] ?? 0) >= ORG_HIERARCHY.BOD;
  if (!roleLoaded) return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!fullAccess) return <ComingSoon feature="Integrity" />;
  return <IntegrityPage />;
}

const CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: "SMOKING_INDOORS", label: "Ngerokok di dalam ruangan", emoji: "🚬" },
  { key: "SMOKING_TOILET", label: "Ngerokok di toilet", emoji: "🚻" },
  { key: "SAFETY_VIOLATION", label: "Pelanggaran K3 / keamanan", emoji: "⚠️" },
  { key: "CLEANLINESS", label: "Kebersihan", emoji: "🧹" },
  { key: "EQUIPMENT_MISUSE", label: "Salah pakai alat / aset", emoji: "🔧" },
  { key: "POLICY_OTHER", label: "Pelanggaran kebijakan lain", emoji: "📋" },
];
const catOf = (k: string) => CATEGORIES.find((c) => c.key === k);
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Nunggu review", cls: "bg-amber-100 text-amber-700 ring-amber-200" },
  VERIFIED: { label: "Terbukti", cls: "bg-rose-100 text-rose-700 ring-rose-200" },
  REJECTED: { label: "Ditolak", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  WITHDRAWN: { label: "Ditarik", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

type Tab = "hall" | "pending" | "all" | "mine";

function IntegrityPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("hall");
  const [composing, setComposing] = useState(false);
  const [openReport, setOpenReport] = useState<PeerReport | null>(null);

  const roleQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const viewerIsBod = ["ONE_ABOVE_ALL", "BOD"].includes(roleQ.data?.role ?? "");

  const hallQ = useQuery({ queryKey: ["hall-of-shame"], queryFn: nexusApi.hallOfShame, enabled: tab === "hall" });
  const listStatus = tab === "pending" ? "PENDING" : "ALL";
  const listQ = useQuery({ queryKey: ["peer-reports", tab, listStatus], queryFn: () => nexusApi.peerReports(listStatus), enabled: tab !== "hall" });
  const reports = listQ.data?.reports ?? [];
  const counts = listQ.data?.counts ?? {};

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["peer-reports"] }); qc.invalidateQueries({ queryKey: ["hall-of-shame"] }); };

  const tabs: [Tab, string][] = viewerIsBod
    ? [["hall", "Hall of Shame"], ["pending", "Perlu review"], ["all", "Semua"]]
    : [["hall", "Hall of Shame"], ["mine", "Aktivitas saya"]];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Integrity"
        subtitle="Lapor pelanggaran kebijakan. Yang terbukti masuk Hall of Shame & diumumin."
        icon={<ShieldAlert className="h-6 w-6 text-primary" />}
        actions={<button onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground shadow-sm transition active:scale-[0.97]"><Plus className="h-4 w-4" /> Buat laporan</button>}
      />

      <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className="relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold transition">
            {tab === t && <motion.span layoutId="integrity-tab" className="absolute inset-0 rounded-lg bg-primary" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <span className={cn("relative flex items-center gap-1.5", tab === t ? "text-primary-foreground" : "text-muted-foreground")}>
              {label}
              {t === "pending" && counts.PENDING > 0 && <span className={cn("rounded-full px-1.5 text-[10px] font-black tabular-nums", tab === t ? "bg-primary-foreground/20" : "bg-amber-100 text-amber-700")}>{counts.PENDING}</span>}
            </span>
          </button>
        ))}
      </div>

      {tab === "hall" ? (
        <HallOfShameView loading={hallQ.isLoading} data={hallQ.data} />
      ) : (
        <div className="space-y-2.5">
          {listQ.isLoading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-card" />)}
          {!listQ.isLoading && reports.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Scale className="h-7 w-7" /></div>
              <div className="text-base font-black">{tab === "pending" ? "Gak ada yang nunggu review" : tab === "mine" ? "Belum ada aktivitas" : "Belum ada laporan"}</div>
              <p className="mt-1 text-sm text-muted-foreground">{tab === "mine" ? "Laporan yang kamu buat / soal kamu bakal muncul di sini." : "Laporan bakal muncul di sini."}</p>
            </div>
          )}
          {reports.map((r) => <ReportCard key={r.id} report={r} onOpen={() => setOpenReport(r)} />)}
        </div>
      )}

      <AnimatePresence>
        {composing && <Composer onClose={() => setComposing(false)} onDone={() => { setComposing(false); invalidate(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {openReport && <ReportDetail report={openReport} viewerIsBod={viewerIsBod} onClose={() => setOpenReport(null)} onChanged={(u) => { setOpenReport(u); invalidate(); }} />}
      </AnimatePresence>
    </div>
  );
}

function HallOfShameView({ loading, data }: { loading: boolean; data?: { entries: { id: string; category: string; at: string; reportedUser: NexusUser }[]; offenders: { user: NexusUser; count: number }[] } }) {
  if (loading) return <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-card" />)}</div>;
  const entries = data?.entries ?? [];
  const offenders = (data?.offenders ?? []).filter((o) => o.count > 1);
  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-rose-100 text-rose-600"><Flame className="h-7 w-7" /></div>
        <div className="text-base font-black">Hall of Shame masih kosong 🎉</div>
        <p className="mt-1 text-sm text-muted-foreground">Belum ada pelanggaran yang terbukti. Pertahankan!</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {offenders.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-rose-700"><Flame className="h-3.5 w-3.5" /> Langganan</div>
          <div className="flex flex-wrap gap-2">
            {offenders.map((o) => (
              <div key={o.user.id} className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-2 py-1">
                <Avatar userId={o.user.id} name={o.user.name} avatar={o.user.avatar} size={20} />
                <span className="text-xs font-bold">{o.user.name}</span>
                <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-black text-white tabular-nums">{o.count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        {entries.map((e) => {
          const cat = catOf(e.category);
          return (
            <div key={e.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft">
              <Avatar userId={e.reportedUser.id} name={e.reportedUser.name} avatar={e.reportedUser.avatar} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black">{e.reportedUser.name}</div>
                <div className="truncate text-xs text-muted-foreground">{cat?.emoji} {cat?.label}</div>
              </div>
              <div className="shrink-0 text-right">
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200">Terbukti</span>
                <div className="mt-1 text-[11px] text-muted-foreground">{fmtDay(e.at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportCard({ report, onOpen }: { report: PeerReport; onOpen: () => void }) {
  const st = STATUS[report.status];
  const cat = catOf(report.category);
  const rel = report.isMine ? "Kamu lapor" : report.isAgainstMe ? "Soal kamu" : "Laporan";
  return (
    <button onClick={onOpen} className="block w-full rounded-2xl border border-border bg-card p-3.5 text-left shadow-soft transition hover:border-primary/40 hover:shadow-pop active:scale-[0.99]">
      <div className="flex items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", st.cls)}>{st.label}</span>
        <span className="text-xs font-semibold text-muted-foreground">{cat?.emoji} {cat?.label}</span>
        {report.canRebut && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-white">perlu bantahan</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">{fmtWhen(report.createdAt)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <Avatar userId={report.reportedUser.id} name={report.reportedUser.name} avatar={report.reportedUser.avatar} size={28} />
        <div className="min-w-0">
          <div className="font-bold leading-tight">{report.reportedUser.name}</div>
          <div className="text-[11px] text-muted-foreground">{rel}{report.reporter ? ` · oleh ${report.isMine ? "kamu" : report.reporter.name}` : report.reporterHidden ? " · pelapor anonim" : ""}</div>
        </div>
      </div>
      {report.reason && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{report.reason}</p>}
    </button>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18, ease: "easeOut" }}
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Composer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const membersQ = useQuery({ queryKey: ["members"], queryFn: nexusApi.members, staleTime: 300_000 });
  const profile = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile });
  const meId = profile.data?.user?.id;
  const members: NexusUser[] = useMemo(() => {
    const raw = membersQ.data; const arr = Array.isArray(raw) ? raw : raw?.members ?? [];
    // Exclude self + BoD-and-above (can't be reported).
    return arr.filter((u) => u.id !== meId && !["ONE_ABOVE_ALL", "BOD"].includes(u.role ?? ""));
  }, [membersQ.data, meId]);

  const [search, setSearch] = useState("");
  const [reportedUserId, setReportedUserId] = useState("");
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(() => (evidence ? URL.createObjectURL(evidence) : null), [evidence]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const reported = members.find((m) => m.id === reportedUserId);
  const filtered = useMemo(() => members.filter((m) => (m.name ?? m.email ?? "").toLowerCase().includes(search.toLowerCase())).slice(0, 50), [members, search]);
  const canSubmit = reportedUserId && category && reason.trim().length >= 10 && evidence;

  const create = useMutation({ mutationFn: () => nexusApi.createPeerReport({ reportedUserId, category, reason: reason.trim(), evidence: evidence! }), onSuccess: onDone });

  return (
    <Backdrop onClose={onClose}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-lg font-black">Buat laporan</h2>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Siapa yang dilaporkan</label>
          {reported ? (
            <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2">
              <Avatar userId={reported.id} name={reported.name} avatar={reported.avatar} size={28} />
              <span className="text-sm font-bold">{reported.name}</span>
              <button onClick={() => setReportedUserId("")} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">Ganti</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama…" className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {filtered.map((m) => (
                  <button key={m.id} onClick={() => { setReportedUserId(m.id); setSearch(""); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <Avatar userId={m.id} name={m.name} avatar={m.avatar} size={24} /> <span className="truncate">{m.name ?? m.email}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Kategori</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.key} onClick={() => setCategory(c.key)} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition", category === c.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Ceritakan kejadiannya</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={1000} placeholder="Jelaskan perilaku/kejadiannya — objektif, bukan nyerang orangnya. (min 10 karakter)" className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <p className="text-right text-[11px] text-muted-foreground">{reason.trim().length}/1000</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Foto bukti <span className="text-rose-500">*wajib</span></label>
          {previewUrl ? (
            <div className="relative overflow-hidden rounded-xl border border-border">
              <img src={previewUrl} alt="bukti" className="max-h-56 w-full object-cover" />
              <button onClick={() => { setEvidence(null); if (fileRef.current) fileRef.current.value = ""; }} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-background py-6 text-muted-foreground transition hover:border-primary/40 hover:text-primary">
              <Camera className="h-6 w-6" />
              <span className="text-sm font-semibold">Ambil / pilih foto bukti</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setEvidence(f); }} />
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          ⚖️ Direview <b>BoD</b>. Identitas kamu (pelapor) <b>anonim</b>. Kalau terbukti: yang dilaporin kena <b>−XP</b>, masuk <b>Hall of Shame</b> + diumumin ke semua (termasuk foto buktinya). Yang dilaporin dikasih kesempatan bantah dulu.
        </div>
        {create.isError && <p className="text-sm font-semibold text-rose-600">Gagal ngirim laporan. Cek koneksi.</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">Batal</button>
        <button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Kirim laporan
        </button>
      </div>
    </Backdrop>
  );
}

function ReportDetail({ report, viewerIsBod, onClose, onChanged }: { report: PeerReport; viewerIsBod: boolean; onClose: () => void; onChanged: (r: PeerReport) => void }) {
  const [note, setNote] = useState("");
  const [rebuttal, setRebuttal] = useState("");
  const st = STATUS[report.status];
  const cat = catOf(report.category);

  const verdict = useMutation({ mutationFn: (action: "verify" | "reject") => nexusApi.peerReportVerdict(report.id, { action, reviewNote: note.trim() || undefined }), onSuccess: onChanged });
  const withdraw = useMutation({ mutationFn: () => nexusApi.withdrawPeerReport(report.id), onSuccess: onChanged });
  const rebut = useMutation({ mutationFn: () => nexusApi.rebutPeerReport(report.id, rebuttal.trim()), onSuccess: onChanged });
  const busy = verdict.isPending || withdraw.isPending || rebut.isPending;

  return (
    <Backdrop onClose={onClose}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold ring-1", st.cls)}>{st.label}</span>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
        <div className="text-sm font-semibold text-muted-foreground">{cat?.emoji} {cat?.label}</div>

        <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/30 p-3">
          <Avatar userId={report.reportedUser.id} name={report.reportedUser.name} avatar={report.reportedUser.avatar} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black">{report.reportedUser.name}</div>
            <div className="text-[11px] text-muted-foreground">yang dilaporkan{report.reporter ? ` · oleh ${report.isMine ? "kamu" : report.reporter.name}` : " · pelapor anonim"}</div>
          </div>
        </div>

        {report.reason ? (
          <div><div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Kejadian</div><p className="mt-1 whitespace-pre-wrap text-sm">{report.reason}</p></div>
        ) : (
          <p className="text-sm text-muted-foreground">Detail kejadian cuma kelihatan oleh BoD & pihak terkait.</p>
        )}

        {report.evidenceUrl && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Foto bukti</div>
            <img src={report.evidenceUrl} alt="bukti" className="mt-1 max-h-72 w-full rounded-xl border border-border object-contain" />
          </div>
        )}

        {report.rebuttal && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-700">Bantahan dari yang dilaporkan</div>
            <p className="mt-1 whitespace-pre-wrap">{report.rebuttal}</p>
          </div>
        )}

        {report.status !== "PENDING" && (
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Keputusan {report.reviewer ? `· ${report.reviewer.name}` : ""}</div>
            <p className="mt-1">{report.status === "VERIFIED" ? "Terbukti melanggar — masuk Hall of Shame + diumumin." : report.status === "REJECTED" ? "Ditolak / gak terbukti." : "Ditarik pelapor."}</p>
            {report.reviewNote && <p className="mt-1 text-muted-foreground">“{report.reviewNote}”</p>}
            {report.xpApplied && <p className="mt-1 text-xs font-semibold text-rose-600">Yang dilaporin kena −{report.reportedPenaltyXp} XP</p>}
          </div>
        )}

        {/* Reported person → rebuttal (while pending) */}
        {report.canRebut && (
          <div className="space-y-2 rounded-2xl border border-sky-200 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-700">Kasih bantahan kamu</div>
            <textarea value={rebuttal} onChange={(e) => setRebuttal(e.target.value)} rows={3} maxLength={1000} placeholder="Klarifikasi / bantahan kamu — dibaca BoD sebelum mutusin." className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-sky-500" />
            <button onClick={() => rebut.mutate()} disabled={busy || !rebuttal.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-40">
              {rebut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareWarning className="h-4 w-4" />} Kirim bantahan
            </button>
            {rebut.isError && <p className="text-xs font-semibold text-rose-600">Gagal kirim bantahan.</p>}
          </div>
        )}

        {/* BoD → verdict (pending, not own report) */}
        {viewerIsBod && report.canDecide && (
          <div className="space-y-2 rounded-2xl border border-border p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Putuskan</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Catatan keputusan (opsional, dilihat kedua pihak)" className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <div className="flex gap-2">
              <button onClick={() => verdict.mutate("reject")} disabled={busy} className="flex-1 rounded-xl border border-border py-2 text-sm font-bold text-muted-foreground transition hover:bg-accent disabled:opacity-40">Tolak</button>
              <button onClick={() => verdict.mutate("verify")} disabled={busy} className="flex-[1.4] rounded-xl bg-rose-600 py-2 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-40">{verdict.isPending ? "Memproses…" : "Tandai terbukti"}</button>
            </div>
            <p className="text-[11px] text-muted-foreground">Terbukti = −XP + Hall of Shame + pengumuman ke semua. Pelapor tetap anonim.</p>
            {verdict.isError && <p className="text-xs font-semibold text-rose-600">Gagal — mungkin udah diputus orang lain.</p>}
          </div>
        )}

        {report.canWithdraw && (
          <button onClick={() => withdraw.mutate()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-accent disabled:opacity-40">
            {withdraw.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Tarik laporan ini
          </button>
        )}
      </div>
    </Backdrop>
  );
}

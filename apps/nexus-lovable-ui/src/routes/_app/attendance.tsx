import type React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/Avatar";
import { ApiError, downloadFile, fmtDate, fmtTime, nexusApi, statusLabel, type AttendanceActionPayload, type NexusAttendanceHistory, type NexusOffice, type NexusOffsiteCheckout } from "@/lib/nexus-api";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { getAttendanceFix, GeoError } from "@/lib/geo";
import { AlertTriangle, Calendar, Camera, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Coffee, Download, Loader2, MapPin, Pencil, Scale, Search, Sparkles, Trash2, X } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { SelfieCapture } from "@/components/attendance/SelfieCapture";
import { MobileCheckInHero } from "@/components/attendance/MobileCheckInHero";
import { MorphPanel, rectCenter, type MorphOrigin } from "@/components/motion/MorphPanel";
import { cn } from "@/lib/utils";

type HistRow = NonNullable<NexusAttendanceHistory["rows"]>[number];

function recTone(r: HistRow): "present" | "wfh" | "leave" | "sick" | "dayoff" | "absent" | "none" {
  // Approved leave/sick/permit/day-off/red-date days are surfaced via attendanceDayType (the request
  // type), NOT `status` (which is "COMPLETED" on those synthetic rows) — check it FIRST.
  const dt = (r.attendanceDayType || "").toUpperCase();
  if (dt === "SICK_APPROVED") return "sick";
  if (dt === "DAY_OFF_APPROVED") return "dayoff"; // covers DAY_OFF + RED_DATE (tanggal merah)
  if (dt === "LEAVE_APPROVED" || dt === "PERMIT_APPROVED") return "leave";
  const s = (r.status || "").toUpperCase();
  if (s.includes("REMOTE") || s.includes("WFH")) return "wfh";
  if (s.includes("LEAVE") || s.includes("SICK") || s.includes("PERMIT") || s.includes("OFF") || s.includes("IZIN") || s.includes("CUTI")) return "leave";
  if (r.checkInAt || s.includes("PRESENT") || s.includes("HADIR")) return "present";
  if (s.includes("ABSENT") || s.includes("ALPHA")) return "absent";
  return "none";
}

export const Route = createFileRoute("/_app/attendance")({ component: Attendance });

const sCls: Record<string, string> = {
  present: "bg-success/30",
  wfh: "bg-info/30",
  leave: "bg-warning/40",
  sick: "bg-rose-400/50",
  dayoff: "bg-teal-400/45",
  absent: "bg-destructive/30",
  none: "bg-muted/40",
};
const toneLabel: Record<string, string> = {
  present: "Hadir", wfh: "WFH", leave: "Cuti/Izin", sick: "Sakit", dayoff: "Day off / tgl merah", absent: "Absent", none: "",
};
const REQ_LABEL: Record<string, string> = { LEAVE: "Cuti", SICK: "Sakit", PERMIT: "Izin", DAY_OFF: "Day Off", RED_DATE: "Tanggal Merah" };

// Detail popup for an approved leave/sick/permit/day-off/red-date cell on the streak board.
function LeaveDetailDrawer({ record, onClose, canOverride }: { record: HistRow; onClose: () => void; canOverride?: boolean }) {
  const typeLabel = REQ_LABEL[(record.requestType || "").toUpperCase()] || "Cuti/Izin";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-warning/20 text-warning-foreground"><Coffee className="h-4 w-4" /></span>
            <div>
              <div className="font-display text-base font-bold tracking-tight">{typeLabel}</div>
              <div className="text-xs text-muted-foreground">{record.user?.name || "Crew"}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tanggal</dt><dd className="font-semibold">{fmtDate(record.attendanceDate)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Status</dt><dd className="font-semibold text-emerald-600">Approved ✓</dd></div>
          {record.reviewedBy?.name && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Disetujui oleh</dt><dd className="font-semibold">{record.reviewedBy.name}</dd></div>}
          {record.reviewedAt && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tgl approve</dt><dd className="font-semibold">{fmtDate(record.reviewedAt)}</dd></div>}
        </dl>
        {record.notes && (
          <div className="mt-3 rounded-xl bg-muted/40 p-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Alasan</div>
            <p className="whitespace-pre-wrap text-sm">{record.notes}</p>
          </div>
        )}
        {record.supportingDocumentUrl && (
          <a href={record.supportingDocumentUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-accent">
            <Download className="h-3.5 w-3.5" /> {record.supportingDocumentName || "Lihat lampiran"}
          </a>
        )}
        {canOverride && record.user?.id && (
          <StatusOverridePanel userId={record.user.id} name={record.user?.name ?? null} dateKey={(record.attendanceDate || "").slice(0, 10)} onDone={onClose} />
        )}
      </div>
    </div>
  );
}

const OVERRIDE_LABEL: Record<string, string> = { PRESENT: "Hadir", LEAVE: "Cuti", SICK: "Sakit", DAY_OFF: "Day off" };

/** BoD-only: rewrite one member-day's status (Hadir on-time / Cuti / Sakit / Day off) — XP penalties
 *  for that day are refunded + an auto-cut day-off restored — or just remove the punishment. */
function StatusOverridePanel({ userId, name, dateKey, onDone }: { userId: string; name: string | null; dateKey: string; onDone: () => void }) {
  const qc = useQueryClient();
  const override = useMutation({
    mutationFn: (action: "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "CLEAR_PENALTY") => nexusApi.attendanceOverride({ userId, date: dateKey, action }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["attendance-history"] });
      qc.invalidateQueries({ queryKey: ["attendance-requests"] });
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      if (r.action === "CLEAR_PENALTY") {
        celebrate(r.refunded ? `Punishment ${r.date} dihapus — XP & day-off balik 🛡️` : `Tidak ada potongan di ${r.date} — hari ini tetap diamankan dari potongan.`);
      } else {
        celebrate(`${name ?? "Staff"} · ${r.date} → ${OVERRIDE_LABEL[r.action] ?? r.action}${r.refunded ? " (potongan dipulihkan)" : ""} ✅`);
      }
      if ((r.multiDayRequestsLeft ?? 0) > 0) {
        alert(`Catatan: tanggal ini masih ketutup ${r.multiDayRequestsLeft} request multi-hari (cuti/izin beberapa hari). Kalau mau hari ini beneran tampil Hadir, atur request itu di bagian Requests.`);
      }
      onDone();
    },
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal mengubah status."),
  });
  const ask = (action: "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "CLEAR_PENALTY") => {
    const what = action === "CLEAR_PENALTY"
      ? `Hapus punishment ${dateKey} buat ${name ?? "staff ini"}?\n\nXP yang kepotong (telat/lupa checkout/alpha) dibalikin + day-off yang kepotong otomatis dipulihkan. Status kehadiran TIDAK diubah.`
      : `Ubah status ${dateKey} (${name ?? "staff ini"}) jadi ${OVERRIDE_LABEL[action]}?\n\nPotongan XP & day-off otomatis hari itu ikut dipulihkan.`;
    if (window.confirm(what)) override.mutate(action);
  };
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary"><Pencil className="h-3.5 w-3.5" /> Ubah status (BoD)</div>
      <div className="flex flex-wrap gap-1.5">
        {(["PRESENT", "LEAVE", "SICK", "DAY_OFF"] as const).map((a) => (
          <button key={a} disabled={override.isPending} onClick={() => ask(a)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold transition hover:border-primary hover:text-primary disabled:opacity-50">
            {OVERRIDE_LABEL[a]}
          </button>
        ))}
      </div>
      <button disabled={override.isPending} onClick={() => ask("CLEAR_PENALTY")} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50">
        {override.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />} Hapus punishment (balikin XP & day-off)
      </button>
      <p className="mt-1.5 text-[10px] text-muted-foreground">Semua aksi otomatis balikin potongan XP & day-off hari itu, dan tercatat di audit log.</p>
    </div>
  );
}

/** BoD-only: delete bad attendance data — a whole record (e.g. an accidental/"mabok" double check-in)
 *  or just the check-out (mis-tapped → reopen the record). */
function DeleteRecordPanel({ recordId, hasCheckOut, name, dateKey, onDone }: { recordId: string; hasCheckOut: boolean; name: string | null; dateKey: string; onDone: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (vars: { part?: "checkout" }) => nexusApi.deleteAttendanceRecord(recordId, vars.part ? { part: vars.part } : {}),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["attendance-history"] });
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      celebrate(vars.part === "checkout" ? `Check-out ${dateKey} dihapus — absen dibuka lagi 🔓` : `Absen ${dateKey} dihapus 🗑️`);
      onDone();
    },
    onError: (e) => alert(e instanceof Error ? e.message : "Gagal menghapus."),
  });
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-rose-300/70 bg-rose-50/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600"><Trash2 className="h-3.5 w-3.5" /> Hapus data absen</div>
      <div className="flex flex-wrap gap-1.5">
        {hasCheckOut && (
          <button disabled={del.isPending} onClick={() => { if (window.confirm(`Hapus CHECK-OUT ${dateKey} (${name ?? "staff ini"})?\n\nCheck-in-nya tetap — record dibuka lagi jadi "masih clocked-in".`)) del.mutate({ part: "checkout" }); }} className="rounded-full border border-rose-300 bg-card px-3 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50">
            Hapus check-out
          </button>
        )}
        <button disabled={del.isPending} onClick={() => { if (window.confirm(`Hapus SELURUH absen ${dateKey} (${name ?? "staff ini"})?\n\nData check-in & check-out hari itu kehapus permanen. Potongan XP/day-off hari itu dibalikin & harinya diamankan dari potongan absen. Tercatat di audit log.`)) del.mutate({}); }} className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50">
          {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Hapus absen ini
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">Buat ngebersihin check-in yang kepencet gak sengaja. "Hapus absen ini" = record-nya ilang + hari itu diamankan dari potongan.</p>
    </div>
  );
}

function Attendance() {
  const today = useQuery({ queryKey: ["attendance-today"], queryFn: nexusApi.attendanceToday, retry: 1 });
  const reduceMotion = useReducedMotion();
  const [logKind, setLogKind] = useState<{ kind: "DAY_OFF" | "RED_DATE"; origin?: MorphOrigin } | null>(null);
  const [correctOrigin, setCorrectOrigin] = useState<MorphOrigin | undefined>(undefined);
  // Audit board state: which month to inspect + per-staff search.
  const [monthKey, setMonthKey] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [memberQuery, setMemberQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "log">("grid");
  // Pull the WHOLE selected month (not just today) so every past day is auditable — backend defaults
  // the range to today when no month is sent, which left the streak grid empty for prior days.
  const canReview = Boolean(today.data?.canReviewAttendanceRequests);
  const canManage = Boolean(today.data?.canManageAttendance);
  // A team-lead MANAGER can review (team-scoped) but not fully manage → still gets the crew board,
  // scoped to their team by the backend. Workspace-wide admin actions stay gated on canManage.
  const canSeeBoard = canManage || canReview;
  // Privacy: managers (BoD/OAA/admin) see the whole crew board; everyone else only their OWN attendance.
  const boardScope = canSeeBoard ? "workspace" : "me";
  const history = useQuery({ queryKey: ["attendance-history", boardScope, monthKey], queryFn: () => nexusApi.attendanceHistory(`scope=${boardScope}&month=${monthKey}`), retry: 1 });
  const qc = useQueryClient();
  const deduct = useMutation({
    mutationFn: () => nexusApi.deductAbsences(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("attendance-history") });
      celebrate(`Proses bolos selesai — ${r.created} day-off dipotong (${r.from} … ${r.to}) ⚖️`);
    },
  });
  const outageRefund = useMutation({
    mutationFn: (payload: { date: string }) => nexusApi.attendanceOutageRefund({ ...payload, dryRun: false }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("attendance-history") });
      const failNote = r.failed > 0 ? ` ⚠️ ${r.failed} gagal — klik lagi buat ulang (aman).` : "";
      celebrate(`Sistem-down ${r.date} di-refund — XP balik ke ${r.refundedMembers} staff (+${r.totalXpRefunded} XP), ${r.totalDayOffsRestored} day-off dipulihkan 🛡️${failNote}`);
    },
    onError: (e) => { alert(e instanceof Error ? e.message : "Gagal refund hari sistem-down."); },
  });
  const [outageBusy, setOutageBusy] = useState(false);
  const runOutageRefund = async () => {
    const now = new Date();
    const def = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const date = window.prompt("Refund penalti HARI SISTEM-DOWN (listrik mati / NEXUS down).\n\nSemua staff yang kepotong XP/day-off di tanggal ini bakal dibalikin. Yang udah request day-off hari itu di-skip. Status hadir/engga TIDAK diubah.\n\nTanggal (YYYY-MM-DD):", def);
    if (!date || !date.trim()) return;
    setOutageBusy(true);
    try {
      const p = await nexusApi.attendanceOutageRefund({ date: date.trim(), dryRun: true });
      const list = p.entries.filter((e) => !e.excludedReason).slice(0, 40)
        .map((e) => `• ${e.name ?? e.userId}: +${e.xpRefund} XP${e.autoDayOffs ? `, ${e.autoDayOffs} day-off balik` : ""}`).join("\n");
      const msg = `AUDIT ${p.date} (BELUM diubah apa-apa):\n\n`
        + `${p.refundedMembers} staff bakal di-refund — total +${p.totalXpRefunded} XP, ${p.totalDayOffsRestored} day-off balik.\n`
        + `${p.excludedMembers} staff di-skip (udah request day-off hari itu).\n\n`
        + `${list || "(tidak ada penalti yang kepotong di tanggal ini)"}\n\n`
        + `Lanjut refund beneran?`;
      if (p.refundedMembers === 0) { alert(msg.replace("Lanjut refund beneran?", "Tidak ada yang perlu di-refund.")); return; }
      if (!window.confirm(msg)) return;
      outageRefund.mutate({ date: date.trim() });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal ambil audit.");
    } finally {
      setOutageBusy(false);
    }
  };
  const [correctRecord, setCorrectRecord] = useState<HistRow | null>(null);
  const [leaveDetail, setLeaveDetail] = useState<HistRow | null>(null);
  // BoD: override a member-day that has NO record/request yet (empty board cell → set status).
  const [overrideTarget, setOverrideTarget] = useState<{ userId: string; name: string | null; dateKey: string } | null>(null);
  const rows = Array.isArray(history.data?.rows) ? history.data.rows : [];
  // Full de-duped member list (search runs over ALL members, not a pre-sliced subset).
  const allMembers = rows
    .map((row) => row.user)
    .filter((user, index, arr): user is NonNullable<typeof user> => Boolean(user?.id) && arr.findIndex((other) => other?.id === user?.id) === index);
  const q = memberQuery.trim().toLowerCase();
  const matchMember = (u?: { name?: string | null; email?: string | null } | null) => {
    if (!q) return true;
    return (u?.name || "").toLowerCase().includes(q) || (u?.email || "").toLowerCase().includes(q);
  };
  const filteredMembers = allMembers.filter(matchMember);
  // Show ALL members on the board (scrollable). Search still narrows to reach anyone fast.
  const MEMBER_CAP = 1000;
  const memberRows = filteredMembers.slice(0, MEMBER_CAP);
  const hiddenCount = filteredMembers.length - memberRows.length;
  // Log view: flat chronological list of actual check-in/out records (the ones with photo + location).
  const logRows = rows
    .filter((r) => r.user?.id && (r.checkInAt || r.checkOutAt) && matchMember(r.user))
    .sort((a, b) => {
      const ad = a.attendanceDate ?? "", bd = b.attendanceDate ?? "";
      if (ad !== bd) return ad < bd ? 1 : -1;
      return (b.checkInAt ?? "").localeCompare(a.checkInAt ?? "");
    })
    .slice(0, 300);
  // Attendance period = company payroll cut-off: 28th of prev month → 27th of this month (NOT calendar month).
  const CUTOFF_DAY = 27;
  const [year, monthNum] = monthKey.split("-").map(Number);
  const month = monthNum - 1; // 0-based index of the cut-off (end) month
  const periodStart = new Date(year, month - 1, CUTOFF_DAY + 1); // prev month, 28th
  const periodEnd = new Date(year, month, CUTOFF_DAY); // this month, 27th
  const periodDays: { key: string; day: number }[] = [];
  for (let d = new Date(periodStart); d <= periodEnd; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    periodDays.push({ key, day: d.getDate() });
  }
  const nowKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const isCurrentMonth = monthKey === nowKey;
  const monthLabel = new Date(year, month, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const periodLabel = `${periodStart.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} – ${periodEnd.toLocaleDateString("id-ID", { day: "numeric", month: "short" })}`;
  const shiftMonth = (delta: number) => { const d = new Date(year, month + delta, 1); setMonthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  // Key by full date (YYYY-MM-DD) since the period spans two calendar months — day-of-month alone collides.
  const recMap = new Map<string, HistRow>();
  for (const r of rows) {
    if (!r.user?.id || !r.attendanceDate) continue;
    recMap.set(`${r.user.id}:${r.attendanceDate.slice(0, 10)}`, r);
  }
  const presentCount = (uid: string) => rows.filter((r) => r.user?.id === uid && recTone(r) === "present").length;

  return (
    <div>
      <PageHeader
        title="Attendance Playground"
        subtitle="Team presence, leave, WFH, and check-in streaks — less spreadsheet, more vibe check."
        icon={<ClipboardCheck className="h-6 w-6 text-primary" />}
        actions={
          <>
            {canManage && (
              <>
                <button
                  onClick={runOutageRefund}
                  disabled={outageBusy || outageRefund.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-accent active:scale-[0.98] disabled:opacity-50"
                  title="Balikin XP & day-off yang kepotong karena sistem/listrik down (preview dulu sebelum eksekusi)"
                >
                  {outageBusy || outageRefund.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />} Refund sistem-down
                </button>
                <button
                  onClick={() => { if (confirm("Proses bolos & potong jatah day-off?\n\nUntuk tiap hari kerja yang lewat (s/d kemarin) di mana user TIDAK absen & TIDAK ada izin, sistem otomatis bikin DAY_OFF (potong kuota). Aman diulang.")) deduct.mutate(); }}
                  disabled={deduct.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors duration-150 hover:bg-accent active:scale-[0.98] disabled:opacity-50"
                  title="Deteksi hari bolos & potong jatah day-off"
                >
                  {deduct.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />} Proses bolos
                </button>
              </>
            )}
          </>
        }
      />

      <div className="p-4 md:p-8 space-y-5">
        {/* Mobile: new map-centric check-in hero. Desktop: keep the dashboard card. */}
        <div className="md:hidden">
          <MobileCheckInHero today={today.data ?? null} disabled={today.isError || today.isLoading || (Boolean(today.data?.todayRequest) && !today.data?.pendingCheckout)} />
        </div>
        <div className="hidden md:block">
          <AttendanceActionCard
            checkedIn={Boolean(today.data?.today?.checkInAt)}
            checkedOut={Boolean(today.data?.today?.checkOutAt)}
            checkInAt={today.data?.today?.checkInAt}
            checkOutAt={today.data?.today?.checkOutAt}
            officeName={today.data?.today?.officeLocation?.name}
            checkOutApproval={today.data?.today?.checkOutApproval ?? null}
            pendingCheckout={today.data?.pendingCheckout ? { attendanceDate: today.data.pendingCheckout.attendanceDate, checkInAt: today.data.pendingCheckout.checkInAt, officeName: today.data.pendingCheckout.officeLocation?.name } : null}
            disabled={today.isError || today.isLoading || (Boolean(today.data?.todayRequest) && !today.data?.pendingCheckout)}
          />
        </div>


        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FunMetric
            icon={<Coffee className="h-5 w-5" />}
            label="Today’s status"
            value={today.data?.today?.status ? statusLabel(today.data.today.status) : today.data?.todayRequest?.status ? `${statusLabel(today.data.todayRequest.type)} ${statusLabel(today.data.todayRequest.status)}` : "Ready to check in"}
            helper={today.isError ? "Login/session needed for live data" : "Pulled from NEXUS attendance API"}
            tone="green"
          />
          <FunMetric
            icon={<MapPin className="h-5 w-5" />}
            label="Office checkpoint"
            value={today.data?.today?.officeLocation?.name || `${today.data?.activeOfficeCount ?? 0} active offices`}
            helper={`In ${fmtTime(today.data?.today?.checkInAt)} · Out ${fmtTime(today.data?.today?.checkOutAt)}`}
            tone="purple"
          />
          <FunMetric
            icon={<Sparkles className="h-5 w-5" />}
            label="Day-off tokens"
            value={`${today.data?.dayOffUsedThisMonth ?? 0}/${today.data?.dayOffQuota ?? 4} used`}
            helper="Klik buat lihat log pemakaian day-off"
            tone="amber"
            onClick={(origin) => setLogKind({ kind: "DAY_OFF", origin })}
          />
          <FunMetric
            icon={<Calendar className="h-5 w-5" />}
            label="Tanggal merah"
            value={`${today.data?.redDateUsedThisMonth ?? 0}/${today.data?.redDateQuota ?? 0} used`}
            helper="Klik buat lihat log tanggal merah"
            tone="rose"
            onClick={(origin) => setLogKind({ kind: "RED_DATE", origin })}
          />
        </section>

        <div className="rounded-[28px] border border-border bg-card shadow-soft overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{viewMode === "grid" ? (canSeeBoard ? "Crew streak board" : "Riwayat absen kamu") : (canSeeBoard ? "Log absensi" : "Riwayat absen kamu")}</h2>
              <p className="text-sm text-muted-foreground">{viewMode === "grid" ? "Green = hadir, purple = WFH, kuning = cuti/izin, rose = sakit, teal = day off / tgl merah. Klik cell buat detail." : (canSeeBoard ? "Riwayat absen tiap orang — foto selfie & lokasi check-in/out. Klik baris buat detail." : "Riwayat check-in/out kamu — foto selfie & lokasi. Klik baris buat detail.")}</p>
            </div>
            <div className="flex items-center gap-3">
              {viewMode === "grid" && (
                <div className="hidden gap-2 text-xs text-muted-foreground sm:flex">
                  <Legend cls="bg-success/40" label="Present" />
                  <Legend cls="bg-info/40" label="WFH" />
                  <Legend cls="bg-warning/40" label="Cuti/Izin" />
                  <Legend cls="bg-rose-400/50" label="Sakit" />
                  <Legend cls="bg-teal-400/45" label="Day off" />
                </div>
              )}
              <div className="inline-flex rounded-lg border border-border p-0.5">
                <button onClick={() => setViewMode("grid")} className={cn("rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>Board</button>
                <button onClick={() => setViewMode("log")} className={cn("rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", viewMode === "log" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>Log</button>
              </div>
            </div>
          </div>
          {/* Audit controls: month navigation + per-staff search. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="flex items-center gap-1.5">
              <button onClick={() => shiftMonth(-1)} aria-label="Bulan sebelumnya" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
              <span className="flex min-w-[8.5rem] flex-col items-center leading-tight">
                <span className="text-sm font-semibold capitalize tabular-nums">{monthLabel}</span>
                <span className="text-[10px] text-muted-foreground" title="Periode cut-off (28 → 27)">{periodLabel}</span>
              </span>
              <button onClick={() => shiftMonth(1)} disabled={isCurrentMonth} aria-label="Bulan berikutnya" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              {!isCurrentMonth && <button onClick={() => setMonthKey(nowKey)} className="ml-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">Bulan ini</button>}
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              {/* Per-staff audit search — for anyone who sees the crew board (BoD: all; team-lead: their team). */}
              {canSeeBoard && (
                <div className="relative flex-1 sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    aria-label="Cari staff buat audit absensi"
                    placeholder="Cari staff buat audit…"
                    className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-8 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  {memberQuery && <button onClick={() => setMemberQuery("")} aria-label="Bersihkan pencarian" className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-3 w-3" /></button>}
                </div>
              )}
              {canSeeBoard && <ExportMenu monthKey={monthKey} monthLabel={monthLabel} />}
            </div>
          </div>
          {viewMode === "log" ? (
            <div className="divide-y divide-border">
              {history.isLoading && <div className="px-5 py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>}
              {!history.isLoading && logRows.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">{q ? `Ga ada absen dari “${memberQuery.trim()}” di bulan ini.` : "Belum ada absen tercatat di bulan ini."}</div>
              )}
              {logRows.map((r) => {
                const tone = recTone(r);
                return (
                  <button key={r.id} onClick={() => setCorrectRecord(r)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/20">
                    <MemberAvatar user={r.user!} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", sCls[tone])} />
                        <span className="truncate font-medium">{r.user?.name || "PATS Crew"}</span>
                        <span className="text-xs text-muted-foreground">{fmtDate(r.attendanceDate)}</span>
                        {r.checkOutOffsite && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Luar area</span>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        In {fmtTime(r.checkInAt)}{r.checkInAddress ? ` · ${r.checkInAddress}` : r.checkInDistanceMeters != null ? ` · ±${Math.round(r.checkInDistanceMeters)}m` : ""}
                        {(r.checkOutAt || r.checkOutAddress) ? ` — Out ${fmtTime(r.checkOutAt)}${r.checkOutAddress ? ` · ${r.checkOutAddress}` : ""}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {r.checkInPhotoUrl ? <img src={r.checkInPhotoUrl} alt="selfie in" loading="lazy" className="h-10 w-10 rounded-lg object-cover ring-1 ring-border" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground/40"><Camera className="h-4 w-4" /></div>}
                      {r.checkOutPhotoUrl && <img src={r.checkOutPhotoUrl} alt="selfie out" loading="lazy" className="h-10 w-10 rounded-lg object-cover ring-1 ring-border" />}
                    </div>
                  </button>
                );
              })}
              {!history.isLoading && logRows.length >= 300 && (
                <div className="px-5 py-3 text-center text-xs text-muted-foreground">Menampilkan 300 absen terbaru — pakai navigasi bulan / cari nama buat lihat sisanya.</div>
              )}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground uppercase">Member</th>
                  {periodDays.map((pd) => (
                    <th key={pd.key} className={cn("px-1 py-2 font-medium text-[10px] text-muted-foreground", pd.day === 1 && "border-l border-border/70")}>{pd.day}</th>
                  ))}
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground uppercase">Score</th>
                </tr>
              </thead>
              <tbody>
                {history.isLoading && (
                  <tr><td colSpan={periodDays.length + 2} className="px-4 py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                )}
                {!history.isLoading && memberRows.length === 0 && (
                  <tr><td colSpan={periodDays.length + 2} className="px-4 py-10 text-center text-sm text-muted-foreground">{q ? `Ga ada staff yang cocok sama “${memberQuery.trim()}”.` : "Belum ada data absensi di bulan ini."}</td></tr>
                )}
                {memberRows.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <MemberAvatar user={u} />
                        <div>
                          <div className="font-medium">{u.name || "PATS Crew"}</div>
                          <div className="text-[10px] text-muted-foreground">{memberSubtitle(u)}</div>
                        </div>
                      </div>
                    </td>
                    {periodDays.map((pd) => {
                      const rec = recMap.get(`${u.id}:${pd.key}`);
                      const tone = rec ? recTone(rec) : "none";
                      return (
                        <td key={pd.key} className={cn("px-1 py-2.5 text-center", pd.day === 1 && "border-l border-border/70")}>
                          {rec ? (
                            tone === "leave" || tone === "sick" || tone === "dayoff" ? (
                              <motion.button
                                whileHover={reduceMotion ? undefined : { scale: 1.3 }}
                                whileTap={reduceMotion ? undefined : { scale: 0.85 }}
                                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                                onClick={(e) => { setCorrectOrigin(rectCenter(e.currentTarget)); setLeaveDetail(rec); }}
                                title={`${fmtDate(rec.attendanceDate)} · ${toneLabel[tone]}${rec.notes ? " — " + rec.notes : ""} — klik buat detail`}
                                className={cn("inline-block h-5 w-5 rounded-lg transition-[box-shadow] hover:ring-2 hover:ring-primary/50", sCls[tone])}
                              />
                            ) : (
                              <motion.button
                                whileHover={reduceMotion ? undefined : { scale: 1.3 }}
                                whileTap={reduceMotion ? undefined : { scale: 0.85 }}
                                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                                onClick={(e) => { setCorrectOrigin(rectCenter(e.currentTarget)); setCorrectRecord(rec); }}
                                title={`${fmtDate(rec.attendanceDate)} · ${statusLabel(rec.status || "")} · in ${fmtTime(rec.checkInAt)} / out ${fmtTime(rec.checkOutAt)} — klik buat lihat lokasi & selfie`}
                                className={cn("inline-block h-5 w-5 rounded-lg transition-[box-shadow] hover:ring-2 hover:ring-primary/50", sCls[tone])}
                              />
                            )
                          ) : canManage ? (
                            <button
                              onClick={() => setOverrideTarget({ userId: u.id, name: u.name ?? null, dateKey: pd.key })}
                              title={`${pd.key} — kosong. Klik buat set status (Hadir/Cuti/Sakit/Day off).`}
                              className="inline-block h-5 w-5 rounded-lg bg-muted/30 transition-[box-shadow] hover:ring-2 hover:ring-primary/50"
                            />
                          ) : (
                            <span className="inline-block h-5 w-5 rounded-lg bg-muted/30" />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">{presentCount(u.id)}/{periodDays.length}</td>
                  </tr>
                ))}
                {!history.isLoading && hiddenCount > 0 && (
                  <tr><td colSpan={periodDays.length + 2} className="px-4 py-3 text-center text-xs text-muted-foreground">+{hiddenCount} staff lagi — ketik nama di kolom cari buat audit yang lain.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>

        <RequestsSection canReview={canReview} />
        {canManage && <OfficesSection />}
      </div>
      <AnimatePresence>
        {correctRecord && <AttendanceCorrectionDrawer key={correctRecord.id} record={correctRecord} origin={correctOrigin} onClose={() => setCorrectRecord(null)} canOverride={canManage} />}
        {leaveDetail && <LeaveDetailDrawer record={leaveDetail} onClose={() => setLeaveDetail(null)} canOverride={canManage} />}
        {overrideTarget && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => setOverrideTarget(null)}>
            <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold tracking-tight">{overrideTarget.name ?? "Staff"}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(overrideTarget.dateKey)} — belum ada catatan kehadiran.</p>
                </div>
                <button onClick={() => setOverrideTarget(null)} aria-label="Tutup" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
              </div>
              <StatusOverridePanel userId={overrideTarget.userId} name={overrideTarget.name} dateKey={overrideTarget.dateKey} onDone={() => setOverrideTarget(null)} />
            </div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {logKind && <DayOffLogModal key={logKind.kind} kind={logKind.kind} origin={logKind.origin} onClose={() => setLogKind(null)} />}
      </AnimatePresence>
    </div>
  );
}

function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Export menu: downloads the monthly recap (xlsx, "ABSENSI INTERNAL" sheet template) or detail log (csv).
function ExportMenu({ monthKey, monthLabel }: { monthKey: string; monthLabel: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  const run = async (format: "xlsx" | "csv") => {
    setBusy(format);
    setOpen(false);
    try {
      await downloadFile(`/api/attendance/history?scope=workspace&month=${monthKey}&format=${format}`, `absensi-${monthKey}.${format}`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Export gagal — coba lagi ya.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((v) => !v)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-pop">
            <button onClick={() => run("xlsx")} className="flex w-full flex-col items-start px-3 py-2.5 text-left transition-colors hover:bg-muted/40"><span className="text-sm font-semibold">Rekap bulanan (Excel)</span><span className="text-xs text-muted-foreground">Sheet absensi internal · {monthLabel}</span></button>
            <button onClick={() => run("csv")} className="flex w-full flex-col items-start border-t border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/40"><span className="text-sm font-semibold">Detail log (CSV)</span><span className="text-xs text-muted-foreground">Per absen: jam, status, telat</span></button>
          </div>
        </>
      )}
    </div>
  );
}

// Member avatar that falls back to the initials Avatar if the photo URL 404s.
function MemberAvatar({ user }: { user: { id: string; avatar?: string | null } }) {
  const [failed, setFailed] = useState(false);
  if (user.avatar && !failed) {
    return <img src={user.avatar} alt="" onError={() => setFailed(true)} className="h-6 w-6 rounded-full object-cover" />;
  }
  return <Avatar userId={user.id} size={24} />;
}

// One evidence card (selfie + location) for a check-in or check-out leg — the audit view.
function AttendanceEvidence({ kind, photoUrl, address, lat, lng, distanceMeters, atIso, offsite, reason }: {
  kind: "in" | "out";
  photoUrl?: string | null; address?: string | null; lat?: number | null; lng?: number | null;
  distanceMeters?: number | null; atIso?: string | null; offsite?: boolean | null; reason?: string | null;
}) {
  const hasAny = !!photoUrl || !!address || lat != null;
  const mapUrl = lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{kind === "in" ? "Check-in" : "Check-out"}</span>
        {atIso && <span className="text-[11px] tabular-nums text-muted-foreground">{fmtTime(atIso)}</span>}
      </div>
      {!hasAny ? (
        <p className="mt-2 text-xs text-muted-foreground/70">Belum ada bukti {kind === "in" ? "check-in" : "check-out"}.</p>
      ) : (
        <div className="mt-2 flex gap-3">
          {photoUrl ? (
            <a href={photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
              <img src={photoUrl} alt={`Selfie ${kind}`} className="h-20 w-20 rounded-xl object-cover ring-1 ring-border transition-transform hover:scale-105" />
            </a>
          ) : (
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground/40"><Camera className="h-5 w-5" /></div>
          )}
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            {offsite && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Luar area</span>}
            <p className="leading-snug text-foreground/80">{address || (lat != null ? `${lat.toFixed(5)}, ${lng?.toFixed(5)}` : "Lokasi tidak tercatat")}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
              {distanceMeters != null && <span>±{Math.round(distanceMeters)}m dari kantor</span>}
              {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"><MapPin className="h-3 w-3" /> peta</a>}
            </div>
            {reason && <p className="italic text-muted-foreground">“{reason}”</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function AttendanceCorrectionDrawer({ record, origin, onClose, canOverride }: { record: HistRow; origin?: MorphOrigin; onClose: () => void; canOverride?: boolean }) {
  const qc = useQueryClient();
  const [checkInAt, setCheckInAt] = useState(toLocalInput(record.checkInAt));
  const [checkOutAt, setCheckOutAt] = useState(toLocalInput(record.checkOutAt));
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const save = useMutation({
    mutationFn: async () => {
      const checkInISO = checkInAt ? new Date(checkInAt).toISOString() : null;
      const checkOutISO = checkOutAt ? new Date(checkOutAt).toISOString() : null;
      // Existing record → PATCH. MISSING record (a placeholder history row / 404) → CREATE it via the
      // override endpoint with the entered times — i.e. admin fills an absen the staff couldn't record
      // (e.g. system error blocked their check-in).
      if (record.id) {
        try {
          return await nexusApi.correctAttendanceRecord(record.id, { checkInAt: checkInISO, checkOutAt: checkOutISO, notes: notes || null, correctionReason: reason.trim() });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
      }
      const uid = record.user?.id;
      if (!uid) throw new Error("User tidak diketahui.");
      return nexusApi.attendanceOverride({ userId: uid, date: (record.attendanceDate || "").slice(0, 10), action: "PRESENT", checkInAt: checkInISO, checkOutAt: checkOutISO, note: reason.trim() });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance-history"] }); celebrate("Absen tersimpan ✅"); onClose(); },
  });

  const field = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <MorphPanel origin={origin} onClose={onClose}>
      <div className="overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">Attendance detail</h2>
            <p className="mt-1 text-sm text-muted-foreground">{record.user?.name ?? "Crew"} · {fmtDate(record.attendanceDate)} · {statusLabel(record.status || "")}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Bukti absensi · lokasi & selfie</p>
          <AttendanceEvidence kind="in" photoUrl={record.checkInPhotoUrl} address={record.checkInAddress} lat={record.checkInLat} lng={record.checkInLng} distanceMeters={record.checkInDistanceMeters} atIso={record.checkInAt} />
          <AttendanceEvidence kind="out" photoUrl={record.checkOutPhotoUrl} address={record.checkOutAddress} lat={record.checkOutLat} lng={record.checkOutLng} distanceMeters={record.checkOutDistanceMeters} atIso={record.checkOutAt} offsite={record.checkOutOffsite} reason={record.checkOutReason} />
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Koreksi manual</p>
        </div>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">Check-in<input type="datetime-local" value={checkInAt} onChange={(e) => setCheckInAt(e.target.value)} className={cn(field, "mt-1")} /></label>
            <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">Check-out<input type="datetime-local" value={checkOutAt} onChange={(e) => setCheckOutAt(e.target.value)} className={cn(field, "mt-1")} /></label>
          </div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note…" className={cn(field, "mt-1 min-h-16")} /></label>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">Correction reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being corrected?" className={cn(field, "mt-1")} /></label>
          {save.isError && <p className="text-sm text-destructive">Gagal: {save.error instanceof Error && save.error.message ? save.error.message : "koreksi gagal — cek izin / urutan waktu."}</p>}
          <button disabled={!checkInAt || !reason.trim() || save.isPending} onClick={() => save.mutate()} className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-50">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save correction</button>
        </div>
        {canOverride && record.user?.id && (
          <StatusOverridePanel userId={record.user.id} name={record.user?.name ?? null} dateKey={(record.attendanceDate || "").slice(0, 10)} onDone={onClose} />
        )}
        {canOverride && record.id && (
          <DeleteRecordPanel recordId={record.id} hasCheckOut={!!record.checkOutAt} name={record.user?.name ?? null} dateKey={(record.attendanceDate || "").slice(0, 10)} onDone={onClose} />
        )}
      </div>
    </MorphPanel>
  );
}

function OfficesSection() {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editOffice, setEditOffice] = useState<NexusOffice | null>(null);
  const offices = useQuery({ queryKey: ["attendance-offices"], queryFn: nexusApi.attendanceOffices, retry: 1 });
  const rows = offices.data?.offices ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["attendance-offices"] });
  const toggle = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => nexusApi.updateOffice(id, { isActive }), onSuccess: invalidate });

  return (
    <section className="rounded-[28px] border border-border bg-card shadow-soft overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Offices & geofence</h2>
          <p className="text-sm text-muted-foreground">Set office locations, radius, and shift times for check-in.</p>
        </div>
        <button onClick={() => setComposerOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><MapPin className="h-3.5 w-3.5" /> New office</button>
      </div>
      <div className="divide-y divide-border">
        {offices.isLoading && <div className="px-5 py-4 text-sm text-muted-foreground">Loading offices…</div>}
        {!offices.isLoading && rows.length === 0 && <div className="px-5 py-6 text-center text-sm text-muted-foreground">No offices configured.</div>}
        {rows.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <MapPin className={`h-4 w-4 shrink-0 ${o.isActive ? "text-primary" : "text-muted-foreground/40"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{o.name}</div>
              <div className="text-xs text-muted-foreground">{o.address || `${o.latitude?.toFixed(4)}, ${o.longitude?.toFixed(4)}`} · {o.radiusMeters}m</div>
            </div>
            <button onClick={() => setEditOffice(o)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Pencil className="h-3.5 w-3.5" /> Edit</button>
            <button onClick={() => toggle.mutate({ id: o.id, isActive: !o.isActive })} className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-colors ${o.isActive ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{o.isActive ? "Active" : "Inactive"}</button>
          </div>
        ))}
      </div>
      {(composerOpen || editOffice) && <OfficeComposer office={editOffice ?? undefined} onClose={() => { setComposerOpen(false); setEditOffice(null); }} onCreated={invalidate} />}
    </section>
  );
}

function OfficeComposer({ office, onClose, onCreated }: { office?: NexusOffice; onClose: () => void; onCreated: () => void }) {
  const editing = !!office;
  const [name, setName] = useState(office?.name ?? "");
  const [address, setAddress] = useState(office?.address ?? "");
  const [lat, setLat] = useState(office?.latitude != null ? String(office.latitude) : "");
  const [lng, setLng] = useState(office?.longitude != null ? String(office.longitude) : "");
  const [radius, setRadius] = useState(office?.radiusMeters != null ? String(office.radiusMeters) : "100");
  // Toleransi telat (grace). Default 0 = ketat (telat dari menit pertama). Dulu ini bisa ke-set
  // diam-diam (60 menit) lewat form lama → sekarang dibikin kelihatan di sini biar ga "kejadian lagi".
  const [grace, setGrace] = useState(office?.lateGraceMinutes != null ? String(office.lateGraceMinutes) : "0");
  // Office shift is just a hidden fallback now (per-person shift wins); keep the existing value on
  // edit, default 09:00–18:00 on create. Not editable here anymore.
  const shiftStart = office?.shiftStartTime ?? "09:00";
  const shiftEnd = office?.shiftEndTime ?? "18:00";
  const create = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), address: address || null, latitude: Number(lat), longitude: Number(lng), radiusMeters: Number(radius), shiftStartTime: shiftStart, shiftEndTime: shiftEnd, lateGraceMinutes: Math.min(180, Number(grace) || 0) };
      return editing ? nexusApi.updateOffice(office!.id, payload) : nexusApi.createOffice(payload);
    },
    onSuccess: () => { onCreated(); onClose(); },
  });
  const useMyLocation = () => navigator.geolocation?.getCurrentPosition((pos) => { setLat(String(pos.coords.latitude)); setLng(String(pos.coords.longitude)); });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold tracking-tight">{editing ? "Edit office" : "New office"}</h2>
        <div className="mt-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Office name" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (optional)" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <div className="grid grid-cols-2 gap-2">
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <button onClick={useMyLocation} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.98]"><MapPin className="h-3.5 w-3.5" /> Use my location</button>
          {/* Shift start/end dihilangkan — jam shift sekarang diatur per orang (Control Room → Members),
              bukan per office. Office cuma nyimpen default fallback (gak ditampilin di sini). */}
          <div className="flex flex-wrap gap-4">
            <label className="block text-[11px] font-bold text-muted-foreground">Radius (m)<input value={radius} onChange={(e) => setRadius(e.target.value.replace(/[^0-9]/g, ""))} className="mt-1 w-32 rounded-xl border border-border bg-background px-2 py-2 text-sm" /></label>
            <label className="block text-[11px] font-bold text-muted-foreground">Toleransi telat (menit)<input value={grace} onChange={(e) => setGrace(e.target.value.replace(/[^0-9]/g, ""))} className="mt-1 w-32 rounded-xl border border-border bg-background px-2 py-2 text-sm" /><span className="mt-1 block font-normal text-muted-foreground/70">0 = ketat, telat dari menit ke-1</span></label>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2">
          <button disabled={!name.trim() || !lat || !lng || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? "Save changes" : "Create office"}</button>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">Cancel</button>
          {create.isError && <span className="text-xs font-semibold text-destructive">Gagal — butuh role supervisor.</span>}
        </div>
      </div>
    </div>
  );
}

function RequestsSection({ canReview }: { canReview: boolean }) {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const requestsQuery = useQuery({ queryKey: ["attendance-requests"], queryFn: () => nexusApi.attendanceRequests("scope=workspace"), retry: 1 });
  const rows = Array.isArray(requestsQuery.data) ? requestsQuery.data : requestsQuery.data?.requests ?? [];
  const pending = rows.filter((r) => (r.status || "").toUpperCase() === "PENDING");
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["attendance-requests"] }); qc.invalidateQueries({ queryKey: ["attendance-today"] }); qc.invalidateQueries({ queryKey: ["attendance-history"] }); };
  const review = useMutation({ mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "cancel" }) => nexusApi.reviewAttendanceRequest(id, action), onSuccess: invalidate });

  // Offsite checkouts (BoD only) merged into this same approvals list.
  const offsiteQ = useQuery({ queryKey: ["offsite-checkouts", "all"], queryFn: () => nexusApi.offsiteCheckouts("ALL"), retry: false, enabled: canReview });
  const offsiteItems = offsiteQ.data?.items ?? [];
  const offsiteSorted = [...offsiteItems].sort((a, b) => (a.approval === "PENDING" ? 0 : 1) - (b.approval === "PENDING" ? 0 : 1));
  const offsiteReview = useMutation({ mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => nexusApi.reviewOffsiteCheckout(id, action), onSuccess: () => { qc.invalidateQueries({ queryKey: ["offsite-checkouts"] }); invalidate(); } });
  const pendingTotal = pending.length + offsiteItems.filter((i) => i.approval === "PENDING").length;
  const offsiteStatusLabel = (a?: string | null) => (a === "APPROVED" ? "Approved" : a === "REJECTED" ? "Rejected" : "Pending");

  return (
    <section className="rounded-[28px] border border-border bg-card shadow-soft overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Leave & permit requests</h2>
          <p className="text-sm text-muted-foreground">{canReview ? "Review pending requests (izin, day-off, checkout di luar) & submit your own." : "Submit leave, sick, or permit requests."}</p>
        </div>
        <button onClick={() => setComposerOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><ClipboardCheck className="h-3.5 w-3.5" /> New request</button>
      </div>
      <div className="divide-y divide-border">
        {requestsQuery.isLoading && <div className="px-5 py-4 text-sm text-muted-foreground">Loading requests…</div>}
        {!requestsQuery.isLoading && rows.length === 0 && offsiteSorted.length === 0 && <div className="px-5 py-6 text-center text-sm text-muted-foreground">No attendance requests yet.</div>}
        {/* Offsite checkouts (need-approval) merged into the same list, shown first */}
        {offsiteSorted.map((it) => {
          const isPending = it.approval === "PENDING";
          const mapUrl = it.lat != null && it.lng != null ? `https://www.google.com/maps?q=${it.lat},${it.lng}` : null;
          return (
            <div key={`offsite-${it.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusTone(it.approval)}`}>{offsiteStatusLabel(it.approval)}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Checkout di luar {it.user?.name ? <span className="font-normal text-muted-foreground">· {it.user.name}</span> : null}</div>
                <div className="text-xs text-muted-foreground">{fmtDateShort(it.attendanceDate)} · out {fmtTime(it.checkOutAt)}{it.reason ? ` · ${it.reason}` : ""}</div>
                <div className="text-xs text-muted-foreground">
                  {it.distanceMeters != null ? `±${Math.round(it.distanceMeters)}m dari ${it.officeName ?? "kantor"}` : ""}
                  {mapUrl && <> · <a href={mapUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">lihat peta</a></>}
                  {it.photoUrl && <> · <a href={it.photoUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">foto</a></>}
                  {!isPending && it.approverName ? ` · oleh ${it.approverName}` : ""}
                </div>
              </div>
              {canReview && isPending && (
                <div className="flex items-center gap-1.5">
                  <button disabled={offsiteReview.isPending} onClick={() => offsiteReview.mutate({ id: it.id, action: "approve" })} className="rounded-lg bg-success/10 px-2.5 py-1 text-xs font-semibold text-success transition-colors hover:bg-success/20 active:scale-[0.97] disabled:opacity-50">Approve</button>
                  <button disabled={offsiteReview.isPending} onClick={() => offsiteReview.mutate({ id: it.id, action: "reject" })} className="rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.97] disabled:opacity-50">Reject</button>
                </div>
              )}
            </div>
          );
        })}
        {rows.map((r) => {
          const isPending = (r.status || "").toUpperCase() === "PENDING";
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusTone(r.status)}`}>{statusLabel(r.status)}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{statusLabel(r.type)} {r.user?.name ? <span className="font-normal text-muted-foreground">· {r.user.name}</span> : null}</div>
                <div className="text-xs text-muted-foreground">{fmtDateShort(r.startDate)} → {fmtDateShort(r.endDate)}{r.reason ? ` · ${r.reason}` : ""}</div>
              </div>
              {canReview && isPending && (
                <div className="flex items-center gap-1.5">
                  <button disabled={review.isPending} onClick={() => review.mutate({ id: r.id, action: "approve" })} className="rounded-lg bg-success/10 px-2.5 py-1 text-xs font-semibold text-success transition-colors hover:bg-success/20 active:scale-[0.97] disabled:opacity-50">Approve</button>
                  <button disabled={review.isPending} onClick={() => review.mutate({ id: r.id, action: "reject" })} className="rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.97] disabled:opacity-50">Reject</button>
                </div>
              )}
              {!canReview && isPending && (
                <button disabled={review.isPending} onClick={() => review.mutate({ id: r.id, action: "cancel" })} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.97] disabled:opacity-50">Cancel</button>
              )}
            </div>
          );
        })}
      </div>
      {canReview && pendingTotal > 0 && <div className="border-t border-border bg-warning/10 px-5 py-2 text-xs font-semibold text-warning-foreground">{pendingTotal} pending review</div>}
      {composerOpen && <RequestComposer onClose={() => setComposerOpen(false)} onCreated={invalidate} />}
    </section>
  );
}

function RequestComposer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState("DAY_OFF");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);

  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const myRole = wsm.data?.role ?? "STAFF";
  const canGrant = myRole === "BOD" || myRole === "ONE_ABOVE_ALL"; // BoD ke atas
  const TYPES = canGrant ? ["LEAVE", "SICK", "PERMIT", "DAY_OFF", "RED_DATE"] : ["PERMIT", "SICK", "DAY_OFF", "RED_DATE"];
  const isGrantType = type === "LEAVE" || (canGrant && type === "PERMIT");
  const grantingToUser = canGrant && isGrantType;
  // Sakit (self-request) wajib lampirin foto surat sakit; Izin boleh lampirin foto (opsional).
  const attachmentRequired = !canGrant && type === "SICK";
  const showAttachment = type === "SICK" || type === "PERMIT";

  const create = useMutation({
    mutationFn: () => nexusApi.createAttendanceRequest({ type, startDate, endDate, reason: reason.trim(), targetUserId: grantingToUser && targetUserId ? targetUserId : undefined, supportingDocument: attachment }),
    onSuccess: () => { onCreated(); onClose(); },
  });

  const otherMembers = wsm.data?.members ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold tracking-tight">{grantingToUser ? "Kasih izin ke user" : "New attendance request"}</h2>
        {!canGrant && <p className="mt-1 text-xs text-muted-foreground">Staff bisa ajuin <b>Izin (Permit)</b>, <b>Sick</b>, <b>Day Off</b> & <b>Tanggal Merah</b>. Sakit wajib lampirin foto surat sakit. Cuti (Leave) diberikan oleh BoD.</p>}
        <div className="mt-4 space-y-3">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Type
            <select value={type} onChange={(e) => { const v = e.target.value; setType(v); if (v !== "SICK" && v !== "PERMIT") setAttachment(null); }} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary">
              {TYPES.map((t) => <option key={t} value={t}>{statusLabel(t)}</option>)}
            </select>
          </label>
          {grantingToUser && (
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Kasih ke
              <select value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary">
                <option value="">— Diri sendiri —</option>
                {otherMembers.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-bold text-muted-foreground">Start<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-2 py-2 text-sm" /></label>
            <label className="text-[11px] font-bold text-muted-foreground">End<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background px-2 py-2 text-sm" /></label>
          </div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason / context…" className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          {showAttachment && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {type === "SICK" ? `Foto surat sakit${attachmentRequired ? " (wajib)" : " (opsional)"}` : "Foto pendukung (opsional)"}
              </label>
              <label className={cn("mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm transition-colors hover:border-primary", attachment ? "border-primary/50 bg-primary/5" : "border-border")}>
                <Camera className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className={cn("min-w-0 flex-1 truncate", attachment ? "font-semibold" : "text-muted-foreground")}>{attachment ? attachment.name : "Pilih foto / file (maks 10MB)"}</span>
                {attachment && <button type="button" onClick={(e) => { e.preventDefault(); setAttachment(null); }} className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>}
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f && f.size > 10 * 1024 * 1024) { alert("Maks 10MB."); return; } setAttachment(f); e.target.value = ""; }} />
              </label>
              {attachmentRequired && !attachment && <p className="mt-1 text-[11px] font-semibold text-destructive">Wajib lampirkan foto surat sakit.</p>}
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center gap-2">
          <button disabled={!reason.trim() || (attachmentRequired && !attachment) || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {grantingToUser && targetUserId ? "Kasih izin" : "Submit request"}</button>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">Cancel</button>
          {create.isError && <span className="text-xs font-semibold text-destructive">{(create.error as Error)?.message ?? "Gagal kirim request."}</span>}
        </div>
      </div>
    </div>
  );
}

function statusTone(status?: string | null) {
  const s = (status || "").toUpperCase();
  if (s === "APPROVED") return "bg-success/15 text-success";
  if (s === "REJECTED" || s === "CANCELED") return "bg-destructive/15 text-destructive";
  return "bg-warning/15 text-warning-foreground";
}
function fmtDateShort(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function AttendanceActionCard({ checkedIn, checkedOut, checkInAt, checkOutAt, officeName, checkOutApproval, pendingCheckout, disabled }: { checkedIn: boolean; checkedOut: boolean; checkInAt?: string | null; checkOutAt?: string | null; officeName?: string | null; checkOutApproval?: string | null; pendingCheckout?: { attendanceDate?: string | null; checkInAt?: string | null; officeName?: string | null } | null; disabled: boolean }) {
  const qc = useQueryClient();
  const [selfie, setSelfie] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const lastOut = useRef<AttendanceActionPayload | null>(null);
  const [offsitePrompt, setOffsitePrompt] = useState<{ officeName: string; distanceMeters: number } | null>(null);
  const [offsiteReason, setOffsiteReason] = useState("");

  const pick = (f: File | null) => { setMessage(""); setSelfie(f); };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["attendance-today"] });
    qc.invalidateQueries({ queryKey: ["attendance-history"] });
    qc.invalidateQueries({ queryKey: ["my-penalties"] });
  };
  const checkIn = useMutation({ mutationFn: (payload: AttendanceActionPayload) => nexusApi.attendanceCheckIn(payload), onSuccess: () => { refresh(); pick(null); celebrate("Checked in. Let’s cook ☕✨"); } });
  const checkOut = useMutation({
    mutationFn: (payload: AttendanceActionPayload) => nexusApi.attendanceCheckOut(payload),
    onSuccess: (data) => {
      refresh(); pick(null); setOffsitePrompt(null); setOffsiteReason("");
      if (data?.pendingApproval) setOkMessage("Checkout di luar area terkirim — nunggu approval BoD ⏳");
      else { setOkMessage(""); celebrate("Checked out. Good run today 🏁"); }
    },
    onError: (e) => {
      const payload = e instanceof ApiError ? (e.payload as { code?: string; officeName?: string; distanceMeters?: number } | null) : null;
      if (e instanceof ApiError && e.status === 422 && payload?.code === "OUTSIDE_RADIUS") {
        setMessage(""); setOffsiteReason("");
        setOffsitePrompt({ officeName: payload.officeName ?? "kantor", distanceMeters: payload.distanceMeters ?? 0 });
      } else { setMessage(e instanceof ApiError ? ((e.payload as { error?: string } | null)?.error ?? "Gagal check-out.") : "Gagal check-out."); }
    },
  });
  const submitOffsite = () => { if (!lastOut.current || !offsiteReason.trim()) return; checkOut.mutate({ ...lastOut.current, offsite: true, reason: offsiteReason.trim() }); };
  const active = checkIn.isPending || checkOut.isPending;
  const busy = active || locating;
  // A forgotten previous-day check-out blocks today's check-in — force check-out mode for it.
  const forcePending = Boolean(pendingCheckout);
  const mode = forcePending ? "check-out" : !checkedIn ? "check-in" : checkedOut ? "done" : "check-out";
  const pendingDateLabel = pendingCheckout?.attendanceDate ? fmtDate(pendingCheckout.attendanceDate) : "";
  const effOfficeName = forcePending ? pendingCheckout?.officeName : officeName;
  const effCheckInAt = forcePending ? pendingCheckout?.checkInAt : checkInAt;

  function submit() {
    setMessage("");
    if (mode === "done") return;
    if (!selfie) { setMessage("Ambil selfie dulu — klik tile selfie buat buka kamera."); return; }
    setLocating(true);
    getAttendanceFix()
      .then((fix) => {
        setLocating(false);
        const payload = { lat: fix.lat, lng: fix.lng, selfie, notes: notes.trim() || undefined };
        if (mode === "check-in") checkIn.mutate(payload); else { lastOut.current = payload; checkOut.mutate(payload); }
      })
      .catch((err) => {
        setLocating(false);
        setMessage(err instanceof GeoError ? err.message : "Gagal ambil lokasi. Attendance butuh GPS buat geofence.");
      });
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-accent via-card to-secondary p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">Attendance</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">{forcePending ? "Selesaikan absen sebelumnya" : mode === "check-in" ? "Start your day" : mode === "check-out" ? "Wrap the day" : "All done today 🎉"}</h2>
          <p className="mt-1 inline-flex items-center gap-2 text-sm text-muted-foreground">
            {effCheckInAt && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> In {fmtTime(effCheckInAt)}{forcePending && pendingDateLabel ? ` · ${pendingDateLabel}` : ""}</span>}
            {!forcePending && checkOutAt && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Out {fmtTime(checkOutAt)}</span>}
            {!effCheckInAt && <span>Selfie + GPS — geofence-verified.</span>}
          </p>
        </div>
        {effOfficeName && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"><MapPin className="h-3.5 w-3.5" /> {effOfficeName}</span>}
      </div>

      {forcePending && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-100 p-3 text-sm font-semibold text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Kamu lupa check-out tanggal {pendingDateLabel || "sebelumnya"}. Wajib check-out dulu sebelum bisa check-in hari ini.</span>
        </div>
      )}

      {mode === "done" ? (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-success/10 p-4 text-sm font-semibold text-success"><CheckCircle2 className="h-5 w-5" /> Attendance lengkap hari ini. Mantap! 🙌</div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
          {/* selfie (live camera + file fallback) */}
          <SelfieCapture file={selfie} onChange={pick} disabled={busy} />

          {/* steps + action */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1", selfie ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{selfie ? <CheckCircle2 className="h-3 w-3" /> : <Camera className="h-3 w-3" />} Selfie</span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1", locating ? "bg-info/15 text-info" : "bg-muted text-muted-foreground")}>{locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />} GPS{locating ? "…" : ""}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-muted-foreground"><Clock className="h-3 w-3" /> Geofence auto</span>
            </div>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note: traffic, WFH context, etc." className="rounded-xl border border-border bg-card/80 px-3 py-2 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20" />
            <button disabled={disabled || busy} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {locating ? "Locating…" : "Recording…"}</> : <><Camera className="h-4 w-4" /> {forcePending ? "Check out kemarin" : mode === "check-in" ? "Check in now" : "Check out now"}</>}
            </button>
          </div>
        </div>
      )}
      {offsitePrompt && (
        <div className="mt-3 space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-bold text-amber-800">Kamu di luar area kantor</div>
          <p className="text-xs text-amber-700">±{Math.round(offsitePrompt.distanceMeters)}m dari {offsitePrompt.officeName}. Checkout dari sini? <span className="font-semibold">Wajib isi alasan</span> — nunggu approval BoD dulu.</p>
          <textarea value={offsiteReason} onChange={(e) => setOffsiteReason(e.target.value)} rows={2} placeholder="Alasan (mis. shoot konten / meeting client di X)" className="w-full resize-none rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500" />
          <div className="flex gap-2">
            <button onClick={() => { setOffsitePrompt(null); setOffsiteReason(""); }} disabled={busy} className="flex-1 rounded-lg border border-border bg-white py-2 text-xs font-semibold text-muted-foreground transition hover:bg-accent disabled:opacity-50">Batal</button>
            <button onClick={submitOffsite} disabled={!offsiteReason.trim() || busy} className="flex-[1.6] rounded-lg bg-amber-600 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-50">{busy ? "Mengirim…" : "Checkout & minta approval"}</button>
          </div>
        </div>
      )}
      {okMessage && !offsitePrompt && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">{okMessage}</p>}
      {checkOutApproval === "PENDING" && !offsitePrompt && !okMessage && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">⏳ Checkout di luar area — nunggu approval BoD</p>}
      {(message || checkIn.isError) && <p className="mt-3 text-sm font-semibold text-destructive">{message || "Attendance gagal — cek session, selfie, GPS, atau kamu di luar radius office."}</p>}
    </section>
  );
}

function memberSubtitle(user: unknown) {
  if (user && typeof user === "object" && "role" in user && typeof (user as { role?: unknown }).role === "string") {
    return (user as { role: string }).role;
  }
  if (user && typeof user === "object" && "email" in user && typeof (user as { email?: unknown }).email === "string") {
    return (user as { email: string }).email;
  }
  return "Team member";
}

function FunMetric({ icon, label, value, helper, tone, onClick }: { icon: React.ReactNode; label: string; value: string; helper: string; tone: "green" | "purple" | "amber" | "rose"; onClick?: (origin?: MorphOrigin) => void }) {
  const toneCls = {
    green: "bg-success/10 text-success border-success/30",
    purple: "bg-accent text-accent-foreground border-accent-foreground/20",
    amber: "bg-warning/10 text-warning-foreground border-warning/30",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
  }[tone];
  const inner = (
    <>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/70">{icon}</span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
          <h3 className="text-2xl font-black tracking-tight text-foreground">{value}</h3>
        </div>
        {onClick && <ChevronRight className="ml-auto h-4 w-4 shrink-0 opacity-40" />}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{helper}</p>
    </>
  );
  if (onClick) {
    return <FunMetricButton onClick={onClick} className={`block w-full rounded-[28px] border p-5 text-left shadow-soft ${toneCls}`}>{inner}</FunMetricButton>;
  }
  return <article className={`rounded-[28px] border p-5 shadow-soft ${toneCls}`}>{inner}</article>;
}

function FunMetricButton({ onClick, className, children }: { onClick: (origin?: MorphOrigin) => void; className: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.button onClick={(e) => onClick(rectCenter(e.currentTarget))} whileHover={reduce ? undefined : { y: -3 }} whileTap={reduce ? undefined : { scale: 0.98 }} transition={{ type: "spring", stiffness: 400, damping: 20 }} className={className}>
      {children}
    </motion.button>
  );
}

// Self log of day-off / tanggal-merah usage (incl. auto-deductions from telat >120 menit).
// Morphs open from the FunMetric card sharing layoutId `funmetric-${kind}`.
function DayOffLogModal({ kind, origin, onClose }: { kind: "DAY_OFF" | "RED_DATE"; origin?: MorphOrigin; onClose: () => void }) {
  const q = useQuery({ queryKey: ["attendance-requests", "me"], queryFn: () => nexusApi.attendanceRequests("scope=me"), retry: 1 });
  const all = Array.isArray(q.data) ? q.data : q.data?.requests ?? [];
  // Only the CURRENT payroll period (cut-off 28th prev month → 27th this month), same as the board —
  // not the calendar month and not all history. Today decides which period we're in (past the 27th
  // rolls into next month's period).
  const CUTOFF_DAY = 27;
  const now = new Date();
  const endAnchor = new Date(now.getFullYear(), now.getMonth() + (now.getDate() > CUTOFF_DAY ? 1 : 0), 1);
  const pStart = new Date(endAnchor.getFullYear(), endAnchor.getMonth() - 1, CUTOFF_DAY + 1); // prev month, 28th
  const pEnd = new Date(endAnchor.getFullYear(), endAnchor.getMonth(), CUTOFF_DAY); // this month, 27th
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const periodStartKey = ymd(pStart);
  const periodEndKey = ymd(pEnd);
  const periodLabel = `${pStart.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} – ${pEnd.toLocaleDateString("id-ID", { day: "numeric", month: "short" })}`;
  const rows = all
    .filter((r) => (r.type ?? "").toUpperCase() === kind)
    .filter((r) => { const d = (r.startDate ?? "").slice(0, 10); return d >= periodStartKey && d <= periodEndKey; })
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  const title = kind === "DAY_OFF" ? "Log Day-off" : "Log Tanggal Merah";
  const subtitle = kind === "DAY_OFF" ? "Day-off / kepotong (telat >120 menit) di periode ini" : "Tanggal merah yang kepakai di periode ini";

  return (
    <MorphPanel origin={origin} onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">{kind === "DAY_OFF" ? <Sparkles className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1"><div className="font-display text-lg font-bold tracking-tight">{title}</div><div className="text-xs text-muted-foreground">{subtitle}</div></div>
        <button onClick={onClose} aria-label="Tutup" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="mb-3 text-[11px] font-medium text-muted-foreground">Periode berjalan: <span className="font-semibold text-foreground">{periodLabel}</span></p>
        {q.isLoading && <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/40" />)}</div>}
        {!q.isLoading && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Belum ada {kind === "DAY_OFF" ? "day-off" : "tanggal merah"} kepakai di periode ini ({periodLabel}).</p>}
        {!q.isLoading && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => {
              const auto = (r.reason ?? "").startsWith("Auto:");
              const range = r.startDate && r.endDate && r.startDate.slice(0, 10) !== r.endDate.slice(0, 10) ? `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` : fmtDate(r.startDate);
              return (
                <div key={r.id} className="rounded-2xl border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{range}</span>
                    {kind === "DAY_OFF" && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", auto ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>{auto ? "Auto · telat >120m" : "Manual"}</span>}
                  </div>
                  {r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Status: {statusLabel(r.status || "")}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MorphPanel>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <div className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${cls}`} /> {label}</div>;
}

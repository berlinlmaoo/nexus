import type React from "react";
import { EscClose } from "@/hooks/use-escape";
import { SelectPicker } from "@/components/SelectPicker";
import { OfficeMapPicker } from "@/components/attendance/OfficeMapPicker";
import { LocationTrail, LocationTrailDialog } from "@/components/attendance/LocationTrail";
import { AndroidAppCheckInNote, IosAppCheckInCard, browserMayTakeAttendance, isUseIosAppError, WebCheckInNote } from "@/components/attendance/IosAppCheckInCard";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { DateField } from "@/components/DateField";
import { PageHeader } from "@/components/PageHeader";
import { LoadError } from "@/components/LoadError";
import { Segmented } from "@/components/PageLayout";
import { Avatar } from "@/components/Avatar";
import { ApiError, downloadFile, fmtDate, fmtTime, nexusApi, statusLabel, type AttendanceActionPayload, type NexusAttendanceHistory, type NexusOffice, type NexusOffsiteCheckout } from "@/lib/nexus-api";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { getAttendanceFix, GeoError } from "@/lib/geo";
import { attendanceReasonText, deductionLabel } from "@/lib/server-text";
import { AlertTriangle, Calendar, Camera, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Coffee, Download, FileText, Flag, Globe, Hand, HeartPulse, Image as ImageIcon, Info, Loader2, MapPin, MapPinOff, Moon, Pencil, PenLine, Route as RouteIcon, Search, Sparkles, Sun, Trash2, X } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { SelfieCapture, type SelfieCaptureHandle } from "@/components/attendance/SelfieCapture";
import { AttendanceButton, CoveredByRequestCard, placeLine, REFLECTION_MIN, successTitle, useAttendancePress, workedLabel, type DayState } from "@/components/attendance/AttendanceButton";
import { MobileCheckInHero } from "@/components/attendance/MobileCheckInHero";
import { MorphPanel, rectCenter, type MorphOrigin } from "@/components/motion/MorphPanel";
import { cn, glueDash } from "@/lib/utils";
import { PERIOD_BASELINE_XP } from "@/lib/levels";
// The board's colours and the BoD "Change status" panel live in shared files since the member record
// page (/people/:userId) draws the same cells and offers the same panel (28 Sep 2026).
import { recTone, sCls, toneLabel } from "@/lib/attendance-tone";
import { recordPlace } from "@/lib/attendance-place";
import { StatusOverridePanel } from "@/components/attendance/StatusOverridePanel";
import { LeftTag, leftAtOf } from "@/components/LeftTag";
import { localeOf, t as tr, useLang } from "@/lib/lang";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { formatCount } from "@/lib/number-format";
import { useStickyHeaderOffset } from "@/hooks/use-sticky-header-offset";
import { monthTitle } from "@/lib/month-title";

type HistRow = NonNullable<NexusAttendanceHistory["rows"]>[number];

/** The line under "Today's status": what today actually looks like, not where the number came from. */
function todayStatusHelper(d: { today?: { checkInAt?: string | null; checkOutAt?: string | null; lateMinutes?: number | null; workedMinutes?: number | null; checkOutOffsite?: boolean | null; checkOutApproval?: string | null } | null; todayRequest?: { status?: string | null } | null; myShift?: { endTime: string; flexi?: boolean } | null } | undefined, isError: boolean) {
  if (isError) return tr("Couldn’t load today — refresh the page or sign in again.");
  const t = d?.today;
  if (t?.checkOutAt) {
    const w = t.workedMinutes ?? 0;
    const worked = w > 0 ? tr("Worked {h}h {m}m", { h: Math.floor(w / 60), m: w % 60 }) : tr("Out at {time}", { time: fmtTime(t.checkOutAt) });
    const offsite = t.checkOutOffsite ? ` · ${t.checkOutApproval === "PENDING" ? tr("offsite, waiting for approval") : t.checkOutApproval === "REJECTED" ? tr("offsite, rejected") : tr("offsite")}` : "";
    return worked + offsite;
  }
  if (t?.checkInAt) {
    const late = (t.lateMinutes ?? 0) > 0 ? ` · ${tr("{n} min late", { n: t.lateMinutes ?? 0 })}` : ` · ${tr("on time")}`;
    return tr("In since {time}", { time: fmtTime(t.checkInAt) }) + late;
  }
  if (d?.todayRequest?.status === "APPROVED") return tr("Your request covers today — no check-in needed.");
  if (d?.todayRequest?.status === "PENDING") return tr("Your request for today is waiting for approval.");
  return tr("Check in with a selfie inside the office area.");
}

export const Route = createFileRoute("/_app/attendance")({
  component: Attendance,
  // `?request=<id>` / `?offsite=<id>` is what a notification links to: the row is shown even if it
  // is settled, scrolled into view and highlighted, so the tap lands on THE request and not on the
  // page. iOS reads the same two keys (AttendanceRequestsCard).
  // `?view=log` keeps the Board/Log choice across a reload / Back (QA 13 Oct 2026).
  validateSearch: (s: Record<string, unknown>): { request?: string; offsite?: string; view?: "log" } => ({
    request: typeof s.request === "string" ? s.request : undefined,
    offsite: typeof s.offsite === "string" ? s.offsite : undefined,
    view: s.view === "log" ? "log" : undefined,
  }),
});

// The WIB calendar day — "outside since" only means something on today's record.
function jakartaDateKey(d = new Date()) {
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Live-location flags on a record: checked in from the web (never tracked), the phone refused
// location, and/or they are out of the office right now.
function TrackingBadges({ rec, isToday, className }: { rec?: HistRow | null; isToday: boolean; className?: string }) {
  if (!rec) return null;
  const web = rec.locationTrackingState === "web";
  const off = rec.locationTrackingState === "denied";
  const outside = isToday && !!rec.outsideSince && !rec.checkOutAt;
  if (!web && !off && !outside) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {web && <span title={tr("Checked in from a browser — the location isn’t tracked during the day")} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"><Globe className="h-3 w-3" /> {tr("Web check-in · location not tracked")}</span>}
      {off && <span title={tr("Location access is off on this person’s phone — no trail is recorded")} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-500/15 dark:text-slate-400"><MapPinOff className="h-3 w-3" /> {tr("Location off")}</span>}
      {outside && <span title={tr("Outside the office radius right now")} className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{tr("Outside since {time}", { time: fmtTime(rec.outsideSince) })}</span>}
    </span>
  );
}
const REQ_LABEL: Record<string, string> = { LEAVE: "Leave", SICK: "Sick", PERMIT: "Permit", DAY_OFF: "Day off", RED_DATE: "Public holiday" };

// A request's supporting document. A PHOTO is never labelled with its file name: the old apps named
// every photo "sick-note.jpg" whatever the request was, so a permit arrived calling its own evidence a
// sick note. The type says what the photo is; the file name only ever said what the app guessed.
// Anything that isn't an image (a PDF) keeps its name — there, the name is the person's own.
const PHOTO_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;
/** Width of the attendance board's right-edge fade on a phone (w-10); landing keeps today clear of it. */
const BOARD_FADE = 40;
/** The board's header cells follow --board-head-shift (set while the page scrolls, see pageHeaderBottom). */
// The head cells also carry a band of the card's colour upwards (an 8px shadow, and a 24px ::before since run 18):
// when the head is pushed under the page header, a few pixels between the two showed the pill tops of the row
// above (UI tour run 17, R17-WB-1 and run 18, R18-WD-1, attendance-3). At the box's own top the band lies outside
// the scroll box and is clipped.
const HEAD_SHIFT: CSSProperties = { transform: "translateY(var(--board-head-shift, 0px))" };
/** Phone board names break between words only: a one-word name is cut with "…" on one line, not split
 *  mid-word ("Abimanyug / m", UI tour run 16, R16-WM-2); a name with spaces takes two lines. */
const phoneNameClamp = (name: string | null | undefined) => (name && /\s/.test(name.trim()) ? "line-clamp-2" : "block min-w-0 truncate");
function isPhotoDocument(url?: string | null, name?: string | null) {
  const path = (url ?? "").split(/[?#]/)[0];
  // The stored file keeps the uploaded extension (see POST /api/attendance/requests); the original
  // name is only consulted when the URL carries none.
  if (/\.[a-z0-9]{2,5}$/i.test(path)) return PHOTO_EXT.test(path);
  return PHOTO_EXT.test(name ?? "");
}
function photoLabel(type?: string | null) {
  const t = (type || "").toUpperCase();
  return t === "PERMIT" ? tr("Permit photo") : t === "SICK" ? tr("Sick note") : tr("Photo");
}
function SupportingDocument({ url, name, type, large = false }: { url: string; name?: string | null; type?: string | null; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const box = large ? "h-14 w-14" : "h-10 w-10";
  if (isPhotoDocument(url, name)) {
    const label = photoLabel(type);
    return (
      <a href={url} target="_blank" rel="noreferrer" title={tr("Open {label}", { label: label.toLowerCase() })}
        className="inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-background p-1 pr-3 text-xs font-semibold transition hover:bg-accent">
        {broken
          ? <span className={cn("grid shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground", box)}><ImageIcon className="h-4 w-4" /></span>
          : <img src={url} alt={label} loading="lazy" onError={() => setBroken(true)} className={cn("shrink-0 rounded-lg bg-muted object-cover", box)} />}
        <span className="truncate">{label}</span>
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-accent">
      <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{name || tr("View document")}</span>
    </a>
  );
}

// Detail popup for an approved leave/sick/permit/day-off/red-date cell on the streak board.
function LeaveDetailDrawer({ record, onClose, canOverride }: { record: HistRow; onClose: () => void; canOverride?: boolean }) {
  const typeLabel = tr(REQ_LABEL[(record.requestType || "").toUpperCase()] || "Leave/Permit");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-scrim p-4" onClick={onClose}>
      <EscClose onClose={onClose} />
      <div role="dialog" aria-modal="true" aria-label={typeLabel} className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-warning/20 text-warning-foreground dark:text-warning"><Coffee className="h-4 w-4" /></span>
            <div>
              <div className="font-display text-base font-bold tracking-tight">{typeLabel}</div>
              <div className="text-xs text-muted-foreground">{record.user?.name || tr("Unnamed")}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label={tr("Close")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("Date")}</dt><dd className="font-semibold">{fmtDate(record.attendanceDate)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("Status")}</dt><dd className="font-semibold text-emerald-600 dark:text-emerald-400">{tr("Approved")} ✓</dd></div>
          {record.reviewedBy?.name && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("Approved by")}</dt><dd className="font-semibold">{record.reviewedBy.name}</dd></div>}
          {record.reviewedAt && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("Approved on")}</dt><dd className="font-semibold">{fmtDate(record.reviewedAt)}</dd></div>}
        </dl>
        {record.notes && (
          <div className="mt-3 rounded-xl bg-muted/40 p-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{tr("Reason")}</div>
            <p className="whitespace-pre-wrap text-sm">{record.notes}</p>
          </div>
        )}
        {record.supportingDocumentUrl && (
          <div className="mt-3"><SupportingDocument url={record.supportingDocumentUrl} name={record.supportingDocumentName} type={record.requestType} large /></div>
        )}
        {canOverride && record.user?.id && (
          <StatusOverridePanel userId={record.user.id} name={record.user?.name ?? null} dateKey={(record.attendanceDate || "").slice(0, 10)} onDone={onClose} />
        )}
      </div>
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
      celebrate(vars.part === "checkout" ? tr("Check-out for {date} deleted — attendance reopened", { date: dateKey }) : tr("Attendance for {date} deleted", { date: dateKey }));
      onDone();
    },
    onError: (e) => alert(e instanceof Error ? e.message : tr("Couldn’t delete.")),
  });
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-rose-300/70 bg-rose-50/60 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400"><Trash2 className="h-3.5 w-3.5" /> {tr("Delete attendance data")}</div>
      <div className="flex flex-wrap gap-1.5">
        {hasCheckOut && (
          <button disabled={del.isPending} onClick={() => { if (window.confirm(tr("Delete the check-out for {date} ({name})?", { date: dateKey, name: name ?? tr("this person") }) + "\n\n" + tr("The check-in stays, and the record goes back to “still checked in”."))) del.mutate({ part: "checkout" }); }} className="rounded-full border border-rose-300 bg-card px-3 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-500/15">
            {tr("Delete check-out")}
          </button>
        )}
        <button disabled={del.isPending} onClick={() => { if (window.confirm(tr("Delete the whole attendance for {date} ({name})?", { date: dateKey, name: name ?? tr("this person") }) + "\n\n" + tr("That day’s check-in and check-out are removed. That day’s XP and day-off deductions are restored, and the day is protected from attendance penalties. It’s recorded in the audit log."))) del.mutate({}); }} className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50">
          {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {tr("Delete this attendance")}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">{tr("For cleaning up an accidental check-in. “Delete this attendance” removes the record and protects the day from deductions.")}</p>
    </div>
  );
}

function Attendance() {
  const { locale } = useLang();
  const coarse = useCoarsePointer();
  const today = useQuery({ queryKey: ["attendance-today"], queryFn: nexusApi.attendanceToday, retry: 1 });
  const reduceMotion = useReducedMotion();
  const [logKind, setLogKind] = useState<{ kind: "DAY_OFF" | "RED_DATE"; origin?: MorphOrigin } | null>(null);
  const [correctOrigin, setCorrectOrigin] = useState<MorphOrigin | undefined>(undefined);
  // Audit board state: which month to inspect + per-staff search.
  // Default to the CURRENT payroll period (cut-off 28th → 27th): past the 27th, roll to next month.
  const [monthKey, setMonthKey] = useState(() => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() + (d.getDate() > 27 ? 1 : 0), 1); return `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}`; });
  const [memberQuery, setMemberQuery] = useState("");
  const attSearch = Route.useSearch();
  const attNavigate = Route.useNavigate();
  const viewMode: "grid" | "log" = attSearch.view === "log" ? "log" : "grid";
  const setViewMode = (v: "grid" | "log") => { void attNavigate({ search: (prev) => ({ ...prev, view: v === "log" ? "log" : undefined }), replace: true }); };
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
  // Remaining day-off per person, one call for the whole crew instead of one per row.
  const dayOffSummary = useQuery({
    queryKey: ["attendance-dayoff-summary", monthKey],
    queryFn: () => nexusApi.attendanceDayOffSummary(monthKey),
    enabled: canManage, retry: 1, staleTime: 30_000,
  });
  const dayOffOf = (userId: string) => dayOffSummary.data?.members.find((m) => m.userId === userId) ?? null;
  // Whose deduction log is open (opened by tapping a name/avatar in the table).
  const [deductionsFor, setDeductionsFor] = useState<{ id: string; name: string | null } | null>(null);
  const qc = useQueryClient();
  const deduct = useMutation({
    mutationFn: () => nexusApi.deductAbsences(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("attendance-history") });
      celebrate(tr("No-show check done — {n} day off deducted ({from} … {to})", { n: r.created, from: r.from, to: r.to }));
    },
  });
  const outageRefund = useMutation({
    mutationFn: (payload: { date: string }) => nexusApi.attendanceOutageRefund({ ...payload, dryRun: false }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("attendance-history") });
      const failNote = r.failed > 0 ? " " + tr("{n} failed — run it again to retry (safe).", { n: r.failed }) : "";
      celebrate(tr("System-down day {date} refunded — XP returned to {n} people (+{xp} XP), {days} day off restored.", { date: r.date, n: r.refundedMembers, xp: r.totalXpRefunded, days: r.totalDayOffsRestored }) + failNote);
    },
    onError: (e) => { alert(e instanceof Error ? e.message : tr("Couldn’t refund the system-down day.")); },
  });
  const [outageBusy, setOutageBusy] = useState(false);
  const runOutageRefund = async () => {
    const now = new Date();
    const def = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const date = window.prompt(tr("Refund penalties for a system-down day (power outage or NEXUS down).") + "\n\n" + tr("Everyone who lost XP or day off on this date gets it back. Anyone who already requested a day off that day is skipped. Present/absent status doesn’t change.") + "\n\n" + tr("Date (YYYY-MM-DD):"), def);
    if (!date || !date.trim()) return;
    setOutageBusy(true);
    try {
      const p = await nexusApi.attendanceOutageRefund({ date: date.trim(), dryRun: true });
      const list = p.entries.filter((e) => !e.excludedReason).slice(0, 40)
        .map((e) => `• ${e.name ?? e.userId}: +${e.xpRefund} XP${e.autoDayOffs ? `, ${tr("{n} day off back", { n: e.autoDayOffs })}` : ""}`).join("\n");
      const msg = tr("Check {date} (nothing has changed yet):", { date: p.date }) + "\n\n"
        + tr("{n} people will be refunded — total +{xp} XP, {days} day off back.", { n: p.refundedMembers, xp: p.totalXpRefunded, days: p.totalDayOffsRestored }) + "\n"
        + tr("{n} people skipped (already requested a day off that day).", { n: p.excludedMembers }) + "\n\n"
        + (list || tr("(no penalties were deducted on this date)")) + "\n\n";
      if (p.refundedMembers === 0) { alert(msg + tr("Nothing to refund.")); return; }
      if (!window.confirm(msg + tr("Go ahead with the refund?"))) return;
      outageRefund.mutate({ date: date.trim() });
    } catch (e) {
      alert(e instanceof Error ? e.message : tr("Couldn’t load the check."));
    } finally {
      setOutageBusy(false);
    }
  };
  const [correctRecord, setCorrectRecord] = useState<HistRow | null>(null);
  // The viewer's own trail for today, opened from the office card.
  const [trailFor, setTrailFor] = useState<{ id: string; title: string; subtitle?: string } | null>(null);
  // Today's place: the office, or the check-in address when it was made away from the office.
  const todayPlace = recordPlace(today.data?.today);
  const todayKey = today.data?.attendanceDateKey?.slice(0, 10) || jakartaDateKey();
  const [leaveDetail, setLeaveDetail] = useState<HistRow | null>(null);
  // BoD: override a member-day that has NO record/request yet (empty board cell → set status).
  const [overrideTarget, setOverrideTarget] = useState<{ userId: string; name: string | null; dateKey: string } | null>(null);
  const rows = Array.isArray(history.data?.rows) ? history.data.rows : [];
  // Full de-duped member list (search runs over ALL members, not a pre-sliced subset).
  // Rows plus the server's roster: everyone on the board even before they have a single day in the
  // period (the first day of a period used to list only whoever had already checked in).
  const roster = (history.data?.roster ?? []) as Array<NonNullable<(typeof rows)[number]["user"]>>;
  const allMembers = [...rows.map((row) => row.user), ...roster]
    .filter((user, index, arr): user is NonNullable<typeof user> => Boolean(user?.id) && arr.findIndex((other) => other?.id === user?.id) === index)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
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
  // Land on today, not on the 28th (owner, 8 Oct 2026: "harusnya lock ke tanggal hari itu"): once per
  // period, after the rows are drawn — today's column fourth, the three days before it still in view.
  // Never again while the person scrolls; a period without today stays at its start.
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const landedPeriod = useRef<string | null>(null);
  // Phone: a fade on the right edge while more days lie that way, so the column cut there reads as "more".
  const [boardMore, setBoardMore] = useState(false);
  // …and at the bottom edge while more rows lie below, so a row cut there fades instead of showing a fragment
  // of its name (UI tour run 15, R15-WM-8: a lone "J" under the rounded border).
  const [boardMoreDown, setBoardMoreDown] = useState(false);
  const setBoardEdge = () => {
    const el = boardScrollRef.current;
    if (!el) return;
    setBoardMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    setBoardMoreDown(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  };
  // Until the person moves the board themselves, the landing is redone whenever the table changes size: the
  // first landing could run before the member rows (and their wider day cells) were drawn, so the offsets
  // were those of the narrow header-only table and the board stood half a column off, with the last day cut
  // at the right edge (UI tour run 16, R16-WM-R5: "FRI 9 … WED 14" with WED 14 halved).
  const boardTouched = useRef(false);
  useEffect(() => {
    if (viewMode !== "grid" || history.isLoading) return;
    const box = boardScrollRef.current;
    const table = box?.querySelector("table");
    if (!box || !table) return;
    if (landedPeriod.current !== monthKey) boardTouched.current = false;
    const land = () => {
      if (boardTouched.current) return;
      const cell = box.querySelector<HTMLElement>(`th[data-day="${todayKey}"]`);
      if (!cell) return;
      const pinned = box.querySelector<HTMLElement>("th[data-member-col]")?.offsetWidth ?? 0;
      // Land on a column edge (QA S-25: day columns differ in width, so "3 × today's width" left the first
      // visible day half under the pinned member column — "D )"): the first column in view starts exactly at
      // the pinned column's edge. As many days before today as fit, with today whole and clear of the right
      // fade (UI tour run 12, WM4: landing on "today - 3" cut today at the right edge). No scroll when today fits.
      const days = [...box.querySelectorAll<HTMLElement>("th[data-day]")];
      const todayRight = cell.offsetLeft + cell.offsetWidth;
      const fits = todayRight <= box.clientWidth - BOARD_FADE;
      let target = cell.offsetLeft - pinned;
      for (const d of days) {
        if (d === cell) break;
        if (todayRight <= d.offsetLeft - pinned + box.clientWidth - BOARD_FADE) { target = d.offsetLeft - pinned; break; }
      }
      box.scrollLeft = fits ? 0 : Math.max(0, target);
      setBoardEdge();
      landedPeriod.current = monthKey;
    };
    land();
    const touched = () => { boardTouched.current = true; };
    box.addEventListener("pointerdown", touched);
    box.addEventListener("wheel", touched, { passive: true });
    box.addEventListener("keydown", touched);
    if (typeof ResizeObserver === "undefined") return () => {
      box.removeEventListener("pointerdown", touched);
      box.removeEventListener("wheel", touched);
      box.removeEventListener("keydown", touched);
    };
    const ro = new ResizeObserver(() => land());
    ro.observe(table);
    ro.observe(box);
    return () => {
      ro.disconnect();
      box.removeEventListener("pointerdown", touched);
      box.removeEventListener("wheel", touched);
      box.removeEventListener("keydown", touched);
    };
  }, [viewMode, history.isLoading, monthKey, todayKey, periodDays.length]);
  // The day header stays in view while the PAGE scrolls too (UI tour run 14, R14-WM-16: scrolling the page past
  // the board's top took MON 12…FRI 16 away and the dots lost their dates). The header row is sticky inside the
  // board's own scroll box; once the box's top has gone under the page's sticky header, the row is pushed down
  // by the same distance (never past the box's last row), so it sits right under the page header.
  const pageHeaderBottom = useStickyHeaderOffset();
  useEffect(() => {
    if (viewMode !== "grid") return;
    const box = boardScrollRef.current;
    if (!box) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const head = box.querySelector<HTMLElement>("thead");
      const headH = head?.offsetHeight ?? 0;
      const room = Math.max(0, box.clientHeight - headH - 56);
      // From md up the header draws a 1rem fade band under itself once the page has scrolled; the pinned head
      // sits below that band, or the band covered the weekday letters' top half (UI tour run 17, R17-WD-2).
      const band = window.matchMedia("(min-width: 768px)").matches ? 16 : 0;
      // Measured from a head cell where it sits without the shift, not from the box's top: the cells rest a little
      // below the box's top, and that offset left a 2px gap between the band and the pinned head where the pills
      // of the row above showed (UI tour run 18, R18-WD-1, and the phone's R18-WB-1 attendance-3).
      const cell = head?.querySelector<HTMLElement>("th");
      const applied = parseFloat(box.style.getPropertyValue("--board-head-shift")) || 0;
      const headTop = cell ? cell.getBoundingClientRect().top - applied : box.getBoundingClientRect().top;
      const shift = Math.min(room, Math.max(0, pageHeaderBottom + band - headTop));
      // Rounded down: the head tucks a sub-pixel under the band rather than leaving a seam above it.
      box.style.setProperty("--board-head-shift", `${Math.floor(shift)}px`);
      // Rows snap whole under the (possibly shifted) day header, not half under it (UI tour run 15, R15-WB-1).
      box.style.setProperty("--board-snap-top", `${Math.round(shift + headH)}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [viewMode, pageHeaderBottom, history.isLoading, history.data]);
  // Cut-off aware: past the 27th we're already in NEXT month's payroll period, so the board's
  // "current period" (and the Next-button guard) must roll over on the 28th, not on the 1st.
  const nowKey = (() => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() + (d.getDate() > CUTOFF_DAY ? 1 : 0), 1); return `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}`; })();
  const isCurrentMonth = monthKey === nowKey;
  const monthLabel = monthTitle(new Date(year, month, 1), locale);
  const periodLabel = `${periodStart.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${periodEnd.toLocaleDateString(locale, { day: "numeric", month: "short" })}`;
  const shiftMonth = (delta: number) => { const d = new Date(year, month + delta, 1); setMonthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  // Key by full date (YYYY-MM-DD) since the period spans two calendar months — day-of-month alone collides.
  const recMap = new Map<string, HistRow>();
  for (const r of rows) {
    if (!r.user?.id || !r.attendanceDate) continue;
    recMap.set(`${r.user.id}:${r.attendanceDate.slice(0, 10)}`, r);
  }
  // Days worked: a check-in, an approved permit (working elsewhere with the approver's blessing — green
  // on the board too) or WFH. Out of the period's WORKING days: its calendar days minus the person's
  // weekly-rest quota (default 4), so a 31-day period has 27 and a 30-day period 26 (owner, 28 Sep 2026).
  const presentCount = (uid: string) => rows.filter((r) => { if (r.user?.id !== uid) return false; const t = recTone(r); return t === "present" || t === "permit" || t === "wfh"; }).length;
  // What the Score is out of comes from the server (`owed`, lib/attendance-score.ts on the server — the same
  // rule as the person record): someone who joined mid-period owes only the days from their start, with a
  // prorated allowance (QA S-20). Older servers: the whole period minus the quota.
  const owedOf = (uid: string) => (allMembers.find((m) => m?.id === uid) as { owed?: { days: number; allowance: number; from: string } } | undefined)?.owed;
  const daysOf = (uid: string) => owedOf(uid)?.days ?? periodDays.length;
  const workDaysOf = (uid: string) => { const o = owedOf(uid); if (o) return Math.max(0, o.days - o.allowance); const q = dayOffOf(uid)?.quota ?? (rows.find((r) => r.user?.id === uid)?.user as { dayOffQuota?: number } | undefined)?.dayOffQuota ?? 4; return Math.max(0, periodDays.length - q); };

  return (
    <div>
      <PageHeader
        title={tr("Attendance")}
        subtitle={canSeeBoard ? tr("Who's in, on leave or working from home, and everyone's attendance history.") : tr("Check in, ask for leave or a permission, and see your attendance history.")}
        // The outage-refund and no-show-sweep buttons were removed (owner, 28 Sep 2026): outage days are
        // not compensated, and the sweep is what the nightly cron already runs. Both APIs stay for the cron.
      />

      <div className="p-4 md:p-8 space-y-5">
        {/* Mobile: new map-centric check-in hero. Desktop: keep the dashboard card. */}
        {/* The check-in card, each summary card and the board card are snap points, so a scrolled page starts on a
            whole card, not on the last line of the status card (UI tour run 18, R18-WB-1, attendance-2). */}
        <div data-snap-row className="md:hidden">
          <MobileCheckInHero today={today.data ?? null} failed={today.isError} disabled={today.isError || today.isLoading || (Boolean(today.data?.todayRequest) && !today.data?.pendingCheckout)} />
        </div>
        <div className="hidden md:block">
          <AttendanceActionCard
            checkedIn={Boolean(today.data?.today?.checkInAt)}
            checkedOut={Boolean(today.data?.today?.checkOutAt)}
            checkInAt={today.data?.today?.checkInAt}
            checkOutAt={today.data?.today?.checkOutAt}
            officeName={today.data?.today?.checkInAt ? recordPlace(today.data.today).label || null : today.data?.today?.officeLocation?.name}
            checkOutApproval={today.data?.today?.checkOutApproval ?? null}
            pendingCheckout={today.data?.pendingCheckout ? { attendanceDate: today.data.pendingCheckout.attendanceDate, checkInAt: today.data.pendingCheckout.checkInAt, officeName: recordPlace(today.data.pendingCheckout).label || null } : null}
            disabled={today.isError || today.isLoading || (Boolean(today.data?.todayRequest) && !today.data?.pendingCheckout)}
            loading={today.isLoading}
            workedMinutes={today.data?.today?.workedMinutes ?? null}
            noGeofence={Boolean(today.data?.noGeofence)}
            coveredBy={today.data?.todayRequest && !today.data?.pendingCheckout && !today.data?.today?.checkInAt ? statusLabel(today.data.todayRequest.type) : null}
          />
        </div>


        {/* Columns follow the space the cards actually get (a container query), not the window: at 1024 with
            the sidebar open four columns left ~160px each and every title was cut ("Rea…", "4 a…"), QA 13 Oct 2026. */}
        <div className="@container">
        <section data-snap-rows className="grid gap-4 @lg:grid-cols-2 @5xl:grid-cols-4">
          <FunMetric
            icon={<Coffee className="h-5 w-5" />}
            label={tr("Today’s status")}
            value={today.data?.today?.status ? statusLabel(today.data.today.status) : today.data?.todayRequest?.status ? `${statusLabel(today.data.todayRequest.type)} ${statusLabel(today.data.todayRequest.status)}` : tr("Ready to check in")}
            helper={todayStatusHelper(today.data, today.isError)}
            tone="green"
          />
          <FunMetric
            icon={<MapPin className="h-5 w-5" />}
            // Before check-in the helper says what the card lists, not a second state name: the state is "Ready to
            // check in" on the status card beside it (decision 7, UI tour run 17; it read "Not checked in yet").
            // Per record (owner, 28 Sep 2026): a check-in made away from the office shows the address it
            // was made at, not the office the record is filed under; inside the radius it stays the office.
            label={todayPlace.away ? tr("Where you checked in") : today.data?.noGeofence && !today.data?.today?.checkInAt ? tr("Any location") : tr("Offices")}
            value={today.data?.today?.checkInAt
              ? (todayPlace.label || tr("{n} active offices", { n: today.data?.activeOfficeCount ?? 0 }))
              : today.data?.noGeofence ? tr("Check in from anywhere") : (today.data?.today?.officeLocation?.name || tr("{n} active offices", { n: today.data?.activeOfficeCount ?? 0 }))}
            helper={`${todayPlace.away ? `${tr("Away from the office")} · ` : ""}${today.data?.today?.checkInAt ? `${tr("In {time}", { time: fmtTime(today.data.today.checkInAt) })} · ${tr("Out {time}", { time: fmtTime(today.data.today.checkOutAt) })}` : tr("Where you can check in")}${today.data?.today?.id && today.data.today.checkInAt ? ` · ${tr("see your location trail")}` : ""}`}
            tone="purple"
            onClick={today.data?.today?.id && today.data.today.checkInAt ? () => setTrailFor({ id: today.data!.today!.id, title: tr("Your location trail"), subtitle: `${tr("Today")}${todayPlace.label ? ` · ${todayPlace.label}${todayPlace.away ? ` (${tr("away from the office")})` : ""}` : ""}` }) : undefined}
          />
          <FunMetric
            icon={<Sparkles className="h-5 w-5" />}
            label={tr("Days off")}
            value={tr("{used}/{quota} used", { used: today.data?.dayOffUsedThisMonth ?? 0, quota: today.data?.dayOffQuota ?? 4 })}
            helper={(today.data?.dayOffAllowance?.bonus ?? 0) > 0
              ? tr("Includes {n} extra ({reasons}) — expires on the 27th", { n: today.data!.dayOffAllowance!.bonus, reasons: today.data!.dayOffAllowance!.grants.map((g) => g.reason).join(", ") })
              : tr("See how your days off were used")}
            tone="amber"
            onClick={(origin) => setLogKind({ kind: "DAY_OFF", origin })}
          />
          <FunMetric
            icon={<Calendar className="h-5 w-5" />}
            label={tr("Public holidays")}
            // Zero over zero says nothing (run 19 decision 10, R19-B-13): say there are none this month.
            value={(today.data?.redDateQuota ?? 0) === 0 && (today.data?.redDateUsedThisMonth ?? 0) === 0
              // "None this month" under the "Public holidays" label: the full sentence was cut at two lines.
              ? tr("None this month")
              : tr("{used}/{quota} used", { used: today.data?.redDateUsedThisMonth ?? 0, quota: today.data?.redDateQuota ?? 0 })}
            helper={tr("See public holidays used")}
            tone="rose"
            onClick={(origin) => setLogKind({ kind: "RED_DATE", origin })}
          />
        </section>
        </div>

        <div data-snap-row className="rounded-[28px] border border-border bg-card shadow-soft overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{viewMode === "grid" ? (canSeeBoard ? tr("Attendance board") : tr("Your attendance history")) : (canSeeBoard ? tr("Attendance log") : tr("Your attendance history"))}</h2>
              <p className="text-sm text-muted-foreground">{viewMode === "grid" ? tr("Green = present or permit, red = absent, orange = sick, purple = day off / public holiday, yellow = leave.") : (canSeeBoard ? tr("Everyone’s attendance history, with check-in/out selfie and location.") : tr("Your check-in/out history, with selfie and location."))}
                {" "}{viewMode === "grid" ? (coarse ? tr("Tap a cell for details.") : tr("Click a cell for details.")) : (coarse ? tr("Tap a row for details.") : tr("Click a row for details."))}</p>
            </div>
            <div className="flex items-center gap-3">
              {viewMode === "grid" && (
                <div className="hidden flex-wrap justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex">
                  <Legend cls="bg-emerald-400/70" label={tr("Present / Permit")} />
                  <Legend cls="bg-amber-300/80" label={tr("Leave")} />
                  <Legend cls="bg-orange-400/80" label={tr("Sick")} />
                  <Legend cls="bg-violet-400/70" label={tr("Days off")} />
                  <Legend cls="bg-rose-500/75" label={tr("Absent")} />
                  {/* The small marks over a day's dot (UI tour run 13, W-D24: they had no key). */}
                  <span className="inline-flex items-center gap-1.5"><span className="grid h-3 w-3 place-items-center rounded-full bg-card text-sky-600 ring-1 ring-border dark:text-sky-400"><Globe className="h-2 w-2" /></span>{tr("Web check-in")}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="grid h-3 w-3 place-items-center rounded-full bg-card text-slate-500 ring-1 ring-border dark:text-slate-400"><MapPinOff className="h-2 w-2" /></span>{tr("Location off")}</span>
                </div>
              )}
              <Segmented label={tr("Attendance view")} size="xs" value={viewMode} onChange={setViewMode} options={[{ key: "grid", label: tr("Board") }, { key: "log", label: tr("Log") }]} />
            </div>
          </div>
          {/* Audit controls: month navigation + per-staff search. A snap point of its own, and so is the board below
              it: a scrolled page starts on the whole controls row or right at the board's head, never with the
              Search / Export row cut in half under the header (UI tour run 19, R19-WB-1 wm attendance-3). */}
          <div data-snap-row className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="flex items-center gap-1.5">
              <button onClick={() => shiftMonth(-1)} aria-label={tr("Previous month")} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
              <span className="flex min-w-[8.5rem] flex-col items-center leading-tight">
                <span className="text-sm font-semibold capitalize tabular-nums">{monthLabel}</span>
                <span className="text-[10px] text-muted-foreground" title={tr("Cut-off period (28th → 27th)")}>{periodLabel}</span>
              </span>
              <button onClick={() => shiftMonth(1)} disabled={isCurrentMonth} aria-label={tr("Next month")} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              {!isCurrentMonth && <button onClick={() => setMonthKey(nowKey)} className="ml-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">{tr("This month")}</button>}
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              {/* Per-staff audit search — for anyone who sees the crew board (BoD: all; team-lead: their team). */}
              {canSeeBoard && (
                <div className="relative flex-1 sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    aria-label={tr("Search people")}
                    placeholder={tr("Search…")}
                    className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-8 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  {memberQuery && <button onClick={() => setMemberQuery("")} aria-label={tr("Clear search")} className="tap-area absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-3 w-3" /></button>}
                </div>
              )}
              {canSeeBoard && <ExportMenu monthKey={monthKey} monthLabel={monthLabel} />}
              <Link to="/people/$userId" params={{ userId: "me" }} search={{ period: monthKey }} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">{tr("My record")}</Link>
            </div>
          </div>
          {viewMode === "log" ? (
            <div className="divide-y divide-border">
              {history.isLoading && <div className="px-5 py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>}
              {/* A failed request is not "no attendance" (QA 13 Oct 2026: a 500 read as an empty month). */}
              {history.isError && !history.data && <LoadError compact error={history.error} what={tr("this month's attendance")} onRetry={() => void history.refetch()} />}
              {!history.isLoading && !(history.isError && !history.data) && logRows.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">{q ? tr("No attendance from “{q}” this month.", { q: memberQuery.trim() }) : tr("No attendance recorded this month yet.")}</div>
              )}
              {logRows.map((r) => {
                const tone = recTone(r);
                return (
                  <button key={r.id} onClick={() => setCorrectRecord(r)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/20">
                    <MemberAvatar user={r.user!} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", sCls[tone])} />
                        <span className="truncate font-medium">{r.user?.name || tr("Unnamed")}</span>
                        <LeftTag leftAt={leftAtOf(r.user)} />
                        <span className="text-xs text-muted-foreground">{fmtDate(r.attendanceDate)}</span>
                        {r.checkInAway === true && <span title={tr("Checked in away from the office")} className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">{tr("Away")}</span>}
                        {r.checkOutOffsite && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{tr("Offsite")}</span>}
                        <TrackingBadges rec={r} isToday={(r.attendanceDate || "").slice(0, 10) === todayKey} />
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {tr("In {time}", { time: fmtTime(r.checkInAt) })}{r.checkInAddress ? ` · ${r.checkInAddress}` : r.checkInDistanceMeters != null ? ` · ±${Math.round(r.checkInDistanceMeters)}m` : ""}
                        {(r.checkOutAt || r.checkOutAddress) ? ` — ${tr("Out {time}", { time: fmtTime(r.checkOutAt) })}${r.checkOutAddress ? ` · ${r.checkOutAddress}` : ""}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {r.checkInPhotoUrl ? <img src={r.checkInPhotoUrl} alt={tr("Check-in selfie")} loading="lazy" className="h-10 w-10 rounded-lg object-cover ring-1 ring-border" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground/40"><Camera className="h-4 w-4" /></div>}
                      {r.checkOutPhotoUrl && <img src={r.checkOutPhotoUrl} alt={tr("Check-out selfie")} loading="lazy" className="h-10 w-10 rounded-lg object-cover ring-1 ring-border" />}
                    </div>
                  </button>
                );
              })}
              {!history.isLoading && logRows.length >= 300 && (
                <div className="px-5 py-3 text-center text-xs text-muted-foreground">{tr("Showing the 300 most recent records. Change the month or search a name to see the rest.")}</div>
              )}
            </div>
          ) : (
          // Its own scroll box, as tall as the screen allows: the date row can only stay pinned inside
          // the element that scrolls, and a page-level sticky cannot cross `overflow-x`. So the days
          // and weekdays stay above the dots while you scroll down the crew (owner, 28 Sep 2026).
          // Phone: a swipe sideways stops on whole columns, a day starting right at the pinned member column
          // (scroll-snap with the column's width as padding), and the right edge fades while more days lie
          // that way (UI tour run 12, WM4: "Wed 14" was cut there with nothing saying so).
          // `isolate`: the board's own layers (pinned head z-30, edge fades z-30, the arrow z-40) stack inside this
          // box only. Without it the bottom fade painted over the phone's pinned page title when a section below
          // the board snapped right under the header (UI tour run 17, R17-WM-1).
          <div data-snap-row className="relative isolate">
          <div ref={boardScrollRef} onScroll={setBoardEdge} className="isolate max-h-[calc(100dvh-11rem)] overflow-auto overscroll-contain [scroll-padding-top:var(--board-snap-top,0px)] [scroll-snap-type:y_proximity] max-sm:[scroll-padding-left:7.5rem] max-sm:[scroll-snap-type:both_proximity]">
            {/* `min-w-max`: with a plain `w-full` the 31 day columns and the member column were
                squeezed into the phone's width, so the name, the pills and the dots all landed on
                top of each other. Now the table keeps its natural width and this container scrolls,
                with the member column pinned to the left so you always know whose row you are on. */}
            <table className="w-full min-w-max text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th data-member-col style={HEAD_SHIFT} className="sticky left-0 top-0 z-30 w-[7.5rem] min-w-[7.5rem] max-w-[7.5rem] bg-muted px-2 py-2 text-left text-xs font-medium uppercase text-muted-foreground shadow-[1px_0_0_0_var(--border),0_-8px_0_0_var(--card)] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-card before:content-[''] sm:w-[20rem] sm:min-w-[20rem] sm:max-w-[20rem] sm:px-4">{tr("Member")}</th>
                  {periodDays.map((pd) => (
                    <th key={pd.key} data-day={pd.key} aria-current={pd.key === todayKey ? "date" : undefined} style={HEAD_SHIFT} className={cn("sticky top-0 z-20 snap-start bg-muted px-1 py-1.5 font-medium text-[10px] shadow-[0_-8px_0_0_var(--card)] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-card before:content-[''] lg:px-0 lg:text-xs leading-tight text-muted-foreground", pd.day === 1 && "border-l border-border/70", pd.key === todayKey && "text-primary")}>
                      {/* From lg, where the whole period fits, the weekday is one letter over the date at a readable
                          size; "MON" had to shrink to a few pixels to fit 30 columns (UI tour run 16, R16-WD-3). */}
                      <span className={cn("block text-[9px] uppercase lg:hidden", pd.key === todayKey ? "font-bold" : "font-normal opacity-70")}>{new Date(`${pd.key}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" })}</span>
                      <span className={cn("hidden text-[11px] uppercase lg:block", pd.key === todayKey ? "font-bold" : "font-normal opacity-70")}>{new Date(`${pd.key}T00:00:00Z`).toLocaleDateString(locale, { weekday: "narrow", timeZone: "UTC" })}</span>
                      {pd.key === todayKey
                        ? <span className="inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-bold text-primary-foreground">{pd.day}</span>
                        : pd.day}
                    </th>
                  ))}
                  <th style={HEAD_SHIFT} className="sticky top-0 z-20 bg-muted text-right px-4 py-2 font-medium text-xs text-muted-foreground uppercase shadow-[0_-8px_0_0_var(--card)] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-card before:content-['']">{tr("Score")}</th>
                </tr>
              </thead>
              <tbody>
                {history.isLoading && (
                  <tr><td colSpan={periodDays.length + 2} className="px-4 py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                )}
                {history.isError && !history.data && (
                  <tr><td colSpan={periodDays.length + 2} className="px-4 py-2"><div className="sticky left-0 w-[min(100%,calc(100vw-3rem))] max-w-xl"><LoadError compact error={history.error} what={tr("this month's attendance")} onRetry={() => void history.refetch()} /></div></td></tr>
                )}
                {!history.isLoading && !(history.isError && !history.data) && memberRows.length === 0 && (
                  <tr><td colSpan={periodDays.length + 2} className="px-4 py-10 text-center text-sm text-muted-foreground">{q ? tr("No one matches “{q}”.", { q: memberQuery.trim() }) : tr("No attendance data for this month yet.")}</td></tr>
                )}
                {memberRows.map((u) => (
                  <tr key={u.id} className="border-b border-border [scroll-snap-align:start_none] last:border-0 hover:bg-muted/20">
                    <td className="sticky left-0 z-10 w-[7.5rem] min-w-[7.5rem] max-w-[7.5rem] bg-card px-1.5 py-2 shadow-[1px_0_0_0_var(--border)] sm:w-[20rem] sm:min-w-[20rem] sm:max-w-[20rem] sm:px-4 sm:py-2.5">
                      {/* Two lines at every width: who, then everything about them. One row squeezed the
                          badges and pills on top of each other in the 20rem column (28 Sep 2026). */}
                      <div className="flex min-w-0 flex-col gap-1.5">
                        {canManage ? (
                          <button
                            onClick={() => setDeductionsFor({ id: u.id, name: u.name ?? null })}
                            title={tr("See {name}'s XP and day-off deductions", { name: u.name ?? tr("this person") })}
                            className="flex min-w-0 items-center gap-1.5 rounded-lg py-0.5 text-left transition hover:bg-primary/10 sm:gap-2 sm:px-1"
                          >
                            <MemberAvatar user={u} />
                            <div className="min-w-0">
                              {/* Phone: first name only, so the pinned column stays narrow (UI tour run 9). */}
                              <div className="flex min-w-0 items-center gap-1.5"><span className={cn("text-[13px] font-medium leading-tight tracking-tight sm:hidden", phoneNameClamp(shortName(u.name)))} title={u.name ?? undefined}>{shortName(u.name) || tr("Unnamed")}</span><span className="hidden truncate font-medium sm:inline">{u.name || tr("Unnamed")}</span><span className="hidden sm:contents"><LeftTag leftAt={leftAtOf(u)} /></span></div>
                              <div className="hidden truncate text-[10px] text-muted-foreground sm:block">{memberSubtitle(u)}</div>
                              <PhoneMemberSummary d={canManage ? dayOffOf(u.id) : null} />
                            </div>
                          </button>
                        ) : (
                          <div className="flex min-w-0 items-center gap-1.5 py-0.5 sm:gap-2 sm:px-1">
                            <MemberAvatar user={u} />
                            <div className="min-w-0">
                              {/* Phone: first name only, so the pinned column stays narrow (UI tour run 9). */}
                              <div className="flex min-w-0 items-center gap-1.5"><span className={cn("text-[13px] font-medium leading-tight tracking-tight sm:hidden", phoneNameClamp(shortName(u.name)))} title={u.name ?? undefined}>{shortName(u.name) || tr("Unnamed")}</span><span className="hidden truncate font-medium sm:inline">{u.name || tr("Unnamed")}</span><span className="hidden sm:contents"><LeftTag leftAt={leftAtOf(u)} /></span></div>
                              <div className="hidden truncate text-[10px] text-muted-foreground sm:block">{memberSubtitle(u)}</div>
                              <PhoneMemberSummary d={canManage ? dayOffOf(u.id) : null} />
                            </div>
                          </div>
                        )}
                        {/* Phone (UI tour run 7, 14 Oct 2026): a 11.5rem column with small pills whose tap targets
                            grow invisibly (tap-area); the 44 px pills and the 15rem column left room for three days. */}
                        {/* Phone: the pills live behind the name (deductions) and the person's Record page; on the
                            narrow pinned column they pushed the day columns off screen (UI tour run 9). */}
                        <div className="hidden min-w-0 flex-wrap items-center gap-1 pl-1 sm:flex">
                        <TrackingBadges rec={recMap.get(`${u.id}:${todayKey}`)} isToday />
                        {/* The person's whole record for this period: counts, XP log with reasons, requests. */}
                        <Link to="/people/$userId" params={{ userId: u.id }} search={{ period: monthKey }} title={tr("{name} — record for this period", { name: u.name ?? tr("Unnamed") })}
                          className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground ring-1 ring-border transition hover:bg-accent hover:text-foreground tap-area">{tr("Record")}</Link>
                        {canManage && (() => {
                          const d = dayOffOf(u.id);
                          if (!d) return null;
                          // Amber once they're down to their last one, rose when it's gone — a
                          // number alone doesn't tell you when to worry.
                          const quotaTone = (remaining: number) =>
                            remaining === 0 ? "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30"
                              : remaining <= 1 ? "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30"
                              : "bg-muted text-muted-foreground ring-border";
                          // Red only for negative XP; any positive score reads neutral, and above the 1000 baseline
                          // green (UI tour run 10, WD-6: "791 XP" wore the same red pill as "-590 XP").
                          const xpTone = xpPillTone(d.xp.score);
                          const pill = "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ring-1";
                          return (
                            <>
                              {/* Right after Record: at the end of the row it wrapped onto a line of its own
                                  (UI tour run 16, R16-WD-4). */}
                              <button
                                type="button"
                                aria-label={tr("Export this person's attendance (xlsx): one row per day, check-in/out times, lateness, notes")} title={tr("Export this person's attendance (xlsx): one row per day, check-in/out times, lateness, notes")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const slug = (u.name || "staff").toLowerCase().replace(/[^a-z0-9]+/g, "-");
                                  void downloadFile(`/api/attendance/history?scope=workspace&month=${monthKey}&userId=${u.id}&format=xlsx`, `absensi-${slug}-${monthKey}.xlsx`)
                                    .catch((err) => alert(err instanceof ApiError ? err.message : tr("Export failed. Try again.")));
                                }}
                                className={cn(pill, "tap-area bg-muted text-muted-foreground ring-border transition hover:bg-accent hover:text-foreground")}
                              >
                                <Download className="inline h-3 w-3" />
                              </button>
                              <span title={tr("Day off left this period: {left} of {quota} (used {used})", { left: d.remaining, quota: d.quota, used: d.used }) + (d.bonus && d.bonus.days > 0 ? "\n" + tr("Quota {base} + {n} extra ({reasons}) — expires on the 27th", { base: d.baseQuota ?? d.quota - d.bonus.days, n: d.bonus.days, reasons: d.bonus.grants.map((g) => `${g.days}: ${g.reason}`).join("; ") }) : "")}
                                className={cn(pill, quotaTone(d.remaining), d.bonus && d.bonus.days > 0 && "ring-emerald-300 dark:ring-emerald-400/60")}>
                                {/* Spelled out (UI tour run 13, W-D24: "0/4 DO" and "0/0 PH" were cryptic). */}
                                {tr("{left}/{quota} days off", { left: d.remaining, quota: d.quota })}{d.bonus && d.bonus.days > 0 && <span className="ml-0.5 text-emerald-600 dark:text-emerald-400">+</span>}
                              </span>
                              <span title={d.redDate.quota === 0
                                  ? tr("The board hasn't set this month's public-holiday allowance yet")
                                  : tr("Public holidays left this calendar month: {left} of {quota} (used {used})", { left: d.redDate.remaining, quota: d.redDate.quota, used: d.redDate.used })}
                                className={cn(pill, d.redDate.quota === 0 ? "bg-muted/50 text-muted-foreground/70 ring-border" : quotaTone(d.redDate.remaining))}>
                                {tr("{left}/{quota} holidays", { left: d.redDate.remaining, quota: d.redDate.quota })}
                              </span>
                              <span title={`${formatCount(d.xp.score)} XP · ${d.xp.levelName} (Lv.${d.xp.level}) — ${tr("the XP period runs from the 28th to the 27th, as attendance")}`}
                                className={cn(pill, xpTone)}>
                                {formatCount(d.xp.score)} XP
                              </span>
                            </>
                          );
                        })()}
                        </div>
                      </div>
                    </td>
                    {periodDays.map((pd) => {
                      const rec = recMap.get(`${u.id}:${pd.key}`);
                      const tone = rec ? recTone(rec) : "none";
                      return (
                        <td key={pd.key} className={cn("px-1 py-2.5 text-center lg:px-0.5", pd.day === 1 && "border-l border-border/70")}>
                          {/* The marks below sit on the day's dot, not on the cell's corner: in a tall row the cell's
                              corner is far above the dot, so a mark floated there on its own, and on a phone it
                              showed as a sliver beside the pinned name column (UI tour run 14, R14-WM-17). */}
                          <span className="relative inline-block align-middle leading-none">
                          {rec ? (
                            tone === "absent" && canManage ? (
                              <button
                                onClick={() => setOverrideTarget({ userId: u.id, name: u.name ?? null, dateKey: pd.key })}
                                title={`${fmtDate(rec.attendanceDate)} · ${tr("Absent — no check-in. Tap to set a status (Present/Leave/Sick/Day off).")}`}
                                className={cn("inline-block h-5 w-5 rounded-lg lg:h-[18px] lg:w-[18px] lg:rounded-md pointer-coarse:size-11 pointer-coarse:rounded-[18px] pointer-coarse:border-[10px] pointer-coarse:border-transparent pointer-coarse:bg-clip-padding transition-[box-shadow] hover:ring-2 hover:ring-primary/50", sCls.absent)}
                              />
                            ) : tone === "absent" ? (
                              <span title={`${fmtDate(rec.attendanceDate)} · ${tr("Absent")}`} className={cn("inline-block h-5 w-5 rounded-lg lg:h-[18px] lg:w-[18px] lg:rounded-md pointer-coarse:size-11 pointer-coarse:rounded-[18px] pointer-coarse:border-[10px] pointer-coarse:border-transparent pointer-coarse:bg-clip-padding", sCls.absent)} />
                            ) : tone === "leave" || tone === "permit" || tone === "sick" || tone === "dayoff" ? (
                              <motion.button
                                whileHover={reduceMotion ? undefined : { scale: 1.3 }}
                                whileTap={reduceMotion ? undefined : { scale: 0.85 }}
                                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                                onClick={(e) => { setCorrectOrigin(rectCenter(e.currentTarget)); setLeaveDetail(rec); }}
                                title={`${fmtDate(rec.attendanceDate)} · ${tr(toneLabel[tone])}${rec.notes ? " — " + rec.notes : ""} — ${tr("tap for details")}`}
                                className={cn("inline-block h-5 w-5 rounded-lg lg:h-[18px] lg:w-[18px] lg:rounded-md pointer-coarse:size-11 pointer-coarse:rounded-[18px] pointer-coarse:border-[10px] pointer-coarse:border-transparent pointer-coarse:bg-clip-padding transition-[box-shadow] hover:ring-2 hover:ring-primary/50", sCls[tone])}
                              />
                            ) : (
                              <motion.button
                                whileHover={reduceMotion ? undefined : { scale: 1.3 }}
                                whileTap={reduceMotion ? undefined : { scale: 0.85 }}
                                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                                onClick={(e) => { setCorrectOrigin(rectCenter(e.currentTarget)); setCorrectRecord(rec); }}
                                title={`${fmtDate(rec.attendanceDate)} · ${statusLabel(rec.status || "")} · ${tr("In {time}", { time: fmtTime(rec.checkInAt) })} / ${tr("Out {time}", { time: fmtTime(rec.checkOutAt) })}${rec.locationTrackingState === "denied" ? ` · ${tr("Location off")}` : rec.locationTrackingState === "web" ? ` · ${tr("Web check-in · location not tracked")}` : ""} — ${tr("tap to see location and selfie")}`}
                                className={cn("inline-block h-5 w-5 rounded-lg lg:h-[18px] lg:w-[18px] lg:rounded-md pointer-coarse:size-11 pointer-coarse:rounded-[18px] pointer-coarse:border-[10px] pointer-coarse:border-transparent pointer-coarse:bg-clip-padding transition-[box-shadow] hover:ring-2 hover:ring-primary/50", sCls[tone])}
                              />
                            )
                          ) : canManage ? (
                            <button
                              onClick={() => setOverrideTarget({ userId: u.id, name: u.name ?? null, dateKey: pd.key })}
                              title={`${pd.key} — ${tr("empty. Tap to set a status (Present/Leave/Sick/Day off).")}`}
                              className="inline-block h-5 w-5 rounded-lg lg:h-[18px] lg:w-[18px] lg:rounded-md pointer-coarse:size-11 pointer-coarse:rounded-[18px] pointer-coarse:border-[10px] pointer-coarse:border-transparent pointer-coarse:bg-clip-padding bg-muted/30 transition-[box-shadow] hover:ring-2 hover:ring-primary/50"
                            />
                          ) : (
                            <span className="inline-block h-5 w-5 rounded-lg lg:h-[18px] lg:w-[18px] lg:rounded-md pointer-coarse:size-11 pointer-coarse:rounded-[18px] pointer-coarse:border-[10px] pointer-coarse:border-transparent pointer-coarse:bg-clip-padding bg-muted/30" />
                          )}
                          {rec?.locationTrackingState === "denied" && (
                            <span title={tr("Location off")} aria-label={tr("Location off")} className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-3 w-3 place-items-center rounded-full bg-card text-slate-500 ring-1 ring-border pointer-coarse:right-0.5 pointer-coarse:top-0.5 dark:text-slate-400"><MapPinOff className="h-2 w-2" /></span>
                          )}
                          {rec?.locationTrackingState === "web" && (
                            <span title={tr("Web check-in · location not tracked")} aria-label={tr("Web check-in · location not tracked")} className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-3 w-3 place-items-center rounded-full bg-card text-sky-600 ring-1 ring-border pointer-coarse:right-0.5 pointer-coarse:top-0.5 dark:text-sky-400"><Globe className="h-2 w-2" /></span>
                          )}
                          {pd.key === todayKey && rec?.outsideSince && !rec.checkOutAt && (
                            <span title={tr("Outside since {time}", { time: fmtTime(rec.outsideSince) })} className="pointer-events-none absolute -bottom-2 left-1/2 h-1 w-3 -translate-x-1/2 rounded-full bg-amber-500 pointer-coarse:bottom-1" />
                          )}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right text-xs font-semibold tabular-nums text-muted-foreground" title={tr("Days worked (present, permit or WFH) out of this period's working days: {days} days − {quota} day-off quota = {target}", { days: daysOf(u.id), quota: daysOf(u.id) - workDaysOf(u.id), target: workDaysOf(u.id) })} data-score-user={u.id}>{(() => {
                      // Capped at the working days, the surplus shown beside it (owner, 28 Sep 2026): a day
                      // cut from the quota for being >120 min late is still a day worked, so someone can
                      // work more days than "period − quota" — 22/22 +3 reads right, 25/22 does not.
                      const worked = presentCount(u.id), target = workDaysOf(u.id);
                      return <>{Math.min(worked, target)}/{target}{worked > target && <span className="ml-1 text-emerald-600 dark:text-emerald-400">+{worked - target}</span>}</>;
                    })()}</td>
                  </tr>
                ))}
                {!history.isLoading && hiddenCount > 0 && (
                  <tr><td colSpan={periodDays.length + 2} className="px-4 py-3 text-center text-xs text-muted-foreground">{tr("+{n} more people — search a name to see someone else.", { n: hiddenCount })}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {/* About a day column wide and solid at the edge, so a column cut there is covered instead of showing
              "T" / "1" fragments (UI tour run 13, W-M3). */}
          {/* Every width (UI tour run 15, R15-WD-5: on desktop the period ended at SUN 25 with MON 26 and TUE 27
              hidden and nothing saying so). Wide screens fit the whole period; narrower ones get the fade plus a
              button that scrolls a week further. */}
          {boardMore && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-30 w-10 bg-gradient-to-l from-card from-45% to-transparent" />}
          {boardMoreDown && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-8 rounded-b-3xl bg-gradient-to-t from-card from-40% to-transparent" />}
          {boardMore && (
            <button
              type="button"
              onClick={() => { boardTouched.current = true; boardScrollRef.current?.scrollBy({ left: 7 * 28, behavior: reduceMotion ? "auto" : "smooth" }); }}
              aria-label={tr("Show later days")} title={tr("Show later days")}
              className="absolute right-1 top-1.5 z-40 hidden h-7 w-7 place-items-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border transition hover:text-foreground sm:grid"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          </div>
          )}
        </div>

        <ReflectionsSection canPickPeople={canSeeBoard} members={allMembers} />
        <RequestsSection canReview={canReview} canManage={canManage} viewerId={today.data?.viewerId ?? null} />
        {canManage && <OfficesSection />}
      </div>
      <AnimatePresence>
        {correctRecord && <AttendanceCorrectionDrawer key={correctRecord.id} record={correctRecord} origin={correctOrigin} onClose={() => setCorrectRecord(null)} canOverride={canManage} />}
        {leaveDetail && <LeaveDetailDrawer record={leaveDetail} onClose={() => setLeaveDetail(null)} canOverride={canManage} />}
        {deductionsFor && (
          <DeductionLogModal
            userId={deductionsFor.id}
            name={deductionsFor.name}
            monthKey={monthKey}
            onClose={() => setDeductionsFor(null)}
          />
        )}
        {overrideTarget && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={() => setOverrideTarget(null)}>
      <EscClose onClose={() => setOverrideTarget(null)} />
            <div role="dialog" aria-modal="true" aria-label={overrideTarget.name ?? tr("Unnamed")} className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold tracking-tight">{overrideTarget.name ?? tr("Unnamed")}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(overrideTarget.dateKey)} — {tr("no attendance record yet.")}</p>
                </div>
                <button onClick={() => setOverrideTarget(null)} aria-label={tr("Close")} className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
              </div>
              <StatusOverridePanel userId={overrideTarget.userId} name={overrideTarget.name} dateKey={overrideTarget.dateKey} onDone={() => setOverrideTarget(null)} />
            </div>
          </div>
        )}
      </AnimatePresence>
      {trailFor && <LocationTrailDialog recordId={trailFor.id} title={trailFor.title} subtitle={trailFor.subtitle} onClose={() => setTrailFor(null)} />}
      <AnimatePresence>
        {logKind && <DayOffLogModal key={logKind.kind} kind={logKind.kind} origin={logKind.origin} onClose={() => setLogKind(null)} />}
      </AnimatePresence>
    </div>
  );
}

/**
 * BoD: every XP and day-off penalty one person took this period, why, and a button to undo each one.
 *
 * Undo reuses the existing CLEAR_PENALTY override rather than deleting rows: that path refunds the XP,
 * restores an auto-cut day-off, AND writes the waiver marker — without the waiver the nightly cron
 * re-derives the penalty and it comes straight back. It clears the whole DAY, so every entry sharing
 * that date clears together; the UI says so instead of pretending otherwise.
 */
function DeductionLogModal({ userId, name, monthKey, onClose }: { userId: string; name: string | null; monthKey: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["attendance-deductions", userId, monthKey],
    queryFn: () => nexusApi.attendanceDeductions(userId, monthKey),
    retry: 1,
  });
  const clear = useMutation({
    mutationFn: (dateKey: string) => nexusApi.attendanceOverride({ userId, date: dateKey, action: "CLEAR_PENALTY" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["attendance-deductions", userId, monthKey] });
      qc.invalidateQueries({ queryKey: ["attendance-dayoff-summary"] });
      qc.invalidateQueries({ predicate: (x) => x.queryKey.map(String).includes("attendance-history") });
      celebrate(r.refunded ? tr("Deduction for {date} removed — XP and day off restored", { date: r.date }) : tr("No deduction on {date}.", { date: r.date }));
    },
    onError: (e) => alert(e instanceof Error ? e.message : tr("Couldn't remove the deduction.")),
  });

  const entries = q.data?.entries ?? [];
  const active = entries.filter((e) => !e.cleared);
  const cleared = entries.filter((e) => e.cleared);

  const row = (e: NonNullable<typeof q.data>["entries"][number]) => (
    <div key={e.id} className={cn("flex items-center gap-3 rounded-xl border border-border px-3 py-2", e.cleared && "opacity-55")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{deductionLabel(e)}</span>
          {e.cleared && <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{tr("removed")}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground">{fmtDate(e.dateKey)}{e.detail ? ` · ${attendanceReasonText(e.detail)}` : ""}</div>
      </div>
      <span className={cn("shrink-0 text-sm font-black tabular-nums", e.cleared ? "text-muted-foreground" : "text-rose-600 dark:text-rose-400")}>
        {e.unit === "XP" ? `${formatCount(e.amount)} XP` : tr("{n} day off", { n: e.amount })}
      </span>
      {!e.cleared && (
        <button aria-label={tr("Remove this day's deduction")}
          disabled={clear.isPending}
          onClick={() => {
            const same = active.filter((x) => x.dateKey === e.dateKey);
            const extra = same.length > 1 ? "\n\n" + tr("This date has {n} deductions — they are all removed together.", { n: same.length }) : "";
            if (window.confirm(tr("Remove the deduction on {date} for {name}?", { date: fmtDate(e.dateKey), name: name ?? tr("this person") }) + extra + "\n\n" + tr("The XP comes back and any day off taken automatically is restored. The attendance status doesn't change."))) {
              clear.mutate(e.dateKey);
            }
          }}
          className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:border-rose-500/40 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
          title={tr("Remove this day's deduction")}
        >
          {clear.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 dark:bg-scrim p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <EscClose onClose={onClose} />
      <motion.div role="dialog" aria-modal="true" aria-label={name ?? tr("Unnamed")} initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.18, ease: "easeOut" }} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop">
        <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-base font-black">{name ?? tr("Unnamed")}</h2>
              <LeftTag leftAt={leftAtOf(q.data)} />
            </div>
            <p className="text-xs text-muted-foreground">{tr("XP and day-off deductions · period {period}", { period: monthKey })}</p>
          </div>
          <button onClick={onClose} aria-label={tr("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        {q.data && (
          <div className="grid grid-cols-2 gap-2 border-b border-border px-5 py-3">
            <div className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{tr("Days off left")}</div>
              <div className="text-lg font-black tabular-nums">{q.data.dayOff.remaining}<span className="text-sm font-bold text-muted-foreground">/{q.data.dayOff.quota}</span></div>
            </div>
            <div className="rounded-xl bg-muted/40 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{tr("XP deducted")}</div>
              <div className="text-lg font-black tabular-nums text-rose-600 dark:text-rose-400">{q.data.totalXpLost}</div>
            </div>
          </div>
        )}

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {q.isLoading && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div>}
          {q.isError && <p className="py-8 text-center text-sm font-semibold text-rose-600 dark:text-rose-400">{tr("Couldn't load the deductions.")}</p>}
          {q.data && entries.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">{tr("No deductions this period.")}</p>
          )}
          {active.map(row)}
          {cleared.length > 0 && (
            <>
              <div className="pt-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{tr("Removed")}</div>
              {cleared.map(row)}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
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
      alert(e instanceof ApiError ? e.message : tr("Export failed. Try again."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((v) => !v)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {tr("Export")}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-pop">
            <button onClick={() => run("xlsx")} className="flex w-full flex-col items-start px-3 py-2.5 text-left transition-colors hover:bg-muted/40"><span className="text-sm font-semibold">{tr("Monthly recap (Excel)")}</span><span className="text-xs text-muted-foreground">{tr("Internal attendance sheet")} · {monthLabel}</span></button>
            <button onClick={() => run("csv")} className="flex w-full flex-col items-start border-t border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/40"><span className="text-sm font-semibold">{tr("Detail log (CSV)")}</span><span className="text-xs text-muted-foreground">{tr("Per record: time, status, lateness")}</span></button>
          </div>
        </>
      )}
    </div>
  );
}

// First word of a name, for the narrow pinned column on a phone.
function shortName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

// Phone line under the name: this period's day-off quota and XP as plain text (the pills sit on desktop).
/** The board's XP pill: red only below zero, neutral up to the 1000 baseline, green above it. */
function xpPillTone(score: number): string {
  if (score < 0) return "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30";
  if (score > PERIOD_BASELINE_XP) return "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30";
  return "bg-muted text-muted-foreground ring-border";
}

/**
 * Phone: day off, public holidays and XP on their own lines, so the narrow pinned column never cuts the XP (UI
 * tour run 10, WM-3). Spelled out as on the desktop pills, and the XP with a true minus (UI tour run 14,
 * R14-WM-14 / R14-WM-15: "0/4 DO", "0/0 PH" and "-590 XP").
 */
function PhoneMemberSummary({ d }: { d: { remaining: number; quota: number; redDate?: { remaining: number; quota: number } | null; xp: { score: number } } | null }) {
  if (!d) return null;
  return (
    <div className="text-[10px] leading-tight tabular-nums text-muted-foreground sm:hidden">
      <div className="whitespace-nowrap">{tr("{left}/{quota} days off", { left: d.remaining, quota: d.quota })}</div>
      {d.redDate && <div className="whitespace-nowrap">{tr("{left}/{quota} holidays", { left: d.redDate.remaining, quota: d.redDate.quota })}</div>}
      <div className={cn("whitespace-nowrap", d.xp.score < 0 && "font-medium text-rose-600 dark:text-rose-400")}>{formatCount(d.xp.score)} XP</div>
    </div>
  );
}

// Member avatar that falls back to the initials Avatar if the photo URL 404s.
function MemberAvatar({ user }: { user: { id: string; avatar?: string | null } }) {
  const [failed, setFailed] = useState(false);
  if (user.avatar && !failed) {
    return <img src={user.avatar} alt="" onError={() => setFailed(true)} className="h-6 w-6 shrink-0 rounded-full object-cover" />;
  }
  return <Avatar userId={user.id} size={24} className="shrink-0" />;
}

// One evidence card (selfie + location) for a check-in or check-out leg — the audit view.
function AttendanceEvidence({ kind, photoUrl, address, lat, lng, distanceMeters, atIso, offsite, reason, away, officeName }: {
  kind: "in" | "out";
  photoUrl?: string | null; address?: string | null; lat?: number | null; lng?: number | null;
  distanceMeters?: number | null; atIso?: string | null; offsite?: boolean | null; reason?: string | null;
  /** Check-in made outside the office radius (location-free) — the address IS the day's place. */
  away?: boolean; officeName?: string | null;
}) {
  const hasAny = !!photoUrl || !!address || lat != null;
  const mapUrl = lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{kind === "in" ? tr("Check-in") : tr("Check-out")}</span>
        {atIso && <span className="text-[11px] tabular-nums text-muted-foreground">{fmtTime(atIso)}</span>}
      </div>
      {!hasAny ? (
        <p className="mt-2 text-xs text-muted-foreground/70">{kind === "in" ? tr("No check-in evidence yet.") : tr("No check-out evidence yet.")}</p>
      ) : (
        <div className="mt-2 flex gap-3">
          {photoUrl ? (
            <a href={photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
              <img src={photoUrl} alt={kind === "in" ? tr("Check-in selfie") : tr("Check-out selfie")} className="h-20 w-20 rounded-xl object-cover ring-1 ring-border transition-transform hover:scale-105" />
            </a>
          ) : (
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground/40"><Camera className="h-5 w-5" /></div>
          )}
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            {offsite && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{tr("Offsite")}</span>}
            {away && <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">{tr("Away from the office")}</span>}
            {!away && officeName && <p className="font-semibold text-foreground">{officeName}</p>}
            <p className="leading-snug text-foreground/80">{address || (lat != null ? `${lat.toFixed(5)}, ${lng?.toFixed(5)}` : tr("Location not recorded"))}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
              {distanceMeters != null && <span>{tr("±{m}m from the office", { m: Math.round(distanceMeters) })}</span>}
              {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"><MapPin className="h-3 w-3" /> {tr("map")}</a>}
            </div>
            {reason && <p className="italic text-muted-foreground">“{reason}”</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// "Location trail" in the day detail — collapsed until asked for, so opening a day costs no extra call.
function TrailSection({ record, recordId }: { record: HistRow; recordId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-2xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground"><RouteIcon className="h-3.5 w-3.5" /> {tr("Location trail")}</p>
        <TrackingBadges rec={record} isToday={(record.attendanceDate || "").slice(0, 10) === jakartaDateKey()} />
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-auto rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-accent">{open ? tr("Hide") : tr("Show")}</button>
      </div>
      {open && <div className="mt-3"><LocationTrail recordId={recordId} compact trackingState={record.locationTrackingState} /></div>}
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
      if (!uid) throw new Error(tr("Unknown user."));
      return nexusApi.attendanceOverride({ userId: uid, date: (record.attendanceDate || "").slice(0, 10), action: "PRESENT", checkInAt: checkInISO, checkOutAt: checkOutISO, note: reason.trim() });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance-history"] }); celebrate(tr("Attendance saved")); onClose(); },
  });

  const field = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <MorphPanel origin={origin} onClose={onClose}>
      <div className="overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">{tr("Attendance detail")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{record.user?.name ?? tr("Unnamed")} · {fmtDate(record.attendanceDate)} · {statusLabel(record.status || "")}</p>
          </div>
          <button onClick={onClose} aria-label={tr("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{tr("Attendance evidence · location and selfie")}</p>
          <AttendanceEvidence kind="in" photoUrl={record.checkInPhotoUrl} address={record.checkInAddress} lat={record.checkInLat} lng={record.checkInLng} distanceMeters={record.checkInDistanceMeters} atIso={record.checkInAt} away={recordPlace(record).away} officeName={record.checkInAt ? record.officeLocation?.name : null} />
          <AttendanceEvidence kind="out" photoUrl={record.checkOutPhotoUrl} address={record.checkOutAddress} lat={record.checkOutLat} lng={record.checkOutLng} distanceMeters={record.checkOutDistanceMeters} atIso={record.checkOutAt} offsite={record.checkOutOffsite} reason={record.checkOutReason} />
        </div>
        {record.id && record.checkInAt && <TrailSection record={record} recordId={record.id} />}
        {record.checkOutReflection && (
          <div className="mt-4 rounded-2xl border border-border bg-muted/30 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground"><PenLine className="h-3.5 w-3.5" /> {tr("Daily reflection")}</p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{record.checkOutReflection}</p>
          </div>
        )}
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{tr("Manual correction")}</p>
        </div>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{tr("Check-in")}<input type="datetime-local" value={checkInAt} onChange={(e) => setCheckInAt(e.target.value)} className={cn(field, "mt-1")} /></label>
            <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{tr("Check-out")}<input type="datetime-local" value={checkOutAt} onChange={(e) => setCheckOutAt(e.target.value)} className={cn(field, "mt-1")} /></label>
          </div>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{tr("Notes")}<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tr("Optional note…")} className={cn(field, "mt-1 min-h-16")} /></label>
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{tr("Correction reason")}<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Why is this being corrected?")} className={cn(field, "mt-1")} /></label>
          {save.isError && <p className="text-sm text-destructive">{save.error instanceof Error && save.error.message ? save.error.message : tr("Couldn’t save the correction. Check your access and that check-out comes after check-in.")}</p>}
          <button disabled={!checkInAt || !reason.trim() || save.isPending} onClick={() => save.mutate()} className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-50">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {tr("Save correction")}</button>
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
  useLang();
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editOffice, setEditOffice] = useState<NexusOffice | null>(null);
  const offices = useQuery({ queryKey: ["attendance-offices"], queryFn: nexusApi.attendanceOffices, retry: 1 });
  const rows = offices.data?.offices ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["attendance-offices"] });
  const toggle = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => nexusApi.updateOffice(id, { isActive }), onSuccess: invalidate,
    onError: (e: unknown) => alert(e instanceof Error ? e.message : tr("Couldn't update the office.")) });
  // Deleting is refused by the server for an office that has attendance history (the rows point at
  // it); the message it sends back says so and suggests switching it off instead.
  const del = useMutation({ mutationFn: (id: string) => nexusApi.deleteOffice(id), onSuccess: invalidate,
    onError: (e: unknown) => alert(e instanceof Error ? e.message : tr("Couldn't delete the office.")) });

  return (
    <section className="rounded-[28px] border border-border bg-card shadow-soft overflow-clip">
      <div data-snap-row className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{tr("Offices and check-in area")}</h2>
          <p className="text-sm text-muted-foreground">{tr("Set office locations and the radius for check-in.")}</p>
        </div>
        <button onClick={() => setComposerOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><MapPin className="h-3.5 w-3.5" /> {tr("New office")}</button>
      </div>
      <div className="divide-y divide-border">
        {offices.isLoading && <div className="px-5 py-4 text-sm text-muted-foreground">{tr("Loading offices…")}</div>}
        {!offices.isLoading && rows.length === 0 && <div className="px-5 py-6 text-center text-sm text-muted-foreground">{tr("No offices yet.")}</div>}
        {rows.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <MapPin className={`h-4 w-4 shrink-0 ${o.isActive ? "text-primary" : "text-muted-foreground/40"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{o.name}</div>
              <div className="text-xs text-muted-foreground">{o.address || `${o.latitude?.toFixed(4)}, ${o.longitude?.toFixed(4)}`} · {o.radiusMeters}m</div>
            </div>
            <button title={tr("Delete office")} aria-label={tr("Delete office")} disabled={del.isPending} onClick={() => { if (window.confirm(tr("Delete “{name}”? It disappears from the list and nobody can check in there anymore. Days already recorded there keep the office's name.", { name: o.name }))) del.mutate(o.id); }} className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 dark:hover:border-rose-500/40 dark:hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
            <button onClick={() => setEditOffice(o)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Pencil className="h-3.5 w-3.5" /> {tr("Edit")}</button>
            <button onClick={() => toggle.mutate({ id: o.id, isActive: !o.isActive })} className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-colors ${o.isActive ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{o.isActive ? tr("Active") : tr("Inactive")}</button>
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
    // A refused save used to leave the dialog open and silent — "the edit doesn't work".
    onError: (e: unknown) => alert(e instanceof Error ? e.message : tr("Couldn't save the office.")),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <EscClose onClose={onClose} />
      <div role="dialog" aria-modal="true" aria-label={editing ? tr("Edit office") : tr("New office")} className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold tracking-tight">{editing ? tr("Edit office") : tr("New office")}</h2>
        <div className="mt-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Office name")} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={tr("Address (optional)")} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <OfficeMapPicker lat={Number.isFinite(Number(lat)) && lat !== "" ? Number(lat) : null} lng={Number.isFinite(Number(lng)) && lng !== "" ? Number(lng) : null}
            radiusMeters={Number(radius) || 100} onChange={(la, lo) => { setLat(la.toFixed(6)); setLng(lo.toFixed(6)); }} />
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer font-semibold">{tr("Fine-tune coordinates")}</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder={tr("Latitude")} className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
              <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder={tr("Longitude")} className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            </div>
          </details>
          {/* Shift start/end dihilangkan — jam shift sekarang diatur per orang (Control Room → Members),
              bukan per office. Office cuma nyimpen default fallback (gak ditampilin di sini). */}
          <div className="flex flex-wrap gap-4">
            <label className="block text-[11px] font-bold text-muted-foreground">Radius · {Number(radius) || 100} m
              <input type="range" min={25} max={500} step={5} value={Number(radius) || 100} onChange={(e) => setRadius(e.target.value)} className="mt-1 block w-full accent-primary" />
            </label>
            <label className="block text-[11px] font-bold text-muted-foreground">{tr("Late grace (minutes)")}<input value={grace} onChange={(e) => setGrace(e.target.value.replace(/[^0-9]/g, ""))} className="mt-1 w-32 rounded-xl border border-border bg-background px-2 py-2 text-sm" /><span className="mt-1 block font-normal text-muted-foreground/70">{tr("0 = strict, late from the very first minute")}</span></label>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2">
          <button disabled={!name.trim() || !lat || !lng || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? tr("Save changes") : tr("Create office")}</button>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">{tr("Cancel")}</button>
          {create.isError && <span className="text-xs font-semibold text-destructive">{tr("Couldn't save the office.")}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Reflections: the daily check-out notes, with GIDEON's read of each day and of the month so far.
// Everyone sees their own; a manager picks one of their reports, BoD anyone on the board.
// ---------------------------------------------------------------------------------------------
function ReflectionsSection({ canPickPeople, members }: { canPickPeople: boolean; members: Array<{ id: string; name?: string | null; email?: string | null }> }) {
  const { locale, tn } = useLang();
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const key = ["attendance-reflections", userId ?? "me", month];
  const q = useQuery({ queryKey: key, queryFn: () => nexusApi.reflections(userId, month), retry: 1 });
  const summarize = useMutation({
    mutationFn: () => nexusApi.summarizeReflections(userId, month),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const [y, m] = month.split("-").map(Number);
  const label = monthTitle(new Date(y, m - 1, 1), locale);
  const shift = (d: number) => { const n = new Date(y, m - 1 + d, 1); setMonth(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`); setOpen(null); };
  const isCurrent = (() => { const d = new Date(); return y === d.getFullYear() && m === d.getMonth() + 1; })();
  const days = q.data?.days ?? [];
  const monthly = q.data?.monthly ?? null;
  const upToDate = Boolean(monthly && monthly.sourceDays === days.length);
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const summarizeError = summarize.error instanceof ApiError ? ((summarize.error.payload as { error?: string } | null)?.error ?? summarize.error.message) : summarize.error ? tr("GIDEON didn't answer. Try again in a minute.") : null;

  return (
    <div className="rounded-[28px] border border-border bg-card shadow-soft overflow-clip">
      <div data-snap-row className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><PenLine className="h-4 w-4 text-primary" /> {tr("Reflections")}</h2>
          <p className="text-sm text-muted-foreground">{tr("What was written at check-out, with GIDEON's summary of each day and of the month so far.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPickPeople && (
            <SelectPicker variant="field" size="sm" align="end" value={userId ?? ""} onChange={(v) => { setUserId(v || undefined); setOpen(null); }} ariaLabel={tr("Reflections")} options={[{ value: "", label: tr("Me") }, ...members.map((u) => ({ value: u.id, label: u.name || u.email || u.id }))]} className="h-8 px-2.5 font-semibold" />
          )}
          <div className="inline-flex items-center rounded-lg border border-border">
            <button type="button" onClick={() => shift(-1)} className="px-2 py-1.5 text-muted-foreground hover:text-foreground" aria-label={tr("Previous month")}><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[120px] text-center text-xs font-semibold">{label}</span>
            <button type="button" onClick={() => shift(1)} disabled={isCurrent} className="px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label={tr("Next month")}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {tr("Loading reflections…")}</div>
        ) : q.isError ? (
          <div className="text-sm font-semibold text-destructive">{q.error instanceof ApiError ? ((q.error.payload as { error?: string } | null)?.error ?? tr("Couldn't load reflections.")) : tr("Couldn't load reflections.")}</div>
        ) : days.length === 0 ? (
          <EmptyState icon={PenLine} compact title={tr("No reflections in {month}", { month: label })}
            message={tr("A reflection is written at check-out. After a check-out with one, it shows up here with GIDEON's summary of the day.")} />
        ) : (
          <>
            {/* Month so far */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-primary" /> {tr("GIDEON's month summary")}</div>
                <button type="button" onClick={() => summarize.mutate()} disabled={summarize.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-soft transition hover:bg-primary/90 disabled:opacity-60">
                  {summarize.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {summarize.isPending ? tr("GIDEON is reading…") : monthly ? (upToDate ? tr("Summary is up to date") : tr("Update the summary")) : tn(days.length, "Summarize {n} day so far", "Summarize {n} days so far")}
                </button>
              </div>
              {monthly ? (
                <>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">{monthly.summary}</p>
                  <p className="mt-2 text-[11px] font-medium text-muted-foreground">{tn(monthly.sourceDays, "Built from {n} day", "Built from {n} days")} · {fmtDate(monthly.updatedAt)}{!upToDate ? ` · ${tn(days.length - monthly.sourceDays, "{n} newer day not included yet", "{n} newer days not included yet")}` : ""}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{tn(days.length, "Not written yet. GIDEON summarizes what has been collected so far — {n} day in {month}.", "Not written yet. GIDEON summarizes what has been collected so far — {n} days in {month}.", { month: label })}</p>
              )}
              {summarizeError && <p className="mt-2 text-xs font-semibold text-destructive">{summarizeError}</p>}
            </div>

            {/* Days */}
            <div className="divide-y divide-border rounded-2xl border border-border">
              {[...days].reverse().map((d) => {
                const isOpen = open === d.date;
                return (
                  <div key={d.date} className="px-4 py-3">
                    <button type="button" onClick={() => setOpen(isOpen ? null : d.date)} className="flex w-full items-start gap-3 text-left">
                      <span className="mt-0.5 w-[92px] shrink-0 text-xs font-bold text-muted-foreground">{dayLabel(d.date)}</span>
                      <span className="flex-1 text-sm leading-relaxed">
                        {d.summary ? d.summary : <span className="italic text-muted-foreground">{tr("GIDEON hasn't summarized this day yet. The note is below.")}</span>}
                      </span>
                      <ChevronRight className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                    </button>
                    {isOpen && (
                      <div className="mt-2 ml-[104px] rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-foreground whitespace-pre-line">
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{tr("Written at check-out")}</div>
                        {d.reflection}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The status chips of the Submissions list, same five and same order as iOS
// (AttendanceRequestsView.swift → `filters`), so a person switching devices finds the same row.
const REQUEST_FILTERS = ["PENDING", "APPROVED", "REJECTED", "CANCELED", "ALL"] as const;
type RequestFilter = (typeof REQUEST_FILTERS)[number];
const REQUEST_FILTER_LABEL: Record<RequestFilter, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELED: "Canceled", ALL: "All" };
const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Start and end (ms) of the attendance period that contains `nowMs`: the 28th through the 27th,
 *  on the Jakarta calendar — the same cut-off payroll and the streak board use. */
function attendancePeriodBounds(nowMs: number) {
  const j = new Date(nowMs + JAKARTA_OFFSET_MS); // Jakarta wall clock, read through the UTC getters
  const m = j.getUTCMonth() - (j.getUTCDate() < 28 ? 1 : 0); // Date.UTC normalises -1 → December
  const y = j.getUTCFullYear();
  const start = Date.UTC(y, m, 28) - JAKARTA_OFFSET_MS;
  const end = Date.UTC(y, m + 1, 28) - JAKARTA_OFFSET_MS - 1; // the last millisecond of the 27th
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(localeOf(), { timeZone: "Asia/Jakarta", day: "numeric", month: "short" });
  return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
}

/** Lower-case and strip accents, so "rene" finds "René" and "IZIN" finds "izin". */
function foldText(value?: string | null) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function RequestsSection({ canReview, canManage, viewerId }: { canReview: boolean; canManage: boolean; viewerId: string | null }) {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  // null means "the user has not picked a chip" — the default then follows `canReview` once the
  // permission lands, exactly like iOS. A reviewer opens a work queue (Pending); everybody else
  // opens their own history (All), where a rejection and its reason are the thing they came for.
  const [statusFilter, setStatusFilter] = useState<RequestFilter | null>(null);
  const activeFilter: RequestFilter = statusFilter ?? (canReview ? "PENDING" : "ALL");
  // Settled rows are shown for the last 3 days by default — a reviewer's history is the whole
  // workspace, and months of approvals buried the handful anyone is actually asking about. "This
  // period" widens it to the attendance period (28th → 27th). Pending rows are never date-filtered:
  // an undecided request is work no matter how old it is.
  const [range, setRange] = useState<"recent" | "period">("recent");
  const [query, setQuery] = useState("");
  // The row a notification pointed at. Highlighted for a few seconds after it scrolls into view;
  // the highlight is state rather than a CSS animation so it survives a re-render mid-scroll.
  const search = Route.useSearch();
  const focusKey = search.request ? `req-${search.request}` : search.offsite ? `offsite-${search.offsite}` : null;
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // Rejecting is a two-step: click Reject → a reason box opens on that row → Confirm. The server
  // refuses a reason-less rejection, so we collect it before the request is ever sent.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // scope=workspace is a reviewer-only scope: the server 403s anyone without
  // canReviewAttendanceRequests. Asking for it unconditionally meant a plain staff member's
  // Submissions list came back empty — they could file a request and then never see it again, on
  // the one screen built to show it to them. iOS has always picked the scope by permission
  // (AttendanceRequestsView.swift); the web never did.
  const requestsScope = canReview ? "scope=workspace" : "scope=me";
  const requestsQuery = useQuery({ queryKey: ["attendance-requests", requestsScope], queryFn: () => nexusApi.attendanceRequests(requestsScope), retry: 1 });
  const rows = Array.isArray(requestsQuery.data) ? requestsQuery.data : requestsQuery.data?.requests ?? [];
  const pending = rows.filter((r) => (r.status || "").toUpperCase() === "PENDING");
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["attendance-requests"] }); qc.invalidateQueries({ queryKey: ["attendance-today"] }); qc.invalidateQueries({ queryKey: ["attendance-history"] }); };
  const closeReject = () => { setRejectingId(null); setRejectNote(""); };
  const review = useMutation({
    mutationFn: ({ id, action, reviewNote }: { id: string; action: "approve" | "reject" | "cancel"; reviewNote?: string }) => nexusApi.reviewAttendanceRequest(id, action, reviewNote),
    onSuccess: () => { closeReject(); invalidate(); },
  });

  // Offsite check-outs merged into this same queue. The two halves do NOT share a permission:
  // requests answer to `canReviewAttendanceRequests` (a team lead has it, scoped to their team),
  // offsite check-outs to `canManageAttendance` (BoD/OAA only, enforced on both GET and PATCH).
  // Neither is widened here — the query simply isn't run for someone who can't act on it, so a team
  // lead sees the leave/permit half of the queue and never a row they'd only get a 403 from.
  const offsiteQ = useQuery({ queryKey: ["offsite-checkouts", "all"], queryFn: () => nexusApi.offsiteCheckouts("ALL"), retry: false, enabled: canManage });
  const offsiteItems = offsiteQ.data?.items ?? [];
  const offsiteReview = useMutation({ mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => nexusApi.reviewOffsiteCheckout(id, action), onSuccess: () => { qc.invalidateQueries({ queryKey: ["offsite-checkouts"] }); invalidate(); } });
  const pendingTotal = pending.length + offsiteItems.filter((i) => i.approval === "PENDING").length;
  const offsiteStatusLabel = (a?: string | null) => (a === "APPROVED" ? tr("Approved") : a === "REJECTED" ? tr("Rejected") : tr("Pending"));

  // ── One queue, two kinds ────────────────────────────────────────────────────────────────────
  // An offsite check-out is a genuinely different shape — an AttendanceRecord carrying a
  // checkOutApproval, not an AttendanceRequest — but it is the same JOB: something sitting there
  // waiting for a reviewer to decide. Both kinds become entries of one queue, each still approved
  // and rejected through the endpoint that owns it.
  //   status  — matched against the chips; an offsite approval only ever holds three of the five.
  //   decided — when it was decided, "" if nobody has (pending, or withdrawn by its own author).
  //   when    — what the date window reads: the decision if there is one, else when it was filed.
  type QueueEntry =
    | { kind: "request"; key: string; status: string; pending: boolean; dateKey: string; decided: string; when: string; row: (typeof rows)[number] }
    | { kind: "offsite"; key: string; status: string; pending: boolean; dateKey: string; decided: string; when: string; item: (typeof offsiteItems)[number] };

  const dayKey = (value?: string | null) => (value ?? "").slice(0, 10);
  const normStatus = (s?: string | null) => { const u = (s || "").toUpperCase(); return u === "CANCELLED" ? "CANCELED" : u; };
  const entries: QueueEntry[] = [
    ...rows.map((r): QueueEntry => {
      const status = normStatus(r.status);
      return {
        kind: "request", key: `req-${r.id}`, status, pending: status === "PENDING",
        dateKey: dayKey(r.startDate), decided: r.reviewedAt ?? "",
        when: r.reviewedAt ?? r.createdAt ?? r.startDate ?? "", row: r,
      };
    }),
    ...offsiteItems.map((it): QueueEntry => {
      const status = normStatus(it.approval);
      return {
        kind: "offsite", key: `offsite-${it.id}`, status, pending: status === "PENDING",
        dateKey: dayKey(it.attendanceDate), decided: it.approvedAt ?? "",
        when: it.approvedAt ?? it.checkOutAt ?? it.attendanceDate ?? "", item: it,
      };
    }),
  ];

  const period = attendancePeriodBounds(Date.now());
  const windowStart = range === "recent" ? Date.now() - RECENT_WINDOW_MS : period.start;
  const windowed = activeFilter !== "PENDING";
  const needle = foldText(query.trim());
  const inWindow = (e: QueueEntry) => {
    if (!windowed || e.pending) return true;
    const t = Date.parse(e.when);
    return !Number.isFinite(t) || t >= windowStart;
  };
  const matchesQuery = (e: QueueEntry) => {
    if (!needle) return true;
    const name = e.kind === "request" ? e.row.user?.name : e.item.user?.name;
    const reason = e.kind === "request" ? e.row.reason : e.item.reason;
    return foldText(name).includes(needle) || foldText(reason).includes(needle);
  };
  // Pending first — this is a work queue and a settled row is noise — then, within each group, on
  // the scale the group is read on: a pending row by the day it is ABOUT, a settled one by WHEN IT
  // WAS DECIDED, newest first (so the check-out you approved ten seconds ago is at the top of
  // Approved, not wherever its attendance date falls). Same comparator as iOS.
  const byQueueOrder = (a: QueueEntry, b: QueueEntry) =>
    (a.pending === b.pending ? 0 : a.pending ? -1 : 1)
    || (!a.pending && a.decided !== b.decided ? b.decided.localeCompare(a.decided) : 0)
    || b.dateKey.localeCompare(a.dateKey);
  // The entry a notification pointed at is always shown, whatever the chip, window or search say —
  // the tap has to land on THE request.
  const shown = entries
    .filter((e) => e.key === focusKey || ((activeFilter === "ALL" || e.status === activeFilter) && inWindow(e) && matchesQuery(e)))
    .sort(byQueueOrder);

  useEffect(() => {
    if (!focusKey) return;
    const el = document.getElementById(`focus-${focusKey}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(focusKey);
    const t = window.setTimeout(() => setHighlighted(null), 6000);
    return () => window.clearTimeout(t);
  }, [focusKey, entries.length]);
  const focusClass = (key: string) => (highlighted === key ? " rounded-xl ring-2 ring-primary bg-primary/5 transition-shadow" : "");

  const renderOffsite = (it: (typeof offsiteItems)[number]) => {
    const isPending = it.approval === "PENDING";
    // Offsite checkouts have had a four-eyes guard server-side all along; hide the buttons to match
    // so a BoD never clicks Approve on their own and gets a 403 back.
    const isMine = Boolean(viewerId && it.user?.id === viewerId);
    const mapUrl = it.lat != null && it.lng != null ? `https://www.google.com/maps?q=${it.lat},${it.lng}` : null;
    return (
      <div key={`offsite-${it.id}`} id={`focus-offsite-${it.id}`} className={"flex flex-wrap items-center gap-3 px-5 py-3" + focusClass(`offsite-${it.id}`)}>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusTone(it.approval)}`}>{offsiteStatusLabel(it.approval)}</span>
        <div className="min-w-0 flex-1">
          {/* The kind badge is what keeps the merged queue readable: these rows sit shoulder to
              shoulder with leave/permit requests, and a reviewer has to see at a glance that this one
              is a check-out from outside the geofence, judged on distance and not on a date range. */}
          <div className="text-sm font-semibold">
            <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 align-middle dark:bg-amber-500/15 dark:text-amber-300">{tr("Offsite check-out")}</span>
            {it.user?.name ? <span className="font-normal text-muted-foreground">· {it.user.name}</span> : null}
          </div>
          <div className="text-xs text-muted-foreground">{fmtDateShort(it.attendanceDate)} · {tr("out {time}", { time: fmtTime(it.checkOutAt) })}{it.reason ? ` · ${it.reason}` : ""}</div>
          <div className="text-xs text-muted-foreground">
            {it.distanceMeters != null ? tr("±{m}m from {office}", { m: Math.round(it.distanceMeters), office: it.officeName ?? tr("the office") }) : ""}
            {it.address ? `${it.distanceMeters != null ? " · " : ""}${it.address}` : ""}
            {mapUrl && <> · <a href={mapUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">{tr("view map")}</a></>}
            {it.photoUrl && <> · <a href={it.photoUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">{tr("photo")}</a></>}
            {!isPending && it.approverName ? ` · ${tr("by {name}", { name: it.approverName })}` : ""}
          </div>
        </div>
        {canManage && isPending && !isMine && (
          <div className="flex items-center gap-1.5">
            <button disabled={offsiteReview.isPending} onClick={() => offsiteReview.mutate({ id: it.id, action: "approve" })} className="rounded-lg bg-success/10 px-2.5 py-1 text-xs font-semibold text-success transition-colors hover:bg-success/20 active:scale-[0.97] disabled:opacity-50">{tr("Approve")}</button>
            <button disabled={offsiteReview.isPending} onClick={() => offsiteReview.mutate({ id: it.id, action: "reject" })} className="rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.97] disabled:opacity-50">{tr("Reject")}</button>
          </div>
        )}
      </div>
    );
  };

  const renderRequest = (r: (typeof rows)[number]) => {
    const isPending = (r.status || "").toUpperCase() === "PENDING";
    // Your own request offers Cancel, never Approve/Reject — the server refuses self-review, so
    // showing the buttons would only produce a 403 nobody can act on.
    const isMine = Boolean(viewerId && r.user?.id === viewerId);
    const typeKey = (r.type || "").toUpperCase();
    // New requests are one day each; older ones may still span several, so the range is kept for them.
    const sameDay = dayKey(r.startDate) === dayKey(r.endDate) || !r.endDate;
    return (
      <div key={r.id} id={`focus-req-${r.id}`} className={"flex flex-wrap items-center gap-3 px-5 py-3" + focusClass(`req-${r.id}`)}>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusTone(r.status)}`}>{statusLabel(r.status)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{REQ_LABEL[typeKey] ? tr(REQ_LABEL[typeKey]) : statusLabel(r.type)} {r.user?.name ? <span className="font-normal text-muted-foreground">· {r.user.name}</span> : null}</div>
          <div className="text-xs text-muted-foreground">{fmtDateShort(r.startDate)}{sameDay ? "" : ` → ${fmtDateShort(r.endDate)}`}{r.reason ? ` · ${attendanceReasonText(r.reason)}` : ""}</div>
          {/* Permit evidence, right under the reason — this is what separates a real errand from a
              forgotten check-in, and it's useless if the approver has to click to find it. */}
          {(r.submittedAddress || r.submittedLat != null || r.reportDelayMinutes != null) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {r.reportDelayMinutes != null && r.reportDelayMinutes > 0 && (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-bold text-destructive">
                  {Math.floor(r.reportDelayMinutes / 60) > 0
                    ? tr("Filed {h}h {m}m after shift start", { h: Math.floor(r.reportDelayMinutes / 60), m: r.reportDelayMinutes % 60 })
                    : tr("Filed {m}m after shift start", { m: r.reportDelayMinutes % 60 })}
                </span>
              )}
              {r.reportDelayMinutes === 0 && (
                <span className="rounded-full bg-success/10 px-2 py-0.5 font-bold text-success">{tr("Filed before shift start")}</span>
              )}
              {r.submittedAddress && <span className="text-muted-foreground">{r.submittedAddress}</span>}
              {r.submittedLat != null && r.submittedLng != null && (
                <a href={`https://www.google.com/maps?q=${r.submittedLat},${r.submittedLng}`} target="_blank" rel="noreferrer"
                   className="font-semibold text-primary underline-offset-2 hover:underline">{tr("view map")}</a>
              )}
            </div>
          )}
          {r.supportingDocumentUrl && (
            <div className="mt-1.5"><SupportingDocument url={r.supportingDocumentUrl} name={r.supportingDocumentName} type={r.type} /></div>
          )}
        </div>
        {canReview && isPending && rejectingId !== r.id && (
          <div className="flex items-center gap-1.5">
            <button disabled={review.isPending} onClick={() => review.mutate({ id: r.id, action: "approve" })} className="rounded-lg bg-success/10 px-2.5 py-1 text-xs font-semibold text-success transition-colors hover:bg-success/20 active:scale-[0.97] disabled:opacity-50">{tr("Approve")}</button>
            <button disabled={review.isPending} onClick={() => { setRejectingId(r.id); setRejectNote(""); }} className="rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.97] disabled:opacity-50">{tr("Reject")}</button>
          </div>
        )}
        {(!canReview || isMine) && isPending && rejectingId !== r.id && (
          <button disabled={review.isPending} onClick={() => review.mutate({ id: r.id, action: "cancel" })} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.97] disabled:opacity-50">{tr("Cancel")}</button>
        )}

        {/* The reason box. Rejecting used to be one click and the requester learned nothing; now the
            reviewer types WHY, and that text is what lands in their notification and on this row. */}
        {canReview && isPending && rejectingId === r.id && (
          <div className="w-full space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-destructive">{tr("Reason for rejection — {name} will see this", { name: r.user?.name ?? tr("the requester") })}</div>
            <textarea
              autoFocus
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder={tr("e.g. The photo is unreadable. Please file again with a clearer one.")}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-destructive"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={review.isPending || rejectNote.trim().length < 3}
                onClick={() => review.mutate({ id: r.id, action: "reject", reviewNote: rejectNote })}
                className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground transition-colors hover:bg-destructive/90 active:scale-[0.97] disabled:opacity-40"
              >
                {review.isPending ? tr("Rejecting…") : tr("Confirm reject")}
              </button>
              <button disabled={review.isPending} onClick={closeReject} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.97] disabled:opacity-50">{tr("Cancel")}</button>
              <span className="text-[11px] text-muted-foreground">{rejectNote.trim().length < 3 ? tr("A reason is required.") : `${rejectNote.trim().length}/1000`}</span>
              {review.isError && <span className="text-[11px] font-semibold text-destructive">{review.error instanceof ApiError ? review.error.message : tr("Couldn't save the rejection.")}</span>}
            </div>
          </div>
        )}

        {/* Who settled this and when — drawn for every decided row, note or no note. Approving
            without typing a note left the row saying only "Approved", so nobody could tell who had
            done it or when, and a question about a decision had nowhere to start. */}
        {!isPending && (
          <div className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {(() => {
                const st = (r.status || "").toUpperCase();
                const verb = st === "APPROVED" ? tr("Approved") : st === "REJECTED" ? tr("Rejected") : tr("Canceled");
                const who = r.reviewedBy?.name ? tr("by {name}", { name: r.reviewedBy.name }) : tr("automatically");
                const when = r.reviewedAt ? fmtDateTime(r.reviewedAt) : null;
                return [verb, who, when].filter(Boolean).join(" · ");
              })()}
            </div>
            {r.reviewNote && (
              <p className="mt-1 whitespace-pre-wrap text-xs">
                <span className="font-semibold">{(r.status || "").toUpperCase() === "REJECTED" ? tr("Reason for rejection:") : tr("Note:")}{" "}</span>
                “{r.reviewNote}”
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderEntry = (e: QueueEntry) => (e.kind === "offsite" ? renderOffsite(e.item) : renderRequest(e.row));
  const rangeLabel = range === "recent" ? tr("the last 3 days") : tr("this period ({range})", { range: period.label });

  // Why this chip is empty, and the one tap that most likely finds what the person is after.
  const emptyFiltered = (() => {
    if (needle) {
      return {
        title: tr("No matches"),
        message: windowed
          ? tr("No name or reason matches “{q}” in {range}.", { q: query.trim(), range: rangeLabel })
          : tr("No pending request matches “{q}”.", { q: query.trim() }),
        action: windowed && range === "recent"
          ? <EmptyAction onClick={() => setRange("period")}>{tr("Show this period")}</EmptyAction>
          : <EmptyAction onClick={() => setQuery("")}>{tr("Clear search")}</EmptyAction>,
      };
    }
    if (!windowed) {
      return {
        title: tr("Nothing waiting on a decision"),
        message: tr("Every request has been decided. Decided ones are under the other filters."),
        action: <EmptyAction onClick={() => setStatusFilter("ALL")}>{tr("Show all")}</EmptyAction>,
      };
    }
    if (range === "recent") {
      return {
        title: tr("Nothing in the last 3 days"),
        message: tr("Decided requests are shown for the last 3 days, by when they were decided. Older ones are in this period's view."),
        action: <EmptyAction onClick={() => setRange("period")}>{tr("Show this period")}</EmptyAction>,
      };
    }
    return {
      title: tr("Nothing this period"),
      message: activeFilter === "ALL"
        ? tr("No requests between {range}.", { range: period.label })
        : tr("No {status} requests between {range}.", { status: tr(REQUEST_FILTER_LABEL[activeFilter]).toLowerCase(), range: period.label }),
      action: activeFilter === "ALL" ? undefined : <EmptyAction onClick={() => setStatusFilter("ALL")}>{tr("Show all")}</EmptyAction>,
    };
  })();

  return (
    <section className="rounded-[28px] border border-border bg-card shadow-soft overflow-clip">
      <div data-snap-row className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{tr("Requests and approvals")}</h2>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? tr("One queue: leave, sick and permit requests plus offsite check-outs waiting on a decision.")
              : canReview
                ? tr("Review pending requests (leave, sick, permit, day off) and submit your own.")
                : tr("Submit leave, sick or permit requests.")}
          </p>
        </div>
        <button onClick={() => setComposerOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><ClipboardCheck className="h-3.5 w-3.5" /> {tr("New request")}</button>
      </div>
      {entries.length > 0 && (
        <div className="space-y-2 border-b border-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {REQUEST_FILTERS.map((f) => {
              const on = activeFilter === f;
              return (
                <button key={f} type="button" onClick={() => setStatusFilter(f)}
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-all active:scale-[0.97]",
                    on ? "bg-primary/10 text-primary ring-primary/40" : "bg-background text-muted-foreground ring-border hover:text-foreground")}>
                  {tr(REQUEST_FILTER_LABEL[f])}{f === "PENDING" && pendingTotal > 0 ? ` (${pendingTotal})` : ""}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-48">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Search name or reason")} aria-label={tr("Search requests by name or reason")}
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-8 text-sm outline-none focus:border-primary" />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label={tr("Clear search")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
            {windowed && (
              <div className="inline-flex shrink-0 rounded-lg border border-border bg-background p-0.5 text-xs font-semibold" role="group" aria-label={tr("Date range")}>
                <button type="button" onClick={() => setRange("recent")} className={cn("rounded-md px-2.5 py-1 transition-colors", range === "recent" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{tr("Last 3 days")}</button>
                <button type="button" onClick={() => setRange("period")} title={period.label} className={cn("rounded-md px-2.5 py-1 transition-colors", range === "period" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{tr("This period")}</button>
              </div>
            )}
          </div>
          {windowed && (
            <p className="text-[11px] text-muted-foreground">
              {activeFilter === "ALL"
                ? tr("Decided requests from {range}, by decision time; pending ones are always listed.", { range: rangeLabel })
                : tr("Decided requests from {range}, by decision time.", { range: rangeLabel })}
            </p>
          )}
        </div>
      )}
      <div className="divide-y divide-border">
        {requestsQuery.isLoading && <div className="px-5 py-4 text-sm text-muted-foreground">{tr("Loading requests…")}</div>}
        {!requestsQuery.isLoading && entries.length === 0 && (
          <div className="p-4">
            <EmptyState icon={ClipboardCheck} compact title={canReview ? tr("Nothing to review yet") : tr("No requests yet")}
              message={canReview
                ? tr("Leave, sick days, permits and offsite check-outs from your people appear here as soon as they're filed, with Approve and Reject right on the row.")
                : tr("Leave, sick days, permits and days off you file show up here with their status, and your approver is told as soon as you send one.")} />
            {/* No second "New request" here: the section header's button is right above (UI tour run 14, R14-WM-18). */}
          </div>
        )}
        {!requestsQuery.isLoading && entries.length > 0 && shown.length === 0 && (
          <div className="p-4">
            <EmptyState icon={Search} compact tone="muted" title={emptyFiltered.title} message={emptyFiltered.message} action={emptyFiltered.action} />
          </div>
        )}
        {/* One list: requests and offsite check-outs, pending first and then newest decision first. */}
        {shown.map(renderEntry)}
      </div>
      {canReview && pendingTotal > 0 && <div className="border-t border-border bg-warning/10 px-5 py-2 text-xs font-semibold text-warning-foreground dark:text-warning">{tr("{n} waiting for review", { n: pendingTotal })}</div>}
      {composerOpen && <RequestComposer viewerId={viewerId} onClose={() => setComposerOpen(false)} onCreated={invalidate} />}
    </section>
  );
}

/**
 * Tanggal mulai kerja per orang — the input behind annual-leave eligibility.
 *
 * BoD-only, and deliberately a plain list of date fields rather than anything clever: this is data
 * that only a human knows. NEXUS launched in April 2026, so nothing already stored measures how long
 * someone has actually worked here, and guessing from account age would rule out everyone who
 * genuinely qualifies.
 */
const ALL_REQUEST_TYPES = ["LEAVE", "SICK", "PERMIT", "DAY_OFF", "RED_DATE"];

function RequestComposer({ onClose, onCreated, viewerId }: { onClose: () => void; onCreated: () => void; viewerId: string | null }) {
  // Today on the Jakarta calendar. toISOString() is UTC, so before 07:00 WIB it still said
  // yesterday — and a permit could be backdated a day through the date picker's own minimum.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  // A BoD either files for themselves or grants a request to someone else. Two different jobs with
  // two different rulebooks, so they are two explicit modes rather than a type that happens to
  // reveal a "grant to" picker.
  const [mode, setMode] = useState<"self" | "grant">("self");
  const [type, setType] = useState("DAY_OFF");
  // Every request is ONE day, for everyone — the grant mode included. The server still takes a
  // startDate/endDate pair; both are this date.
  const [date, setDate] = useState(today);
  // Annual leave is picked as several dates (owner, 29 Sep 2026), capped at the days left; each run of
  // consecutive dates goes to the server as one request.
  const [leaveFrom, setLeaveFrom] = useState("");
  const [leaveTo, setLeaveTo] = useState("");
  const [reason, setReason] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);

  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const todayQ = useQuery({ queryKey: ["attendance-today"], queryFn: () => nexusApi.attendanceToday(), staleTime: 30_000 });
  const myRole = wsm.data?.role ?? "STAFF";
  const canGrant = myRole === "BOD" || myRole === "ONE_ABOVE_ALL"; // BoD and up
  const granting = canGrant && mode === "grant";
  const leave = todayQ.data?.annualLeave;
  const leaveUsable = Boolean(leave?.eligible && (leave?.remaining ?? 0) > 0);
  const redQuota = todayQ.data?.redDateQuota ?? 0;
  const redLeft = Math.max(0, redQuota - (todayQ.data?.redDateUsedThisMonth ?? 0));
  // Filing for YOURSELF follows the staff rules whatever your role: annual leave needs a year of
  // service AND days left; a public holiday needs a quota for the month with days left. Offering
  // either without that is a button whose only outcome is a refusal. Granting to someone else keeps
  // every type — that is a BoD recording a decision, and the server lets a grant skip the quotas.
  const TYPES = granting
    ? ALL_REQUEST_TYPES
    : [
        ...(leaveUsable ? ["LEAVE"] : []),
        "SICK", "PERMIT", "DAY_OFF",
        ...(redLeft > 0 ? ["RED_DATE"] : []),
      ];
  useEffect(() => { if (!TYPES.includes(type)) setType("DAY_OFF"); }, [TYPES.join(","), type]); // eslint-disable-line react-hooks/exhaustive-deps
  const leaveBlocked = !granting && type === "LEAVE" && !leaveUsable;
  const remainingDays =
    type === "DAY_OFF" ? Math.max(0, (todayQ.data?.dayOffQuota ?? 0) - (todayQ.data?.dayOffUsedThisMonth ?? 0))
    : type === "RED_DATE" ? redLeft
    : type === "LEAVE" ? (leave?.remaining ?? null)
    : null;
  // Said before the submit, not after: a day asked for with none left is caught here.
  const quotaProblem = !granting && remainingDays != null && remainingDays < 1
    ? tr("You have no {type} days left.", { type: tr(REQ_LABEL[type] ?? "days").toLowerCase() })
    : null;
  const TYPE_ICON: Record<string, typeof Sun> = { LEAVE: Sun, SICK: HeartPulse, PERMIT: Hand, DAY_OFF: Moon, RED_DATE: Flag };
  const typeHint = granting
    ? tr("Granted to the person you pick below and approved straight away; it doesn't use up their quota.")
    : type === "LEAVE" ? (!leave ? tr("Uses one day of your annual leave.") : !leave.eligible ? (leave.reason ?? tr("Annual leave needs 12 months of service.")) : tr("Annual leave: {left} of {quota} days left this year.", { left: leave.remaining, quota: leave.quota }))
    : type === "SICK" ? tr("A photo of the doctor's note is required. Today or later — a past day is filed by a board member.")
    : type === "PERMIT" ? tr("Today or later, with a photo and your location.")
    : type === "DAY_OFF" ? tr("Day off: {left} of {quota} left this period.", { left: remainingDays ?? 0, quota: todayQ.data?.dayOffQuota ?? 0 })
    : tr("Public holiday: {left} of {quota} left this month.", { left: remainingDays ?? 0, quota: redQuota });
  const pickType = (t: string) => {
    setType(t);
    if (t !== "SICK" && t !== "PERMIT") setAttachment(null);
    // A permit cannot be backdated: bring the date into line the moment the type changes, rather
    // than at submit time.
    if (date < today) setDate(today);
  };
  const pickMode = (m: "self" | "grant") => { setMode(m); if (m === "self") setTargetUserId(""); };
  const leaveNote = !leave || granting
    ? null
    : !leave.eligible
      ? leave.reason
      : leave.remaining > 0
        ? tr("{year} annual leave: {left} of {quota} days left.", { year: leave.year, left: leave.remaining, quota: leave.quota })
        : tr("{year} annual leave is used up ({quota} days taken).", { year: leave.year, quota: leave.quota });
  // A sick day filed for yourself needs the doctor's note; a permit carries the same evidence a
  // check-in does: photo + coordinates + when it was filed. Without it, a permit was the cheapest
  // way to erase an attendance penalty — nothing to verify.
  // A sick day needs the note for everyone filing their own, a BoD included; only a grant for
  // somebody else is exempt (owner, 29 Sep 2026).
  // Photo required for sick AND permit when filing your own, a BoD included (owner, 29 Sep 2026).
  const attachmentRequired = (type === "SICK" || type === "PERMIT") && !granting;
  // Annual leave is a range: pick the first and the last day; every day between counts, capped at the
  // days left (owner, 29 Sep 2026).
  const multiLeave = type === "LEAVE" && !granting;
  const leaveDayCount = leaveFrom && leaveTo && leaveTo >= leaveFrom
    ? Math.round((Date.parse(leaveTo + "T00:00:00Z") - Date.parse(leaveFrom + "T00:00:00Z")) / 86_400_000) + 1
    : leaveFrom ? 1 : 0;
  const leaveCapNote = multiLeave && remainingDays != null && leaveDayCount > remainingDays
    ? tr("That's {n} days — you have {left} left.", { n: leaveDayCount, left: remainingDays })
    : null;
  const leaveDates = leaveFrom ? [leaveFrom] : [];
  const leaveBlocks: Array<[string, string]> = leaveFrom ? [[leaveFrom, leaveTo && leaveTo >= leaveFrom ? leaveTo : leaveFrom]] : [];
  const showAttachment = type === "SICK" || type === "PERMIT";
  const needsLocation = !canGrant && type === "PERMIT";
  const permitBackdated = !granting && date < today;
  const shiftStart = todayQ.data?.myShift?.startTime ?? null;
  // Preview of how late this filing is, so the warning appears BEFORE submitting rather than as a
  // surprise on the approver's screen.
  const lateReportPreview = (() => {
    if (type !== "PERMIT" || canGrant || date !== today || !shiftStart) return null;
    const [h, m] = shiftStart.split(":").map(Number);
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
    return mins > 0 ? mins : null;
  })();

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const askLocation = () => {
    if (!navigator.geolocation) { setGeoError(tr("This browser can't read your location.")); return; }
    setGeoBusy(true); setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoBusy(false); },
      () => { setGeoError(tr("Location refused. Turn location on for this browser first.")); setGeoBusy(false); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  // Ask as soon as a permit is picked — a permission prompt at submit time is where people give up.
  useEffect(() => { if (needsLocation && !coords) askLocation(); }, [needsLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  // One idempotency key per submit (16 Oct 2026): kept while the form says the same thing, so a retry after a
  // timeout or a second click sends the same key and the server hands back the request it already stored. A
  // changed form is a new submit with a new key.
  const submitKey = useRef<{ form: string; key: string } | null>(null);
  const keyForSubmit = () => {
    const form = JSON.stringify([type, date, leaveBlocks, reason.trim(), granting ? targetUserId : "", attachment?.name ?? "", attachment?.size ?? 0]);
    if (submitKey.current?.form !== form) submitKey.current = { form, key: newClientRequestId() };
    return submitKey.current.key;
  };

  const create = useMutation({
    mutationFn: async () => {
      const key = keyForSubmit();
      if (multiLeave) {
        // One request per run of consecutive dates; stop at the first refusal and say which dates it hit.
        // Each run has its own key, so a retry replays the runs already stored and files the rest.
        for (const [i, [startDate, endDate]] of leaveBlocks.entries()) {
          await nexusApi.createAttendanceRequest({ type, startDate, endDate, reason: reason.trim(), supportingDocument: null, lat: null, lng: null, clientRequestId: `${key}-${i}` });
        }
        return;
      }
      await nexusApi.createAttendanceRequest({ type, startDate: date, endDate: date, reason: reason.trim(), targetUserId: granting && targetUserId ? targetUserId : undefined, supportingDocument: attachment, lat: coords?.lat ?? null, lng: coords?.lng ?? null, clientRequestId: key });
    },
    onSuccess: () => { onCreated(); onClose(); },
  });

  const otherMembers = (wsm.data?.members ?? []).filter((m) => m.userId && m.userId !== viewerId);
  const missingTarget = granting && !targetUserId;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <EscClose onClose={onClose} />
      <div role="dialog" aria-modal="true" aria-label={granting ? tr("Grant a request to someone") : tr("New attendance request")} className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold tracking-tight">{granting ? tr("Grant a request to someone") : tr("New attendance request")}</h2>
        {!granting && <p className="mt-1 text-xs text-muted-foreground">{tr("One day per request (annual leave: a range of days). Only the types you can use are listed.")}</p>}
        {canGrant && (
          <div className="mt-3 inline-flex rounded-xl border border-border bg-background p-0.5 text-xs font-semibold" role="group" aria-label={tr("Who is this for")}>
            <button type="button" onClick={() => pickMode("self")} className={cn("rounded-lg px-3 py-1.5 transition-colors", !granting ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{tr("For myself")}</button>
            <button type="button" onClick={() => pickMode("grant")} className={cn("rounded-lg px-3 py-1.5 transition-colors", granting ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{tr("Grant to someone")}</button>
          </div>
        )}
        <div className="mt-4 space-y-3">
          {granting && (
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{tr("Grant to")}
              <SelectPicker variant="field" value={targetUserId} onChange={setTargetUserId} placeholder={tr("— Pick a person —")} ariaLabel={tr("Grant to")} options={otherMembers.map((m) => ({ value: m.userId, label: m.name || m.email }))} className="mt-1 flex w-full rounded-xl px-3 py-2 font-semibold normal-case tracking-normal text-foreground" />
            </label>
          )}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{tr("Type")}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TYPES.map((t) => {
                const Icon = TYPE_ICON[t] ?? Flag;
                const on = type === t;
                return (
                  <button key={t} type="button" onClick={() => pickType(t)}
                    className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-all active:scale-[0.97]",
                      on ? "bg-primary/10 text-primary ring-primary/40" : "bg-background text-muted-foreground ring-border hover:text-foreground")}>
                    <Icon className="h-3.5 w-3.5" />{REQ_LABEL[t] ? tr(REQ_LABEL[t]) : statusLabel(t)}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{typeHint}
            </p>
          </div>
          {needsLocation && (
            <div className="space-y-1.5 rounded-xl border border-border bg-background/60 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{tr("Permit evidence")}</div>
              <p className="text-xs text-muted-foreground">{tr("A permit needs a photo and your location, and is best filed before your shift starts.")}</p>
              {coords ? (
                <p className="text-xs font-semibold text-success">{tr("Location locked ({coords})", { coords: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` })}</p>
              ) : (
                <button type="button" onClick={askLocation} disabled={geoBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:border-primary disabled:opacity-50">
                  {geoBusy && <Loader2 className="h-3 w-3 animate-spin" />}{geoBusy ? tr("Getting your location…") : tr("Use my location")}
                </button>
              )}
              {geoError && <p className="text-xs font-semibold text-destructive">{geoError}</p>}
              {permitBackdated && (
                <p className="text-xs font-semibold text-destructive">{tr("A permit can't be filed for a day that has passed. Ask the board to enter it if it's really needed.")}</p>
              )}
              {lateReportPreview != null && !permitBackdated && (
                <p className="text-xs font-semibold text-warning">
                  {tr("You're filing {time} after your shift started ({start}). This is recorded and your approver sees it.", { time: `${Math.floor(lateReportPreview / 60) > 0 ? `${Math.floor(lateReportPreview / 60)}h ` : ""}${lateReportPreview % 60}m`, start: shiftStart ?? "" })}
                </p>
              )}
            </div>
          )}
          {type === "LEAVE" && leaveNote && (
            // Colour follows the MESSAGE: an empty or not-yet-earned allowance reads red.
            <p className={cn("rounded-xl px-3 py-2 text-xs font-semibold",
              (!leave?.eligible || (leave?.remaining ?? 0) === 0)
                ? "bg-destructive/10 text-destructive"
                : "bg-success/10 text-success")}>{leaveNote}</p>
          )}
          {multiLeave ? (
            <div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{tr("From")}
                  <DateField value={leaveFrom || null} min={today} ariaLabel={tr("From")} placeholder={tr("Pick a date")} onChange={(v) => { const x = v ?? ""; setLeaveFrom(x); if (leaveTo && x > leaveTo) setLeaveTo(""); }}
                    className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm normal-case tracking-normal text-foreground hover:bg-background" />
                </label>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{tr("Until")}
                  <DateField value={leaveTo || null} min={leaveFrom || today} ariaLabel={tr("Until")} placeholder={tr("Pick a date")} onChange={(v) => setLeaveTo(v ?? "")}
                    className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm normal-case tracking-normal text-foreground hover:bg-background" />
                </label>
              </div>
              {leaveFrom && <p className="mt-1 text-[11px] font-semibold text-foreground">{fmtDate(leaveFrom)}{leaveTo && leaveTo > leaveFrom ? ` – ${fmtDate(leaveTo)}` : ""} · {tr(leaveDayCount === 1 ? "{n} day" : "{n} days", { n: leaveDayCount })}</p>}
              {leaveCapNote && <p className="mt-1 text-[11px] font-semibold text-destructive">{leaveCapNote}</p>}
            </div>
          ) : (
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{tr("Date")}
            <DateField value={date || null} min={!granting ? today : undefined} ariaLabel={tr("Date")} placeholder={tr("Pick a date")}
              onChange={(v) => setDate(v ?? "")}
              className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm normal-case tracking-normal text-foreground hover:bg-background" />
          </label>
          )}
          {!granting && remainingDays != null && (
            <div className="flex items-center gap-2">
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums", quotaProblem ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>{multiLeave ? tr(leaveDayCount === 1 ? "{n} day" : "{n} days", { n: leaveDayCount }) : tr("{n} day", { n: 1 })}</span>
              <span className="text-xs text-muted-foreground">{tr("{n} left", { n: remainingDays })}</span>
            </div>
          )}
          {quotaProblem && (
            <p className="flex items-start gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{quotaProblem}
            </p>
          )}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={tr("Reason or context…")} className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          {showAttachment && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {type === "SICK"
                  ? (attachmentRequired ? tr("Doctor’s note photo (required)") : tr("Doctor’s note photo (optional)"))
                  : (attachmentRequired ? tr("Supporting photo (required)") : tr("Supporting photo (optional)"))}
              </label>
              <label className={cn("mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm transition-colors hover:border-primary", attachment ? "border-primary/50 bg-primary/5" : "border-border")}>
                <Camera className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className={cn("min-w-0 flex-1 truncate", attachment ? "font-semibold" : "text-muted-foreground")}>{attachment ? attachment.name : tr("Pick a photo or file (max 10 MB)")}</span>
                {attachment && <button type="button" aria-label={tr("Remove file")} onClick={(e) => { e.preventDefault(); setAttachment(null); }} className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>}
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f && f.size > 10 * 1024 * 1024) { alert(tr("Max 10 MB.")); return; } setAttachment(f); e.target.value = ""; }} />
              </label>
              {attachmentRequired && !attachment && <p className="mt-1 text-[11px] font-semibold text-destructive">{type === "SICK" ? tr("A doctor’s note photo is required.") : tr("A photo is required.")}</p>}
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button disabled={reason.trim().length < 3 || (attachmentRequired && !attachment) || (needsLocation && !coords) || permitBackdated || leaveBlocked || Boolean(quotaProblem) || missingTarget || (multiLeave && (leaveDates.length === 0 || Boolean(leaveCapNote))) || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {granting ? tr("Grant {type}", { type: tr(REQ_LABEL[type] ?? "request").toLowerCase() }) : tr("Submit request")}</button>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">{tr("Cancel")}</button>
          {create.isError && <span className="text-xs font-semibold text-destructive">{(create.error as Error)?.message ?? tr("Couldn’t send the request.")}</span>}
        </div>
      </div>
    </div>
  );
}

function statusTone(status?: string | null) {
  const s = (status || "").toUpperCase();
  if (s === "APPROVED") return "bg-success/15 text-success";
  if (s === "REJECTED" || s === "CANCELED") return "bg-destructive/15 text-destructive";
  return "bg-warning/15 text-warning-foreground dark:text-warning";
}
/** "23 Sep · 19:04" in Jakarta time, for the moment a request was settled. */
function fmtDateTime(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString(localeOf(), { timeZone: "Asia/Jakarta", day: "numeric", month: "short" })} · ${fmtTime(value)}`;
}

function fmtDateShort(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(localeOf(), { month: "short", day: "numeric" });
}

function AttendanceActionCard({ checkedIn, checkedOut, checkInAt, checkOutAt, officeName, checkOutApproval, pendingCheckout, disabled, loading, workedMinutes, noGeofence, coveredBy }: { checkedIn: boolean; checkedOut: boolean; checkInAt?: string | null; checkOutAt?: string | null; officeName?: string | null; checkOutApproval?: string | null; pendingCheckout?: { attendanceDate?: string | null; checkInAt?: string | null; officeName?: string | null } | null; disabled: boolean; loading?: boolean; workedMinutes?: number | null; noGeofence?: boolean; coveredBy?: string | null }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [reflection, setReflection] = useState("");
  const [message, setMessage] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const lastOut = useRef<AttendanceActionPayload | null>(null);
  const [offsitePrompt, setOffsitePrompt] = useState<{ officeName: string; distanceMeters: number } | null>(null);
  const [offsiteReason, setOffsiteReason] = useState("");
  // Only an Android phone's browser takes attendance (owner, 2 Oct 2026); iPhone/iPad and laptops are
  // shown the card up front, and the server's 403 (USE_IOS_APP / USE_PHONE_APP) switches to it too.
  const [iosOnly, setIosOnly] = useState(() => !browserMayTakeAttendance());

  // The selfie comes from the face check (SelfieCapture opens LivenessCapture, and falls back to the
  // plain camera / file picker only where the face check cannot run). Opened by the one button.
  const selfieRef = useRef<SelfieCaptureHandle>(null);
  const pendingMode = useRef<"check-in" | "check-out" | null>(null);
  const press = useAttendancePress();
  const officesQ = useQuery({ queryKey: ["attendance-offices"], queryFn: nexusApi.attendanceOffices, retry: 1 });
  const errOf = (e: unknown, fb: string) => (e instanceof ApiError ? ((e.payload as { error?: string } | null)?.error ?? fb) : fb);
  const atOf = (iso?: string | null) => (iso ? fmtTime(iso) : fmtTime(new Date().toISOString()));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["attendance-today"] });
    qc.invalidateQueries({ queryKey: ["attendance-history"] });
    qc.invalidateQueries({ queryKey: ["my-penalties"] });
  };
  const checkIn = useMutation({
    mutationFn: (payload: AttendanceActionPayload) => nexusApi.attendanceCheckIn(payload),
    onSuccess: (data) => { refresh(); setNotes(""); press.succeed(successTitle("in", atOf(data?.record?.checkInAt), data?.record)); },
    onError: (e) => { if (isUseIosAppError(e)) { press.set(null); setIosOnly(true); setMessage(""); return; } press.fail(errOf(e, tr("Check-in failed.")), "in"); },
  });
  const checkOut = useMutation({
    mutationFn: (payload: AttendanceActionPayload) => nexusApi.attendanceCheckOut(payload),
    onSuccess: (data) => {
      refresh(); setNotes(""); setOffsitePrompt(null); setOffsiteReason(""); setReflection("");
      if (data?.pendingApproval) { press.set(null); setOkMessage(tr("Offsite check-out sent — waiting for board approval.")); }
      else { setOkMessage(""); press.succeed(successTitle("out", atOf(data?.record?.checkOutAt), data?.record)); }
    },
    onError: (e) => {
      if (isUseIosAppError(e)) { press.set(null); setIosOnly(true); setMessage(""); return; }
      const payload = e instanceof ApiError ? (e.payload as { code?: string; officeName?: string; distanceMeters?: number } | null) : null;
      if (e instanceof ApiError && e.status === 422 && payload?.code === "OUTSIDE_RADIUS") {
        press.set(null); setMessage(""); setOffsiteReason("");
        setOffsitePrompt({ officeName: payload.officeName ?? tr("the office"), distanceMeters: payload.distanceMeters ?? 0 });
      } else { press.fail(errOf(e, tr("Check-out failed.")), "out"); }
    },
  });
  const submitOffsite = () => { if (!lastOut.current || !offsiteReason.trim()) return; press.set({ step: "sending", place: tr("Outside the office · with your reason") }); checkOut.mutate({ ...lastOut.current, offsite: true, reason: offsiteReason.trim() }); };
  const active = checkIn.isPending || checkOut.isPending;
  const busy = active || locating || press.busy;
  // A forgotten previous-day check-out blocks today's check-in — force check-out mode for it.
  const forcePending = Boolean(pendingCheckout);
  const mode = forcePending ? "check-out" : !checkedIn ? "check-in" : checkedOut ? "done" : "check-out";
  const pendingDateLabel = pendingCheckout?.attendanceDate ? fmtDate(pendingCheckout.attendanceDate) : "";
  const effOfficeName = forcePending ? pendingCheckout?.officeName : officeName;
  const effCheckInAt = forcePending ? pendingCheckout?.checkInAt : checkInAt;

  const reflectionCount = reflection.trim().length;
  const day: DayState =
    loading ? { kind: "loading" }
    : checkOutApproval === "PENDING" && !forcePending ? { kind: "waiting-approval" }
    : mode === "check-out" ? { kind: "check-out", reflectionCount, previousDay: forcePending }
    : mode === "done" ? { kind: "done", line: `${tr("Done for today")}${workedLabel(workedMinutes) ? ` · ${tr("worked {time}", { time: workedLabel(workedMinutes) ?? "" })}` : ""}`, times: `${tr("In {time}", { time: fmtTime(checkInAt) })} · ${tr("Out {time}", { time: fmtTime(checkOutAt) })}` }
    : { kind: "check-in", hint: noGeofence ? tr("Any location — check in from anywhere") : tr("Check in with a selfie at the office.") };

  // The one button: face check first, then the position, then the upload — each drawn in the button.
  function start(m: "check-in" | "check-out") {
    setMessage(""); setOkMessage(""); setOffsitePrompt(null); press.set(null);
    if (disabled || busy) return;
    if (m === "check-out" && reflectionCount < REFLECTION_MIN) return; // the button is locked until then; the server checks again
    pendingMode.current = m;
    selfieRef.current?.open();
  }
  function onPress() {
    if (press.phase?.step === "failed") { start(press.phase.mode === "in" ? "check-in" : "check-out"); return; } // retry = a fresh face check
    if (mode === "check-in" || mode === "check-out") start(mode);
  }
  function submit(selfie: File) {
    const m = pendingMode.current;
    pendingMode.current = null;
    if (!m) return;
    setLocating(true);
    void (async () => {
      await press.hold({ step: "selfie" });
      press.set({ step: "locating" });
      return getAttendanceFix();
    })()
      .then(async (fix) => {
        const place = placeLine(fix, officesQ.data?.offices, noGeofence);
        await press.hold({ step: "located", text: place.text, inside: place.inside });
        setLocating(false);
        press.set({ step: "sending", place: place.text });
        const payload = { lat: fix.lat, lng: fix.lng, selfie, notes: notes.trim() || undefined, ...(m === "check-out" ? { reflection: reflection.trim() } : {}) };
        if (m === "check-in") checkIn.mutate(payload); else { lastOut.current = payload; checkOut.mutate(payload); }
      })
      .catch((err) => {
        setLocating(false);
        press.fail(err instanceof GeoError ? err.message : tr("Couldn’t get your location. Attendance needs GPS to check the office area."), m === "check-in" ? "in" : "out");
      });
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-accent via-card to-secondary p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* No "Attendance" eyebrow: it repeated the page title (run 19 decision 1, R19-WB-4). */}
          <h2 className="font-display text-2xl font-bold tracking-tight">{forcePending ? tr("Finish your previous attendance") : mode === "check-in" ? tr("Start your day") : mode === "check-out" ? tr("Wrap up the day") : tr("All done for today")}</h2>
          <p className="mt-1 inline-flex items-center gap-2 text-sm text-muted-foreground">
            {effCheckInAt && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> {tr("In {time}", { time: fmtTime(effCheckInAt) })}{forcePending && pendingDateLabel ? ` · ${pendingDateLabel}` : ""}</span>}
            {!forcePending && checkOutAt && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> {tr("Out {time}", { time: fmtTime(checkOutAt) })}</span>}
            {!effCheckInAt && <span>{tr("Check in with a selfie at the office.")}</span>}
          </p>
        </div>
        {effOfficeName && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"><MapPin className="h-3.5 w-3.5" /> {effOfficeName}</span>}
      </div>

      {forcePending && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-100 p-3 text-sm font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{tr("You forgot to check out on {date}. Check out first before you check in today.", { date: pendingDateLabel || tr("the previous day") })}</span>
        </div>
      )}

      {coveredBy && !forcePending && mode === "check-in" ? (
        <CoveredByRequestCard type={coveredBy} className="mt-4" />
      ) : iosOnly && mode !== "done" ? (
        <IosAppCheckInCard className="mt-4" />
      ) : mode === "done" ? (
        <AttendanceButton className="mt-4" phase={press.phase} day={day} shakes={press.shakes} onPress={onPress} onDismiss={() => press.set(null)} />
      ) : (
        <div className="mt-4">
          {/* The face check (live camera, plain-photo fallback) — opened by the button, no tile. */}
          <SelfieCapture ref={selfieRef} renderTile={false} file={null} onChange={() => {}} onCapture={submit} disabled={busy} />

          <div className="flex flex-col gap-2">
            {mode === "check-out" && (
              <div className="rounded-xl border border-primary/20 bg-card/80 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">{tr("Daily reflection")} <span className="font-medium text-muted-foreground">· {tr("required, min {n} characters", { n: REFLECTION_MIN })}</span></span>
                  <span className={cn("text-[11px] font-semibold", reflection.trim().length >= REFLECTION_MIN ? "text-success" : "text-muted-foreground")}>{reflection.trim().length}/{REFLECTION_MIN}</span>
                </div>
                <textarea value={reflection} onChange={(e) => setReflection(e.target.value)} rows={4} placeholder={tr("What you worked on today, progress, blockers, and what’s next…")} className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
            )}
            <input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} placeholder={tr("Optional note: traffic, WFH context, etc.")} className="rounded-xl border border-border bg-card/80 px-3 py-2 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20" />
            <AttendanceButton phase={press.phase} day={day} shakes={press.shakes} onPress={onPress} onDismiss={() => press.set(null)} />
            <WebCheckInNote />
            <AndroidAppCheckInNote />
          </div>
        </div>
      )}
      {offsitePrompt && (
        <div className="mt-3 space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="text-sm font-bold text-amber-800 dark:text-amber-300">{tr("You’re outside the office area")}</div>
          <p className="text-xs text-amber-700 dark:text-amber-300">{tr("±{m}m from {office}. Check out from here? A reason is required, and it waits for board approval first.", { m: Math.round(offsitePrompt.distanceMeters), office: offsitePrompt.officeName })}</p>
          <textarea value={offsiteReason} onChange={(e) => setOffsiteReason(e.target.value)} rows={2} placeholder={tr("Reason (e.g. content shoot or client meeting at X)")} className="w-full resize-none rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 dark:border-amber-500/40 dark:bg-background" />
          <div className="flex gap-2">
            <button onClick={() => { setOffsitePrompt(null); setOffsiteReason(""); }} disabled={busy} className="flex-1 rounded-lg border border-border bg-white py-2 text-xs font-semibold dark:bg-background text-muted-foreground transition hover:bg-accent disabled:opacity-50">{tr("Cancel")}</button>
            <button onClick={submitOffsite} disabled={!offsiteReason.trim() || busy} className="flex-[1.6] rounded-lg bg-amber-600 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-50">{busy ? tr("Sending…") : tr("Check out and request approval")}</button>
          </div>
        </div>
      )}
      {okMessage && !offsitePrompt && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">{okMessage}</p>}
      {checkOutApproval === "PENDING" && !offsitePrompt && !okMessage && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">{tr("Offsite check-out — waiting for board approval")}</p>}
      {!iosOnly && message && <p className="mt-3 text-sm font-semibold text-destructive">{message}</p>}
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
  return tr("Team member");
}

function FunMetric({ icon, label, value, helper, tone, onClick }: { icon: React.ReactNode; label: string; value: string; helper: string; tone: "green" | "purple" | "amber" | "rose"; onClick?: (origin?: MorphOrigin) => void }) {
  const toneCls = {
    green: "bg-success/10 text-success border-success/30",
    purple: "bg-accent text-accent-foreground border-accent-foreground/20",
    amber: "bg-warning/10 text-warning-foreground dark:text-warning border-warning/30",
    rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30",
  }[tone];
  const inner = (
    <>
      {/* One line per value, icon pinned to the label row: the four cards share a baseline (audit 12 Oct 2026,
          a long value wrapped and pushed its card's text off the others). */}
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/70 dark:bg-background/60">{icon}</span>
        <div className="min-w-0 flex-1">
          {/* The label in sentence case, not an uppercase eyebrow (run 19 decision 1, R19-WB-4). */}
          <p className="line-clamp-2 text-sm font-medium leading-5 opacity-80">{label}</p>
          <h3 title={value} className="line-clamp-2 text-xl font-black leading-7 tracking-tight text-foreground [overflow-wrap:anywhere] [text-wrap:balance] xl:text-2xl">{value}</h3>
        </div>
        {onClick && <ChevronRight className="mt-3 h-4 w-4 shrink-0 opacity-40" />}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{helper}</p>
    </>
  );
  if (onClick) {
    return <FunMetricButton onClick={onClick} className={`flex h-full w-full flex-col rounded-[28px] border p-5 text-left shadow-soft ${toneCls}`}>{inner}</FunMetricButton>;
  }
  return <article className={`flex h-full flex-col rounded-[28px] border p-5 shadow-soft ${toneCls}`}>{inner}</article>;
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
  const { locale } = useLang();
  // `includeAutoDeductions=1` because this log is the one place the cron's penalties BELONG: the card
  // that opens it counts them in "N/4 used", so a log without them wouldn't add up. Everywhere else
  // the endpoint now returns only what a person actually filed.
  const q = useQuery({ queryKey: ["attendance-requests", "me", "with-auto"], queryFn: () => nexusApi.attendanceRequests("scope=me&includeAutoDeductions=1"), retry: 1 });
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
  const periodLabel = `${pStart.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${pEnd.toLocaleDateString(locale, { day: "numeric", month: "short" })}`;
  const rows = all
    .filter((r) => (r.type ?? "").toUpperCase() === kind)
    .filter((r) => { const d = (r.startDate ?? "").slice(0, 10); return d >= periodStartKey && d <= periodEndKey; })
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  const title = kind === "DAY_OFF" ? tr("Day-off log") : tr("Public holiday log");
  const subtitle = kind === "DAY_OFF" ? tr("Days off and deductions (late >120 min) this period") : tr("Public holidays used this period");

  return (
    <MorphPanel origin={origin} onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">{kind === "DAY_OFF" ? <Sparkles className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1"><div className="font-display text-lg font-bold tracking-tight">{title}</div><div className="text-xs text-muted-foreground">{subtitle}</div></div>
        <button onClick={onClose} aria-label={tr("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="mb-3 text-[11px] font-medium text-muted-foreground">{tr("Current period:")} <span className="font-semibold text-foreground">{periodLabel}</span></p>
        {q.isLoading && <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/40" />)}</div>}
        {!q.isLoading && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{kind === "DAY_OFF" ? tr("No day off used this period ({range}).", { range: periodLabel }) : tr("No public holiday used this period ({range}).", { range: periodLabel })}</p>}
        {!q.isLoading && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => {
              const auto = (r.reason ?? "").startsWith("Auto:");
              const range = r.startDate && r.endDate && r.startDate.slice(0, 10) !== r.endDate.slice(0, 10) ? `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` : fmtDate(r.startDate);
              return (
                <div key={r.id} className="rounded-2xl border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{range}</span>
                    {kind === "DAY_OFF" && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", auto ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300")}>{auto ? tr("Auto · late >120m") : tr("Manual")}</span>}
                  </div>
                  {r.reason && <p className="mt-1 text-xs text-muted-foreground">{attendanceReasonText(r.reason)}</p>}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{tr("Status")}: {statusLabel(r.status || "")}</p>
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

/** A fresh idempotency key for one attendance request submit (a UUID; any 8–200 of [A-Za-z0-9._:-] is accepted). */
function newClientRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* not a secure context: fall through */ }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// One person's record for one attendance period (28th → 27th): who they are, how the period went, their
// row of the crew board, every XP change with the reason, and their requests. Owner request 28 Sep 2026.
// The iPhone draws the same page (MemberProfileView); both read GET /api/members/:userId/record.
//
// Opened from the leaderboard's XP log, the Attendance board (the Record link beside a name), Control
// Room's member card and the "deduction removed" notification.
import type React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Lock, Loader2, Mail, MessageSquare, ScrollText, Undo2, UserRound, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ZoomableAvatar } from "@/components/PhotoLightbox";
import { EmptyState, EmptyAction } from "@/components/EmptyState";
import { celebrate } from "@/components/Celebration";
import { StatusOverridePanel } from "@/components/attendance/StatusOverridePanel";
import { LeftTag, leftAtOf } from "@/components/LeftTag";
import { recTone, sCls, toneFromLetter, toneLabel, type HistRow } from "@/lib/attendance-tone";
import { recordPlace } from "@/lib/attendance-place";
import { ApiError, fmtDate, fmtTime, nexusApi, ORG_ROLE_LABEL, ORG_ROLE_TONE, type NexusMemberRecord, type NexusRecordXp, type NexusRecordXpEntry } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

type RecordSearch = { period?: string };

export const Route = createFileRoute("/_app/people/$userId")({
  component: MemberRecordPage,
  validateSearch: (s: Record<string, unknown>): RecordSearch => ({
    period: typeof s.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s.period) ? s.period : undefined,
  }),
  head: () => ({ meta: [{ title: "NEXUS Phaëthon — Record" }] }),
});

const REQ_LABEL: Record<string, string> = { LEAVE: "Leave", SICK: "Sick", PERMIT: "Permit", DAY_OFF: "Day off", RED_DATE: "Public holiday" };
const STATUS_TONE: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  REJECTED: "bg-rose-100 text-rose-700",
  CANCELED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-muted text-muted-foreground",
};

function errorCode(err: unknown): string | null {
  if (err instanceof ApiError && err.payload && typeof err.payload === "object" && "code" in err.payload) return String((err.payload as { code?: unknown }).code ?? "") || null;
  return null;
}
function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}
/** "14 Sep" from "2026-09-14" — a calendar day, never shifted by the browser's zone. */
function dayLabel(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}
function rangeLabel(a: string, b: string) {
  return a === b ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`;
}
function signed(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}

function MemberRecordPage() {
  const { userId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate({ from: "/people/$userId" });
  const setPeriod = (p: string | undefined) => navigate({ search: { period: p }, replace: true });

  const record = useQuery({
    queryKey: ["member-record", userId, period ?? "current"],
    queryFn: () => nexusApi.memberRecord(userId, period),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 1,
  });
  const data = record.data;
  // The board's own rows for this person and period — the cells' colours and the day detail come from
  // them exactly as on the Attendance board. Keyed under "attendance-history" so a status change made
  // from the panel (which invalidates that key) refreshes them too.
  const historyQuery = data ? (data.person.isSelf ? `scope=me&month=${data.period.key}` : `scope=workspace&month=${data.period.key}&userId=${data.person.id}`) : "";
  const history = useQuery({
    queryKey: ["attendance-history", "record", data?.person.id, data?.period.key],
    queryFn: () => nexusApi.attendanceHistory(historyQuery),
    enabled: Boolean(data),
    retry: 1,
  });

  const code = errorCode(record.error);
  const title = data?.person.name ?? "Record";
  return (
    <div>
      <PageHeader
        title={title}
        subtitle={data ? (data.person.isSelf ? "Your attendance, XP and requests, one period at a time." : "Attendance, XP and requests, one period at a time.") : undefined}
        icon={<UserRound className="h-6 w-6 text-primary" />}
        actions={data ? <PeriodPicker data={data} onChange={setPeriod} /> : undefined}
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
        {record.isLoading ? (
          <div className="grid place-items-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : code === "FORBIDDEN" ? (
          <EmptyState icon={Lock} tone="muted" title="Not in your view"
            message="You can open your own record. A manager sees the people under them in the approval chart, and the BoD sees everyone."
            action={<EmptyAction to="/people/me">Open my record</EmptyAction>} />
        ) : record.isError || !data ? (
          <EmptyState icon={AlertTriangle} tone="muted" title="Couldn’t load this record" message={errorText(record.error, "Check your connection and try again.")}
            action={<EmptyAction onClick={() => record.refetch()}>Try again</EmptyAction>} />
        ) : (
          <>
            <HeaderCard data={data} />
            <SummaryCard data={data} />
            <StreakRow data={data} rows={history.data?.rows ?? []} historyLoading={history.isLoading} />
            <XpLog key={`${data.person.id}:${data.period.key}`} data={data} />
            <RequestsCard data={data} />
          </>
        )}
      </div>
    </div>
  );
}

function PeriodPicker({ data, onChange }: { data: NexusMemberRecord; onChange: (p: string | undefined) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onChange(data.period.previousKey)} aria-label="Previous period" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
      <span className="min-w-[9.5rem] text-center text-sm font-semibold tabular-nums" title="Attendance period: the 28th to the 27th">{data.period.label}</span>
      <button onClick={() => onChange(data.period.nextKey ?? undefined)} disabled={!data.period.nextKey} aria-label="Next period" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
      {!data.period.isCurrent && <button onClick={() => onChange(undefined)} className="ml-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">This period</button>}
    </div>
  );
}

function Card({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-border bg-card p-4 shadow-soft md:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground/80">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// Who this is, then the one thing to do from here (owner, 9 Oct 2026, with the iPhone). The avatar opens
// the photo full screen. Message is a tonal button that hugs its label: on a phone the card used to stack
// and stretch it into a full-width black bar, the same slab the iPhone had.
function HeaderCard({ data }: { data: NexusMemberRecord }) {
  const { t, locale } = useLang();
  const p = data.person;
  const navigate = useNavigate();
  const chat = useMutation({
    mutationFn: () => nexusApi.createConversation({ type: "DM", userIds: [p.id] }),
    onSuccess: (r) => navigate({ to: "/messages/$conversationId", params: { conversationId: r.conversation.id } }),
    onError: (e) => alert(errorText(e, t("Couldn’t start that chat. Try again."))),
  });
  // Someone who left can no longer sign in: no one to message.
  const canMessage = !p.isSelf && !leftAtOf(p);
  const joined = new Date(p.joinedAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-4 rounded-[24px] border border-border bg-card p-4 shadow-soft md:p-5">
      <div className="flex min-w-0 flex-1 basis-[17rem] items-center gap-4">
        <ZoomableAvatar userId={p.id} name={p.name} avatar={p.avatar} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-lg font-bold tracking-tight">{p.name ?? "—"}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ORG_ROLE_TONE[p.role] ?? "bg-muted text-muted-foreground")}>{ORG_ROLE_LABEL[p.role] ?? p.role}</span>
            {p.isSelf && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{t("You")}</span>}
            <LeftTag leftAt={leftAtOf(p)} className="text-[11px]" />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {p.email && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate text-foreground">{p.email}</span></span>}
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0" /><span className="text-foreground">{t("Joined {date}", { date: joined })}</span></span>
          </div>
        </div>
      </div>
      {canMessage && (
        <button
          type="button"
          onClick={() => chat.mutate()}
          disabled={chat.isPending}
          aria-busy={chat.isPending || undefined}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60 sm:min-h-10"
        >
          {chat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
          {t("Message")}
        </button>
      )}
    </section>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2" title={hint}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">{tone && <span className={cn("inline-block h-2.5 w-2.5 rounded", tone)} />}{label}</div>
      <div className="mt-0.5 text-lg font-black tabular-nums">{value}</div>
    </div>
  );
}

function SummaryCard({ data }: { data: NexusMemberRecord }) {
  const { score, counts, dayOff, xp } = data.summary;
  const bonus = dayOff.bonusDays > 0 ? ` + ${dayOff.bonusDays} extra (${dayOff.bonusGrants.map((g) => g.reason).join(", ")})` : "";
  return (
    <Card title={data.period.isCurrent ? "This period" : "Period"} hint={`${data.period.label} · ${data.period.days} days, ${score.working} working days (${data.period.days} − ${dayOff.quota} day-off allowance)`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,14rem)_1fr]">
        <div className="rounded-2xl bg-primary/5 p-4" title="Days worked (present or permit) out of the period's working days — the board's Score column">
          <div className="text-[11px] font-bold uppercase tracking-wider text-primary">Score</div>
          <div className="mt-1 text-3xl font-black tabular-nums">{score.worked}/{score.working}{score.surplus > 0 && <span className="ml-1 text-lg text-emerald-600">+{score.surplus}</span>}</div>
          <div className="mt-1 text-xs text-muted-foreground">{score.totalWorked} day{score.totalWorked === 1 ? "" : "s"} worked{data.period.isCurrent ? ` · day ${data.period.daysElapsed} of ${data.period.days}` : ""}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          <Stat label="Present" value={counts.present} tone={sCls.present} />
          <Stat label="Permit" value={counts.permit} tone={sCls.permit} />
          <Stat label="Leave" value={counts.leave} tone={sCls.leave} />
          <Stat label="Sick" value={counts.sick} tone={sCls.sick} />
          <Stat label="Day off" value={counts.dayOff} tone={sCls.dayoff} />
          <Stat label="Absent (TK)" value={counts.absent} tone={sCls.absent} />
          <Stat label="Late" value={counts.lateMinutes > 0 ? `${counts.lateMinutes} min` : "—"} hint={`${counts.lateDays} late day${counts.lateDays === 1 ? "" : "s"}`} />
          <Stat label="Day-off balance" value={`${dayOff.remaining} left`} hint={`Used ${dayOff.usedRaw} of ${dayOff.quota}: ${dayOff.baseQuota} base${bonus}. Includes days cut automatically for TK or >120 min late.`} />
          <Stat label="XP this period" value={<span><span className="text-emerald-600">+{xp.gained}</span> <span className="text-rose-600">{xp.lost}</span></span>} hint={xp.removed > 0 ? `${xp.removed} XP of deductions removed by the BoD` : undefined} />
        </div>
      </div>
      {dayOff.bonusDays > 0 && <p className="mt-2 text-xs text-emerald-700">Day-off allowance {dayOff.quota} = {dayOff.baseQuota} + {dayOff.bonusDays} extra for this period ({dayOff.bonusGrants.map((g) => `${g.days}: ${g.reason}`).join("; ")}).</p>}
    </Card>
  );
}

function StreakRow({ data, rows, historyLoading }: { data: NexusMemberRecord; rows: HistRow[]; historyLoading: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const byDate = new Map<string, HistRow>();
  for (const r of rows) if (r.attendanceDate && (!r.user?.id || r.user.id === data.person.id)) byDate.set(r.attendanceDate.slice(0, 10), r);
  const day = open ? data.days.find((d) => d.date === open) ?? null : null;
  return (
    <Card title="Streak board" hint="Green = present or permit, red = absent, orange = sick, purple = day off, yellow = leave. Tap a day for its detail."
      right={historyLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : undefined}>
      <div className="overflow-x-auto overscroll-contain pb-1">
        <div className="flex min-w-max gap-1">
          {data.days.map((d) => {
            const rec = byDate.get(d.date);
            const tone = rec ? recTone(rec) : toneFromLetter(d.tone);
            return (
              <button key={d.date} disabled={d.isFuture} onClick={() => setOpen(d.date)}
                title={`${dayLabel(d.date)} · ${toneLabel[tone] || (d.isFuture ? "Not yet" : "No record")}${d.lateMinutes > 0 ? ` · ${d.lateMinutes} min late` : ""}${d.penaltyXp < 0 ? ` · ${d.penaltyXp} XP` : ""}`}
                className={cn("flex w-8 flex-col items-center gap-1 rounded-lg py-1 transition-colors enabled:hover:bg-accent disabled:cursor-default", Number(d.day) === 1 && "border-l border-border/70")}>
                <span className="text-[9px] font-medium uppercase text-muted-foreground">{d.weekday}</span>
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{d.day}</span>
                <span className={cn("relative inline-block h-5 w-5 rounded-lg", sCls[tone], d.isToday && "ring-2 ring-primary ring-offset-1 ring-offset-card", d.isFuture && "opacity-40")}>
                  {d.penaltyXp < 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-600 ring-1 ring-card" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">A red dot on a day = XP was deducted for it.</p>
      {day && <DayDetail data={data} day={day} rec={byDate.get(day.date) ?? null} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function DayDetail({ data, day, rec, onClose }: { data: NexusMemberRecord; day: NexusMemberRecord["days"][number]; rec: HistRow | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const tone = rec ? recTone(rec) : toneFromLetter(day.tone);
  const entries = data.xp.entries.filter((e) => e.dateKey === day.date);
  // Where the day was: the office, or the check-in address when it was made away from it.
  const place = rec?.checkInAt ? recordPlace(rec) : null;
  const where = place?.label || rec?.checkInAddress || null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold tracking-tight">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</h3>
            <div className="mt-1 flex items-center gap-1.5 text-sm"><span className={cn("inline-block h-3 w-3 rounded", sCls[tone])} />{toneLabel[tone] || "No record"}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <dl className="mt-3 space-y-1.5 text-sm">
          {rec?.checkInAt && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">In / out</dt><dd className="font-semibold tabular-nums">{fmtTime(rec.checkInAt)} – {rec.checkOutAt ? fmtTime(rec.checkOutAt) : "no check-out"}</dd></div>}
          {day.lateMinutes > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Late</dt><dd className="font-semibold text-rose-600">{day.lateMinutes} min</dd></div>}
          {where && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Where</dt><dd className="min-w-0 text-right"><div className="truncate font-semibold" title={rec?.checkInAddress ?? undefined}>{where}</div>{place?.away && <div className="text-[11px] text-muted-foreground">Away from the office</div>}</dd></div>}
          {rec?.requestType && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Request</dt><dd className="font-semibold">{REQ_LABEL[rec.requestType] ?? rec.requestType}{rec.reviewedBy?.name ? ` · approved by ${rec.reviewedBy.name}` : ""}</dd></div>}
          {rec?.notes && <div className="rounded-xl bg-muted/40 p-2.5 text-sm"><div className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Reason</div><p className="whitespace-pre-wrap">{rec.notes}</p></div>}
          {!rec && !day.isFuture && <p className="text-muted-foreground">Nothing recorded — a rest day, a public holiday, before they joined, or still open today.</p>}
        </dl>
        {entries.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">XP for this day</div>
            {entries.map((e) => <XpRow key={e.id} entry={e} data={data} compact />)}
          </div>
        )}
        {data.viewer.canManageAttendance && !day.isFuture && (
          <StatusOverridePanel userId={data.person.id} name={data.person.name} dateKey={day.date} onDone={onClose} />
        )}
        {rec?.id && rec.recordKind === "ATTENDANCE" && (
          <Link to="/attendance" className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline">Selfies, location and trail are on the Attendance board →</Link>
        )}
      </div>
    </div>
  );
}

function XpRow({ entry: e, data, compact = false }: { entry: NexusRecordXpEntry; data: NexusMemberRecord; compact?: boolean }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (note: string) => nexusApi.removeXpDeduction(e.id, note.trim() || undefined),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["member-record"] });
      qc.invalidateQueries({ queryKey: ["attendance-dayoff-summary"] });
      qc.invalidateQueries({ queryKey: ["attendance-deductions"] });
      celebrate(`Deduction removed — +${r.refund.refunded} XP back to ${data.person.name ?? "them"}`);
    },
    onError: (err) => {
      qc.invalidateQueries({ queryKey: ["member-record"] });
      alert(errorText(err, "Couldn’t remove that deduction."));
    },
  });
  const ask = () => {
    const what = `${e.label}${e.dateKey ? ` (${dayLabel(e.dateKey)})` : ""}, ${e.originalAmount} XP`;
    const note = window.prompt(`Remove this deduction for ${data.person.name ?? "this person"}?\n\n${what}\n\nThe ${-e.originalAmount} XP goes back to them, the nightly jobs won’t take it again, and it is recorded in the audit log. They get a notification.\n\nWhy? (optional)`, "");
    if (note === null) return;
    remove.mutate(note);
  };
  const removed = Boolean(e.removed);
  const pos = e.originalAmount >= 0;
  return (
    <div className={cn("flex items-center gap-3", compact ? "rounded-xl bg-muted/30 px-3 py-2" : "px-4 py-2.5 md:px-5")}>
      {!compact && <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", removed ? "bg-muted text-muted-foreground" : pos ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600")}><ScrollText className="h-4 w-4" /></span>}
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-semibold", removed && "text-muted-foreground line-through")}>{e.label}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {e.dateKey ? `for ${dayLabel(e.dateKey)} · ` : ""}{fmtDate(e.createdAt)} {fmtTime(e.createdAt)}
        </div>
        {e.removed && (
          <div className="truncate text-[11px] font-semibold text-emerald-700">
            Removed by {e.removed.by?.name ?? "a BoD"} · {fmtDate(e.removed.at)}{e.removed.note ? ` — ${e.removed.note}` : ""}
          </div>
        )}
      </div>
      <div className={cn("shrink-0 text-sm font-black tabular-nums", removed ? "text-muted-foreground line-through" : pos ? "text-emerald-600" : "text-rose-600")}>{signed(e.originalAmount)} XP</div>
      {e.canRemove && (
        <button onClick={ask} disabled={remove.isPending} title="Remove this deduction (BoD)" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50">
          {remove.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Remove
        </button>
      )}
    </div>
  );
}

function XpLog({ data }: { data: NexusMemberRecord }) {
  // Older periods, appended by "Load older" one period at a time.
  const [older, setOlder] = useState<{ period: string; xp: NexusRecordXp }[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = older.length ? older[older.length - 1].xp : data.xp;
  const loadOlder = async () => {
    if (!last.olderPeriod) return;
    setLoading(true); setErr(null);
    try {
      const r = await nexusApi.memberRecordXp(data.person.id, last.olderPeriod);
      setOlder((o) => [...o, { period: r.period, xp: r.xp }]);
    } catch (e) {
      setErr(errorText(e, "Couldn’t load older entries."));
    } finally {
      setLoading(false);
    }
  };
  const sections = [{ period: data.period.key, label: data.period.label, xp: data.xp }, ...older.map((o) => ({ period: o.period, label: o.period, xp: o.xp }))];
  const t = data.summary.xp;
  return (
    <Card title="XP log" hint="Every XP change written in the period, with the reason. Attendance penalties name the day they are for."
      right={<div className="text-xs font-semibold tabular-nums text-muted-foreground"><span className="text-emerald-600">+{t.gained}</span> · <span className="text-rose-600">{t.lost}</span>{t.removed > 0 && <> · <span className="text-emerald-700">{t.removed} removed</span></>}</div>}>
      <div className="-mx-4 divide-y divide-border md:-mx-5">
        {sections.map((s, i) => (
          <div key={s.period}>
            {i > 0 && <div className="bg-muted/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground md:px-5">Period ending {s.label}</div>}
            {s.xp.entries.length === 0 ? (
              i === 0 ? (
                <EmptyState compact icon={ScrollText} tone="muted" className="mx-4 my-2 md:mx-5" title="No XP moved this period"
                  message={`XP comes from quests and goes on attendance penalties (late, no check-out, TK). ${data.person.isSelf ? "Nothing has landed on you" : "Nothing has landed on them"} since ${dayLabel(data.period.from)}.${s.xp.hasOlder ? " Older periods are below." : ""}`} />
              ) : <p className="px-4 py-3 text-sm text-muted-foreground md:px-5">No XP moved in that period.</p>
            ) : (
              s.xp.entries.map((e) => <XpRow key={e.id} entry={e} data={data} />)
            )}
          </div>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      {last.hasOlder && last.olderPeriod && (
        <button onClick={loadOlder} disabled={loading} className="mt-3 w-full rounded-xl border border-border bg-muted/40 py-2 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60">
          {loading ? "Loading…" : `Load older (period ending ${last.olderPeriod})`}
        </button>
      )}
    </Card>
  );
}

function RequestsCard({ data }: { data: NexusMemberRecord }) {
  const list = data.requests;
  return (
    <Card title="Requests" hint="Leave, sick, permit and day-off requests touching this period.">
      {list.length === 0 ? (
        <EmptyState compact icon={ClipboardList} tone="muted" title="No requests this period"
          message={data.person.isSelf ? "Leave, sick notes, permits and days off you file show up here with their status." : "Nothing was filed for these dates. What they file shows up here with its status."}
          action={data.person.isSelf ? <EmptyAction to="/attendance">File a request</EmptyAction> : undefined} />
      ) : (
        <div className="-mx-4 divide-y divide-border md:-mx-5">
          {list.map((r) => {
            const body = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{r.isAuto ? "Day off cut automatically" : REQ_LABEL[r.type] ?? r.type}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{rangeLabel(r.startDate, r.endDate)}{r.days > 1 ? ` · ${r.days} days` : ""}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{r.reason}</div>
                  {r.reviewedBy?.name && <div className="truncate text-[11px] text-muted-foreground/80">{r.status === "REJECTED" ? "Rejected" : "Reviewed"} by {r.reviewedBy.name}{r.reviewNote ? ` — ${r.reviewNote}` : ""}</div>}
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_TONE[r.status] ?? "bg-muted text-muted-foreground")}>{r.status}</span>
              </>
            );
            // The cron's own cut is not a request anyone can open; everything else opens on the Attendance page.
            return r.isAuto ? (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 md:px-5">{body}</div>
            ) : (
              <Link key={r.id} to="/attendance" search={{ request: r.id }} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30 md:px-5">{body}</Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

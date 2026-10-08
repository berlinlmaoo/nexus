// One crew member's report for one attendance period (28→27): work, attendance, XP.
// Used by /reports (the viewer's own "Me" tab) and /reports/$userId (a report the viewer may see).
// Sections, labels and every figure mirror the iOS PersonReportSections (identity, KPIs, completed
// per week, overdue tasks, by project, attendance, XP) so the two never disagree.
import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarCheck, CheckCircle2, ChevronRight, Clock, Flame, FolderKanban, RefreshCw, Sparkles, Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { Reveal, AnimatedBar } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { LeftTag, leftAtOf } from "@/components/LeftTag";
import { cn } from "@/lib/utils";
import type { PersonReportResponse, ReportPriority, ReportRatio } from "@/lib/nexus-api";
import { fmtDayKey, fmtHours, fmtNum, fmtPct, periodRangeLabel, ROLE_LABEL } from "./report-format";

const PRIORITY_LABEL: Record<ReportPriority, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low", NONE: "No priority" };
const PRIORITY_DOT: Record<ReportPriority, string> = { URGENT: "var(--destructive)", HIGH: "var(--warning)", MEDIUM: "#0091ff", LOW: "var(--muted-foreground)", NONE: "var(--border)" };
const PENALTY_LABEL: Record<string, string> = {
  late: "Late check-in",
  nocheckout: "No check-out",
  alpha: "Absent without notice",
  peer: "Peer report",
  penalty: "Penalty",
  admin: "Admin adjustment",
  other: "Other",
};

export function PersonReportView({ data, showIdentity }: { data: PersonReportResponse; showIdentity?: boolean }) {
  const { person, work, attendance, xp } = data;
  return (
    <div className="space-y-6">
      {showIdentity && <IdentityCard person={person} />}
      <Reveal><Kpis data={data} /></Reveal>

      <Reveal delay={0.05} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WeeklyCard weekly={work.weekly} />
        <OverdueCard work={work} />
      </Reveal>

      <Reveal delay={0.08}><ProjectsCard rows={work.perProject} /></Reveal>

      <Reveal delay={0.1} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AttendanceCard a={attendance} />
        <XpCard xp={xp} />
      </Reveal>

      <p className="text-center text-[11px] text-muted-foreground">
        Tasks shared by several people are split between them, so counts can be fractional.
      </p>
    </div>
  );
}

function IdentityCard({ person }: { person: PersonReportResponse["person"] }) {
  return (
    <section className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
      <Avatar userId={person.id} name={person.name} avatar={person.avatar} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2"><span className="truncate font-display text-lg font-bold tracking-tight">{person.name}</span><LeftTag leftAt={leftAtOf(person)} /></div>
        <div className="truncate text-xs text-muted-foreground">{person.email}</div>
        {(person.role || person.teams.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {person.role && <span className="chip chip--sm chip--soft">{ROLE_LABEL[person.role] ?? person.role}</span>}
            {person.teams.map((t) => <span key={t.id} className="chip chip--sm chip--tertiary">{t.name}</span>)}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// KPI tiles — the same six as iOS, with the same delta rule: whole percents compared in points,
// counts compared at one decimal, "—" when either side is missing.

type Delta = { text: string; mood: "better" | "worse" | "flat" | "unknown"; up: boolean };

function between(now: number | null | undefined, before: number | null | undefined, higherIsBetter: boolean, percentPoints = false): Delta {
  if (now == null || before == null) return { text: "—", mood: "unknown", up: false };
  let n = now;
  let b = before;
  if (percentPoints) { n = Math.round(n); b = Math.round(b); }
  const diff = n - b;
  if (Math.abs(diff) < 0.05) return { text: "0", mood: "flat", up: false };
  const amount = fmtNum(Math.abs(diff));
  return { text: percentPoints ? `${amount} pt` : amount, mood: (diff > 0) === higherIsBetter ? "better" : "worse", up: diff > 0 };
}

const pctOf = (r: ReportRatio | null | undefined) => {
  if (!r || !r.den) return null;
  return (r.num / r.den) * 100;
};

function Kpis({ data }: { data: PersonReportResponse }) {
  const now = data.headline;
  const before = data.previous;
  const isCurrent = data.period.isCurrent;
  const prior = periodRangeLabel(data.previousPeriod);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={CheckCircle2} label="Completed" value={fmtNum(now.completed)} delta={between(now.completed, before.completed, true)} />
        <Kpi icon={Target} label="On time" value={fmtPct(now.onTime)} sub={`${fmtNum(now.onTime.num)}/${fmtNum(now.onTime.den)}`} delta={between(pctOf(now.onTime), pctOf(before.onTime), true, true)} />
        <Kpi icon={AlertTriangle} label={isCurrent ? "Overdue now" : "Overdue"} value={fmtNum(now.overdue)} tone={now.overdue > 0 ? "danger" : undefined} delta={between(now.overdue, before.overdue, false)} />
        <Kpi icon={CalendarCheck} label="Attendance" value={fmtPct(now.attendanceRate)} delta={between(pctOf(now.attendanceRate), pctOf(before.attendanceRate), true, true)} />
        <Kpi icon={Clock} label="Late" value={fmtNum(now.late)} sub={`${fmtNum(now.lateMinutes)} min in total`} delta={between(now.late, before.late, false)} />
        <Kpi icon={Sparkles} label="XP this period" value={fmtNum(now.xpScore)} sub={now.xpPenalty ? `${fmtNum(-Math.abs(now.xpPenalty))} XP penalties` : undefined} delta={between(now.xpScore, before.xpScore, true)} />
      </div>
      {prior && <p className="text-[11px] text-muted-foreground">Arrows compare with {prior}.</p>}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, delta, tone }: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  delta: Delta;
  tone?: "danger";
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label}</span></div>
      <div className={cn("mt-1 truncate font-display text-2xl font-bold tracking-tight tabular-nums md:text-3xl", tone === "danger" && "text-destructive")}>{value}</div>
      <div className={cn("mt-1 flex items-center gap-0.5 text-[11px] font-bold tabular-nums", delta.mood === "better" ? "text-success" : delta.mood === "worse" ? "text-destructive" : "text-muted-foreground")}>
        {(delta.mood === "better" || delta.mood === "worse") && (delta.up ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />)}
        <span className="truncate">{delta.text}</span>
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Cards

function Card({ title, icon: Icon, right, children, className }: { title: string; icon?: ComponentType<{ className?: string }>; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("h-full min-w-0 rounded-2xl border border-border bg-card p-4 shadow-soft md:p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 font-display text-base font-bold tracking-tight">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}<span className="truncate">{title}</span>
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function WeeklyCard({ weekly }: { weekly: PersonReportResponse["work"]["weekly"] }) {
  // Stacked like iOS: on-time on the bottom, the rest (late, or no due date) on top — the bar's full
  // height is the week's completed count.
  const data = weekly.map((w) => ({
    label: fmtDayKey(w.from),
    range: `${fmtDayKey(w.from)} – ${fmtDayKey(w.to)}`,
    "On time": Math.min(w.onTime, w.completed),
    "Late or no due date": Math.max(0, w.completed - w.onTime),
  }));
  const empty = weekly.length === 0 || weekly.every((w) => w.completed <= 0);
  return (
    <Card title="Completed per week" icon={TrendingUp}>
      {empty ? (
        <EmptyState compact tone="muted" icon={TrendingUp} title="Nothing completed yet" message="Tasks marked done in this period are counted here, week by week." />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => fmtNum(v)} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                formatter={(v: number | string, n: string) => [fmtNum(Number(v)), n]}
                labelFormatter={(_l, p) => (p?.[0]?.payload as { range?: string } | undefined)?.range ?? ""}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Bar dataKey="On time" stackId="w" fill="var(--success)" maxBarSize={32} />
              <Bar dataKey="Late or no due date" stackId="w" fill="#a168be" fillOpacity={0.45} radius={[5, 5, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function OverdueCard({ work }: { work: PersonReportResponse["work"] }) {
  const list = work.overdueList;
  return (
    <Card title="Overdue tasks" icon={AlertTriangle} right={list.length > 0 ? <span className="chip chip--sm chip--danger tabular-nums">{fmtNum(work.overdueNow)}</span> : undefined}>
      {list.length === 0 ? (
        <EmptyState compact tone="success" icon={CheckCircle2} title="Nothing overdue" message="Every open task with a due date is still on schedule." />
      ) : (
        <ul className="-mx-2 max-h-[22rem] divide-y divide-border overflow-y-auto">
          {list.map((t) => (
            <li key={t.id}>
              <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="group flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_DOT[t.priority] ?? PRIORITY_DOT.NONE }} title={PRIORITY_LABEL[t.priority] ?? t.priority} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-semibold">{t.title || "Untitled task"}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {t.projectName && <span className="max-w-full truncate">{t.projectName}</span>}
                    {t.assigneeCount > 1 && <span className="font-semibold">Shared by {fmtNum(t.assigneeCount)}</span>}
                  </div>
                </div>
                <span className="chip chip--sm chip--danger shrink-0 tabular-nums" title={`Due ${fmtDayKey(t.dueKey || t.dueDate, true)}`}>{fmtNum(t.daysOverdue)}d late</span>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProjectsCard({ rows }: { rows: PersonReportResponse["work"]["perProject"] }) {
  return (
    <Card title="By project" icon={FolderKanban}>
      {rows.length === 0 ? (
        <EmptyState compact tone="muted" icon={FolderKanban} title="No project activity" message="Tasks assigned in this period show up here, grouped by project." />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5">
          <table className="w-full min-w-[340px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Project</th>
                <th className="pb-2 pr-3 text-right font-medium">Done</th>
                <th className="pb-2 pr-3 text-right font-medium">Open</th>
                <th className="pb-2 text-right font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.projectId} className="border-t border-border">
                  <td className="max-w-[16rem] py-2.5 pr-3">
                    <Link to="/projects/$projectId" params={{ projectId: p.projectId }} className="block truncate font-semibold hover:underline">{p.projectName || "Untitled project"}</Link>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{fmtNum(p.completed)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{fmtNum(p.open)}</td>
                  <td className="py-2.5 text-right tabular-nums">{p.overdue > 0 ? <span className="chip chip--sm chip--danger">{fmtNum(p.overdue)} overdue</span> : <span className="text-muted-foreground">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AttendanceCard({ a }: { a: PersonReportResponse["attendance"] }) {
  const reflections = a.reflectionRate.den > 0 ? `${fmtNum(a.reflectionRate.num)}/${fmtNum(a.reflectionRate.den)} · ${fmtPct(a.reflectionRate)}` : "—";
  const stats: { label: string; value: string; tone?: "warning" | "danger" }[] = [
    { label: "Present", value: fmtNum(a.present) },
    { label: "Late", value: fmtNum(a.late), tone: a.late > 0 ? "warning" : undefined },
    { label: "Late minutes", value: fmtNum(a.lateMinutes) },
    { label: "Left early", value: fmtNum(a.earlyLeave) },
    { label: "Absent", value: fmtNum(a.absent), tone: a.absent > 0 ? "danger" : undefined },
    { label: "Leave", value: fmtNum(a.leave) },
    { label: "Sick", value: fmtNum(a.sick) },
    { label: "Permit", value: fmtNum(a.permit) },
    { label: "Day off", value: fmtNum(a.dayOff) },
    { label: "Avg worked", value: fmtHours(a.avgWorkedMinutes) },
    { label: "Reflections", value: reflections },
    { label: "Attendance rate", value: fmtPct(a.attendanceRate) },
  ];
  return (
    <Card title="Attendance" icon={CalendarCheck}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="truncate text-[11px] font-semibold text-muted-foreground">{s.label}</dt>
            <dd className={cn("truncate font-display text-lg font-bold tabular-nums", s.tone === "warning" && "text-warning", s.tone === "danger" && "text-destructive")}>{s.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function XpCard({ xp }: { xp: PersonReportResponse["xp"] }) {
  // level.pct is 0–100 (the server rounds it to a whole percent).
  const pct = xp.level.isMax ? 100 : Math.max(0, Math.min(100, xp.level.pct));
  return (
    <Card title="XP this period" icon={Sparkles}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-3xl font-black tracking-tight tabular-nums">{fmtNum(xp.periodScore)}</span>
        <span className="text-sm font-bold text-muted-foreground">XP</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-orange-500"><Flame className="h-3.5 w-3.5" />{fmtNum(xp.streak.current)}-day streak</span>
      </div>
      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-2 text-sm">
          <span className="font-bold text-primary">Level {xp.level.level}</span>
          <span className="min-w-0 truncate font-semibold">{xp.level.name}</span>
          <span className="ml-auto text-xs font-bold text-muted-foreground tabular-nums">{xp.level.isMax ? "Max level" : `${Math.round(pct)}%`}</span>
        </div>
        <AnimatedBar pct={pct} className="h-2 rounded-full bg-muted" barClassName="h-full rounded-full bg-[#a168be]" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Longest streak: {fmtNum(xp.streak.longest)} days</p>

      <div className="mt-3 border-t border-border pt-3">
        {xp.penalties.length === 0 ? (
          <p className="text-sm text-muted-foreground">No penalties this period.</p>
        ) : (
          <ul className="space-y-1.5">
            {xp.penalties.map((p) => (
              <li key={p.kind} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 truncate font-semibold">{PENALTY_LABEL[p.kind] ?? p.kind}</span>
                <span className="text-xs text-muted-foreground tabular-nums">×{fmtNum(p.count)}</span>
                <span className="ml-auto shrink-0 font-bold tabular-nums text-destructive">{fmtNum(-Math.abs(p.xp))} XP</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Counted over the attendance period, so it can differ from the leaderboard's month.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------
// Loading / error

export function PersonReportSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading report">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-10" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft"><Skeleton className="mb-4 h-4 w-36" /><Skeleton className="h-48 w-full" /></div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft"><Skeleton className="mb-4 h-4 w-28" />{Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="mb-3 h-9 w-full" />)}</div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft"><Skeleton className="mb-4 h-4 w-32" />{Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="mb-3 h-6 w-full" />)}</div>
    </div>
  );
}

export function ReportError({ title, message, onRetry, retrying }: { title: string; message: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      tone="muted"
      title={title}
      message={message}
      action={onRetry ? (
        <button type="button" onClick={onRetry} disabled={retrying} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60">
          <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} /> Try again
        </button>
      ) : undefined}
    />
  );
}

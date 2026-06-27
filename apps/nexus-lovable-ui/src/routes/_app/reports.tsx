import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { nexusApi, statusLabel, type NexusReports } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { Reveal, AnimatedBar, CountUp } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/reports")({ component: Reports });

const RANGES = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];
const STATUS_COLORS: Record<string, string> = { TODO: "#94a3b8", IN_PROGRESS: "#0091ff", IN_REVIEW: "#f59e0b", DONE: "#16a34a", CANCELLED: "#ef4444" };
const PRIORITY_COLORS: Record<string, string> = { URGENT: "#ef4444", HIGH: "#f59e0b", MEDIUM: "#0091ff", LOW: "#94a3b8", NONE: "#cbd5e1" };

function Reports() {
  const [days, setDays] = useState(30);
  const report = useQuery({ queryKey: ["nexus", "reports", days], queryFn: () => nexusApi.reports(`days=${days}`), retry: false });
  const d = report.data;
  const m = d?.metrics ?? {};

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Live workspace analytics — completion, throughput, and project health."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
            {RANGES.map((r) => (
              <button key={r.days} onClick={() => setDays(r.days)} className={cn("rounded-md px-3 py-1 text-sm font-semibold transition-colors", days === r.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>{r.label}</button>
            ))}
          </div>
        }
      />
      <div className="p-4 md:p-8 space-y-6">
        {report.isLoading && <ReportsSkeleton />}
        {report.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><BarChart3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">Reports unavailable</div><p className="mt-2 text-sm text-muted-foreground">You'll need to be logged in to see live analytics.</p></div>}

        {d && (
          <>
            <Reveal className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label="Total tasks" value={m.totalTasks ?? 0} />
              <Metric label="Completed" value={m.completedTasks ?? 0} trend={m.completionTrend} />
              <Metric label="Overdue" value={m.overdueTasks ?? 0} danger={(m.overdueTasks ?? 0) > 0} />
              <Metric label="Completion" value={`${m.completionRate ?? 0}%`} sub={m.avgCompletionDays != null ? `${m.avgCompletionDays}d avg` : undefined} />
            </Reveal>

            <Reveal delay={0.08} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <DistroCard title="By status" rows={(d.tasksByStatus ?? []).map((s) => ({ label: statusLabel(s.status), count: s.count, color: STATUS_COLORS[s.status] ?? "#7b68ee" }))} />
              <DistroCard title="By priority" rows={(d.tasksByPriority ?? []).map((p) => ({ label: statusLabel(p.priority), count: p.count, color: PRIORITY_COLORS[p.priority] ?? "#7b68ee" }))} />
            </Reveal>

            {(d.completionTimeline?.length ?? 0) > 0 && <Reveal delay={0.12}><TimelineCard timeline={d.completionTimeline!} /></Reveal>}

            {(d.tasksByAssignee?.length ?? 0) > 0 && (
              <Reveal delay={0.16}><Card title="Workload by assignee">
                <div className="space-y-2">
                  {d.tasksByAssignee!.slice(0, 12).map((a, i) => {
                    const total = a.total ?? 0; const done = a.completed ?? 0; const rate = total ? Math.round((done / total) * 100) : 0;
                    return (
                      <div key={a.userId ?? i} className="flex items-center gap-3">
                        <span className="w-40 shrink-0 truncate text-sm font-semibold">{a.name ?? "Unassigned"}</span>
                        <AnimatedBar pct={rate} className="h-2 flex-1 rounded-full bg-muted" barClassName="h-full rounded-full bg-primary" />
                        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{done}/{total}</span>
                      </div>
                    );
                  })}
                </div>
              </Card></Reveal>
            )}

            {(d.projectHealth?.length ?? 0) > 0 && (
              <Reveal delay={0.2}><Card title="Project health">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs uppercase tracking-wider text-muted-foreground"><th className="pb-2 pr-3 font-medium">Project</th><th className="pb-2 pr-3 font-medium">Done</th><th className="pb-2 pr-3 font-medium">Overdue</th><th className="pb-2 font-medium">Completion</th></tr></thead>
                    <tbody>
                      {d.projectHealth!.map((p, i) => (
                        <tr key={p.id ?? i} className="border-t border-border">
                          <td className="py-2.5 pr-3"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? "#7b68ee" }} /><span className="font-semibold">{p.name}</span></div></td>
                          <td className="py-2.5 pr-3 text-muted-foreground">{p.completed ?? 0}/{p.total ?? 0}</td>
                          <td className="py-2.5 pr-3">{(p.overdue ?? 0) > 0 ? <span className="font-semibold text-destructive">{p.overdue}</span> : <span className="text-muted-foreground">0</span>}</td>
                          <td className="py-2.5"><div className="flex items-center gap-2"><AnimatedBar pct={p.completionRate ?? 0} className="h-1.5 w-24 rounded-full bg-muted" barClassName="h-full rounded-full bg-primary" /><span className="text-xs font-semibold">{p.completionRate ?? 0}%</span></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card></Reveal>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, trend, sub, danger }: { label: string; value: string | number; trend?: number; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-pop">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-display text-2xl font-bold tracking-tight tabular-nums md:text-3xl", danger && "text-destructive")}>{typeof value === "number" ? <CountUp value={value} /> : value}</div>
      {trend != null && trend !== 0 && (
        <div className={cn("mt-1 inline-flex items-center gap-1 text-xs font-semibold", trend > 0 ? "text-success" : "text-destructive")}>
          {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {Math.abs(trend)}%
        </div>
      )}
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h3 className="mb-4 font-display text-base font-bold tracking-tight">{title}</h3>
      {children}
    </section>
  );
}

function DistroCard({ title, rows }: { title: string; rows: Array<{ label: string; count: number; color: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card title={title}>
      <div className="space-y-2.5">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No data.</p>}
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm font-semibold">{r.label}</span>
            <AnimatedBar pct={(r.count / max) * 100} className="h-3 flex-1 rounded-full bg-muted" barClassName="h-full rounded-full" barStyle={{ background: r.color }} />
            <span className="w-8 shrink-0 text-right text-xs font-semibold text-muted-foreground tabular-nums">{r.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TimelineCard({ timeline }: { timeline: NonNullable<NexusReports["completionTimeline"]> }) {
  const max = Math.max(1, ...timeline.map((t) => t.count));
  const reduce = useReducedMotion();
  return (
    <Card title="Completion timeline">
      <div className="flex h-40 items-end gap-1">
        {timeline.map((t, i) => {
          const h = `${Math.max(2, (t.count / max) * 100)}%`;
          return (
            <div key={t.date} className="group relative flex-1" title={`${t.date}: ${t.count}`}>
              <motion.div
                className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                style={reduce ? { height: h } : undefined}
                initial={reduce ? false : { height: 0 }}
                whileInView={reduce ? undefined : { height: h }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: Math.min(i, 30) * 0.015, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>{timeline[0]?.date?.slice(5)}</span><span>{timeline[timeline.length - 1]?.date?.slice(5)}</span></div>
    </Card>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <Skeleton className="mb-4 h-4 w-28" />
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-3 w-full" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

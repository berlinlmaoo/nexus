// "My team" / "Team": one row per crew member the viewer may see (direct reports for a manager,
// everyone for BoD/OAA/admin). Sortable, searchable; a row opens that person's report.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Flag, Search, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ReportRosterResponse, ReportRosterRow } from "@/lib/nexus-api";
import { fmtNum, fmtPct, ratioPct, ROLE_LABEL } from "./report-format";

type SortKey = "name" | "flags" | "completed" | "onTime" | "overdue" | "attendance" | "late" | "absent" | "reflections" | "xp";

const COLUMNS: { key: Exclude<SortKey, "name" | "flags">; label: string; title: string; value: (r: ReportRosterRow) => number | null; render: (r: ReportRosterRow) => string; tone?: (r: ReportRosterRow) => "danger" | "warning" | null }[] = [
  { key: "completed", label: "Done", title: "Tasks completed this period", value: (r) => r.headline.completed, render: (r) => fmtNum(r.headline.completed) },
  { key: "onTime", label: "On time", title: "Completed on or before the due date", value: (r) => ratioPct(r.headline.onTime), render: (r) => fmtPct(r.headline.onTime) },
  { key: "overdue", label: "Overdue", title: "Open tasks past their due date", value: (r) => r.headline.overdue, render: (r) => fmtNum(r.headline.overdue), tone: (r) => (r.headline.overdue > 0 ? "danger" : null) },
  { key: "attendance", label: "Attend.", title: "Attendance rate", value: (r) => ratioPct(r.headline.attendanceRate), render: (r) => fmtPct(r.headline.attendanceRate) },
  { key: "late", label: "Late", title: "Late check-ins", value: (r) => r.headline.late, render: (r) => fmtNum(r.headline.late), tone: (r) => (r.headline.late > 0 ? "warning" : null) },
  { key: "absent", label: "Absent", title: "Absent days", value: (r) => r.headline.absent, render: (r) => fmtNum(r.headline.absent), tone: (r) => (r.headline.absent > 0 ? "danger" : null) },
  { key: "reflections", label: "Reflect.", title: "Checkouts with a reflection", value: (r) => ratioPct(r.headline.reflectionRate), render: (r) => fmtPct(r.headline.reflectionRate) },
  { key: "xp", label: "XP", title: "XP this period", value: (r) => r.headline.xpScore, render: (r) => fmtNum(r.headline.xpScore) },
];

// Same words and tones as the iOS roster chips.
export const FLAG_LABEL: Record<keyof ReportRosterRow["flags"], string> = {
  overdue3: "3+ overdue",
  late3: "Late 3+ times",
  lowReflections: "Few reflections",
};
const FLAG_CHIP: Record<keyof ReportRosterRow["flags"], string> = {
  overdue3: "chip--danger",
  late3: "chip--warning",
  lowReflections: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

export function TeamRosterView({ data, onOpen, teamId, onTeamChange, teamOptions }: {
  data: ReportRosterResponse;
  onOpen: (userId: string) => void;
  teamId: string | null;
  onTeamChange: (teamId: string | null) => void;
  teamOptions: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "flags", dir: "desc" });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? data.rows.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.teams.some((t) => t.name.toLowerCase().includes(q)))
      : data.rows;
    const col = COLUMNS.find((c) => c.key === sort.key);
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "name") return mul * a.name.localeCompare(b.name);
      const va = sort.key === "flags" ? a.flagCount : col!.value(a);
      const vb = sort.key === "flags" ? b.flagCount : col!.value(b);
      // Rows with no data ("—") always sink, whichever way the column is sorted.
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;
      if (vb == null) return -1;
      return mul * (va - vb) || a.name.localeCompare(b.name);
    });
  }, [data.rows, query, sort]);

  const flagged = data.rows.filter((r) => r.flagCount > 0).length;
  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">{data.team?.name ?? (data.scope === "ALL" ? "Everyone" : "Your direct reports")}</span>
          <span className="text-xs font-bold text-muted-foreground">{data.rows.length} {data.rows.length === 1 ? "person" : "people"}</span>
          {flagged > 0 && <span className="chip chip--sm chip--warning"><Flag className="h-3 w-3" /> {flagged} need attention</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {teamOptions.length > 0 && (
            <select
              value={teamId ?? ""}
              onChange={(e) => onTeamChange(e.target.value || null)}
              aria-label="Filter by team"
              className="h-9 min-w-0 max-w-[12rem] flex-1 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-primary sm:flex-none"
            >
              <option value="">All teams</option>
              {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search crew"
              aria-label="Search crew"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState icon={Users} tone="muted" title={teamId ? "No one in this team" : "No one to show yet"} message={teamId ? "Pick another team, or show all teams." : data.scope === "ALL" ? "People join this list once they are members of the workspace." : "People appear here once the approval chart lists you as their manager."} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={Search} tone="muted" title={`No one matches “${query.trim()}”`} message="Search by name, email or team." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <SortTh sticky label="Name" active={sort.key === "name"} dir={sort.dir} onClick={() => toggle("name")} />
                  {COLUMNS.map((c) => <SortTh key={c.key} label={c.label} title={c.title} align="right" active={sort.key === c.key} dir={sort.dir} onClick={() => toggle(c.key)} />)}
                  <SortTh label="Flags" active={sort.key === "flags"} dir={sort.dir} onClick={() => toggle("flags")} />
                  <th className="w-6 border-b border-border" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.userId}
                    tabIndex={0}
                    onClick={() => onOpen(r.userId)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.userId); } }}
                    className="group cursor-pointer outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60"
                  >
                    <td className="sticky left-0 z-[1] max-w-[11rem] border-b border-border bg-card px-3 py-2.5 transition-colors group-hover:bg-accent group-focus-visible:bg-accent sm:max-w-[16rem]">
                      <div className="flex items-center gap-2.5">
                        <Avatar userId={r.userId} name={r.name} avatar={r.avatar} size={30} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{r.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{[r.role ? ROLE_LABEL[r.role] ?? r.role : null, ...r.teams.map((t) => t.name)].filter(Boolean).join(" · ") || r.email}</div>
                        </div>
                      </div>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={cn("whitespace-nowrap border-b border-border px-3 py-2.5 text-right tabular-nums", c.tone?.(r) === "danger" ? "font-semibold text-destructive" : c.tone?.(r) === "warning" ? "font-semibold text-warning" : c.value(r) == null ? "text-muted-foreground" : "")}>{c.render(r)}</td>
                    ))}
                    <td className="border-b border-border px-3 py-2.5">
                      {r.flagCount === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-nowrap gap-1">
                          {(Object.keys(FLAG_LABEL) as (keyof ReportRosterRow["flags"])[]).filter((k) => r.flags[k]).map((k) => (
                            <span key={k} className={cn("chip chip--sm whitespace-nowrap", FLAG_CHIP[k])}>{FLAG_LABEL[k]}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="border-b border-border pr-2 text-muted-foreground"><ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-center text-[11px] text-muted-foreground">Tasks shared by several people are split between them, so counts can be fractional.</p>
    </div>
  );
}

function SortTh({ label, title, active, dir, onClick, align, sticky }: { label: string; title?: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "right"; sticky?: boolean }) {
  return (
    <th
      scope="col"
      title={title}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("whitespace-nowrap border-b border-border bg-muted/40 px-3 py-2 font-semibold", sticky && "sticky left-0 z-[2] bg-card", align === "right" && "text-right")}
    >
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground", active && "text-foreground")}>
        {label}
        {active ? (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <span className="w-3" />}
      </button>
    </th>
  );
}

export function TeamRosterSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading team">
      <div className="flex justify-between"><Skeleton className="h-5 w-32" /><Skeleton className="h-9 w-56" /></div>
      <div className="rounded-2xl border border-border bg-card p-3 shadow-soft">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border py-2.5 last:border-0">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="ml-auto h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Reports per crew. Everyone sees their own report ("Me"); a manager also sees their direct reports
// and BoD/OAA/admin see everyone ("My team" / "Team"). Staff never see anyone else — the server
// enforces that (viewerScope SELF, 403 REPORT_SELF_ONLY); this page only follows its lead.
// /reports/$userId is a child route: it renders through the <Outlet /> below.
import { useState } from "react";
import { createFileRoute, Outlet, useChildMatches, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { nexusApi } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { PersonReportSkeleton, PersonReportView, ReportError } from "@/components/reports/PersonReportView";
import { TeamRosterSkeleton, TeamRosterView } from "@/components/reports/TeamRosterView";
import { PeriodSelect } from "@/components/reports/PeriodSelect";
import { errorMessage, isPeriodKey, reportErrorCode, reportRetry, type ReportsSearch } from "@/components/reports/report-format";

export const Route = createFileRoute("/_app/reports")({
  // `period` = attendance period key "YYYY-MM" (28→27); absent = current. `tab` survives the trip to a
  // person's report and back, so "Back to team" lands on the team table for the same period.
  validateSearch: (s: Record<string, unknown>): ReportsSearch => ({
    period: isPeriodKey(s.period) ? s.period : undefined,
    tab: s.tab === "team" ? "team" : undefined,
  }),
  component: ReportsRoute,
  head: () => ({ meta: [{ title: "NEXUS Phaëthon — Reports" }] }),
});

function ReportsRoute() {
  const children = useChildMatches();
  if (children.length > 0) return <Outlet />;
  return <Reports />;
}

function Reports() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/reports" });
  const period = search.period;
  const [teamId, setTeamId] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ["nexus", "reports", "person", "me", period ?? "current"],
    queryFn: () => nexusApi.personReport("me", period),
    retry: reportRetry,
    staleTime: 60_000,
  });

  const scope = me.data?.viewerScope;
  const canSeeTeam = scope != null && scope !== "SELF";
  const wantTeam = search.tab === "team" && canSeeTeam;

  const roster = useQuery({
    queryKey: ["nexus", "reports", "roster", period ?? "current", teamId ?? "all"],
    queryFn: () => nexusApi.reportRoster({ period, teamId }),
    enabled: wantTeam,
    retry: reportRetry,
    staleTime: 60_000,
  });
  // Team options come from the unfiltered roster, so picking a team doesn't shrink the list of teams.
  const allRoster = useQuery({
    queryKey: ["nexus", "reports", "roster", period ?? "current", "all"],
    queryFn: () => nexusApi.reportRoster({ period }),
    enabled: wantTeam && teamId != null,
    retry: reportRetry,
    staleTime: 60_000,
  });

  // The server has the last word: if it says this viewer may only see themselves, there is no team tab.
  const selfOnly = !canSeeTeam || reportErrorCode(roster.error) === "REPORT_SELF_ONLY";
  const tab: "me" | "team" = wantTeam && !selfOnly ? "team" : "me";
  const teamLabel = scope === "ALL" ? "Team" : "My team";

  const teamOptions = (() => {
    const src = (teamId ? allRoster.data : roster.data)?.rows ?? [];
    const map = new Map<string, string>();
    for (const r of src) for (const t of r.teams) map.set(t.id, t.name);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  })();

  const setSearch = (next: Partial<ReportsSearch>) => navigate({ search: (prev: ReportsSearch) => ({ ...prev, ...next }), replace: true });

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={tab === "team" ? `How your ${scope === "ALL" ? "crew" : "direct reports"} are doing this period.` : "Your work, attendance and XP for the period."}
        icon={<BarChart3 className="h-6 w-6 text-primary" />}
        actions={<PeriodSelect value={period} onChange={(p) => setSearch({ period: p })} />}
        tabs={canSeeTeam && !selfOnly ? (
          <div role="tablist" aria-label="Report view" className="mb-3 inline-flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
            {([["me", "Me"], ["team", teamLabel]] as const).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setSearch({ tab: key === "team" ? "team" : undefined })}
                className={cn("rounded-md px-4 py-1 text-sm font-semibold transition-colors", tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
              >
                {label}
              </button>
            ))}
          </div>
        ) : undefined}
      />
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        {me.isLoading && search.tab === "team" ? <TeamRosterSkeleton /> : tab === "me" ? (
          me.isLoading ? <PersonReportSkeleton /> :
          me.isError ? <ReportError title="Couldn't load your report" message={errorMessage(me.error)} onRetry={() => me.refetch()} retrying={me.isFetching} /> :
          me.data ? <PersonReportView data={me.data} /> : null
        ) : (
          roster.isLoading ? <TeamRosterSkeleton /> :
          roster.isError ? <ReportError title="Couldn't load the team" message={errorMessage(roster.error)} onRetry={() => roster.refetch()} retrying={roster.isFetching} /> :
          roster.data ? (
            <TeamRosterView
              data={roster.data}
              teamId={teamId}
              onTeamChange={setTeamId}
              teamOptions={teamOptions}
              onOpen={(userId) => navigate({ to: "/reports/$userId", params: { userId }, search: (prev: ReportsSearch) => ({ ...prev, tab: "team" }) })}
            />
          ) : null
        )}
      </div>
    </div>
  );
}

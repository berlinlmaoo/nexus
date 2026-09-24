// One crew member's report, opened from the team table on /reports. Rendered through the parent
// route's <Outlet />, so it shares the parent's `period` / `tab` search params.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Lock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { nexusApi } from "@/lib/nexus-api";
import { PersonReportSkeleton, PersonReportView, ReportError } from "@/components/reports/PersonReportView";
import { PeriodSelect } from "@/components/reports/PeriodSelect";
import { errorMessage, reportErrorCode, reportRetry, type ReportsSearch } from "@/components/reports/report-format";

export const Route = createFileRoute("/_app/reports/$userId")({
  component: PersonReportPage,
  head: () => ({ meta: [{ title: "NEXUS Phaëthon — Report" }] }),
});

function PersonReportPage() {
  const { userId } = Route.useParams();
  const search = Route.useSearch() as ReportsSearch;
  const navigate = useNavigate({ from: "/reports/$userId" });
  const period = search.period;

  const report = useQuery({
    queryKey: ["nexus", "reports", "person", userId, period ?? "current"],
    queryFn: () => nexusApi.personReport(userId, period),
    retry: reportRetry,
    staleTime: 60_000,
  });

  const code = reportErrorCode(report.error);
  const blocked = code === "REPORT_OUT_OF_SCOPE" || code === "REPORT_SELF_ONLY";
  const backSearch: ReportsSearch = { period, tab: code === "REPORT_SELF_ONLY" ? undefined : "team" };

  return (
    <div>
      <PageHeader
        title={report.data ? report.data.person.name : "Report"}
        subtitle={report.data ? (report.data.person.isSelf ? "Your work, attendance and XP for the period." : "Work, attendance and XP for the period.") : undefined}
        icon={<BarChart3 className="h-6 w-6 text-primary" />}
        actions={<PeriodSelect value={period} onChange={(p) => navigate({ search: (prev: ReportsSearch) => ({ ...prev, period: p }), replace: true })} />}
      />
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        <Link to="/reports" search={backSearch} className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {backSearch.tab === "team" ? "Back to team" : "Back to reports"}
        </Link>
        {report.isLoading ? <PersonReportSkeleton /> :
          blocked ? (
            <EmptyState icon={Lock} tone="muted" title="Not in your view" message={errorMessage(report.error)} />
          ) : report.isError ? (
            <ReportError title="Couldn't load this report" message={errorMessage(report.error)} onRetry={() => report.refetch()} retrying={report.isFetching} />
          ) : report.data ? <PersonReportView data={report.data} showIdentity /> : null}
      </div>
    </div>
  );
}

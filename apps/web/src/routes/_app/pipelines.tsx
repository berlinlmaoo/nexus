import { createFileRoute } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { useLang } from "@/lib/lang";
import { PageHeader } from "@/components/PageHeader";
import { PipelineView } from "@/components/pipeline/PipelineView";
import { PipelineTitleSwitcher } from "@/components/pipeline/AllPipelinesEntry";

/**
 * All Pipelines (owner, 21 Oct 2026): every company's Pipeline board in one read-only view, for BoD and One Above
 * All. The server decides (GET /api/pipelines/all answers 403 to anyone else, and the page then says so).
 */
export const Route = createFileRoute("/_app/pipelines")({
  component: AllPipelinesPage,
});

function AllPipelinesPage() {
  const { t } = useLang();
  return (
    <div data-page-canvas="card" className="min-h-dvh bg-card max-md:-mb-(--tabbar-room) max-md:pb-(--tabbar-room)">
      <PageHeader
        compact
        hero
        className="bg-card md:bg-card max-md:bg-card max-md:before:bg-card [--page-header-bg:var(--card)]"
        icon={<span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary md:h-10 md:w-10"><Layers aria-hidden className="h-5 w-5" /></span>}
        title={<PipelineTitleSwitcher title={t("All Pipelines")} current={null} />}
        subtitle={t("Every company's pipeline board, combined. Read-only: open a deal to change it in its own board.")}
      />
      <PipelineView mode="all" />
    </div>
  );
}

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mic, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageBody } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { BetaBadge } from "@/components/meetings/BetaBadge";
import { NewMeetingDialog } from "@/components/meetings/NewMeetingDialog";
import { MeetingStatusChip } from "@/components/meetings/MeetingPage";
import { useLang } from "@/lib/lang";
import { durationText, queueLine, useMeetingList, useMeetingNotesEnabled } from "@/lib/meetings";

/** Meeting notes (Beta, 18 Oct 2026): the person's recordings, newest first. ?projectId= shows a project's. */
export const Route = createFileRoute("/_app/meetings/")({
  validateSearch: (s: Record<string, unknown>): { projectId?: string } => (typeof s.projectId === "string" && s.projectId ? { projectId: s.projectId } : {}),
  component: MeetingsPage,
});

function MeetingsPage() {
  const { t, lang } = useLang();
  const { projectId } = Route.useSearch();
  const list = useMeetingList(projectId ?? null);
  const enabled = useMeetingNotesEnabled();
  const [open, setOpen] = useState(false);
  const rows = list.data?.meetings ?? [];
  const newButton = enabled ? (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sidebar-primary px-3 text-sm font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary/90"><Plus className="h-4 w-4" />{t("New meeting notes")}</button>
  ) : null;
  return (
    <div className="min-h-dvh">
      <PageHeader
        title={t("Meeting notes")}
        subtitle={t("GIDEON turns a meeting recording into an overview, minutes and tasks.")}
        icon={<BetaBadge className="self-center" />}
        actions={newButton}
      />
      <PageBody>
        {list.isLoading ? (
          <div className="space-y-2" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/60" />)}</div>
        ) : list.isError ? (
          <LoadError error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Mic} title={t("No meeting notes yet")} message={t("Upload or record a meeting. GIDEON writes the minutes and suggests tasks; you check them before anything is added.")} action={newButton} />
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {rows.map((m) => (
              <Link key={m.id} to="/meetings/$meetingId" params={{ meetingId: m.id }} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-sidebar-primary"><Mic className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.title || m.audio.name || t("Untitled meeting")}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[m.project?.name, new Date(m.recordedAt ?? m.createdAt).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" }), durationText(m.durationSec, t)].filter(Boolean).join(" · ")}
                  </span>
                  {queueLine(m.queue, m.status, t) && <span className="mt-0.5 block truncate text-xs font-medium text-sidebar-primary">{queueLine(m.queue, m.status, t)}</span>}
                </span>
                <MeetingStatusChip status={m.status} waiting={m.queue?.waiting} className="shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </PageBody>
      <NewMeetingDialog open={open} onOpenChange={setOpen} projectId={projectId ?? null} />
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronDown, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { nexusApi } from "@/lib/nexus-api";
import { allPipelinesApi, pipelineBoardsKey, type PipelineBoardRef } from "@/lib/pipeline-api";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePipelineV8 } from "@/lib/meetings";
import { usePresentingMode } from "./presentation";

/**
 * The ways into All Pipelines (owner, 21 Oct 2026), for BoD and One Above All only: a pinned row on Projects and
 * a switcher in a Pipeline board's title. Anyone else never sees either — and the server answers 403 to them
 * anyway (GET /api/pipelines/*), so hiding is not the guard.
 */

const WIDE_ROLES = new Set(["ONE_ABOVE_ALL", "BOD"]);

/**
 * The Pipeline boards for a BoD / One Above All viewer; null for anyone else (no request is made for them), and
 * null for everyone while the web's 0.1.7 launch switch is off (lib/web-launch.ts): no row, no switcher.
 */
export function usePipelineBoards(workspaceId?: string): PipelineBoardRef[] | null {
  const launched = usePipelineV8();
  const wsm = useQuery({
    queryKey: ["nexus", "workspace-members", workspaceId || "any"],
    queryFn: () => nexusApi.workspaceMembers(workspaceId || undefined),
    retry: false,
    staleTime: 300_000,
  });
  const wide = launched && WIDE_ROLES.has(wsm.data?.role ?? "");
  const boards = useQuery({ queryKey: pipelineBoardsKey, queryFn: allPipelinesApi.boards, retry: false, staleTime: 60_000, enabled: wide });
  return wide && boards.data ? boards.data.boards : null;
}

/**
 * Going to All Pipelines. With Presentation mode on, it asks first ("Show all companies?"): the screen may be
 * shown to one company, and the combined view names the others. The mode itself stays on across the switch.
 */
export function useGoAllPipelines() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [presenting] = usePresentingMode();
  const [asking, setAsking] = useState(false);
  const go = () => navigate({ to: "/pipelines" });
  const request = () => (presenting ? setAsking(true) : go());
  const dialog = (
    <AlertDialog open={asking} onOpenChange={setAsking}>
      <AlertDialogContent lang={lang}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Show all companies?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("Presentation mode is on. All Pipelines shows the deals of every company's board on this screen. Amounts stay hidden.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { setAsking(false); go(); }}>{t("Show all companies")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { request, dialog };
}

/**
 * A Pipeline board's title: plain text for everyone, a small switcher for BoD / One Above All — the boards they
 * can open, then "All Pipelines" at the bottom. On All Pipelines itself (`current` null) the same switcher.
 */
export function PipelineTitleSwitcher({ title, current, workspaceId }: { title: string; current: string | null; workspaceId?: string }) {
  const { t, tn } = useLang();
  const navigate = useNavigate();
  const boards = usePipelineBoards(workspaceId);
  const all = useGoAllPipelines();
  if (!boards) return <>{title}</>;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-pl="board-switcher"
          // A button is laid out as one block inside the heading, so the heading's two-line clamp never reached the
          // name (3 lines at 1440, 5 at 390; QA final #2 pre-run, P-1). The name clamps itself the same way as the
          // plain project title (two lines, between words, balanced) and PageHeader's fit shrinks it to 75% first
          // (data-title-clamp); the chevron sits after it and is never cut off.
          className="-mx-1 inline-flex max-w-full items-end rounded-md px-1 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          title={t("Switch pipeline board")}
        >
          <span data-title-clamp className="min-w-0 line-clamp-2 whitespace-normal break-words [text-wrap:balance]">{title}</span>
          <ChevronDown aria-hidden className="mb-[0.2em] ml-1 h-5 w-5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t("Pipeline boards")}</DropdownMenuLabel>
          {boards.map((b) => (
            <DropdownMenuItem key={b.id} onSelect={() => { if (b.id !== current) navigate({ to: "/projects/$projectId", params: { projectId: b.id } }); }} className="gap-2">
              <Check aria-hidden className={cn("h-4 w-4 shrink-0", b.id === current ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tn(b.dealCount, "{n} deal", "{n} deals")}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { if (current !== null) all.request(); }} className="gap-2 font-medium">
            {current === null ? <Check aria-hidden className="h-4 w-4 shrink-0" /> : <Layers aria-hidden className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{t("All Pipelines")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {all.dialog}
    </>
  );
}

/** The pinned "All Pipelines" row at the top of Projects (BoD / One Above All only; nothing for anyone else). */
export function AllPipelinesRow({ workspaceId }: { workspaceId?: string }) {
  const { t, tn } = useLang();
  const boards = usePipelineBoards(workspaceId);
  const all = useGoAllPipelines();
  if (!boards) return null;
  return (
    <>
      <Link
        to="/pipelines"
        data-pl="all-pipelines-row"
        onClick={(e) => { e.preventDefault(); all.request(); }}
        className="group flex items-center gap-3 rounded-[28px] border border-border bg-card p-4 shadow-soft transition hover:bg-accent/50"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Layers aria-hidden className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold group-hover:text-primary">{t("All Pipelines")}</div>
          <div className="truncate text-xs text-muted-foreground">{tn(boards.length, "{n} board · combined", "{n} boards · combined")}</div>
        </div>
        <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
      </Link>
      {all.dialog}
    </>
  );
}

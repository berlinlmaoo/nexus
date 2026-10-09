import { BarChart3, CalendarRange, Filter, ListChecks } from "lucide-react";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { PROJECT_TYPES, type ProjectTypeId } from "@/components/projects/project-tabs";

/**
 * The first step of "New project" (owner, 9 Oct 2026): what the project is for. Task Project and
 * Pipeline Dashboard exist (the pipeline since the same day: the GM's deal board, components/pipeline);
 * Finance Dashboard and Content Planner are announced as coming soon and cannot be picked (the server
 * refuses them too, 400 TYPE_COMING_SOON).
 */
const META: Record<ProjectTypeId, { icon: typeof ListChecks; title: string; body: string }> = {
  TASK: { icon: ListChecks, title: "Task Project", body: "Board, list, calendar and timeline for work with owners and due dates." },
  FINANCE: { icon: BarChart3, title: "Finance Dashboard", body: "Revenue, OPEX and profit, month by month." },
  CONTENT: { icon: CalendarRange, title: "Content Planner", body: "Plan and schedule content across your channels." },
  PIPELINE: { icon: Filter, title: "Pipeline Dashboard", body: "Follow every deal from first contact to paid." },
};

/**
 * `pipeline` (owner/GM, 9 Oct 2026): the company has ONE pipeline board for every deal, open to its project
 * members (added by its lead, like any project — owner, 9 Oct 2026 evening). The card is offered to its
 * members, where picking it opens the board, and to everyone while no board exists yet; not to anyone
 * else, for whom a second one would only be refused (409).
 */
export function ProjectTypePicker({ onPick, pipeline }: { onPick: (type: ProjectTypeId) => void; pipeline?: { allowed: boolean; exists: boolean } }) {
  const { t } = useLang();
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {PROJECT_TYPES.filter(({ id }) => id !== "PIPELINE" || !pipeline || pipeline.allowed).map(({ id, available }) => {
        const m = id === "PIPELINE" && pipeline?.exists
          ? { ...META.PIPELINE, body: "Opens the company's pipeline: one board for every deal." }
          : META[id];
        const Icon = m.icon;
        return (
          <button
            key={id}
            type="button"
            disabled={!available}
            onClick={() => available && onPick(id)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition",
              available
                ? "border-border bg-background hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]"
                : "cursor-not-allowed border-dashed border-border bg-muted/30",
            )}
          >
            <span className="mb-1 flex w-full items-start justify-between gap-2">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", available ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <Icon className="h-4 w-4" />
              </span>
              {!available && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("Coming soon")}
                </span>
              )}
            </span>
            <span className={cn("text-sm font-bold", !available && "text-muted-foreground")}>{t(m.title)}</span>
            <span className="text-xs leading-snug text-muted-foreground">{t(m.body)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The chosen type, shown above the details form, with a way back to the picker. */
export function ProjectTypeChosen({ type, onChange }: { type: ProjectTypeId; onChange: () => void }) {
  const { t } = useLang();
  const m = META[type];
  const Icon = m.icon;
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/5 px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
        <Icon className="h-3.5 w-3.5" /> {t(m.title)}
      </span>
      <button type="button" onClick={onChange} className="font-semibold text-muted-foreground transition-colors hover:text-foreground">
        {t("Change type")}
      </button>
    </div>
  );
}

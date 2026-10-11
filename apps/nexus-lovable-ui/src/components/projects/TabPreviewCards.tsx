// Tab picker for New project (owner, 11 Oct 2026): each tab is a card with a small drawing of what the
// view looks like, so people pick by sight rather than by name. Same keys and rules as Project settings
// → Tabs (Board or List stays on). The drawings are plain blocks in theme tokens, no images.
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { PROJECT_TAB_KEYS, PROJECT_TAB_LABELS, TASK_VIEW_TAB_KEYS, type ProjectTabKey } from "@/components/projects/project-tabs";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

const DESC: Record<ProjectTabKey, string> = {
  overview: "Progress, members and what's due",
  board: "Cards in columns by status",
  list: "Tasks as a simple checklist",
  table: "Rows and columns with every field",
  sheet: "A spreadsheet with formulas",
  calendar: "Tasks on a month by due date",
  timeline: "Start-to-end bars, Gantt style",
  automations: "When this happens, do that",
  pages: "Docs and notes for the project",
  forms: "Collect requests as tasks",
  chat: "The project's group chat",
};

const Bar = ({ className }: { className?: string }) => <span className={cn("block h-1 rounded-full bg-foreground/15", className)} />;
const Box = ({ className }: { className?: string }) => <span className={cn("block rounded-[3px] bg-background ring-1 ring-foreground/10", className)} />;
const Hit = "bg-primary/70";

function Thumb({ tab }: { tab: ProjectTabKey }): ReactNode {
  switch (tab) {
    case "overview":
      return (
        <div className="flex h-full flex-col gap-1.5">
          <div className="grid grid-cols-3 gap-1">{[0, 1, 2].map((i) => <Box key={i} className="h-4" />)}</div>
          <div className="flex flex-1 items-end gap-1 px-0.5">{[40, 70, 55, 90, 65].map((h, i) => <span key={i} className={cn("flex-1 rounded-t-[2px]", i === 3 ? Hit : "bg-foreground/15")} style={{ height: `${h}%` }} />)}</div>
        </div>
      );
    case "board":
      return (
        <div className="grid h-full grid-cols-3 gap-1">
          {[3, 2, 1].map((n, c) => (
            <div key={c} className="flex flex-col gap-1 rounded-[3px] bg-foreground/5 p-0.5">
              {Array.from({ length: n }, (_, i) => <Box key={i} className={cn("h-2.5", c === 1 && i === 0 && "ring-primary/60")} />)}
            </div>
          ))}
        </div>
      );
    case "list":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", i < 2 ? Hit : "ring-1 ring-foreground/25")} />
              <Bar className={i % 2 ? "w-3/5" : "w-4/5"} />
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="grid h-full grid-cols-4 grid-rows-4 overflow-hidden rounded-[3px] ring-1 ring-foreground/10">
          {Array.from({ length: 16 }, (_, i) => <span key={i} className={cn("border-b border-r border-foreground/10", i < 4 ? "bg-foreground/10" : "bg-background")} />)}
        </div>
      );
    case "sheet":
      return (
        <div className="grid h-full grid-cols-6 grid-rows-5 overflow-hidden rounded-[3px] ring-1 ring-foreground/10">
          {Array.from({ length: 30 }, (_, i) => <span key={i} className={cn("border-b border-r border-foreground/10", i < 6 || i % 6 === 0 ? "bg-foreground/10" : i === 14 ? "bg-primary/25 ring-1 ring-inset ring-primary" : "bg-background")} />)}
        </div>
      );
    case "calendar":
      return (
        <div className="grid h-full grid-cols-7 grid-rows-4 gap-0.5">
          {Array.from({ length: 28 }, (_, i) => <span key={i} className={cn("rounded-[2px]", [3, 9, 10, 18, 23].includes(i) ? (i === 9 || i === 10 ? Hit : "bg-primary/35") : "bg-foreground/[0.07]")} />)}
        </div>
      );
    case "timeline":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5">
          {[[0, 45], [20, 40], [45, 35], [60, 30]].map(([l, w], i) => <span key={i} className={cn("block h-2 rounded-full", i === 1 ? Hit : "bg-foreground/20")} style={{ marginLeft: `${l}%`, width: `${w}%` }} />)}
        </div>
      );
    case "automations":
      return (
        <div className="flex h-full items-center justify-center gap-1">
          <Box className="h-5 w-7" />
          <span className="h-px w-3 bg-foreground/30" />
          <span className={cn("h-5 w-5 rotate-45 rounded-[3px]", Hit)} />
          <span className="h-px w-3 bg-foreground/30" />
          <Box className="h-5 w-7" />
        </div>
      );
    case "pages":
      return (
        <div className="mx-auto flex h-full w-4/5 flex-col gap-1 rounded-[3px] bg-background p-1.5 ring-1 ring-foreground/10">
          <span className="block h-1.5 w-1/2 rounded-full bg-foreground/40" />
          <Bar /><Bar className="w-5/6" /><Bar className="w-2/3" />
        </div>
      );
    case "forms":
      return (
        <div className="mx-auto flex h-full w-4/5 flex-col justify-center gap-1">
          <Bar className="w-1/3" /><Box className="h-2.5" />
          <Bar className="w-1/4" /><Box className="h-2.5" />
          <span className={cn("ml-auto block h-2.5 w-1/3 rounded-full", Hit)} />
        </div>
      );
    case "chat":
      return (
        <div className="flex h-full flex-col justify-center gap-1">
          <span className="block h-2.5 w-3/5 rounded-full rounded-bl-[2px] bg-foreground/15" />
          <span className={cn("ml-auto block h-2.5 w-1/2 rounded-full rounded-br-[2px]", Hit)} />
          <span className="block h-2.5 w-2/5 rounded-full rounded-bl-[2px] bg-foreground/15" />
        </div>
      );
  }
}

export function TabPreviewCards({ hidden, onChange }: { hidden: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLang();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {PROJECT_TAB_KEYS.map((key) => {
        const shown = !hidden.includes(key);
        // Board or List stays on, as in Project settings: a task project needs a way to see its tasks.
        const lastTaskView = shown && (TASK_VIEW_TAB_KEYS as readonly string[]).includes(key) && TASK_VIEW_TAB_KEYS.filter((k) => !hidden.includes(k)).length === 1;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={shown}
            disabled={lastTaskView}
            title={lastTaskView ? t("Board or List stays on") : undefined}
            onClick={() => onChange(shown ? [...hidden, key] : hidden.filter((k) => k !== key))}
            className={cn(
              "group flex flex-col gap-1.5 rounded-2xl border p-2 text-left transition-[border-color,background-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed",
              shown ? "border-primary/50 bg-primary/[0.04]" : "border-border bg-background opacity-60 hover:opacity-90",
            )}
          >
            <div className={cn("h-14 rounded-xl bg-muted/60 p-2", !shown && "grayscale")} aria-hidden>
              <Thumb tab={key} />
            </div>
            <div className="min-w-0 px-0.5">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{t(PROJECT_TAB_LABELS[key])}</span>
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full", shown ? "bg-primary text-primary-foreground" : "ring-1 ring-border")}>
                  {shown && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
              </div>
              <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{t(DESC[key])}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

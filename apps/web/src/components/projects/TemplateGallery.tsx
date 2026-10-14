// New project gallery (owner, 12 Oct 2026, DEV item #8): "Blank" first, then the templates from the
// server registry (GET /api/project-templates, src/lib/project-templates.ts of the Next app) and the two
// dashboards that are project TYPES (Outlet Sales, Social Media Report, Pipeline). Notion's picker is the model: search,
// categories, cards with a one-line blurb and a small drawing of what the project will look like.
//
// Nothing here knows a template by name. A card and its preview are drawn from the template's data
// (sections, fields, preview layout), so a template added on the server shows up without a web change.
// The drawings use the same plain blocks in theme tokens as TabPreviewCards.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useEdgeFade } from "@/hooks/use-edge-fade";
import { useQuery } from "@tanstack/react-query";
import {
  Bug, CalendarRange, FileText, Filter, Flag, Images, Lightbulb, ListChecks, Map as MapIcon, Megaphone, Package,
  PartyPopper, Plus, Search, StickyNote, Store, Target, Users, X, Heart,
} from "lucide-react";
import { nexusApi, type NexusL, type NexusProjectTemplate, type NexusTemplateColor } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

export type DashboardType = "OUTLET_SALES" | "SOCIAL_MEDIA_REPORT" | "PIPELINE";

export type GalleryPick =
  | { kind: "blank" }
  | { kind: "type"; type: DashboardType }
  | { kind: "template"; template: NexusProjectTemplate };

const ICONS: Record<string, typeof ListChecks> = {
  Bug, CalendarRange, FileText, Flag, Images, Lightbulb, ListChecks, Map: MapIcon, Megaphone, Package, PartyPopper, StickyNote, Target, Users,
};
export function templateIcon(name?: string | null) {
  return (name && ICONS[name]) || ListChecks;
}

/** Card wash and icon colour per template tint. Full class strings so Tailwind keeps them. */
const TINT: Record<NexusTemplateColor, { wash: string; icon: string }> = {
  gray: { wash: "bg-slate-500/[0.06]", icon: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  brown: { wash: "bg-amber-800/[0.06]", icon: "bg-amber-800/15 text-amber-900 dark:text-amber-200" },
  orange: { wash: "bg-orange-500/[0.07]", icon: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  yellow: { wash: "bg-yellow-500/[0.08]", icon: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-200" },
  green: { wash: "bg-emerald-500/[0.07]", icon: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  blue: { wash: "bg-sky-500/[0.07]", icon: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  purple: { wash: "bg-violet-500/[0.07]", icon: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  pink: { wash: "bg-pink-500/[0.07]", icon: "bg-pink-500/15 text-pink-700 dark:text-pink-300" },
  red: { wash: "bg-rose-500/[0.07]", icon: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
};
/** Option chips in the previews, Notion's colours. */
export const CHIP: Record<NexusTemplateColor, string> = {
  gray: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  brown: "bg-amber-800/15 text-amber-900 dark:text-amber-200",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  yellow: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-200",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  blue: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  purple: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  red: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

/** Category ids from the registry, plus "dashboards" for the two typed projects. English, through t(). */
const CATEGORY_LABEL: Record<string, string> = {
  marketing: "Marketing",
  projects: "Projects & tasks",
  docs: "Docs & meetings",
  planning: "Planning",
  operations: "Operations",
  dashboards: "Dashboards",
};
const CATEGORY_ORDER = ["marketing", "projects", "docs", "planning", "operations", "dashboards"];

const DASHBOARDS: { type: DashboardType; icon: typeof Store; title: string; body: string }[] = [
  // Owner, 10 Oct 2026 (for Ryan). One project = one outlet.
  { type: "OUTLET_SALES", icon: Store, title: "Outlet Sales Dashboard", body: "One outlet: sales and pax against the month's target, a calendar of events, and a report form for every night." },
  // Owner, 14 Oct 2026: per day and platform the team's views, likes, comments, shares and posts.
  { type: "SOCIAL_MEDIA_REPORT", icon: Heart, title: "Social Media Report", body: "Daily views, likes, comments, shares and posts per platform, against monthly and daily targets." },
  { type: "PIPELINE", icon: Filter, title: "Pipeline Dashboard", body: "Follow every deal from first contact to paid." },
];

const say = (text: NexusL, lang: string) => (lang === "en" ? text.en : text.id || text.en);

/**
 * `pipeline`: the Pipeline card is offered to people in the company workspace only (`allowed`), as in the
 * old type picker.
 */
export function TemplateGallery({ onPick, pipeline }: { onPick: (pick: GalleryPick) => void; pipeline?: { allowed: boolean } }) {
  const { t, lang } = useLang();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const chipStrip = useRef<HTMLDivElement>(null);
  const list = useQuery({ queryKey: ["nexus", "project-templates"], queryFn: () => nexusApi.projectTemplates(), staleTime: 5 * 60_000, retry: 1 });
  const templates = list.data?.templates ?? [];
  const dashboards = DASHBOARDS.filter((d) => d.type !== "PIPELINE" || !pipeline || pipeline.allowed);

  const needle = query.trim().toLowerCase();
  const matches = (...texts: string[]) => !needle || texts.some((x) => x.toLowerCase().includes(needle));
  const shownTemplates = useMemo(
    () => templates.filter((tp) =>
      (category === "all" || tp.category === category) &&
      matches(tp.name.en, tp.name.id, tp.blurb.en, tp.blurb.id, ...tp.fields.flatMap((f) => [f.name.en, f.name.id]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, category, needle],
  );
  const shownDashboards = dashboards.filter((d) => (category === "all" || category === "dashboards") && matches(d.title, t(d.title), d.body, t(d.body)));
  const showBlank = category === "all" && matches("blank", t("Blank project"), t("Start empty"));
  const categories = CATEGORY_ORDER.filter((c) => c === "dashboards" ? dashboards.length > 0 : templates.some((tp) => tp.category === c));
  // The category chips scroll sideways on a phone; the cut edge fades (it was a hard cut, audit 12 Oct 2026).
  const chipFade = useEdgeFade(chipStrip, [categories.length, lang]);
  const nothing = !showBlank && shownTemplates.length === 0 && shownDashboards.length === 0 && !list.isLoading;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search templates")}
            aria-label={t("Search templates")}
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-8 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={t("Clear search")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
      </div>
      <div ref={chipStrip} className={cn("relative -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", chipFade)} role="tablist" aria-label={t("Template categories")}>
        {["all", ...categories].map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              category === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {c === "all" ? t("All") : t(CATEGORY_LABEL[c] ?? c)}
          </button>
        ))}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {showBlank && (
          <Card
            onClick={() => onPick({ kind: "blank" })}
            wash="bg-muted/40"
            icon={<Plus className="h-4 w-4" />}
            iconClass="bg-primary/10 text-primary"
            title={t("Blank project")}
            body={t("Start empty: To Do, In Progress and Done. You pick the tabs.")}
            preview={<BlankPreview />}
          />
        )}
        {list.isLoading && Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[13.5rem] animate-pulse rounded-2xl border border-border bg-muted/40" aria-hidden />
        ))}
        {shownTemplates.map((tp) => {
          const Icon = templateIcon(tp.icon);
          const tint = TINT[tp.tint] ?? TINT.gray;
          return (
            <Card
              key={tp.id}
              onClick={() => onPick({ kind: "template", template: tp })}
              wash={tint.wash}
              icon={<Icon className="h-4 w-4" />}
              iconClass={tint.icon}
              title={say(tp.name, lang)}
              body={say(tp.blurb, lang)}
              preview={<TemplatePreview template={tp} lang={lang} />}
            />
          );
        })}
        {shownDashboards.map((d) => (
          <Card
            key={d.type}
            onClick={() => onPick({ kind: "type", type: d.type })}
            wash="bg-primary/[0.04]"
            icon={<d.icon className="h-4 w-4" />}
            iconClass="bg-primary/10 text-primary"
            title={t(d.title)}
            body={t(d.body)}
            preview={<DashboardPreview type={d.type} />}
          />
        ))}
      </div>
      {list.isError && (
        <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("Templates couldn't load. You can still start blank, or try again in a moment.")}
        </p>
      )}
      {nothing && (
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("No template matches “{q}”.", { q: query.trim() })}{" "}
          <button type="button" onClick={() => { setQuery(""); setCategory("all"); }} className="font-semibold text-primary hover:underline">{t("Show all")}</button>
        </div>
      )}
    </div>
  );
}

function Card({ onClick, wash, icon, iconClass, title, body, preview }: { onClick: () => void; wash: string; icon: ReactNode; iconClass: string; title: string; body: string; preview: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full w-full flex-col items-stretch overflow-hidden rounded-2xl border border-border bg-background text-left transition hover:border-primary hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]"
    >
      <div className={cn("flex w-full items-start gap-2.5 px-3.5 pb-2.5 pt-3", wash)}>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", iconClass)}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-foreground">{title}</span>
          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{body}</span>
        </span>
      </div>
      <div className={cn("w-full flex-1 px-3.5 pb-3", wash)} aria-hidden>
        <div className="h-[6.5rem] w-full overflow-hidden rounded-xl bg-background p-2 ring-1 ring-foreground/10 transition group-hover:ring-primary/30">
          {preview}
        </div>
      </div>
    </button>
  );
}

// Previews --------------------------------------------------------------------------------------------

const Bar = ({ className }: { className?: string }) => <span className={cn("block h-1 rounded-full bg-foreground/15", className)} />;
const Mini = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("inline-block max-w-full truncate rounded px-1 text-[9px] font-medium leading-[14px]", className)}>{children}</span>
);

function columnLabel(tp: NexusProjectTemplate, key: string, lang: string, t: (s: string) => string): string {
  if (key.startsWith("cf:")) {
    const f = tp.fields.find((x) => x.key === key.slice(3));
    return f ? say(f.name, lang) : key;
  }
  const b = tp.builtins.find((x) => x.key === key);
  if (b) return say(b.name, lang);
  return t(({ status: "Status", assignee: "Assignee", dueDate: "Due date", priority: "Priority", tags: "Tags" } as Record<string, string>)[key] ?? key);
}

/** One sample value for a preview cell: an option chip, a section chip, a person dot or a plain bar. */
function Cell({ tp, col, row, lang }: { tp: NexusProjectTemplate; col: string; row: number; lang: string }) {
  if (col.startsWith("cf:")) {
    const f = tp.fields.find((x) => x.key === col.slice(3));
    const opt = f?.options?.length ? f.options[row % f.options.length] : null;
    if (opt) return <Mini className={CHIP[opt.color ?? "gray"]}>{say(opt.label, lang)}</Mini>;
    return <Bar className={row % 2 ? "w-1/2" : "w-2/3"} />;
  }
  if (col === "status") {
    const s = tp.sections[row % tp.sections.length];
    return <Mini className={CHIP[s.color ?? "gray"]}>{say(s.name, lang)}</Mini>;
  }
  if (col === "assignee") return <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-foreground/25" /><Bar className="w-8" /></span>;
  return <Bar className={row % 2 ? "w-1/2" : "w-2/3"} />;
}

function TemplatePreview({ template: tp, lang }: { template: NexusProjectTemplate; lang: string }) {
  const { t } = useLang();
  const cols = tp.preview.columns ?? [];
  switch (tp.preview.layout) {
    case "board": {
      const lanes = tp.sections.slice(0, 3);
      return (
        <div className="grid h-full grid-cols-3 gap-1.5">
          {lanes.map((s, c) => (
            <div key={c} className="flex min-w-0 flex-col gap-1 rounded-md bg-foreground/[0.04] p-1">
              {/* A lane name may take two lines ("Sedang dikerjakan" was cut to "Sedang dikerj…" on a phone). */}
              <Mini className={cn("self-start whitespace-normal! break-words", CHIP[s.color ?? "gray"])}>{say(s.name, lang)}</Mini>
              {Array.from({ length: 2 - (c === 2 ? 1 : 0) }, (_, i) => (
                <div key={i} className="space-y-1 rounded bg-background p-1 ring-1 ring-foreground/10">
                  <Bar className={i ? "w-1/2" : "w-4/5"} />
                  {cols[0] && <Cell tp={tp} col={cols[0]} row={c * 2 + i} lang={lang} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }
    case "calendar": {
      const days = lang === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri"] : ["Sen", "Sel", "Rab", "Kam", "Jum"];
      const lit: Record<number, number> = { 1: 0, 3: 1, 7: 2, 8: 0, 12: 1 };
      return (
        <div className="flex h-full flex-col gap-1">
          <div className="grid grid-cols-5 gap-1 text-[9px] font-semibold text-muted-foreground">{days.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="grid flex-1 grid-cols-5 grid-rows-3 gap-1">
            {Array.from({ length: 15 }, (_, i) => {
              const s = lit[i] !== undefined ? tp.sections[lit[i] % tp.sections.length] : null;
              return (
                <span key={i} className="flex flex-col justify-end rounded-[3px] bg-foreground/[0.05] p-0.5">
                  {s && <span className={cn("block h-1.5 rounded-full", CHIP[s.color ?? "gray"])} />}
                </span>
              );
            })}
          </div>
        </div>
      );
    }
    case "gallery":
      return (
        <div className="grid h-full grid-cols-3 gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-w-0 flex-col gap-1 rounded-md bg-foreground/[0.04] p-1">
              <span className="block h-7 rounded bg-foreground/[0.07]" />
              <Bar className="w-4/5" />
              {cols[0] && <Cell tp={tp} col={cols[0]} row={i} lang={lang} />}
            </div>
          ))}
        </div>
      );
    case "list":
      return (
        <div className="flex h-full flex-col justify-center gap-2 px-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-1.5">
              <FileText className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
              <Bar className={i % 2 ? "w-1/2" : "w-3/4"} />
            </div>
          ))}
        </div>
      );
    case "table":
    default: {
      const shown = cols.slice(0, 2);
      return (
        <div className="flex h-full flex-col text-[9px]">
          <div className="grid grid-cols-3 gap-1.5 border-b border-foreground/10 pb-1 font-semibold text-muted-foreground">
            <span className="truncate">{t("Name")}</span>
            {shown.map((c) => <span key={c} className="truncate">{columnLabel(tp, c, lang, t)}</span>)}
          </div>
          {[0, 1, 2].map((r) => (
            <div key={r} className="grid flex-1 grid-cols-3 items-center gap-1.5 border-b border-foreground/[0.06] last:border-0">
              <Bar className={r % 2 ? "w-1/2" : "w-3/4"} />
              {shown.map((c) => <span key={c} className="min-w-0"><Cell tp={tp} col={c} row={r} lang={lang} /></span>)}
            </div>
          ))}
        </div>
      );
    }
  }
}

function BlankPreview() {
  return (
    <div className="grid h-full grid-cols-3 gap-1.5">
      {[2, 1, 0].map((n, c) => (
        <div key={c} className="flex flex-col gap-1 rounded-md border border-dashed border-foreground/15 p-1">
          <Bar className="w-1/2" />
          {Array.from({ length: n }, (_, i) => <span key={i} className="block h-3 rounded bg-foreground/[0.06]" />)}
        </div>
      ))}
    </div>
  );
}

function DashboardPreview({ type }: { type: DashboardType }) {
  if (type === "SOCIAL_MEDIA_REPORT") {
    return (
      <div className="flex h-full flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          {[62, 85].map((w, i) => (
            <div key={i} className="flex flex-col gap-1 rounded bg-foreground/[0.06] p-1">
              <span className="block h-1.5 w-1/2 rounded bg-foreground/15" />
              <span className="block h-1 rounded-full bg-foreground/10"><span className="block h-1 rounded-full bg-primary/60" style={{ width: `${w}%` }} /></span>
            </div>
          ))}
        </div>
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="flex-1 text-primary/60" aria-hidden>
          <path d="M0,24 L14,20 L28,22 L42,13 L56,16 L70,8 L84,11 L100,4" fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    );
  }
  if (type === "PIPELINE") {
    return (
      <div className="flex h-full flex-col justify-center gap-1.5 px-1">
        {[100, 78, 55, 34].map((w, i) => <span key={i} className={cn("mx-auto block h-3 rounded", i === 3 ? "bg-primary/60" : "bg-foreground/15")} style={{ width: `${w}%` }} />)}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">{[0, 1].map((i) => <span key={i} className="block h-5 rounded bg-foreground/[0.07]" />)}</div>
      <div className="flex flex-1 items-end gap-1 px-0.5">{[40, 70, 55, 90, 65, 80].map((h, i) => <span key={i} className={cn("flex-1 rounded-t-[2px]", i === 3 ? "bg-primary/60" : "bg-foreground/15")} style={{ height: `${h}%` }} />)}</div>
    </div>
  );
}

/** The template picked, above the details form: what it will create, and a way back to the gallery. */
export function TemplateChosen({ pick, onChange }: { pick: GalleryPick; onChange: () => void }) {
  const { t, lang } = useLang();
  let icon: ReactNode;
  let title: string;
  let detail: string | null = null;
  if (pick.kind === "template") {
    const Icon = templateIcon(pick.template.icon);
    icon = <Icon className="h-3.5 w-3.5" />;
    title = say(pick.template.name, lang);
    detail = pick.template.sections.map((s) => say(s.name, lang)).join(" → ");
  } else if (pick.kind === "type") {
    const d = DASHBOARDS.find((x) => x.type === pick.type)!;
    icon = <d.icon className="h-3.5 w-3.5" />;
    title = t(d.title);
  } else {
    icon = <Plus className="h-3.5 w-3.5" />;
    title = t("Blank project");
  }
  return (
    <div className="rounded-xl bg-primary/5 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-primary">{icon} <span className="truncate">{title}</span></span>
        <button type="button" onClick={onChange} className="shrink-0 font-semibold text-muted-foreground transition-colors hover:text-foreground">
          {t("Change template")}
        </button>
      </div>
      {pick.kind === "template" && (
        <div className="mt-1 space-y-0.5 text-muted-foreground">
          <div className="truncate" title={detail ?? undefined}>{t("Sections")}: {detail}</div>
          {pick.template.fields.length > 0 && (
            <div className="truncate">{t("Fields")}: {pick.template.fields.map((f) => say(f.name, lang)).join(", ")}</div>
          )}
        </div>
      )}
    </div>
  );
}

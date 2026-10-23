import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SelectPicker } from "@/components/SelectPicker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Eye, EyeOff, Filter, HeartPulse, KanbanSquare, Layers, Loader2, Plus, Search, Table2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { nexusApi } from "@/lib/nexus-api";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";
import { EmptyAction, EmptyState } from "@/components/EmptyState";
import { PIPELINE_STAGES, dealYearsOf, eventYearOf, summarize, type HealthKey } from "@/lib/pipeline";
import {
  allPipelinesApi, allPipelinesKey, pipelineApi, pipelineKey, servicesOf,
  type AllPipelinesResponse, type PipelineBoardRef, type PipelineDeal, type PipelineDealPatch, type PipelineListBases, type PipelineResponse,
} from "@/lib/pipeline-api";
import { useWeb017Launch } from "@/lib/meetings";
import { PipelineKpis } from "./PipelineKpis";
import { PipelineBoard } from "./PipelineBoard";
import { PipelineTable } from "./PipelineTable";
import { PipelineHealth } from "./PipelineHealth";
import { DealDrawer } from "./DealDrawer";
import { PresentationContext, usePresentingMode } from "./presentation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PersonOption } from "./fields";
import { HEALTH_DOT, HEALTH_LABEL, HEALTH_ORDER, StagePill, applyLocal, personName } from "./pipeline-ui";

type View = "board" | "table" | "health";
const VIEW_KEY = "nexus-pipeline-view";
const ALL = "";

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "board" || v === "table" || v === "health") return v;
  } catch { /* private window: the board */ }
  return "board";
}

/** Error text from a refused write: the server's field message when it sent one. */
function errorText(error: unknown, fallback: string): string {
  const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

/**
 * The main view of a Pipeline Dashboard project (owner, 9 Oct 2026; the GM's "Control Tower TZN"):
 * KPI strip, filters, then Board (by stage, drag to move) · Table (inline edit) · Health (what needs
 * someone today), and the deal drawer. Edits show at once (optimistic) and reach colleagues live through
 * `pipeline-changed` on the project's room.
 */
export function PipelineView({
  projectId = "", mode = "board", initialDealId, fromAll = false, boardName,
}: {
  projectId?: string;
  workspaceId?: string;
  /**
   * "all" = All Pipelines (Control Tower v8, owner 21 Oct 2026): every Pipeline board of the workspace,
   * read-only, BoD / One Above All only (the server answers 403 to anyone else). A company chip on every deal,
   * Company + Year filters, combined KPIs; a deal opens in its own board; no "New deal" here.
   */
  mode?: "board" | "all";
  /** Open this deal once the board has loaded (`?deal=` on the project page). */
  initialDealId?: string;
  /** The deal was opened from All Pipelines: the drawer shows the company and the way back. */
  fromAll?: boolean;
  boardName?: string;
}) {
  const { t, tn, lang } = useLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const all = mode === "all";
  // Year filter and the v8 Excel columns wait for the web 0.1.7 launch switch (lib/web-launch.ts).
  const v8 = useWeb017Launch();
  const key = all ? allPipelinesKey : pipelineKey(projectId);
  const q = useQuery<PipelineResponse | AllPipelinesResponse>({
    queryKey: key,
    queryFn: () => (all ? allPipelinesApi.list() : pipelineApi.list(projectId)),
    retry: false,
  });
  // BD / PM are picked from the project's members (owner, 9 Oct 2026: the board's people are its project
  // members, added by its lead) — the same list and cache key as the task project's member pickers.
  const members = useQuery({
    queryKey: ["nexus", "project-members", projectId],
    queryFn: () => nexusApi.projectMembers(projectId),
    retry: false,
    staleTime: 60_000,
    enabled: !all && !!projectId,
  });
  const people: PersonOption[] = useMemo(() => {
    const raw = members.data;
    const arr = Array.isArray(raw) ? raw : raw?.members ?? [];
    return arr
      .map((m) => m.user)
      .filter((u): u is NonNullable<typeof u> => !!u?.id)
      .map((u) => ({ id: u.id, name: u.name || u.email || "?", avatar: u.avatar ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members.data]);

  // Live: a colleague's edit refetches the list (and the open deal's history, keyed under it).
  useRealtimeRoom(all ? null : `project:${projectId}`);
  // All Pipelines listens on every board's room: any board's edit refetches the combined view.
  const boards: PipelineBoardRef[] = useMemo(() => (q.data && "boards" in q.data ? q.data.boards : []), [q.data]);
  const boardIds = boards.map((b) => b.id).join(",");
  const { socket, join, leave, connected } = useRealtime();
  useEffect(() => {
    if (!all || !boardIds) return;
    const rooms = boardIds.split(",").map((id) => `project:${id}`);
    rooms.forEach(join);
    return () => rooms.forEach(leave);
  }, [all, boardIds, join, leave, connected]);
  useEffect(() => {
    if (!socket) return;
    const onChanged = (payload?: { projectId?: unknown }) => {
      if (all ? boardIds.split(",").includes(String(payload?.projectId)) : payload?.projectId === projectId) qc.invalidateQueries({ queryKey: key });
    };
    socket.on("pipeline-changed", onChanged);
    return () => { socket.off("pipeline-changed", onChanged); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, projectId, qc, all, boardIds]);

  const [view, setViewState] = useState<View>(readView);
  const stickyTop = useStickyHeaderOffset();
  const setView = (v: View) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ }
  };
  const [search, setSearch] = useState("");
  const [pm, setPm] = useState(ALL);
  const [bd, setBd] = useState(ALL);
  const [service, setService] = useState(ALL);
  const [health, setHealth] = useState<HealthKey | "">("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Presentation mode (Control Tower v7): hides every rupiah on screen. Never stored — a reload starts with it
  // off; kept in memory for the tab so it stays on across boards and All Pipelines (presentation.tsx, v8).
  const [presenting, setPresentingMode] = usePresentingMode();
  const setPresenting = (fn: (p: boolean) => boolean) => setPresentingMode(fn(presenting));
  // Year (v8): the event / main date's year, a view filter only (never stored). Company: All Pipelines only.
  const [year, setYear] = useState(ALL);
  const [source, setSource] = useState(ALL);

  const data = q.data;
  const allDeals = useMemo(() => data?.deals ?? [], [data]);
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  // Staff who are not project members never get this far (403). Full / Can edit may change deals (real
  // cost lines included); Can comment / Can view only read (14 Oct 2026). An older server says nothing:
  // everyone who reads may write, as before. All Pipelines is always read-only.
  const canEdit = !all && !!data && data.canEdit !== false;
  const years = useMemo(() => (v8 ? dealYearsOf(allDeals) : []), [allDeals, v8]);
  // The deals the page is about: the company and year picked (deals without an event date leave with a year).
  const deals = useMemo(
    () => allDeals.filter((d) => (!source || d.source?.projectId === source) && (!year || eventYearOf(d) === Number(year))),
    [allDeals, source, year],
  );
  // The KPI strip follows the company and year (same KPI definitions); the other filters never change it.
  const kpis = useMemo(() => (!all && !year && data ? data.summary : summarize(deals, today)), [all, year, data, deals, today]);

  const personFilter = (list: PipelineDeal[], pick: (d: PipelineDeal) => string | null) =>
    Array.from(new Set(list.map(pick).filter((x): x is string => !!x))).sort((a, b) => a.localeCompare(b));
  const pmNames = useMemo(() => personFilter(deals, (d) => personName(d.pm, d.pmName)), [deals]);
  const bdNames = useMemo(() => personFilter(deals, (d) => personName(d.bd, d.bdName)), [deals]);
  // Every service in use, typed ones included (owner, 9 Oct 2026: a deal has several).
  const serviceNames = useMemo(
    () => Array.from(new Set(deals.flatMap((d) => servicesOf(d)))).sort((a, b) => a.localeCompare(b)),
    [deals],
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return deals.filter((d) => {
      if (health && d.health.key !== health) return false;
      if (pm && personName(d.pm, d.pmName) !== pm) return false;
      if (bd && personName(d.bd, d.bdName) !== bd) return false;
      if (service && !servicesOf(d).includes(service)) return false;
      if (needle) {
        const hay = `${d.code} ${d.name} ${d.brand} ${servicesOf(d).join(" ")} ${personName(d.pm, d.pmName) ?? ""} ${personName(d.bd, d.bdName) ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [deals, search, pm, bd, service, health]);
  const filtering = !!(search.trim() || pm || bd || service || health || year || source);
  const resetFilters = () => { setSearch(""); setPm(ALL); setBd(ALL); setService(ALL); setHealth(""); setYear(ALL); setSource(ALL); };

  const personOf = useCallback((id: string | null | undefined) => {
    if (!id) return null;
    const p = people.find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, avatar: p.avatar } : null;
  }, [people]);

  const update = useMutation({
    mutationFn: ({ id, patch, bases }: { id: string; patch: PipelineDealPatch; bases?: PipelineListBases }) =>
      pipelineApi.update(projectId, id, { ...patch, ...bases }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<PipelineResponse>(key);
      if (before) {
        const next = before.deals.map((d) => {
          if (d.id !== id) return d;
          const local = applyLocal(d, patch, before.today);
          if ("pmUserId" in patch) local.pm = personOf(patch.pmUserId);
          if ("bdUserId" in patch) local.bd = personOf(patch.bdUserId);
          return local;
        });
        qc.setQueryData<PipelineResponse>(key, { ...before, deals: next, summary: summarize(next, before.today) });
      }
      return { before };
    },
    onError: (error, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      toast.error(errorText(error, t("That change wasn't saved. Try again.")));
    },
    onSuccess: (saved) => {
      qc.setQueryData<PipelineResponse>(key, (cur) => {
        if (!cur) return cur;
        const next = cur.deals.map((d) => (d.id === saved.id ? saved : d));
        return { ...cur, deals: next, summary: summarize(next, cur.today) };
      });
      qc.invalidateQueries({ queryKey: [...key, "deal", saved.id] });
    },
  });
  // A cost or link list goes with the list it was edited from (race audit 16 Oct 2026, M6), read from the
  // cache before the optimistic update: the server merges the edit into the deal as it is now, so a line
  // another person added in the meantime is kept instead of overwritten.
  const patchDeal = useCallback((id: string, patch: PipelineDealPatch) => {
    const cur = qc.getQueryData<PipelineResponse>(key)?.deals.find((d) => d.id === id);
    const bases: PipelineListBases = {};
    if (cur && "costs" in patch) bases.costsBase = cur.costs ?? [];
    if (cur && "links" in patch) bases.linksBase = cur.links ?? [];
    update.mutate({ id, patch, bases });
  }, [update, qc, key]);

  // "+" asks for the deal's name first and creates nothing until it's saved: closing the box leaves no
  // blank "New deal" behind and burns no TZN code (QA B48, 13 Oct 2026).
  const [newIn, setNewIn] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: ({ stage, name }: { stage: string; name: string }) => pipelineApi.create(projectId, { stage, name }),
    onSuccess: (deal) => {
      setNewIn(null);
      qc.setQueryData<PipelineResponse>(key, (cur) => {
        if (!cur) return cur;
        const next = [...cur.deals, deal];
        return { ...cur, deals: next, summary: summarize(next, cur.today) };
      });
      // The GM's flow: the new deal opens straight away, its name ready to type.
      setOpenId(deal.id);
      if (view === "health") setView("board");
    },
    onError: (error) => toast.error(errorText(error, t("The deal wasn't created. Try again."))),
  });

  const remove = useMutation({
    mutationFn: (deal: PipelineDeal) => pipelineApi.remove(projectId, deal.id),
    onMutate: (deal) => {
      setOpenId(null);
      const before = qc.getQueryData<PipelineResponse>(key);
      if (before) {
        const next = before.deals.filter((d) => d.id !== deal.id);
        qc.setQueryData<PipelineResponse>(key, { ...before, deals: next, summary: summarize(next, before.today) });
      }
      return { before };
    },
    onSuccess: (_r, deal) => toast.success(t("{name} deleted. Control Room → Audit can restore it.", { name: deal.name })),
    onError: (error, _d, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      toast.error(errorText(error, t("The deal wasn't deleted. Try again.")));
    },
  });

  const [exporting, setExporting] = useState(false);
  const exportXlsx = async () => {
    setExporting(true);
    try {
      if (all) await allPipelinesApi.exportXlsx(lang, { year: year ? Number(year) : null, source: source || null });
      else await pipelineApi.exportXlsx(projectId, lang, year ? Number(year) : null, !v8);
    }
    catch (error) { toast.error(errorText(error, t("The Excel file didn't download. Try again."))); }
    finally { setExporting(false); }
  };

  // A deal named in the link (`?deal=`, e.g. opened from All Pipelines) opens once the board is there.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current || !initialDealId || !data) return;
    openedInitial.current = true;
    if (data.deals.some((d) => d.id === initialDealId)) setOpenId(initialDealId);
  }, [initialDealId, data]);
  // All Pipelines: a deal opens in its own board, with the company on it.
  const openFromAll = (id: string) => {
    const d = allDeals.find((x) => x.id === id);
    if (d?.source) navigate({ to: "/projects/$projectId", params: { projectId: d.source.projectId }, search: { deal: d.id, from: "all" } });
  };
  const onOpen = all ? openFromAll : setOpenId;

  const openDeal = all ? null : allDeals.find((d) => d.id === openId) ?? null;
  // The open deal was deleted elsewhere: close the drawer instead of showing a ghost.
  useEffect(() => {
    if (openId && data && !data.deals.some((d) => d.id === openId)) setOpenId(null);
  }, [openId, data]);

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-8" aria-busy="true" aria-label={t("Loading the pipeline")}>
        <div className="h-[5.25rem] animate-pulse rounded-xl bg-muted" />
        <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted" />
        <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <div key={i} className="h-72 w-[18rem] shrink-0 animate-pulse rounded-lg bg-muted/70" />)}</div>
      </div>
    );
  }
  if (q.isError || !data) {
    const code = (q.error as { status?: number } | null)?.status;
    return (
      <div className="p-4 md:p-8">
        <EmptyState
          icon={Filter}
          tone="muted"
          title={code === 403 ? (all ? t("All Pipelines is for BoD and One Above All") : t("This pipeline is for its project members")) : t("The pipeline didn't load")}
          message={code === 403 ? (all ? t("Open your company's pipeline board from Projects.") : t("Ask the Project Owner or a board member to add you to the project.")) : t("Check your connection, then try again.")}
          action={code === 403 ? undefined : <EmptyAction onClick={() => q.refetch()}>{t("Try again")}</EmptyAction>}
        />
      </div>
    );
  }

  const viewSwitch = (
    <div role="radiogroup" aria-label={t("View")} className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5 lg:inline-grid">
      {([
        ["board", t("Board"), KanbanSquare],
        ["table", t("Table"), Table2],
        ["health", t("Health"), HeartPulse],
      ] as const).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => setView(v)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[40px]",
            view === v ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,15,15,0.08)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
  const pickerControl = "h-9 rounded-lg bg-card pointer-coarse:h-11";
  const control = "h-9 rounded-lg border border-border bg-card text-sm transition-colors hover:border-control-border focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-11";
  // "All PMs" reads as just "PM" on a phone, where the three filters share one row (they were "Semu…"). There each
  // one starts from its own label width (flex-auto, px-2) so "Service" is not cut to "Ser…" at 360–390 px.
  const allLabel = (short: string, long: string) => (o: { value: string; label: string } | null) =>
    o && o.value !== ALL ? <span className="truncate">{o.label}</span> : (
      <span className="truncate text-muted-foreground"><span className="lg:hidden">{short}</span><span className="hidden lg:inline">{long}</span></span>
    );

  return (
    <PresentationContext.Provider value={presenting}>
    <div className="flex flex-col gap-4 p-4 md:p-8" data-presenting={presenting ? "" : undefined}>
      {allDeals.length === 0 ? (
        all
          ? <EmptyState icon={Layers} tone="muted" title={t("No deals in any pipeline yet")} message={t("Deals are added inside each company's pipeline board. They show here together.")} />
          : <FirstDeal adding={create.isPending} onAdd={canEdit ? () => setNewIn("Incoming") : undefined} />
      ) : (
        <>
          <PipelineKpis s={kpis} />

          {/* A computer: find · filter · export · add, then health chips with the view switch. A phone or a
              narrow window (owner, 9 Oct 2026: "di hape jg sempit bgt"): search with the add button, the two
              filters with Excel, the view switch on its own row, then the health chips as a row that scrolls
              sideways. */}
          {/* No wrapper here: the health row below must be a direct child of the page column to stay sticky. */}
            <div className="flex flex-wrap items-center gap-2">
              <label className={cn("relative order-1 min-w-0 lg:max-w-md lg:flex-1 lg:basis-48", canEdit ? "basis-[calc(100%-3.25rem)]" : "basis-full")}>
                <span className="sr-only">{t("Search deals")}</span>
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("Search deals…")}
                  title={t("Search deal, brand, code, BD or PM…")}
                  className={cn(control, "w-full pl-9 pr-3 placeholder:text-muted-foreground/80")}
                />
              </label>
              {/* Company (All Pipelines) and Year (v8): their own row on a phone, so every picker keeps its label. */}
              {(years.length > 0 || (all && boards.length > 0)) && (
                <div className="order-3 flex min-w-0 basis-full gap-2 lg:basis-auto">
                  {all && boards.length > 0 && (
                    <SelectPicker variant="field" ariaLabel={t("Filter by company")} value={source} onChange={setSource} renderValue={allLabel(t("All companies"), t("All companies"))} options={[{ value: ALL, label: t("All companies") }, ...boards.map((b) => ({ value: b.id, label: b.name }))]} className={cn(pickerControl, "min-w-0 flex-1 px-3 lg:w-48 lg:flex-none", source && "border-foreground/30 text-foreground")} />
                  )}
                  {years.length > 0 && (
                    <SelectPicker variant="field" ariaLabel={t("Filter by year")} value={year} onChange={setYear} renderValue={allLabel(t("All years"), t("All years"))} options={[{ value: ALL, label: t("All years") }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} className={cn(pickerControl, "min-w-0 flex-1 px-3 lg:w-40 lg:flex-none", year && "border-foreground/30 text-foreground")} />
                  )}
                </div>
              )}
              <SelectPicker variant="field" ariaLabel={t("Filter by PM")} value={pm} onChange={setPm} renderValue={allLabel("PM", t("All PMs"))} options={[{ value: ALL, label: t("All PMs") }, ...pmNames.map((n) => ({ value: n, label: n }))]} className={cn(pickerControl, "order-3 min-w-0 flex-auto px-2 lg:w-36 lg:flex-none lg:px-3", pm && "border-foreground/30 text-foreground")} />
              <SelectPicker variant="field" ariaLabel={t("Filter by BD")} value={bd} onChange={setBd} renderValue={allLabel("BD", t("All BDs"))} options={[{ value: ALL, label: t("All BDs") }, ...bdNames.map((n) => ({ value: n, label: n }))]} className={cn(pickerControl, "order-4 min-w-0 flex-auto px-2 lg:w-36 lg:flex-none lg:px-3", bd && "border-foreground/30 text-foreground")} />
              {serviceNames.length > 1 && (
                <SelectPicker variant="field" ariaLabel={t("Filter by service")} value={service} onChange={setService} renderValue={allLabel(t("Service"), t("All services"))} options={[{ value: ALL, label: t("All services") }, ...serviceNames.map((n) => ({ value: n, label: n }))]} className={cn(pickerControl, "order-4 min-w-0 flex-auto px-2 lg:w-40 lg:flex-none lg:px-3", service && "border-foreground/30 text-foreground")} />
              )}
              <button
                type="button"
                onClick={() => setPresenting((p) => !p)}
                aria-pressed={presenting}
                aria-label={t("Presentation mode")}
                title={presenting ? t("Presentation mode is on: amounts are hidden. Click to show them.") : t("Presentation mode: hide every amount on screen")}
                className={cn(
                  control,
                  "order-5 inline-flex w-11 shrink-0 items-center justify-center gap-1.5 font-medium pointer-coarse:w-11 xl:w-auto xl:px-3",
                  presenting ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : "hover:bg-muted",
                )}
              >
                {presenting ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
                <span className="hidden xl:inline">{t("Presentation mode")}</span>
              </button>
              <button
                type="button"
                onClick={exportXlsx}
                disabled={exporting}
                aria-label={t("Download Excel")}
                title={t("Download Excel")}
                className={cn(control, "order-5 inline-flex w-11 shrink-0 items-center justify-center gap-1.5 font-medium hover:bg-muted disabled:opacity-60 pointer-coarse:w-11 xl:w-auto xl:px-3")}
              >
                {exporting ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Download aria-hidden className="h-4 w-4" />}
                <span className="hidden xl:inline">{exporting ? t("Preparing…") : "Excel"}</span>
              </button>
              {canEdit && <button
                type="button"
                onClick={() => setNewIn("Incoming")}
                disabled={create.isPending}
                aria-label={t("New deal")}
                className="order-2 inline-flex h-9 w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-soft transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11 lg:order-6 lg:w-auto lg:px-3.5"
              >
                {create.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
                <span className="hidden lg:inline">{create.isPending ? t("Adding…") : t("New deal")}</span>
              </button>}
              <div className="order-7 basis-full lg:hidden">{viewSwitch}</div>
            </div>

            {/* The health chips and the view switch stay in view under the page header while the page scrolls
                (owner, 12 Oct 2026: the row slid half under the tab bar). Its top is the header's height where
                that header is sticky (md+), else the top of the screen. */}
            <div className="sticky z-30 -mx-4 -my-2.5 flex items-center gap-3 bg-card px-4 py-1.5 md:z-[41] md:-mx-8 md:px-8" style={{ top: stickyTop }}>
              <div role="group" aria-label={t("Health")} className="-mx-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 xl:flex-wrap xl:overflow-visible">
                {(["", ...HEALTH_ORDER] as const).map((k) => {
                  const on = health === k;
                  const n = k ? deals.filter((d) => d.health.key === k).length : deals.length;
                  return (
                    <button
                      key={k || "all"}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setHealth(k)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[36px]",
                        on ? "border-foreground/25 bg-muted text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        !on && k && n === 0 && "opacity-60",
                      )}
                    >
                      {k && <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[k])} />}
                      {k ? t(HEALTH_LABEL[k]) : t("All")}
                      <span className={cn("tabular-nums", on ? "opacity-70" : "opacity-60")}>{n}</span>
                    </button>
                  );
                })}
              </div>
              {filtering && (
                <p className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground lg:flex" aria-live="polite">
                  {t("{shown} of {total} deals", { shown: shown.length, total: allDeals.length })}
                  <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                    <X className="h-3 w-3" /> {t("Clear filters")}
                  </button>
                </p>
              )}
              <div className="hidden shrink-0 lg:block">{viewSwitch}</div>
            </div>
            {filtering && (
              <p className="-mt-2 flex items-center gap-2 text-xs text-muted-foreground lg:hidden" aria-live="polite">
                {t("{shown} of {total} deals", { shown: shown.length, total: allDeals.length })}
                <button type="button" onClick={resetFilters} className="inline-flex min-h-[36px] items-center gap-1 rounded font-semibold text-foreground">
                  <X className="h-3 w-3" /> {t("Clear filters")}
                </button>
              </p>
            )}


          {filtering && shown.length === 0 ? (
            <EmptyState
              compact
              icon={Search}
              tone="muted"
              title={t("No deal matches")}
              message={tn(allDeals.length, "The filters hide the only deal.", "The filters hide all {n} deals.")}
              action={<EmptyAction onClick={resetFilters}>{t("Clear filters")}</EmptyAction>}
            />
          ) : view === "board" ? (
            <PipelineBoard deals={shown} today={today} canEdit={canEdit} onOpen={onOpen} onMove={(id, stage) => patchDeal(id, { stage })} onAdd={(stage) => setNewIn(stage)} />
          ) : view === "table" ? (
            <PipelineTable deals={shown} canEdit={canEdit} onOpen={onOpen} onPatch={patchDeal} />
          ) : (
            <PipelineHealth deals={shown} today={today} onOpen={onOpen} />
          )}
        </>
      )}

      <NewDealDialog stage={newIn} saving={create.isPending} onCancel={() => { if (!create.isPending) setNewIn(null); }} onCreate={(name) => newIn && create.mutate({ stage: newIn, name })} />
      <DealDrawer
        deal={openDeal}
        projectId={projectId}
        people={people}
        canEdit={canEdit}
        onPatch={patchDeal}
        onDelete={(d) => remove.mutate(d)}
        onClose={() => setOpenId(null)}
        boardName={boardName ?? (data && "project" in data ? data.project.name : undefined)}
        fromAll={fromAll}
      />
    </div>
    </PresentationContext.Provider>
  );
}

/** The name of a new deal, asked before anything is created (QA B48). Empty = the button stays off. */
function NewDealDialog({ stage, saving, onCancel, onCreate }: { stage: string | null; saving: boolean; onCancel: () => void; onCreate: (name: string) => void }) {
  const { t, lang } = useLang();
  const [name, setName] = useState("");
  useEffect(() => { if (stage) setName(""); }, [stage]);
  const ok = name.trim().length > 0 && !saving;
  return (
    <Dialog open={!!stage} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent lang={lang} className="max-w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("New deal")}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">{t("It goes in")} {stage && <StagePill stage={stage} className="text-xs" />}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (ok) onCreate(name.trim()); }} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("Deal name")}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder={t("e.g. Brand activation, Jakarta Fair")}
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-11" />
          </label>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={onCancel} className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3.5 text-sm font-medium hover:bg-muted pointer-coarse:h-11">{t("Cancel")}</button>
            <button type="submit" disabled={!ok} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-soft transition-opacity hover:opacity-90 disabled:opacity-50 pointer-coarse:h-11">
              {saving && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}{saving ? t("Adding…") : t("Add deal")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * An empty board (owner, 9 Oct 2026: start fresh, no demo deals): what the board is for, the road a deal
 * takes across it, and one button. No KPI strip and no eight empty columns until there is a first deal.
 */
function FirstDeal({ adding, onAdd }: { adding: boolean; onAdd?: () => void }) {
  const { t } = useLang();
  const road = PIPELINE_STAGES.filter((s) => s !== "Lost / Cancelled");
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-10 text-center md:px-10 md:py-14">
      <h2 className="text-lg font-semibold text-balance">{t("No deals in this pipeline yet")}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-pretty text-muted-foreground">
        {t("Every client job goes here, from the first brief to paid and closed. Add the first one, then BD, Legal, PM and Finance fill in their parts on the same card.")}
      </p>
      <ol aria-label={t("How a deal moves")} className="mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-x-1 gap-y-2">
        {road.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <StagePill stage={s} className="text-xs" />
            {i < road.length - 1 && <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground/60" />}
          </li>
        ))}
      </ol>
      {onAdd && <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        className="mt-7 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
      >
        {adding ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
        {adding ? t("Adding…") : t("Add your first deal")}
      </button>}
    </section>
  );
}

/**
 * Where the page's sticky header ends, so a sticky row sits right under it. From md up the whole header sticks;
 * on a phone only its pinned parts do (title bar + tab strip, `data-page-header-sticky`), the header box itself
 * being `display: contents` there.
 */
function useStickyHeaderOffset(): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-page-header]");
    if (!header) return;
    const measure = () => {
      const cs = getComputedStyle(header);
      if (cs.position === "sticky") { setTop(Math.round(header.getBoundingClientRect().height)); return; }
      if (cs.display !== "contents") { setTop(0); return; }
      const pinned = [...header.querySelectorAll<HTMLElement>("[data-page-header-sticky]")].filter((el) => getComputedStyle(el).position === "sticky");
      setTop(Math.round(pinned.reduce((h, el) => h + el.getBoundingClientRect().height, 0)));
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(header);
    header.querySelectorAll<HTMLElement>("[data-page-header-sticky]").forEach((el) => ro?.observe(el));
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return top;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Filter, HeartPulse, KanbanSquare, Plus, Search, Table2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { nexusApi } from "@/lib/nexus-api";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";
import { EmptyAction, EmptyState } from "@/components/EmptyState";
import { summarize, type HealthKey } from "@/lib/pipeline";
import { pipelineApi, pipelineKey, type PipelineDeal, type PipelineDealPatch, type PipelineResponse } from "@/lib/pipeline-api";
import { PipelineKpis } from "./PipelineKpis";
import { PipelineBoard } from "./PipelineBoard";
import { PipelineTable } from "./PipelineTable";
import { PipelineHealth } from "./PipelineHealth";
import { DealDrawer } from "./DealDrawer";
import type { PersonOption } from "./fields";
import { HEALTH_DOT, HEALTH_LABEL, HEALTH_ORDER, applyLocal, personName } from "./pipeline-ui";

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
export function PipelineView({ projectId }: { projectId: string; workspaceId: string }) {
  const { t, tn, lang } = useLang();
  const qc = useQueryClient();
  const key = pipelineKey(projectId);
  const q = useQuery({ queryKey: key, queryFn: () => pipelineApi.list(projectId), retry: false });
  // BD / PM are picked from the project's members (owner, 9 Oct 2026: the board's people are its project
  // members, added by its lead) — the same list and cache key as the task project's member pickers.
  const members = useQuery({
    queryKey: ["nexus", "project-members", projectId],
    queryFn: () => nexusApi.projectMembers(projectId),
    retry: false,
    staleTime: 60_000,
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
  useRealtimeRoom(`project:${projectId}`);
  const { socket } = useRealtime();
  useEffect(() => {
    if (!socket) return;
    const onChanged = (payload?: { projectId?: unknown }) => {
      if (payload?.projectId === projectId) qc.invalidateQueries({ queryKey: key });
    };
    socket.on("pipeline-changed", onChanged);
    return () => { socket.off("pipeline-changed", onChanged); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, projectId, qc]);

  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ }
  };
  const [search, setSearch] = useState("");
  const [pm, setPm] = useState(ALL);
  const [bd, setBd] = useState(ALL);
  const [health, setHealth] = useState<HealthKey | "">("");
  const [openId, setOpenId] = useState<string | null>(null);

  const data = q.data;
  const deals = useMemo(() => data?.deals ?? [], [data]);
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  // Staff who are not project members never get this far (403); everyone who reads may also write.
  const canEdit = !!data;

  const personFilter = (list: PipelineDeal[], pick: (d: PipelineDeal) => string | null) =>
    Array.from(new Set(list.map(pick).filter((x): x is string => !!x))).sort((a, b) => a.localeCompare(b));
  const pmNames = useMemo(() => personFilter(deals, (d) => personName(d.pm, d.pmName)), [deals]);
  const bdNames = useMemo(() => personFilter(deals, (d) => personName(d.bd, d.bdName)), [deals]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return deals.filter((d) => {
      if (health && d.health.key !== health) return false;
      if (pm && personName(d.pm, d.pmName) !== pm) return false;
      if (bd && personName(d.bd, d.bdName) !== bd) return false;
      if (needle) {
        const hay = `${d.code} ${d.name} ${d.brand} ${personName(d.pm, d.pmName) ?? ""} ${personName(d.bd, d.bdName) ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [deals, search, pm, bd, health]);
  const filtering = !!(search.trim() || pm || bd || health);
  const resetFilters = () => { setSearch(""); setPm(ALL); setBd(ALL); setHealth(""); };

  const personOf = useCallback((id: string | null | undefined) => {
    if (!id) return null;
    const p = people.find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, avatar: p.avatar } : null;
  }, [people]);

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PipelineDealPatch }) => pipelineApi.update(projectId, id, patch),
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
  const patchDeal = useCallback((id: string, patch: PipelineDealPatch) => update.mutate({ id, patch }), [update]);

  const create = useMutation({
    mutationFn: (stage: string) => pipelineApi.create(projectId, { stage }),
    onSuccess: (deal) => {
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
    try { await pipelineApi.exportXlsx(projectId, lang); }
    catch (error) { toast.error(errorText(error, t("The Excel file didn't download. Try again."))); }
    finally { setExporting(false); }
  };

  const openDeal = deals.find((d) => d.id === openId) ?? null;
  // The open deal was deleted elsewhere: close the drawer instead of showing a ghost.
  useEffect(() => {
    if (openId && data && !data.deals.some((d) => d.id === openId)) setOpenId(null);
  }, [openId, data]);

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-8" aria-busy="true" aria-label={t("Loading the pipeline")}>
        <div className="h-20 animate-pulse rounded-2xl bg-muted" />
        <div className="h-10 w-2/3 animate-pulse rounded-xl bg-muted" />
        <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <div key={i} className="h-72 w-[17.5rem] shrink-0 animate-pulse rounded-2xl bg-muted" />)}</div>
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
          title={code === 403 ? t("This pipeline is for its project members") : t("The pipeline didn't load")}
          message={code === 403 ? t("Ask the project lead or a manager to add you to the project.") : t("Check your connection, then try again.")}
          action={code === 403 ? undefined : <EmptyAction onClick={() => q.refetch()}>{t("Try again")}</EmptyAction>}
        />
      </div>
    );
  }

  const newDealButton = (
    <button
      type="button"
      onClick={() => create.mutate("Incoming")}
      disabled={create.isPending}
      className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-soft transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
    >
      <Plus className="h-4 w-4" /> {create.isPending ? t("Adding…") : t("New deal")}
    </button>
  );

  return (
    <div className="space-y-4 p-4 md:p-8">
      {deals.length === 0 ? (
        <EmptyState
          icon={Filter}
          title={t("No deals in this pipeline yet")}
          message={t("Every client job goes here, from the first brief to paid and closed. Add the first one, then BD, Legal, PM and Finance fill in their parts on the same card.")}
          action={<EmptyAction onClick={() => create.mutate("Incoming")}><Plus className="h-4 w-4" />{t("Add the first deal")}</EmptyAction>}
        />
      ) : (
        <>
          <PipelineKpis s={data.summary} />

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1 basis-56">
                <span className="sr-only">{t("Search deals")}</span>
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("Search deal, brand, code, BD or PM…")}
                  className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:min-h-[44px]"
                />
              </label>
              <select aria-label={t("Filter by PM")} value={pm} onChange={(e) => setPm(e.target.value)} className="max-w-44 rounded-xl border border-border bg-card px-3 py-2 text-sm pointer-coarse:min-h-[44px]">
                <option value={ALL}>{t("All PMs")}</option>
                {pmNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select aria-label={t("Filter by BD")} value={bd} onChange={(e) => setBd(e.target.value)} className="max-w-44 rounded-xl border border-border bg-card px-3 py-2 text-sm pointer-coarse:min-h-[44px]">
                <option value={ALL}>{t("All BDs")}</option>
                {bdNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportXlsx}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
                >
                  <Download className="h-4 w-4" /> <span className="hidden sm:inline">{exporting ? t("Preparing…") : t("Download Excel")}</span><span className="sm:hidden">Excel</span>
                </button>
                {newDealButton}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label={t("Health")} className="flex flex-wrap gap-1.5">
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
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[36px]",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {k && <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[k])} />}
                      {k ? t(HEALTH_LABEL[k]) : t("All")}
                      <span className={cn("tabular-nums", on ? "opacity-80" : "opacity-60")}>{n}</span>
                    </button>
                  );
                })}
              </div>
              <div role="radiogroup" aria-label={t("View")} className="inline-flex gap-0.5 rounded-xl border border-border bg-card p-0.5">
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
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[40px]",
                      view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
            {filtering && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                {t("{shown} of {total} deals", { shown: shown.length, total: deals.length })}
                <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                  <X className="h-3 w-3" /> {t("Clear filters")}
                </button>
              </p>
            )}
          </div>

          {filtering && shown.length === 0 ? (
            <EmptyState
              compact
              icon={Search}
              tone="muted"
              title={t("No deal matches")}
              message={tn(deals.length, "The filters hide the only deal.", "The filters hide all {n} deals.")}
              action={<EmptyAction onClick={resetFilters}>{t("Clear filters")}</EmptyAction>}
            />
          ) : view === "board" ? (
            <PipelineBoard deals={shown} canEdit={canEdit} onOpen={setOpenId} onMove={(id, stage) => patchDeal(id, { stage })} onAdd={(stage) => create.mutate(stage)} />
          ) : view === "table" ? (
            <PipelineTable deals={shown} canEdit={canEdit} onOpen={setOpenId} onPatch={patchDeal} />
          ) : (
            <PipelineHealth deals={shown} today={today} onOpen={setOpenId} />
          )}
        </>
      )}

      <DealDrawer
        deal={openDeal}
        projectId={projectId}
        people={people}
        canEdit={canEdit}
        onPatch={patchDeal}
        onDelete={(d) => remove.mutate(d)}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

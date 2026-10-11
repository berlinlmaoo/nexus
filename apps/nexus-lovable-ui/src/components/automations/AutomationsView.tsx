import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, History, Loader2, MoreHorizontal, Plus, Sparkles, Trash2, Zap } from "lucide-react";
import { nexusApi, type NexusAutomation, type NexusAutomationRule } from "@/lib/nexus-api";
import { useLang, type LangApi } from "@/lib/lang";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ACTIONS, LEGACY_TRIGGER_LABEL, PRIORITIES, STATUSES, TRIGGERS } from "./automation-meta";
import { AutomationBuilder, RUN_STATUS_LABEL, type BuilderContext } from "./AutomationBuilder";

/**
 * A project's Automations tab (rebuilt 12 Oct 2026, owner: "like Notion's When / If / Do"). A list of rules
 * with on/off, name, what they do and their last run; a rule opens the builder (rule + run log). Live: any
 * change or run anywhere refetches through `automations-changed` on the project's room.
 */

const STATUS_TONE: Record<string, string> = {
  SUCCESS: "bg-emerald-500", PARTIAL: "bg-amber-500", FAILED: "bg-destructive", SKIPPED: "bg-muted-foreground/50", RUNNING: "bg-primary",
};

function relative(iso: string | null | undefined, { t, locale }: LangApi) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return t("just now");
  const m = Math.round(s / 60);
  if (m < 60) return t("{n}m ago", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("{n}h ago", { n: h });
  const d = Math.round(h / 24);
  if (d < 7) return t("{n}d ago", { n: d });
  return new Date(ms).toLocaleDateString(locale, { timeZone: "Asia/Jakarta", day: "numeric", month: "short" });
}

function valueLabel(v: string | undefined, t: LangApi["t"]) {
  if (!v) return "";
  const s = STATUSES.find((x) => x.value === v) ?? PRIORITIES.find((x) => x.value === v);
  return s ? t(s.label) : v;
}

function triggerText(r: NexusAutomationRule | null | undefined, t: LangApi["t"]) {
  if (!r) return "—";
  const def = TRIGGERS.find((d) => d.type === r.type);
  const base = def ? t(def.label) : LEGACY_TRIGGER_LABEL[r.type] ? t(LEGACY_TRIGGER_LABEL[r.type]) : r.type;
  if (r.type === "STATUS_CHANGED" && r.value) return t("Status changed to {status}", { status: valueLabel(r.value, t) });
  if (r.type === "SCHEDULED") {
    const c = r.config ?? {};
    const f = c.frequency === "weekly" ? t("Weekly") : c.frequency === "weekdays" ? t("Weekdays") : c.frequency === "monthly" ? t("Monthly") : t("Daily");
    return `${f} ${String(c.time ?? "")} WIB`;
  }
  if (r.type === "DUE_DATE_APPROACHING") return t("{n}h before due", { n: r.value || "24" });
  return base;
}

function actionText(a: NexusAutomationRule, t: LangApi["t"]) {
  const def = ACTIONS.find((d) => d.type === a.type);
  const base = def ? t(def.label) : a.type;
  if ((a.type === "SET_STATUS" || a.type === "SET_PRIORITY") && a.value) return `${base}: ${valueLabel(a.value, t)}`;
  if ((a.type === "ADD_TAG" || a.type === "REMOVE_TAG") && a.value) return `${base}: ${a.value}`;
  return base;
}

export function AutomationsView({ projectId }: { projectId: string }) {
  const L = useLang();
  const { t } = L;
  const qc = useQueryClient();
  const key = ["nexus", "automations", projectId];
  const list = useQuery({ queryKey: key, queryFn: () => nexusApi.automations(projectId), retry: false });
  const project = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId), retry: false });
  const members = useQuery({ queryKey: ["nexus", "project-members", projectId], queryFn: () => nexusApi.projectMembers(projectId), retry: false, staleTime: 60_000 });
  const fields = useQuery({ queryKey: ["nexus", "project-custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), retry: false, staleTime: 60_000 });
  const forms = useQuery({ queryKey: ["nexus", "forms", projectId], queryFn: () => nexusApi.forms(projectId), retry: false, staleTime: 60_000 });
  const [editing, setEditing] = useState<{ id: string | null; tab: "rule" | "runs" } | null>(null);
  const [deleting, setDeleting] = useState<NexusAutomation | null>(null);

  // Live: rules edited, toggled or run anywhere (another tab, a colleague, the clock) refetch here.
  useRealtimeRoom(`project:${projectId}`);
  const { socket } = useRealtime();
  useEffect(() => {
    if (!socket) return;
    const onChanged = (p?: { projectId?: unknown; automationId?: unknown }) => {
      if (p?.projectId !== projectId) return;
      qc.invalidateQueries({ queryKey: ["nexus", "automations", projectId] });
      if (typeof p.automationId === "string") qc.invalidateQueries({ queryKey: ["nexus", "automation-runs", p.automationId] });
    };
    socket.on("automations-changed", onChanged);
    return () => { socket.off("automations-changed", onChanged); };
  }, [socket, projectId, qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => nexusApi.updateAutomation({ id, enabled }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ automations: NexusAutomation[]; canEdit?: boolean }>(key);
      if (prev) qc.setQueryData(key, { ...prev, automations: prev.automations.map((a) => (a.id === id ? { ...a, enabled } : a)) });
      return { prev };
    },
    onError: (e, _v, c) => { if (c?.prev) qc.setQueryData(key, c.prev); toast.error(e instanceof Error ? e.message : t("Couldn't change it.")); },
    onSettled: invalidate,
  });
  const del = useMutation({
    mutationFn: (id: string) => nexusApi.deleteAutomation(id),
    onSuccess: () => { invalidate(); toast.success(t("Automation deleted. Restore it from Control Room → Audit.")); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't delete it.")),
  });
  const suggest = useMutation({ mutationFn: () => nexusApi.automationSuggestions(projectId) });
  const addSuggestion = useMutation({
    mutationFn: (s: { name: string; trigger: NexusAutomationRule; action: NexusAutomationRule }) => nexusApi.createAutomation({ name: s.name, projectId, trigger: s.trigger, actions: [s.action] }),
    onSuccess: () => { invalidate(); toast.success(t("Automation is on")); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't add it.")),
  });

  const ctx: BuilderContext = useMemo(() => {
    const m = members.data;
    const arr = Array.isArray(m) ? m : m?.members ?? [];
    const lists = project.data?.taskLists ?? [];
    return {
      projectId,
      sections: lists.map((l) => ({ id: l.id, name: l.name })),
      members: arr.map((x) => x.user).filter((u): u is NonNullable<typeof u> => !!u?.id).map((u) => ({ id: u.id, name: u.name || u.email || "?", avatar: u.avatar ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
      fields: (fields.data?.fields ?? []).map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options })),
      forms: (forms.data ?? []).map((f) => ({ id: f.id, name: f.name })),
      tasks: lists.flatMap((l) => (l.tasks ?? []).map((x) => ({ id: x.id, title: x.title }))).slice(0, 300),
    };
  }, [projectId, members.data, project.data, fields.data, forms.data]);

  const rows = list.data?.automations ?? [];
  const canEdit = !!list.data?.canEdit;
  const suggestions = suggest.data?.suggestions ?? [];
  const current = editing?.id ? rows.find((r) => r.id === editing.id) ?? null : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight"><Zap className="h-5 w-5 text-primary" /> {t("Automations")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("When something happens in this project, NEXUS does the next step for you.")}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => suggest.mutate()} disabled={suggest.isPending} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent active:scale-[0.98] disabled:opacity-50">{suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />} {t("Suggest")}</button>
            <button type="button" onClick={() => setEditing({ id: null, tab: "rule" })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-4 w-4" /> {t("New automation")}</button>
          </div>
        )}
      </section>

      {suggest.isSuccess && suggestions.length === 0 && <p className="text-sm text-muted-foreground">{t("No suggestions yet: NEXUS needs more tasks in this project to spot patterns.")}</p>}
      {suggestions.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <span className="text-xs font-semibold text-primary">{t("Suggested")}</span>
          {suggestions.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <span className="min-w-0 flex-1 text-sm font-semibold">{s.name}</span>
              <span className="text-xs text-muted-foreground">{triggerText(s.trigger, t)} <ArrowRight className="inline h-3 w-3" /> {actionText(s.action, t)}</span>
              <button type="button" onClick={() => addSuggestion.mutate(s)} disabled={addSuggestion.isPending} className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50">{t("Add")}</button>
            </div>
          ))}
        </section>
      )}

      {list.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>}
      {list.isError && <p className="text-sm text-muted-foreground">{t("Couldn't load the automations of this project.")}</p>}
      {!list.isLoading && !list.isError && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <Zap className="mx-auto mb-3 h-7 w-7 text-muted-foreground/50" />
          <div className="font-semibold">{t("No automations yet")}</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{canEdit ? t("Set one up: pick what starts it, filter which tasks, then what NEXUS should do.") : t("Project leads can set up automations here.")}</p>
          {canEdit && <button type="button" onClick={() => setEditing({ id: null, tab: "rule" })} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" /> {t("New automation")}</button>}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="hidden grid-cols-[2.5rem_1fr_9rem_2rem] gap-3 border-b border-border px-4 py-2 text-[11px] font-semibold text-muted-foreground md:grid">
            <span>{t("On")}</span><span>{t("Automation")}</span><span>{t("Last run")}</span><span />
          </div>
          {rows.map((a) => {
            const actions = a.actions?.length ? a.actions : a.action ? [a.action] : [];
            const nCond = a.conditions?.rules.length ?? 0;
            return (
              <div key={a.id} className="grid grid-cols-[2.5rem_1fr_2rem] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[2.5rem_1fr_9rem_2rem]">
                <button type="button" role="switch" aria-checked={!!a.enabled} aria-label={t("Turn {name} on or off", { name: a.name })} disabled={!canEdit || toggle.isPending} onClick={() => toggle.mutate({ id: a.id, enabled: !a.enabled })} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed", a.enabled ? "bg-primary" : "bg-muted", !canEdit && "opacity-70")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all", a.enabled ? "left-[18px]" : "left-0.5")} />
                </button>
                <button type="button" onClick={() => setEditing({ id: a.id, tab: "rule" })} className="min-w-0 text-left">
                  <div className={cn("truncate text-sm font-semibold", !a.enabled && "text-muted-foreground")}>{a.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">{t("When")}</span> {triggerText(a.trigger, t)}
                    {nCond > 0 && <> · {L.tn(nCond, "{n} condition", "{n} conditions")}</>}
                    {" "}<ArrowRight className="inline h-3 w-3" />{" "}
                    {actions.map((x) => actionText(x, t)).join(", ") || "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground md:hidden">{a.lastRunAt ? `${t(RUN_STATUS_LABEL[a.lastRunStatus ?? ""] ?? "")} · ${relative(a.lastRunAt, L)}` : t("Never ran")}</div>
                </button>
                <button type="button" onClick={() => setEditing({ id: a.id, tab: "runs" })} className="hidden items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground md:inline-flex" title={t("Open the run log")}>
                  {a.lastRunAt ? (
                    <>
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_TONE[a.lastRunStatus ?? ""] ?? "bg-muted")} />
                      <span className="truncate">{relative(a.lastRunAt, L)}{a.runCount ? ` · ${L.tn(a.runCount, "{n} run", "{n} runs")}` : ""}</span>
                    </>
                  ) : <span>{t("Never ran")}</span>}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={t("More for {name}", { name: a.name })} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><MoreHorizontal className="h-4 w-4" /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing({ id: a.id, tab: "rule" })}><Zap className="mr-2 h-4 w-4" /> {canEdit ? t("Edit") : t("View")}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setEditing({ id: a.id, tab: "runs" })}><History className="mr-2 h-4 w-4" /> {t("Run log")}</DropdownMenuItem>
                    {canEdit && <DropdownMenuItem onSelect={() => setDeleting(a)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> {t("Delete")}</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}

      {editing && (editing.id === null || current) && (
        <AutomationBuilder key={editing.id ?? "new"} automation={current} ctx={ctx} canEdit={canEdit} initialTab={editing.tab} onClose={() => setEditing(null)} />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete “{name}”?", { name: deleting?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("It stops running right away. Its run log goes with it. You can restore it from Control Room → Audit.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleting) del.mutate(deleting.id); setDeleting(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { nexusApi, type NexusCustomField } from "@/lib/nexus-api";
import { AUTOFILL_FIELD_TYPES, getAutofill, removeAutofill, runAutofillNow, saveAutofill, type AutofillConfig, type AutofillMode } from "@/lib/gideon-ai";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * AI Autofill (owner, 12 Oct 2026 — Notion's "✨ AI Autofill" panel on a database): GIDEON fills a custom
 * field from each task's own title and description — a summary, one of the field's options, or a value
 * pulled out of the text. On demand ("Fill empty", "Refill all") and/or when a task is created or its
 * text changes. It always runs as the person who triggered it, with their access; "Review before writing"
 * turns every value into a change they approve in the GIDEON panel.
 */

const key = (projectId: string) => ["gideon-autofill", projectId] as const;

/** Which fields are AI-filled, and which (field, task) values GIDEON wrote (the ✨ marker). */
export function useAutofillMarks(projectId: string | null | undefined) {
  const q = useQuery({ queryKey: key(projectId ?? ""), queryFn: () => getAutofill(projectId!), enabled: !!projectId, staleTime: 30_000, retry: false });
  return useMemo(() => {
    const aiFields = new Set((q.data?.configs ?? []).map((c) => c.customFieldId));
    const marks = new Set((q.data?.marks ?? []).map((m) => `${m.customFieldId}:${m.taskId}`));
    return { aiFields, isMarked: (fieldId: string, taskId: string) => marks.has(`${fieldId}:${taskId}`) };
  }, [q.data]);
}

const MODE_LABEL: Record<AutofillMode, string> = { summary: "Summarize", classify: "Classify into an option", extract: "Extract a value" };

function modesFor(type: string): AutofillMode[] {
  const tp = type.toUpperCase();
  if (["SELECT", "DROPDOWN", "MULTI_SELECT", "STATUS"].includes(tp)) return ["classify"];
  if (tp === "TEXT") return ["summary", "extract", "classify"];
  return ["extract"];
}

export function AutofillPanel({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["nexus", "project-custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), enabled: open });
  const data = useQuery({
    queryKey: key(projectId),
    queryFn: () => getAutofill(projectId),
    enabled: open,
    // While a fill is running, look again every few seconds for its result.
    refetchInterval: (q) => ((q.state.data?.configs ?? []).some((c) => c.lastResult?.at === "running") ? 4000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key(projectId) });
  const all = fields.data?.fields ?? [];
  const configs = data.data?.configs ?? [];
  const canManage = data.data?.canManage ?? false;
  const eligible = all.filter((f) => AUTOFILL_FIELD_TYPES.includes((f.type ?? "").toUpperCase()) && !configs.some((c) => c.customFieldId === f.id));
  const add = useMutation({
    mutationFn: (fieldId: string) => saveAutofill({ customFieldId: fieldId }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't save.")),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t("AI Autofill")}</SheetTitle>
          <SheetDescription>{t("GIDEON fills fields from each task's own title and description, with the access of whoever runs it.")}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-3">
          {(fields.isLoading || data.isLoading) && <div className="grid h-24 place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
          {data.data && !data.data.configured && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">{t("GIDEON isn't connected on this server, so nothing will be filled.")}</p>
          )}
          {configs.map((c) => {
            const field = all.find((f) => f.id === c.customFieldId);
            return field ? <AutofillCard key={c.customFieldId} config={c} field={field} canManage={canManage} onChanged={refresh} /> : null;
          })}
          {!data.isLoading && configs.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
              <Sparkles className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-semibold">{t("No AI fields yet")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("Pick a field and GIDEON keeps it filled: a one-line summary, a category from your options, a date or amount found in the text.")}</p>
            </div>
          )}
          {canManage && (
            eligible.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" disabled={add.isPending} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t("New AI Autofill")}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-64">
                  <DropdownMenuLabel className="text-xs">{t("Which field should GIDEON fill?")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {eligible.map((f) => (
                    <DropdownMenuItem key={f.id} onSelect={() => add.mutate(f.id)}>
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.type}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : configs.length === 0 && !fields.isLoading ? (
              <p className="text-xs text-muted-foreground">{t("Add a Text, Number, Select, Date or URL field first (Project settings › Fields), then come back here.")}</p>
            ) : null
          )}
          {!canManage && data.data && <p className="text-xs text-muted-foreground">{t("Only project members can change AI Autofill.")}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AutofillCard({ config, field, canManage, onChanged }: { config: AutofillConfig; field: NexusCustomField; canManage: boolean; onChanged: () => void }) {
  const { t, locale } = useLang();
  const [prompt, setPrompt] = useState(config.prompt ?? "");
  const modes = modesFor(field.type ?? "");
  const save = useMutation({
    mutationFn: (patch: Partial<AutofillConfig>) => saveAutofill({ customFieldId: config.customFieldId, ...patch }),
    onSuccess: onChanged,
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't save.")),
  });
  const run = useMutation({
    mutationFn: (scope: "empty" | "all") => runAutofillNow(config.customFieldId, scope),
    onSuccess: (r) => {
      if (!r.started) toast.message(t("Every task already has a value."));
      else toast.success(t("GIDEON is filling {n} tasks…", { n: r.count }), { description: r.remaining > 0 ? t("{n} more after this batch: run it again.", { n: r.remaining }) : undefined });
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Couldn't start.")),
  });
  const remove = useMutation({ mutationFn: () => removeAutofill(config.customFieldId), onSuccess: onChanged });
  const running = config.lastResult?.at === "running" || run.isPending;
  const last = config.lastResult && config.lastResult.at !== "running" ? config.lastResult : null;
  const disabled = !canManage;
  return (
    <section className={cn("rounded-xl border bg-card p-3", config.enabled ? "border-border" : "border-dashed border-border opacity-80")}>
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{field.name}</div>
          <div className="text-[11px] text-muted-foreground">{field.type}</div>
        </div>
        <Switch checked={config.enabled} disabled={disabled} onCheckedChange={(v) => save.mutate({ enabled: v })} aria-label={t("On")} />
      </div>

      <div className="mt-3 space-y-3 text-xs">
        {modes.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {modes.map((m) => (
              <button key={m} type="button" disabled={disabled} onClick={() => save.mutate({ mode: m })} className={cn("rounded-full border px-2.5 py-1 font-semibold", config.mode === m ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent")}>{t(MODE_LABEL[m])}</button>
            ))}
          </div>
        )}
        <label className="block">
          <span className="font-semibold">{t("Instructions (optional)")}</span>
          <textarea
            value={prompt}
            disabled={disabled}
            rows={2}
            maxLength={1000}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => { if ((config.prompt ?? "") !== prompt.trim()) save.mutate({ prompt: prompt.trim() || null }); }}
            placeholder={config.mode === "classify" ? t("e.g. Bug if something is broken, Feature if it is new work.") : config.mode === "extract" ? t("e.g. The invoice amount in rupiah.") : t("e.g. One sentence: what is being delivered, for whom.")}
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
          />
        </label>
        <div className="space-y-1.5">
          <div className="font-semibold">{t("Fill automatically")}</div>
          <label className="flex items-center justify-between gap-2"><span>{t("When a task is created")}</span><Switch checked={config.onCreate} disabled={disabled} onCheckedChange={(v) => save.mutate({ onCreate: v })} /></label>
          <label className="flex items-center justify-between gap-2"><span>{t("When a task's title or description changes")}</span><Switch checked={config.onUpdate} disabled={disabled} onCheckedChange={(v) => save.mutate({ onUpdate: v })} /></label>
        </div>
        <div className="space-y-1">
          <div className="font-semibold">{t("Before a value is written")}</div>
          <div className="flex gap-1">
            {(["review", "auto"] as const).map((a) => (
              <button key={a} type="button" disabled={disabled} onClick={() => save.mutate({ approval: a })} className={cn("flex-1 rounded-lg border px-2 py-1.5 font-semibold", config.approval === a ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-accent")}>
                {a === "review" ? t("Review before writing") : t("Write directly")}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{config.approval === "review" ? t("Each value waits for whoever triggered it, in the GIDEON panel.") : t("Values are written straight away and marked ✨.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <button type="button" disabled={disabled || running} onClick={() => run.mutate("empty")} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{running ? t("Filling…") : t("Fill empty")}
          </button>
          <button type="button" disabled={disabled || running} onClick={() => run.mutate("all")} className="rounded-lg border border-border px-2.5 py-1.5 font-semibold hover:bg-accent disabled:opacity-50">{t("Refill all")}</button>
          {canManage && <button type="button" onClick={() => remove.mutate()} title={t("Turn off and remove")} aria-label={t("Turn off and remove")} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
        {last && (
          <p className={cn("text-[11px]", last.error ? "text-destructive" : "text-muted-foreground")}>
            {last.error
              ? t("Last run failed: {reason}", { reason: last.error })
              : t("Last run {when}: {filled} filled · {proposed} waiting for review · {skipped} left as they were", {
                  when: new Date(last.at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                  filled: last.filled, proposed: last.proposed, skipped: last.skipped,
                })}
          </p>
        )}
      </div>
    </section>
  );
}

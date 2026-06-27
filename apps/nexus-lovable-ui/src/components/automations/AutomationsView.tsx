import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, Sparkles, Trash2, Zap } from "lucide-react";
import { nexusApi, statusLabel, type NexusAutomation, type NexusAutomationRule } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

const TRIGGERS = [
  { type: "task_created", label: "Task created" },
  { type: "task_status_changed", label: "Status changed" },
  { type: "task_assigned", label: "Task assigned" },
  { type: "task_due_approaching", label: "Due date approaching" },
];
const ACTIONS = [
  { type: "CHANGE_STATUS", label: "Change status", values: ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] },
  { type: "SET_PRIORITY", label: "Set priority", values: ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] },
  { type: "CREATE_SUBTASK", label: "Create subtask", values: null },
];
const STATUS_VALUES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];

function ruleLabel(rule?: NexusAutomationRule | null) {
  if (!rule) return "—";
  const base = TRIGGERS.find((t) => t.type === rule.type)?.label ?? ACTIONS.find((a) => a.type === rule.type)?.label ?? statusLabel(rule.type);
  return rule.value ? `${base}: ${statusLabel(rule.value)}` : base;
}

export function AutomationsView({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const list = useQuery({ queryKey: ["nexus", "automations", projectId], queryFn: () => nexusApi.automations(projectId), retry: false });
  const suggest = useMutation({ mutationFn: () => nexusApi.automationSuggestions(projectId) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "automations", projectId] });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => nexusApi.updateAutomation({ id, enabled }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.deleteAutomation(id), onSuccess: invalidate });
  const createFromSuggestion = useMutation({
    mutationFn: (s: { name: string; trigger: NexusAutomationRule; action: NexusAutomationRule }) => nexusApi.createAutomation({ name: s.name, projectId, trigger: s.trigger, action: s.action }),
    onSuccess: invalidate,
  });

  const rows = list.data?.automations ?? [];
  const suggestions = suggest.data?.suggestions ?? [];

  return (
    <div className="p-4 md:p-8 space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-border bg-card p-5 shadow-soft">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary"><Zap className="h-3.5 w-3.5" /> Automation rules</div>
          <h2 className="mt-2 font-display text-xl font-bold tracking-tight">When this happens, do that.</h2>
          <p className="mt-1 text-sm text-muted-foreground">Live from /api/automations — triggers fire actions on your board.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => suggest.mutate()} disabled={suggest.isPending} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent active:scale-[0.98] disabled:opacity-50">{suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />} Suggest</button>
          <button onClick={() => setComposerOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-4 w-4" /> New rule</button>
        </div>
      </section>

      {suggestions.length > 0 && (
        <section className="space-y-2 rounded-[28px] border border-primary/20 bg-primary/5 p-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Suggested rules</span>
          {suggestions.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5">
              <span className="flex-1 text-sm font-semibold">{s.name}</span>
              <span className="text-xs text-muted-foreground">{ruleLabel(s.trigger)} <ArrowRight className="inline h-3 w-3" /> {ruleLabel(s.action)}</span>
              <button onClick={() => createFromSuggestion.mutate(s)} disabled={createFromSuggestion.isPending} className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 active:scale-[0.97] disabled:opacity-50">Add</button>
            </div>
          ))}
        </section>
      )}

      {list.isLoading && <p className="text-sm text-muted-foreground">Loading automations…</p>}
      {!list.isLoading && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><Zap className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">No automations yet</div><p className="mt-2 text-sm text-muted-foreground">Create your first rule, or hit Suggest for some auto ideas.</p></div>
      )}

      <div className="space-y-2">
        {rows.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-soft">
            <button onClick={() => toggle.mutate({ id: a.id, enabled: !a.enabled })} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", a.enabled ? "bg-primary" : "bg-muted")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", a.enabled ? "left-[18px]" : "left-0.5")} />
            </button>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-semibold", !a.enabled && "text-muted-foreground")}>{a.name}</div>
              <div className="text-xs text-muted-foreground">{ruleLabel(a.trigger)} <ArrowRight className="inline h-3 w-3" /> {ruleLabel(a.action)}</div>
            </div>
            <button onClick={() => { if (confirm(`Delete automation "${a.name}"?`)) del.mutate(a.id); }} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      {composerOpen && <AutomationComposer projectId={projectId} onClose={() => setComposerOpen(false)} onCreated={invalidate} />}
    </div>
  );
}

function AutomationComposer({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState(TRIGGERS[0].type);
  const [triggerValue, setTriggerValue] = useState("");
  const [actionType, setActionType] = useState(ACTIONS[0].type);
  const [actionValue, setActionValue] = useState(ACTIONS[0].values?.[0] ?? "");

  const actionDef = ACTIONS.find((a) => a.type === actionType)!;
  const needsTriggerValue = triggerType === "task_status_changed";

  const create = useMutation({
    mutationFn: () => nexusApi.createAutomation({
      name: name.trim(),
      projectId,
      trigger: { type: triggerType, ...(needsTriggerValue && triggerValue ? { value: triggerValue } : {}) },
      action: { type: actionType, ...(actionValue ? { value: actionValue } : {}) },
    }),
    onSuccess: () => { onCreated(); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold tracking-tight">New automation</h2>
        <div className="mt-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name, e.g. Auto-prioritize bugs" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
          <div className="rounded-xl border border-border bg-background p-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">When (trigger)</span>
            <div className="mt-2 flex flex-wrap gap-2">
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm font-semibold outline-none focus:border-primary">
                {TRIGGERS.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              {needsTriggerValue && (
                <select value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-primary">
                  <option value="">any status</option>
                  {STATUS_VALUES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-background p-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Then (action)</span>
            <div className="mt-2 flex flex-wrap gap-2">
              <select value={actionType} onChange={(e) => { setActionType(e.target.value); const def = ACTIONS.find((a) => a.type === e.target.value)!; setActionValue(def.values?.[0] ?? ""); }} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm font-semibold outline-none focus:border-primary">
                {ACTIONS.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
              </select>
              {actionDef.values ? (
                <select value={actionValue} onChange={(e) => setActionValue(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-primary">
                  {actionDef.values.map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}
                </select>
              ) : (
                <input value={actionValue} onChange={(e) => setActionValue(e.target.value)} placeholder="Subtask title" className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-primary" />
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2">
          <button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create rule</button>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">Cancel</button>
          {create.isError && <span className="text-xs font-semibold text-destructive">Failed — you need the LEAD role on this project.</span>}
        </div>
      </div>
    </div>
  );
}

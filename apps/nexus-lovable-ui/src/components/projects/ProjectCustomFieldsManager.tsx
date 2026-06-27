import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { CUSTOM_FIELD_TYPES, nexusApi, type NexusCustomField, type NexusCustomFieldOptions } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  TEXT: "Text",
  SELECT: "Dropdown",
  MULTI_SELECT: "Multi-select",
  STATUS: "Status",
  NUMBER: "Number",
  DATE: "Date",
  URL: "URL",
  FILE: "Files & media",
  PLACE: "Place / Map",
  CREATED: "Created (auto)",
};

const OPTION_TYPES = new Set(["SELECT", "MULTI_SELECT", "STATUS"]);

function fieldOptionList(field: NexusCustomField): string[] {
  const o = field.options;
  if (Array.isArray(o)) return o.map(String);
  if (o && typeof o === "object") {
    const obj = o as { options?: unknown[]; choices?: unknown[] };
    if (Array.isArray(obj.options)) return obj.options.map(String);
    if (Array.isArray(obj.choices)) return obj.choices.map(String);
  }
  return [];
}

function fieldNumberFormat(field: NexusCustomField): "plain" | "currency-idr" {
  const o = field.options;
  if (o && typeof o === "object" && !Array.isArray(o) && (o as { format?: string }).format === "currency-idr") return "currency-idr";
  return "plain";
}

function buildOptions(type: string, optionList: string[], numberFormat: "plain" | "currency-idr"): NexusCustomFieldOptions | null {
  if (OPTION_TYPES.has(type)) return { options: optionList.map((s) => s.trim()).filter(Boolean) };
  if (type === "NUMBER") return numberFormat === "currency-idr" ? { format: "currency-idr" } : null;
  return null;
}

/** Inline create/edit form for one custom field. Reused by the task panel's "+ new field". */
export function FieldEditor({ initial, saving, onSave, onCancel }: { initial?: NexusCustomField; saving: boolean; onSave: (payload: { name: string; type: string; options: NexusCustomFieldOptions | null }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ? initial.type.toUpperCase() : "SELECT");
  const [optionList, setOptionList] = useState<string[]>(() => {
    const list = initial ? fieldOptionList(initial) : [];
    return list.length ? list : OPTION_TYPES.has(type) ? [""] : [];
  });
  const [numberFormat, setNumberFormat] = useState<"plain" | "currency-idr">(initial ? fieldNumberFormat(initial) : "plain");

  const showOptions = OPTION_TYPES.has(type);
  const canSave = name.trim().length > 0 && (!showOptions || optionList.some((o) => o.trim()));

  const onTypeChange = (next: string) => {
    setType(next);
    if (OPTION_TYPES.has(next) && optionList.length === 0) setOptionList([""]);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Field name (e.g. Production Status)" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />

      <div className="flex flex-wrap gap-1.5">
        {CUSTOM_FIELD_TYPES.map((t) => (
          <button key={t} type="button" onClick={() => onTypeChange(t)} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", type === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40")}>
            {TYPE_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      {showOptions && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Options</span>
          {optionList.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={opt} onChange={(e) => setOptionList((list) => list.map((o, j) => (j === i ? e.target.value : o)))} placeholder={`Option ${i + 1}`} className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
              <button type="button" onClick={() => setOptionList((list) => list.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setOptionList((list) => [...list, ""])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"><Plus className="h-3.5 w-3.5" /> Add option</button>
        </div>
      )}

      {type === "NUMBER" && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Format</span>
          {(["plain", "currency-idr"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setNumberFormat(f)} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", numberFormat === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground")}>
              {f === "plain" ? "Plain" : "Rp (IDR)"}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" disabled={!canSave || saving} onClick={() => onSave({ name: name.trim(), type, options: buildOptions(type, optionList, numberFormat) })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {initial ? "Update" : "New field"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">Cancel</button>
      </div>
    </div>
  );
}

export function ProjectCustomFieldsManager({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fieldsQuery = useQuery({ queryKey: ["project-custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId) });
  const fields = fieldsQuery.data?.fields ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project-custom-fields", projectId] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).some((k) => k.includes("task-cf") || k.includes("project")) });
  };

  const create = useMutation({
    mutationFn: (payload: { name: string; type: string; options: NexusCustomFieldOptions | null }) => nexusApi.createCustomField(projectId, payload),
    onSuccess: () => { setAdding(false); invalidate(); },
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; type: string; options: NexusCustomFieldOptions | null } }) => nexusApi.updateCustomField(id, payload),
    onSuccess: () => { setEditingId(null); invalidate(); },
  });
  const del = useMutation({
    mutationFn: (id: string) => nexusApi.deleteCustomField(id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-2 border-t border-border pt-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Fields · {fields.length}</span>
        {!adding && <button onClick={() => { setAdding(true); setEditingId(null); }} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> New field</button>}
      </div>
      <p className="text-xs text-muted-foreground">Metadata just for this project — shows up in every task's details (e.g. Production Status, Budget, Location).</p>

      {fieldsQuery.isLoading && <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

      <div className="space-y-1.5">
        {fields.map((f) => (
          editingId === f.id ? (
            <FieldEditor key={f.id} initial={f} saving={update.isPending} onCancel={() => setEditingId(null)} onSave={(payload) => update.mutate({ id: f.id, payload })} />
          ) : (
            <div key={f.id} className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{f.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {TYPE_LABELS[(f.type ?? "").toUpperCase()] ?? f.type}
                  {(() => { const opts = fieldOptionList(f); return opts.length ? ` · ${opts.slice(0, 4).join(", ")}${opts.length > 4 ? "…" : ""}` : fieldNumberFormat(f) === "currency-idr" ? " · Rp" : ""; })()}
                </div>
              </div>
              <button onClick={() => { setEditingId(f.id); setAdding(false); }} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => { if (confirm(`Delete custom field "${f.name}"? Its value on every task gets wiped too.`)) del.mutate(f.id); }} disabled={del.isPending} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )
        ))}
        {!fieldsQuery.isLoading && fields.length === 0 && !adding && <p className="text-xs text-muted-foreground">No fields yet.</p>}
      </div>

      {adding && <FieldEditor saving={create.isPending} onCancel={() => setAdding(false)} onSave={(payload) => create.mutate(payload)} />}

      {(create.isError || update.isError || del.isError) && <p className="text-xs font-semibold text-destructive">That didn't go through — you need the LEAD role, or check your access.</p>}
    </div>
  );
}

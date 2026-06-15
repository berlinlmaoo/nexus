import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlignLeft, Calendar, Check, CheckSquare, ChevronDown, Copy, FileText, GitBranch, GripVertical, Hash, ListChecks, Loader2, Mail, Paperclip, Plus, Trash2, Type, X } from "lucide-react";
import { nexusApi, type NexusForm, type NexusFormField } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";

export const FIELD_TYPES: { value: string; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "textarea", label: "Textarea", icon: AlignLeft },
  { value: "email", label: "Email", icon: Mail },
  { value: "number", label: "Number", icon: Hash },
  { value: "date", label: "Date", icon: Calendar },
  { value: "dropdown", label: "Dropdown", icon: ChevronDown },
  { value: "multi_select", label: "Multi-select", icon: ListChecks },
  { value: "checkbox", label: "Checkbox", icon: CheckSquare },
  { value: "file", label: "File", icon: Paperclip },
];
const OPTION_TYPES = ["dropdown", "multi_select", "select"];

let fieldCounter = 0;
export function newField(): NexusFormField {
  fieldCounter += 1;
  return { id: `field_${Date.now()}_${fieldCounter}`, label: "", type: "text", required: false };
}

/** Live preview of how one field renders on the public form — the clarity win. */
function FieldPreview({ field }: { field: NexusFormField }) {
  const label = (field.name || field.label)?.trim() || "Untitled field";
  const opts = Array.isArray(field.options) ? field.options : (field.options?.choices ?? []);
  const base = "block w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground";
  if (field.type === "checkbox") {
    return <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" disabled className="h-4 w-4" /> {label}</label>;
  }
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-foreground">{label}{field.required ? <span className="text-destructive"> *</span> : null}</div>
      {field.type === "textarea" ? (
        <textarea disabled rows={2} placeholder="Long text answer" className={cn(base, "resize-none")} />
      ) : field.type === "dropdown" || field.type === "select" ? (
        <select disabled className={base}>{opts.length ? opts.map((o, i) => <option key={i}>{o}</option>) : <option>Pilih opsi…</option>}</select>
      ) : field.type === "multi_select" ? (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border bg-card p-2">
          {(() => { const shown = opts.map(String).filter((o) => o.trim()); return (shown.length ? shown : ["Opsi"]).map((o, i) => <label key={i} className="flex items-center gap-2 text-xs"><input type="checkbox" disabled className="h-3.5 w-3.5" /> {o}</label>); })()}
        </div>
      ) : field.type === "file" ? (
        <div className={cn(base, "flex items-center gap-2")}><Paperclip className="h-3.5 w-3.5" /> Pilih file…</div>
      ) : (
        <input disabled type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : "text"} placeholder={field.type === "email" ? "email@example.com" : field.type === "number" ? "0" : field.type === "date" ? "" : "Short text answer"} className={base} />
      )}
    </div>
  );
}

/* ---------- advanced field logic (branching / routing / mapping / schedule) ---------- */
type FCond = { fieldId: string; operator: string; value: string };
type FRule = { id: string; operator: string; value: string; action: string; targetTaskListId?: string; targetUserId?: string };
type FMapping = { target?: string; customFieldId?: string };
export type RichField = NexusFormField & { name?: string; showIf?: FCond | null; routingRules?: FRule[]; mapping?: FMapping | null; attachmentEnabled?: boolean };

const OPERATORS = [
  { value: "equals", label: "sama dengan" },
  { value: "not_equals", label: "tidak sama dengan" },
  { value: "contains", label: "mengandung" },
  { value: "is_empty", label: "kosong" },
  { value: "is_not_empty", label: "tidak kosong" },
];
const needsValue = (op: string) => op !== "is_empty" && op !== "is_not_empty";
const MAPPING_TARGETS = [
  { value: "none", label: "— tidak dipetakan —" },
  { value: "task_title", label: "Judul task" },
  { value: "task_description", label: "Deskripsi task" },
  { value: "task_due_date", label: "Tanggal due" },
  { value: "task_status", label: "Status" },
  { value: "task_priority", label: "Prioritas" },
  { value: "task_list", label: "Section / list" },
  { value: "custom_field", label: "Custom field" },
];
const ROUTING_ACTIONS = [
  { value: "set_task_list", label: "Pindah ke section" },
  { value: "assign_user", label: "Assign ke member" },
];
const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

function fieldName(f: RichField) { return f.name || f.label || "Untitled"; }
function optionsOf(f: RichField): string[] {
  if (Array.isArray(f.options)) return f.options;
  if (f.options && typeof f.options === "object" && Array.isArray(f.options.choices)) return f.options.choices;
  return [];
}
function genId() { return `r_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; }

function AccessScheduleEditor({ value, onChange }: { value: { enabled?: boolean; daysOfWeek?: number[]; startTime?: string; endTime?: string; timezone?: string; override?: "open" | "closed" } | null; onChange: (v: unknown) => void }) {
  const s = value ?? {};
  const enabled = !!s.enabled;
  const days = Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [];
  const override = s.override === "open" || s.override === "closed" ? s.override : undefined;
  // Always carry the FULL current state forward so a partial edit never drops a sibling field.
  const base = { enabled, daysOfWeek: days, startTime: s.startTime ?? "00:00", endTime: s.endTime ?? "23:59", timezone: s.timezone ?? "Asia/Jakarta", ...(override ? { override } : {}) };
  const patch = (p: Record<string, unknown>) => onChange({ ...base, enabled: true, ...p });
  const fieldCls = "rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary";
  const OV: { v: "open" | "closed" | undefined; l: string }[] = [{ v: undefined, l: "Auto" }, { v: "open", l: "Buka paksa" }, { v: "closed", l: "Tutup paksa" }];
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-3">
      {/* Master on/off override — beats the schedule (force open / force closed). */}
      <div>
        <div className="mb-1.5 text-sm font-semibold">Status form</div>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {OV.map((o) => (
            <button key={o.l} type="button" onClick={() => onChange({ ...base, override: o.v })}
              className={cn("rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", override === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{o.l}</button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {override === "open" ? "🟢 Dibuka paksa — selalu nerima submit, jadwal diabaikan." : override === "closed" ? "🔴 Ditutup paksa — gak nerima submit sementara." : "Ikut jadwal di bawah (kalau jadwal mati = selalu buka)."}
        </p>
      </div>

      <label className={cn("flex items-center gap-2 text-sm font-semibold", override && "opacity-50")}>
        <input type="checkbox" checked={enabled} onChange={(e) => onChange({ ...base, enabled: e.target.checked, daysOfWeek: e.target.checked && days.length === 0 ? [1, 2, 3, 4, 5] : days })} className="h-4 w-4 accent-primary" />
        Batasi jadwal akses form {override && <span className="text-[11px] font-normal text-muted-foreground">(diabaikan selama override aktif)</span>}
      </label>
      {enabled && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Hari</div>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d, i) => {
                const on = days.includes(i);
                return <button key={i} type="button" onClick={() => patch({ daysOfWeek: on ? days.filter((x) => x !== i) : [...days, i].sort((a, b) => a - b) })} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold transition-colors", on ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-accent")}>{d}</button>;
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-semibold text-muted-foreground">Jam</label>
            <input type="time" value={s.startTime ?? "00:00"} onChange={(e) => patch({ startTime: e.target.value })} className={fieldCls} />
            <span className="text-muted-foreground">–</span>
            <input type="time" value={s.endTime ?? "23:59"} onChange={(e) => patch({ endTime: e.target.value })} className={fieldCls} />
            <span className="text-[11px] text-muted-foreground">({s.timezone ?? "Asia/Jakarta"})</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AdvancedFieldEditor({ field, others, taskLists, members, customFields, onChange }: {
  field: RichField;
  others: RichField[];
  taskLists: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  customFields: { id: string; name: string }[];
  onChange: (patch: Partial<RichField>) => void;
}) {
  const showIf = field.showIf ?? null;
  const rules = field.routingRules ?? [];
  const mapping = field.mapping ?? { target: "none" };
  const sel = "rounded-lg border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-primary";
  const parent = showIf ? others.find((o) => o.id === showIf.fieldId) : undefined;
  const parentOpts = parent ? optionsOf(parent) : [];
  const ownOpts = optionsOf(field);

  return (
    <details className="mt-2 rounded-lg border border-border bg-background/60 px-3 py-2 [&_summary]:cursor-pointer [&_summary]:list-none">
      <summary className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><GitBranch className="h-3 w-3" /> Advanced — branching · routing · mapping</summary>
      <div className="mt-3 space-y-4">
        {/* showIf */}
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={!!showIf} onChange={(e) => onChange({ showIf: e.target.checked ? { fieldId: others[0]?.id ?? "", operator: "equals", value: "" } : null })} className="h-3.5 w-3.5 accent-primary" />
            Tampilkan field ini hanya jika…
          </label>
          {showIf && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <select value={showIf.fieldId} onChange={(e) => onChange({ showIf: { ...showIf, fieldId: e.target.value, value: "" } })} className={sel}>
                {others.length === 0 && <option value="">(tidak ada field lain)</option>}
                {others.map((o) => <option key={o.id} value={o.id}>{fieldName(o)}</option>)}
              </select>
              <select value={showIf.operator} onChange={(e) => onChange({ showIf: { ...showIf, operator: e.target.value } })} className={sel}>
                {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
              </select>
              {needsValue(showIf.operator) && (
                parentOpts.length
                  ? <select value={showIf.value} onChange={(e) => onChange({ showIf: { ...showIf, value: e.target.value } })} className={sel}><option value="">—</option>{parentOpts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  : <input value={showIf.value} onChange={(e) => onChange({ showIf: { ...showIf, value: e.target.value } })} placeholder="nilai" className={sel} />
              )}
            </div>
          )}
        </div>

        {/* routing */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold">Routing</span>
            <button type="button" onClick={() => onChange({ routingRules: [...rules, { id: genId(), operator: "equals", value: "", action: "assign_user" }] })} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-accent"><Plus className="h-3 w-3" /> Rule</button>
          </div>
          {rules.length === 0 && <p className="text-[11px] text-muted-foreground">Belum ada rule.</p>}
          <div className="space-y-1.5">
            {rules.map((r, i) => {
              const setRule = (p: Partial<FRule>) => onChange({ routingRules: rules.map((x, xi) => (xi === i ? { ...x, ...p } : x)) });
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-1.5">
                  <span className="text-[11px] text-muted-foreground">jika</span>
                  <select value={r.operator} onChange={(e) => setRule({ operator: e.target.value })} className={sel}>{OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}</select>
                  {needsValue(r.operator) && (ownOpts.length ? <select value={r.value} onChange={(e) => setRule({ value: e.target.value })} className={sel}><option value="">—</option>{ownOpts.map((o) => <option key={o} value={o}>{o}</option>)}</select> : <input value={r.value} onChange={(e) => setRule({ value: e.target.value })} placeholder="nilai" className={sel} />)}
                  <span className="text-[11px] text-muted-foreground">→</span>
                  <select value={r.action} onChange={(e) => setRule({ action: e.target.value })} className={sel}>{ROUTING_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
                  {r.action === "set_task_list" ? (
                    <select value={r.targetTaskListId ?? ""} onChange={(e) => setRule({ targetTaskListId: e.target.value })} className={sel}><option value="">pilih section</option>{taskLists.map((tl) => <option key={tl.id} value={tl.id}>{tl.name}</option>)}</select>
                  ) : (
                    <select value={r.targetUserId ?? ""} onChange={(e) => setRule({ targetUserId: e.target.value })} className={sel}><option value="">pilih member</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
                  )}
                  <button type="button" onClick={() => onChange({ routingRules: rules.filter((_, xi) => xi !== i) })} aria-label="Hapus rule" className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
              );
            })}
          </div>
        </div>

        {/* mapping */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">Petakan jawaban ke</span>
          <select value={mapping.target ?? "none"} onChange={(e) => onChange({ mapping: { ...mapping, target: e.target.value } })} className={sel}>
            {MAPPING_TARGETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          {mapping.target === "custom_field" && (
            <select value={mapping.customFieldId ?? ""} onChange={(e) => onChange({ mapping: { ...mapping, target: "custom_field", customFieldId: e.target.value } })} className={sel}>
              <option value="">pilih custom field</option>
              {customFields.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>
    </details>
  );
}

export function FormCard({ form, projectName, onEdit }: { form: NexusForm; projectName?: string; onEdit: () => void }) {
  const [copied, setCopied] = useState(false);
  const publicUrl = `${window.location.origin}/f/${form.id}`;
  const copy = () => { navigator.clipboard?.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:border-primary/30 hover:shadow-pop">
      <button onClick={onEdit} className="flex-1 text-left">
        <div className="flex items-start gap-2"><FileText className="mt-0.5 h-5 w-5 text-primary" /><div className="min-w-0"><h3 className="truncate font-semibold tracking-tight">{form.name}</h3>{projectName && <p className="mt-0.5 truncate text-[11px] font-medium text-primary/80">{projectName}</p>}<p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{form.description || `${form.fields?.length ?? 0} fields`}</p></div></div>
      </button>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>{form._count?.submissions ?? 0} submissions · {form.fields?.length ?? 0} fields</span>
        <span className={cn("rounded-full px-2 py-0.5 font-bold", form.isPublic ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{form.isPublic ? "Public" : "Private"}</span>
      </div>
      {form.isPublic && (
        <button onClick={copy} className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold transition-colors hover:bg-accent active:scale-[0.98]">
          {copied ? <><Check className="h-3.5 w-3.5 text-success" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy public link</>}
        </button>
      )}
    </div>
  );
}

export function FormBuilder({ projectId, form, onClose }: { projectId: string; form?: NexusForm; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!form;
  const [name, setName] = useState(form?.name ?? "");
  const [description, setDescription] = useState(form?.description ?? "");
  const [isPublic, setIsPublic] = useState(form?.isPublic ?? false);
  const [requireAuth, setRequireAuth] = useState(form?.requireAuth ?? false);
  const [accessSchedule, setAccessSchedule] = useState<unknown>((form as NexusForm & { accessSchedule?: unknown })?.accessSchedule ?? null);
  // Load existing fields intact (keeps advanced props like showIf/routingRules/mapping
  // so saving never wipes them). Sync name↔label; map legacy "select" → "dropdown".
  const [fields, setFields] = useState<RichField[]>(() => {
    const init = form?.fields?.length ? form.fields : [newField()];
    return init.map((f) => ({ ...f, type: f.type === "select" ? "dropdown" : f.type, name: f.name || f.label || "", label: f.label || f.name || "" }));
  });

  // task lists + members power the routing editor
  const projectQ = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId), enabled: !!projectId, retry: false });
  const taskLists = (projectQ.data?.taskLists ?? []).map((t) => ({ id: t.id, name: t.name }));
  const membersQ = useQuery({ queryKey: ["nexus", "project-members", projectId], queryFn: () => nexusApi.projectMembers(projectId), enabled: !!projectId, retry: false });
  const members = (() => {
    const raw = membersQ.data;
    const arr = Array.isArray(raw) ? raw : (raw?.members ?? []);
    return arr.map((m) => ({ userId: m.userId ?? m.user?.id ?? "", name: m.user?.name ?? "Member" })).filter((m) => m.userId);
  })();
  const customFieldsQ = useQuery({ queryKey: ["nexus", "custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), enabled: !!projectId, retry: false });
  const customFields = (customFieldsQ.data?.fields ?? []).map((c) => ({ id: c.id, name: c.name }));

  // drag-to-reorder fields (grip handle = drag source, card = drop target)
  const dragFrom = useRef<number | null>(null);
  const reorder = (to: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === to) return;
    setFields((cur) => {
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "forms"] });
  const save = useMutation({
    mutationFn: () => {
      // Drop blank option rows before saving (the editor keeps an empty row for typing).
      const cleanFields = fields.map((f) => Array.isArray(f.options) ? { ...f, options: (f.options as unknown[]).map(String).map((s) => s.trim()).filter(Boolean) } : f);
      return editing
        ? nexusApi.updateForm(form!.id, { name: name.trim(), description: description || null, fields: cleanFields, isPublic, requireAuth, accessSchedule })
        : nexusApi.createForm({ name: name.trim(), description: description || null, fields: cleanFields, isPublic, requireAuth, projectId, accessSchedule });
    },
    onSuccess: () => { invalidate(); onClose(); },
  });
  const del = useMutation({ mutationFn: () => nexusApi.deleteForm(form!.id), onSuccess: () => { invalidate(); onClose(); } });

  const update = (id: string, patch: Partial<RichField>) => setFields((cur) => cur.map((f) => f.id === id ? { ...f, ...patch } : f));
  const remove = (id: string) => setFields((cur) => cur.filter((f) => f.id !== id));

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto rounded-l-3xl border-l border-border bg-card shadow-pop">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
          <h2 className="font-display text-lg font-bold tracking-tight">{editing ? "Edit form" : "New form"}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Form name" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description (optional)…" className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="h-4 w-4 accent-primary" /> Public form (shareable link, no login)</label>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={requireAuth} onChange={(e) => setRequireAuth(e.target.checked)} className="h-4 w-4 accent-primary" /> Wajib login NEXUS untuk submit <span className="font-normal text-muted-foreground">(siapa pun yang login; pengajuan bisa dilacak di “Pengajuan Saya”)</span></label>
          <AccessScheduleEditor value={accessSchedule as { enabled?: boolean; daysOfWeek?: number[]; startTime?: string; endTime?: string; timezone?: string } | null} onChange={setAccessSchedule} />

          <div className="space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Fields</span>
            {fields.map((f, idx) => {
              const TypeIcon = FIELD_TYPES.find((t) => t.value === f.type)?.icon ?? Type;
              return (
                <div key={f.id} onDragOver={(e) => e.preventDefault()} onDrop={() => reorder(idx)} className="rounded-xl border border-border bg-background p-3">
                  {/* header: index + delete */}
                  <div className="mb-2 flex items-center gap-2">
                    <span draggable onDragStart={() => { dragFrom.current = idx; }} onDragEnd={() => { dragFrom.current = null; }} title="Geser untuk ubah urutan" className="cursor-grab text-muted-foreground/40 active:cursor-grabbing"><GripVertical className="h-4 w-4 shrink-0" /></span>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Field {idx + 1}</span>
                    <button onClick={() => remove(f.id)} aria-label="Delete field" className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>

                  {/* field name */}
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Field name</label>
                  <input value={f.name ?? f.label} onChange={(e) => update(f.id, { name: e.target.value, label: e.target.value })} placeholder="e.g. Nominal pengajuan" className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium outline-none focus:border-primary" />

                  {/* type + required */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] font-semibold text-muted-foreground">Type</label>
                    <div className="relative">
                      <TypeIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <select
                        value={f.type}
                        onChange={(e) => update(f.id, { type: e.target.value, ...(OPTION_TYPES.includes(e.target.value) && !f.options ? { options: [] } : {}) })}
                        className="h-9 appearance-none rounded-lg border border-border bg-card pl-8 pr-8 text-sm font-semibold outline-none focus:border-primary"
                      >
                        {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <span className={cn("text-xs font-semibold", f.required ? "text-primary" : "text-muted-foreground")}>{f.required ? "Wajib" : "Opsional"}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={f.required ?? false}
                        aria-label="Wajib diisi"
                        onClick={() => update(f.id, { required: !f.required })}
                        className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", f.required ? "bg-primary" : "bg-muted")}
                      >
                        <span className={cn("inline-block h-4 w-4 rounded-full bg-card shadow transition-transform", f.required ? "translate-x-4" : "translate-x-0.5")} />
                      </button>
                    </div>
                  </div>

                  {/* per-question attachment: let the respondent attach a file to this answer */}
                  {f.type !== "file" && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!f.attachmentEnabled}
                        aria-label="Izinkan lampiran file"
                        onClick={() => update(f.id, { attachmentEnabled: !f.attachmentEnabled })}
                        className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", f.attachmentEnabled ? "bg-primary" : "bg-muted")}
                      >
                        <span className={cn("inline-block h-4 w-4 rounded-full bg-card shadow transition-transform", f.attachmentEnabled ? "translate-x-4" : "translate-x-0.5")} />
                      </button>
                      <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" /> Izinkan lampiran file (opsional)</span>
                    </label>
                  )}

                  {/* options for dropdown / multi-select — one row per option, add as many as you want */}
                  {OPTION_TYPES.includes(f.type) && (() => {
                    const optsArr: string[] = Array.isArray(f.options) ? (f.options as unknown[]).map(String) : [];
                    const rows = optsArr.length ? optsArr : [""];
                    return (
                      <div className="mt-2 space-y-1.5">
                        <label className="block text-[11px] font-semibold text-muted-foreground">Options</label>
                        {rows.map((opt, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <input
                              value={opt}
                              onChange={(e) => { const next = [...rows]; next[i] = e.target.value; update(f.id, { options: next }); }}
                              placeholder={`Opsi ${i + 1}`}
                              className="flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                            />
                            <button type="button" onClick={() => update(f.id, { options: rows.filter((_, j) => j !== i) })} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-destructive" aria-label="Hapus opsi"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => update(f.id, { options: [...rows, ""] })} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"><Plus className="h-3.5 w-3.5" /> Tambah opsi</button>
                      </div>
                    );
                  })()}

                  {/* advanced: branching / routing / mapping */}
                  <AdvancedFieldEditor field={f} others={fields.filter((x) => x.id !== f.id)} taskLists={taskLists} members={members} customFields={customFields} onChange={(patch) => update(f.id, patch)} />

                  {/* live preview */}
                  <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 p-2.5">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Preview</div>
                    <FieldPreview field={f} />
                  </div>
                </div>
              );
            })}
            <button onClick={() => setFields((cur) => [...cur, newField()])} className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary active:scale-[0.98]"><Plus className="h-4 w-4" /> Add field</button>
          </div>
        </div>
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-card/95 px-5 py-4 backdrop-blur">
          <button disabled={!name.trim() || fields.length === 0 || save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? "Save form" : "Create form"}</button>
          {editing && <button onClick={() => { if (confirm("Delete this form?")) del.mutate(); }} className="inline-flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 active:scale-[0.98]"><Trash2 className="h-4 w-4" /> Delete</button>}
          {save.isError && <span className="text-xs font-semibold text-destructive">Gagal menyimpan form.</span>}
        </div>
      </aside>
    </div>
  );
}

/** Project-scoped forms list + builder (used in the project detail "Forms" tab). */
export function ProjectFormsView({ projectId }: { projectId: string }) {
  const [builder, setBuilder] = useState<{ form?: NexusForm } | null>(null);
  const forms = useQuery({ queryKey: ["nexus", "forms", projectId], queryFn: () => nexusApi.forms(projectId), enabled: !!projectId, retry: false });
  const rows = forms.data ?? [];
  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">Intake forms</h2>
          <p className="text-sm text-muted-foreground">Forms that spin up real tasks in this project on submit.</p>
        </div>
        <button onClick={() => setBuilder({})} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> New form</button>
      </div>
      {forms.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex items-start gap-2"><Skeleton className="h-5 w-5 rounded" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div>
              <Skeleton className="mt-4 h-3 w-1/3" />
            </div>
          ))}
        </div>
      )}
      {!forms.isLoading && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft"><FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><div className="text-lg font-bold">No forms yet</div><p className="mt-2 text-sm text-muted-foreground">Buat intake form pertama untuk project ini.</p></div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((f, i) => <Reveal key={f.id} delay={Math.min(i, 8) * 0.05} className="h-full"><FormCard form={f} onEdit={() => setBuilder({ form: f })} /></Reveal>)}
      </div>
      {builder && <FormBuilder projectId={projectId} form={builder.form} onClose={() => setBuilder(null)} />}
    </div>
  );
}

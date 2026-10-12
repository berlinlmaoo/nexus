import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, Filter, Loader2, Play, Plus, Search, Trash2, X, Zap,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SelectPicker } from "@/components/SelectPicker";
import { nexusApi, type NexusAutomation, type NexusAutomationRun } from "@/lib/nexus-api";
import { useLang, type LangApi } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  ACTIONS, BUILTIN_FIELDS, LEGACY_TRIGGER_LABEL, OPS, PRIORITIES, SETTABLE_BUILTIN, STATUSES, TEMPLATE_HINT, TRIGGERS, WEEKDAYS,
  cfChoices, cfKind, type ConditionRule, type Conditions, type FieldKind, type Rule,
} from "./automation-meta";

/**
 * The "When / If / Do" builder (owner, 12 Oct 2026, after Notion's Automations modal): a centred dialog with
 * the trigger, optional property filters, and an ordered list of actions; a second tab shows the run log.
 * People who cannot manage the project see it read-only.
 */

export type BuilderContext = {
  projectId: string;
  /** taskStatus set = the section is a status option (owner, 12 Oct 2026, lib/status-sections.ts). */
  sections: Array<{ id: string; name: string; position?: number; taskStatus?: string | null }>;
  members: Array<{ id: string; name: string; avatar?: string | null }>;
  fields: Array<{ id: string; name: string; type: string; options?: unknown }>;
  forms: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; title: string }>;
};

type Opt = { value: string; label: string; hint?: string; group?: string };

const input = "h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary disabled:opacity-70";
const picker = "h-9 rounded-lg px-2.5 text-sm";

function errorText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** A searchable menu (Notion's "+ New trigger" / "+ New action"). */
function PickMenu({ trigger, options, onPick, placeholder, disabled }: { trigger: ReactNode; options: Opt[]; onPick: (v: string) => void; placeholder: string; disabled?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = options.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = Array.from(new Set(list.map((o) => o.group ?? "")));
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQ(""); }}>
      <PopoverTrigger asChild disabled={disabled}>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
        <div className="mt-1 max-h-80 overflow-y-auto overscroll-contain">
          {list.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t("Nothing matches.")}</div>}
          {groups.map((g) => (
            <div key={g}>
              {g && <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground">{t(g)}</div>}
              {list.filter((o) => (o.group ?? "") === g).map((o) => (
                <button key={o.value} type="button" onClick={() => { onPick(o.value); setOpen(false); setQ(""); }} className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent">
                  <span className="text-sm font-medium">{o.label}</span>
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Sel({ value, onChange, options, disabled, label, className }: { value: string; onChange: (v: string) => void; options: Opt[]; disabled?: boolean; label: string; className?: string }) {
  const { t } = useLang();
  // Options with a group render under its heading (the status options: To-do / In progress / Complete).
  return (
    <SelectPicker
      variant="field"
      ariaLabel={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={options.map((o) => ({ value: o.value, label: o.label, group: o.group ? t(o.group) : undefined }))}
      className={cn(picker, className)}
    />
  );
}

// ── Status options (sections are the statuses, owner 12 Oct 2026) ────────────────────────────────
// A project whose sections stand for statuses offers ITS options ("Concept & Design", "Budget Approval"…)
// wherever a status is picked. Stored so released apps still read an enum: a trigger keeps `value` = the
// option's status and adds config.toSection / config.fromSection; "Set status" keeps `value` and adds
// config.sectionId; conditions and "Field changed" use the field "section" (shown as "Status").

const STATUS_GROUP_OF: Record<string, string> = { TODO: "To-do", IN_PROGRESS: "In progress", IN_REVIEW: "In progress", DONE: "Complete", CANCELLED: "Complete" };
const GROUP_ORDER = ["To-do", "In progress", "Complete"];

export function usesStatusOptions(ctx: BuilderContext): boolean {
  return ctx.sections.some((s) => !!s.taskStatus);
}

/** The project's status options, grouped and in board order. Value = section id. */
function statusOptionList(ctx: BuilderContext): Opt[] {
  return ctx.sections
    .filter((s) => !!s.taskStatus)
    .map((s) => ({ s, g: STATUS_GROUP_OF[s.taskStatus!] ?? "To-do" }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.g) - GROUP_ORDER.indexOf(b.g) || (a.s.position ?? 0) - (b.s.position ?? 0))
    .map(({ s, g }) => ({ value: s.id, label: s.name, group: g }));
}

/** A rule saved with a bare status (before options, or from an app): kept selectable as "Any <status>". */
function legacyStatusOpt(value: string | undefined, t: LangApi["t"]): Opt[] {
  const s = value ? STATUSES.find((x) => x.value === value) : null;
  return s ? [{ value: `status:${s.value}`, label: t("Any “{status}” column", { status: t(s.label) }) }] : [];
}

/** People chips: special recipients plus project members. */
function PeoplePicker({ value, onChange, specials, members, disabled }: { value: string[]; onChange: (v: string[]) => void; specials: Opt[]; members: BuilderContext["members"]; disabled?: boolean }) {
  const { t } = useLang();
  const all: Opt[] = [...specials, ...members.map((m) => ({ value: m.id, label: m.name, group: "Project members" }))];
  const label = (v: string) => all.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-2 pr-1 text-xs font-semibold">
          {label(v)}
          {!disabled && <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={t("Remove {name}", { name: label(v) })} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}
        </span>
      ))}
      {!disabled && (
        <PickMenu
          placeholder={t("Search people…")}
          options={all.filter((o) => !value.includes(o.value))}
          onPick={(v) => onChange([...value, v])}
          trigger={<button type="button" className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground hover:bg-accent"><Plus className="h-3 w-3" /> {t("Add")}</button>}
        />
      )}
    </div>
  );
}

function listOf(v?: string): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? listOf(v) : [];
}

function fieldOptions(ctx: BuilderContext, t: LangApi["t"], include: (key: string) => boolean, current?: string): Opt[] {
  const statusMode = usesStatusOptions(ctx);
  return [
    ...BUILTIN_FIELDS
      .filter((f) => include(f.key))
      .filter((f) => !(statusMode && f.key === "status" && current !== "status"))
      .map((f) => ({ value: f.key, label: statusMode && f.key === "section" ? t("Status") : statusMode && f.key === "status" ? t("Status type") : t(f.label), group: "Task" })),
    ...ctx.fields.filter((f) => include(`cf:${f.id}`)).map((f) => ({ value: `cf:${f.id}`, label: f.name, group: "Custom fields" })),
  ];
}

function kindOf(field: string, ctx: BuilderContext): FieldKind {
  const b = BUILTIN_FIELDS.find((f) => f.key === field);
  if (b) return b.kind as FieldKind;
  const cf = ctx.fields.find((f) => `cf:${f.id}` === field);
  return cfKind(cf?.type);
}

/** The value editor for one field (status/priority/section/person get a menu, select fields their choices). */
function ValueInput({ field, value, onChange, ctx, disabled, allowAny, placeholder }: { field: string; value: string; onChange: (v: string) => void; ctx: BuilderContext; disabled?: boolean; allowAny?: string; placeholder?: string }) {
  const { t } = useLang();
  const kind = kindOf(field, ctx);
  const any: Opt[] = allowAny ? [{ value: "", label: allowAny }] : [];
  if (kind === "status") return <Sel label={t("Status")} value={value} onChange={onChange} disabled={disabled} options={[...any, ...STATUSES.map((s) => ({ value: s.value, label: t(s.label) }))]} />;
  if (kind === "priority") return <Sel label={t("Priority")} value={value} onChange={onChange} disabled={disabled} options={[...any, ...PRIORITIES.map((s) => ({ value: s.value, label: t(s.label) }))]} />;
  if (kind === "section") return usesStatusOptions(ctx)
    ? <Sel label={t("Status")} value={value} onChange={onChange} disabled={disabled} options={[...any, ...statusOptionList(ctx), ...ctx.sections.filter((s) => !s.taskStatus).map((s) => ({ value: s.id, label: s.name, group: "Other sections" }))]} />
    : <Sel label={t("Section")} value={value} onChange={onChange} disabled={disabled} options={[...any, ...ctx.sections.map((s) => ({ value: s.id, label: s.name }))]} />;
  if (kind === "person") return <Sel label={t("Person")} value={value} onChange={onChange} disabled={disabled} options={[...any, ...ctx.members.map((m) => ({ value: m.id, label: m.name }))]} />;
  if (kind === "select") {
    const cf = ctx.fields.find((f) => `cf:${f.id}` === field);
    const choices = cfChoices(cf?.options);
    if (choices.length) return <Sel label={cf?.name ?? t("Value")} value={value} onChange={onChange} disabled={disabled} options={[...any, ...choices.map((c) => ({ value: c, label: c }))]} />;
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder ?? (allowAny ? allowAny : t("Value"))} type={kind === "number" ? "number" : "text"} className={cn(input, "min-w-0 flex-1")} />;
}

function Section({ label, children, aside }: { label: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Connector() {
  return <div aria-hidden className="mx-auto my-1.5 h-5 w-px bg-border" />;
}

// ── Trigger ───────────────────────────────────────────────────────────────────────────────────

function TriggerConfig({ trigger, set, ctx, automation, disabled }: { trigger: Rule; set: (r: Rule) => void; ctx: BuilderContext; automation?: NexusAutomation | null; disabled?: boolean }) {
  const { t, locale } = useLang();
  const cfg = trigger.config ?? {};
  const setCfg = (patch: Record<string, unknown>) => set({ ...trigger, config: { ...cfg, ...patch } });
  switch (trigger.type) {
    case "STATUS_CHANGED":
      if (usesStatusOptions(ctx)) {
        const opts = statusOptionList(ctx);
        const enumOf = (id: string) => ctx.sections.find((s) => s.id === id)?.taskStatus ?? undefined;
        const fromVal = typeof cfg.fromSection === "string" ? cfg.fromSection : typeof cfg.from === "string" && cfg.from ? `status:${cfg.from}` : "";
        const toVal = typeof cfg.toSection === "string" ? cfg.toSection : trigger.value ? `status:${trigger.value}` : "";
        const pick = (v: string, side: "from" | "to") => {
          const legacy = v.startsWith("status:") ? v.slice(7) : null;
          const next: Record<string, unknown> = { ...cfg, bySection: true };
          if (side === "from") {
            next.fromSection = legacy || !v ? undefined : v;
            next.from = legacy ?? (v ? enumOf(v) : undefined);
            set({ ...trigger, config: next });
          } else {
            next.toSection = legacy || !v ? undefined : v;
            set({ ...trigger, value: legacy ?? (v ? enumOf(v) : undefined), config: next });
          }
        };
        return (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("from")}</span>
            <Sel label={t("From status")} disabled={disabled} value={fromVal} onChange={(v) => pick(v, "from")} options={[{ value: "", label: t("Any status") }, ...legacyStatusOpt(typeof cfg.fromSection === "string" ? undefined : (cfg.from as string | undefined), t), ...opts]} />
            <span className="text-muted-foreground">{t("to")}</span>
            <Sel label={t("To status")} disabled={disabled} value={toVal} onChange={(v) => pick(v, "to")} options={[{ value: "", label: t("Any status") }, ...legacyStatusOpt(typeof cfg.toSection === "string" ? undefined : trigger.value, t), ...opts]} />
          </div>
        );
      }
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("from")}</span>
          <Sel label={t("From status")} disabled={disabled} value={String(cfg.from ?? "")} onChange={(v) => setCfg({ from: v || undefined })} options={[{ value: "", label: t("Any status") }, ...STATUSES.map((s) => ({ value: s.value, label: t(s.label) }))]} />
          <span className="text-muted-foreground">{t("to")}</span>
          <Sel label={t("To status")} disabled={disabled} value={trigger.value ?? ""} onChange={(v) => set({ ...trigger, value: v || undefined })} options={[{ value: "", label: t("Any status") }, ...STATUSES.map((s) => ({ value: s.value, label: t(s.label) }))]} />
        </div>
      );
    case "ASSIGNEE_CHANGED":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("when this person is added")}</span>
          <Sel label={t("Person")} disabled={disabled} value={trigger.value ?? ""} onChange={(v) => set({ ...trigger, value: v || undefined })} options={[{ value: "", label: t("Anyone (any change)") }, ...ctx.members.map((m) => ({ value: m.id, label: m.name }))]} />
        </div>
      );
    case "FIELD_CHANGED":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Sel label={t("Field")} disabled={disabled} value={trigger.field ?? ""} onChange={(v) => set({ ...trigger, field: v || undefined, value: undefined })} options={[{ value: "", label: t("Pick a field…") }, ...fieldOptions(ctx, t, (k) => k !== "creator" && k !== "status" && k !== "assignee")]} />
          {trigger.field && (
            <>
              <span className="text-muted-foreground">{trigger.field === "tags" ? t("gets the tag") : t("becomes")}</span>
              <ValueInput field={trigger.field} value={trigger.value ?? ""} onChange={(v) => set({ ...trigger, value: v || undefined })} ctx={ctx} disabled={disabled} allowAny={t("anything")} />
            </>
          )}
        </div>
      );
    case "FORM_SUBMITTED":
      return <Sel label={t("Form")} disabled={disabled} value={trigger.value ?? ""} onChange={(v) => set({ ...trigger, value: v || undefined })} options={[{ value: "", label: t("Any form of this project") }, ...ctx.forms.map((f) => ({ value: f.id, label: f.name }))]} />;
    case "DUE_DATE_APPROACHING":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="number" min={1} max={720} disabled={disabled} value={trigger.value ?? "24"} onChange={(e) => set({ ...trigger, value: e.target.value })} aria-label={t("Hours before due")} className={cn(input, "w-20")} />
          <span className="text-muted-foreground">{t("hours before the due date (once per task)")}</span>
        </div>
      );
    case "DUE_DATE_REACHED":
      return <p className="text-xs text-muted-foreground">{t("Runs once per task when its due date passes and it is not done or cancelled.")}</p>;
    case "SCHEDULED": {
      const freq = String(cfg.frequency ?? "daily");
      const days = arr(cfg.days).map(Number);
      return (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Sel label={t("Repeat")} disabled={disabled} value={freq} onChange={(v) => setCfg({ frequency: v, ...(v === "weekly" && days.length === 0 ? { days: [1] } : {}) })} options={[
              { value: "daily", label: t("Every day") }, { value: "weekdays", label: t("Every weekday (Mon–Fri)") },
              { value: "weekly", label: t("Every week") }, { value: "monthly", label: t("Every month") },
            ]} />
            <span className="text-muted-foreground">{t("at")}</span>
            <input type="time" disabled={disabled} value={String(cfg.time ?? "09:00")} onChange={(e) => setCfg({ time: e.target.value })} aria-label={t("Time")} className={cn(input, "w-28")} />
            <span className="text-xs text-muted-foreground">WIB</span>
            {freq === "monthly" && (
              <>
                <span className="text-muted-foreground">{t("on day")}</span>
                <input type="number" min={1} max={28} disabled={disabled} value={String(cfg.dayOfMonth ?? 1)} onChange={(e) => setCfg({ dayOfMonth: Number(e.target.value) })} aria-label={t("Day of month")} className={cn(input, "w-16")} />
              </>
            )}
          </div>
          {freq === "weekly" && (
            <div className="flex gap-1" role="group" aria-label={t("Days")}>
              {WEEKDAYS.map((d) => {
                const on = days.includes(d.d);
                return (
                  <button key={d.d} type="button" disabled={disabled} aria-pressed={on} onClick={() => setCfg({ days: on ? days.filter((x) => x !== d.d) : [...days, d.d].sort() })} className={cn("h-8 w-9 rounded-lg border text-xs font-semibold transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}>{t(d.label)}</button>
                );
              })}
            </div>
          )}
          {automation?.nextRunAt && <p className="text-xs text-muted-foreground">{t("Next run: {when}", { when: new Date(automation.nextRunAt).toLocaleString(locale, { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " WIB" })}</p>}
          <p className="text-xs text-muted-foreground">{t("Without conditions it runs once (create a task, notify). With conditions it runs on every task that matches them.")}</p>
        </div>
      );
    }
    default:
      return null;
  }
}

// ── Conditions ────────────────────────────────────────────────────────────────────────────────

function ConditionRow({ rule, set, remove, ctx, disabled }: { rule: ConditionRule; set: (r: ConditionRule) => void; remove: () => void; ctx: BuilderContext; disabled?: boolean }) {
  const { t } = useLang();
  const kind = kindOf(rule.field, ctx);
  const ops = OPS[kind];
  const op = ops.find((o) => o.op === rule.op) ?? ops[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Sel label={t("Field")} disabled={disabled} value={rule.field} onChange={(v) => set({ field: v, op: OPS[kindOf(v, ctx)][0].op })} options={fieldOptions(ctx, t, () => true, rule.field)} />
      <Sel label={t("Operator")} disabled={disabled} value={op.op} onChange={(v) => set({ ...rule, op: v })} options={ops.map((o) => ({ value: o.op, label: t(o.label) }))} />
      {!op.noValue && (op.op === "within_days"
        ? <input type="number" min={0} disabled={disabled} value={rule.value ?? ""} onChange={(e) => set({ ...rule, value: e.target.value })} aria-label={t("Days")} className={cn(input, "w-20")} />
        : kind === "date" ? <input type="date" disabled={disabled} value={rule.value ?? ""} onChange={(e) => set({ ...rule, value: e.target.value })} aria-label={t("Date")} className={input} />
        : <ValueInput field={rule.field} value={rule.value ?? ""} onChange={(v) => set({ ...rule, value: v })} ctx={ctx} disabled={disabled} />)}
      {!disabled && <button type="button" onClick={remove} aria-label={t("Remove condition")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><X className="h-4 w-4" /></button>}
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────────────────────

const PERSON_SPECIALS = (t: LangApi["t"]): Opt[] => [
  { value: "@actor", label: t("Person who triggered it"), group: "Roles" },
  { value: "@creator", label: t("Task creator"), group: "Roles" },
];
const NOTIFY_SPECIALS = (t: LangApi["t"]): Opt[] => [
  { value: "@assignees", label: t("Assignees"), group: "Roles" },
  ...PERSON_SPECIALS(t),
  { value: "@leads", label: t("Project leads"), group: "Roles" },
];

function ActionConfig({ action, set, ctx, disabled }: { action: Rule; set: (r: Rule) => void; ctx: BuilderContext; disabled?: boolean }) {
  const { t } = useLang();
  const cfg = action.config ?? {};
  const setCfg = (patch: Record<string, unknown>) => set({ ...action, config: { ...cfg, ...patch } });
  const sectionOpts = (anyLabel: string): Opt[] => [{ value: "", label: anyLabel }, ...ctx.sections.map((s) => ({ value: s.id, label: s.name }))];
  switch (action.type) {
    case "SET_STATUS":
      if (usesStatusOptions(ctx)) {
        const val = typeof cfg.sectionId === "string" ? cfg.sectionId : action.value ? `status:${action.value}` : "";
        return <Sel label={t("Status")} disabled={disabled} value={val} onChange={(v) => {
          if (v.startsWith("status:")) { const rest = { ...cfg }; delete rest.sectionId; set({ ...action, value: v.slice(7), config: rest }); return; }
          const sec = ctx.sections.find((s) => s.id === v);
          set({ ...action, value: sec?.taskStatus ?? undefined, config: { ...cfg, sectionId: v || undefined } });
        }} options={[{ value: "", label: t("Pick a status…") }, ...legacyStatusOpt(typeof cfg.sectionId === "string" ? undefined : action.value, t), ...statusOptionList(ctx)]} />;
      }
      return <Sel label={t("Status")} disabled={disabled} value={action.value ?? ""} onChange={(v) => set({ ...action, value: v })} options={[{ value: "", label: t("Pick a status…") }, ...STATUSES.map((s) => ({ value: s.value, label: t(s.label) }))]} />;
    case "SET_PRIORITY":
      return <Sel label={t("Priority")} disabled={disabled} value={action.value ?? ""} onChange={(v) => set({ ...action, value: v })} options={[{ value: "", label: t("Pick a priority…") }, ...PRIORITIES.map((s) => ({ value: s.value, label: t(s.label) }))]} />;
    case "ASSIGN_TO":
      return <PeoplePicker disabled={disabled} value={listOf(action.value)} onChange={(v) => set({ ...action, value: v.join(",") || undefined })} specials={PERSON_SPECIALS(t)} members={ctx.members} />;
    case "UNASSIGN":
      return <PeoplePicker disabled={disabled} value={listOf(action.value)} onChange={(v) => set({ ...action, value: v.join(",") || undefined })} specials={[{ value: "@all", label: t("Everyone"), group: "Roles" }, ...PERSON_SPECIALS(t)]} members={ctx.members} />;
    case "MOVE_TO_SECTION":
      return <Sel label={t("Section")} disabled={disabled} value={action.value ?? ""} onChange={(v) => set({ ...action, value: v })} options={sectionOpts(t("Pick a section…"))} />;
    case "ADD_TAG":
    case "REMOVE_TAG":
      return <input disabled={disabled} value={action.value ?? ""} onChange={(e) => set({ ...action, value: e.target.value })} placeholder={t("Tag")} className={cn(input, "w-48")} />;
    case "SET_FIELD": {
      const field = action.field ?? "";
      const isDate = field === "dueDate" || field === "startDate" || kindOf(field, ctx) === "date";
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Sel label={t("Field")} disabled={disabled} value={field} onChange={(v) => set({ ...action, field: v || undefined, value: undefined })} options={[{ value: "", label: t("Pick a field…") }, ...fieldOptions(ctx, t, (k) => SETTABLE_BUILTIN.includes(k) || (k.startsWith("cf:") && !["FILE", "CREATED", "PLACE"].includes((ctx.fields.find((f) => `cf:${f.id}` === k)?.type ?? "").toUpperCase())))]} />
          {field && <span className="text-sm text-muted-foreground">{t("to")}</span>}
          {field && (isDate
            ? <input disabled={disabled} value={action.value ?? ""} onChange={(e) => set({ ...action, value: e.target.value })} placeholder={t("+3 = in 3 days, today, 2026-12-31, empty = clear")} className={cn(input, "min-w-0 flex-1")} />
            : <ValueInput field={field} value={action.value ?? ""} onChange={(v) => set({ ...action, value: v })} ctx={ctx} disabled={disabled} placeholder={t("New value (supports {task})")} />)}
        </div>
      );
    }
    case "ADD_COMMENT":
      return (
        <div className="space-y-1">
          <textarea disabled={disabled} value={action.value ?? ""} onChange={(e) => set({ ...action, value: e.target.value })} rows={2} placeholder={t("Comment text")} className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary" />
          <p className="text-[11px] text-muted-foreground">{t("Placeholders: {list}", { list: TEMPLATE_HINT })}</p>
        </div>
      );
    case "SEND_NOTIFICATION":
      return (
        <div className="space-y-2">
          <PeoplePicker disabled={disabled} value={arr(cfg.to).length ? arr(cfg.to) : ["@assignees"]} onChange={(v) => setCfg({ to: v })} specials={NOTIFY_SPECIALS(t)} members={ctx.members} />
          <textarea disabled={disabled} value={action.value ?? ""} onChange={(e) => set({ ...action, value: e.target.value })} rows={2} placeholder={t("Message (empty = the task title)")} className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary" />
          <p className="text-[11px] text-muted-foreground">{t("Placeholders: {list}", { list: TEMPLATE_HINT })}</p>
        </div>
      );
    case "CREATE_TASK":
      return (
        <div className="space-y-2">
          <input disabled={disabled} value={action.value ?? ""} onChange={(e) => set({ ...action, value: e.target.value })} placeholder={t("Task title (supports {task}, {payload.title})")} className={cn(input, "w-full")} />
          <div className="flex flex-wrap items-center gap-2">
            <Sel label={t("Section")} disabled={disabled} value={String(cfg.sectionId ?? "")} onChange={(v) => setCfg({ sectionId: v || undefined })} options={sectionOpts(t("First section"))} />
            <Sel label={t("Priority")} disabled={disabled} value={String(cfg.priority ?? "")} onChange={(v) => setCfg({ priority: v || undefined })} options={[{ value: "", label: t("Default priority") }, ...PRIORITIES.map((s) => ({ value: s.value, label: t(s.label) }))]} />
            <input disabled={disabled} value={String(cfg.due ?? "")} onChange={(e) => setCfg({ due: e.target.value || undefined })} placeholder={t("Due: +3, today…")} aria-label={t("Due date")} className={cn(input, "w-32")} />
          </div>
          <PeoplePicker disabled={disabled} value={arr(cfg.assignees)} onChange={(v) => setCfg({ assignees: v })} specials={PERSON_SPECIALS(t)} members={ctx.members} />
        </div>
      );
    case "CREATE_SUBTASK":
      return <input disabled={disabled} value={action.value ?? ""} onChange={(e) => set({ ...action, value: e.target.value })} placeholder={t("Subtask title")} className={cn(input, "w-full")} />;
    case "DUPLICATE_TASK":
      return <Sel label={t("Section")} disabled={disabled} value={String(cfg.sectionId ?? "")} onChange={(v) => setCfg({ sectionId: v || undefined })} options={sectionOpts(t("Same section"))} />;
    case "ARCHIVE_TASK":
      return <p className="text-xs text-muted-foreground">{t("The task is deleted and can be restored from Control Room → Audit for 90 days.")}</p>;
    default:
      return null;
  }
}

// ── Run log ───────────────────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  SUCCESS: "bg-emerald-500", PARTIAL: "bg-amber-500", FAILED: "bg-destructive", SKIPPED: "bg-muted-foreground/50", RUNNING: "bg-primary",
};
export const RUN_STATUS_LABEL: Record<string, string> = { SUCCESS: "Succeeded", PARTIAL: "Partly failed", FAILED: "Failed", SKIPPED: "Nothing to do", RUNNING: "Running" };
const EVENT_LABEL: Record<string, string> = {
  task_created: "Task created", task_updated: "Task edited", comment_added: "Comment added", form_submitted: "Form submitted",
  due_approaching: "Due date approaching", due_reached: "Due date reached", scheduled: "Schedule", webhook: "Webhook received", manual: "Run by hand",
};

function RunLog({ automationId }: { automationId: string }) {
  const { t, locale } = useLang();
  const [extra, setExtra] = useState<NexusAutomationRun[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["nexus", "automation-runs", automationId], queryFn: () => nexusApi.automationRuns(automationId), retry: false });
  useEffect(() => { setExtra([]); setMore(null); }, [q.dataUpdatedAt]);
  const runs = [...(q.data?.runs ?? []), ...extra];
  const hasMore = more ?? q.data?.hasMore ?? false;
  const loadMore = async () => {
    const last = runs[runs.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await nexusApi.automationRuns(automationId, last.createdAt);
      setExtra((x) => [...x, ...r.runs]);
      setMore(r.hasMore);
    } catch (e) {
      toast.error(errorText(e, t("Couldn't load more runs.")));
    } finally {
      setLoadingMore(false);
    }
  };
  if (q.isLoading) return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>;
  if (q.isError) return <p className="py-8 text-center text-sm text-muted-foreground">{t("Couldn't load the run log.")}</p>;
  if (runs.length === 0) return (
    <div className="py-10 text-center">
      <Zap className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
      <div className="text-sm font-semibold">{t("No runs yet")}</div>
      <p className="mt-1 text-xs text-muted-foreground">{t("Each time this automation fires, it shows up here with what it did.")}</p>
    </div>
  );
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_auto] gap-2 px-2 pb-1 text-[11px] font-semibold text-muted-foreground"><span>{t("Run")}</span><span>{t("Result")}</span></div>
      {runs.map((r) => {
        const expanded = open === r.id;
        return (
          <div key={r.id} className="rounded-lg border border-border">
            <button type="button" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded} className="grid w-full grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-left hover:bg-accent/50">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{t(EVENT_LABEL[r.event] ?? r.event)}{r.task ? ` · ${r.task.title}` : r.taskId ? ` · ${t("(task deleted)")}` : ""}</span>
                <span className="block text-xs text-muted-foreground" title={new Date(r.createdAt).toLocaleString(locale, { timeZone: "Asia/Jakarta" })}>
                  {new Date(r.createdAt).toLocaleString(locale, { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} WIB
                  {r.actor?.name ? ` · ${r.actor.name}` : ""}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                <span className={cn("h-2 w-2 rounded-full", STATUS_TONE[r.status] ?? "bg-muted")} />
                {t(RUN_STATUS_LABEL[r.status] ?? r.status)}
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
              </span>
            </button>
            {expanded && (
              <div className="space-y-1 border-t border-border px-3 py-2">
                {r.steps.length === 0 && <p className="text-xs text-muted-foreground">{t("No actions ran.")}</p>}
                {r.steps.map((s, i) => {
                  const def = ACTIONS.find((a) => a.type === s.type);
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {s.ok ? (s.skipped ? <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/50" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />) : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
                      <span><span className="font-semibold">{def ? t(def.label) : s.type}</span> · <span className={cn(!s.ok && "text-destructive")}>{s.message}</span></span>
                    </div>
                  );
                })}
                {typeof r.durationMs === "number" && <p className="pt-1 text-[11px] text-muted-foreground">{t("{n} ms", { n: r.durationMs })}</p>}
              </div>
            )}
          </div>
        );
      })}
      {hasMore && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-2 w-full rounded-lg border border-border py-2 text-xs font-semibold hover:bg-accent disabled:opacity-60">{loadingMore ? t("Loading…") : t("Load older runs")}</button>
      )}
    </div>
  );
}

// ── The dialog ────────────────────────────────────────────────────────────────────────────────

function initialActions(a?: NexusAutomation | null): Rule[] {
  if (a?.actions?.length) return a.actions.map((x) => ({ ...x }));
  if (a?.action) return [{ ...a.action }];
  return [];
}

export function AutomationBuilder({ automation, ctx, canEdit, onClose, initialTab = "rule" }: { automation: NexusAutomation | null; ctx: BuilderContext; canEdit: boolean; onClose: () => void; initialTab?: "rule" | "runs" }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"rule" | "runs">(automation ? initialTab : "rule");
  const [name, setName] = useState(automation?.name ?? "");
  const [trigger, setTrigger] = useState<Rule | null>(automation?.trigger ? { ...automation.trigger } : null);
  const [conditions, setConditions] = useState<Conditions>(automation?.conditions ? { match: automation.conditions.match, rules: automation.conditions.rules.map((r) => ({ ...r })) } : { match: "all", rules: [] });
  const [actions, setActions] = useState<Rule[]>(initialActions(automation));
  const [runTaskId, setRunTaskId] = useState("");
  const readOnly = !canEdit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[data-radix-popper-content-wrapper]")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const triggerDef = TRIGGERS.find((d) => d.type === trigger?.type);
  const noTask = trigger?.type === "SCHEDULED" && conditions.rules.length === 0;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nexus", "automations", ctx.projectId] });

  const problem = useMemo(() => {
    if (!name.trim()) return t("Give it a name");
    if (!trigger) return t("Pick a trigger");
    // "Webhook received" was removed (12 Oct 2026): the rule can only be saved with another trigger.
    if (trigger.type === "WEBHOOK_RECEIVED") return t("Pick a trigger");
    if (trigger.type === "FIELD_CHANGED" && !trigger.field) return t("Pick the field to watch");
    if (trigger.type === "SCHEDULED" && trigger.config?.frequency === "weekly" && arr(trigger.config?.days).length === 0) return t("Pick at least one day");
    if (actions.length === 0) return t("Add at least one action");
    for (const a of actions) {
      if ((a.type === "SET_STATUS" || a.type === "SET_PRIORITY" || a.type === "MOVE_TO_SECTION") && !a.value) return t("Finish the “{action}” step", { action: t(ACTIONS.find((d) => d.type === a.type)?.label ?? a.type) });
      if ((a.type === "ASSIGN_TO" || a.type === "UNASSIGN") && !a.value) return t("Pick who in “{action}”", { action: t(ACTIONS.find((d) => d.type === a.type)?.label ?? a.type) });
      if ((a.type === "ADD_TAG" || a.type === "REMOVE_TAG" || a.type === "ADD_COMMENT") && !a.value?.trim()) return t("Finish the “{action}” step", { action: t(ACTIONS.find((d) => d.type === a.type)?.label ?? a.type) });
      if (a.type === "SET_FIELD" && !a.field) return t("Pick the field to set");
    }
    return null;
  }, [name, trigger, actions, t]);

  const payload = () => ({
    name: name.trim(),
    trigger: trigger!,
    actions,
    conditions: conditions.rules.length ? { match: conditions.match, rules: conditions.rules.filter((r) => r.field) } : null,
  });

  const save = useMutation({
    mutationFn: () => automation
      ? nexusApi.updateAutomation({ id: automation.id, ...payload() })
      : nexusApi.createAutomation({ projectId: ctx.projectId, enabled: true, ...payload() }),
    onSuccess: () => { invalidate(); toast.success(automation ? t("Automation saved") : t("Automation is on")); onClose(); },
    onError: (e) => toast.error(errorText(e, t("Couldn't save. Only project leads can edit automations."))),
  });
  const runNow = useMutation({
    mutationFn: () => nexusApi.runAutomation(automation!.id, runTaskId || undefined),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["nexus", "automation-runs", automation!.id] });
      invalidate();
      if (!r.run) toast.message(t("Nothing ran: the task doesn't meet the conditions."));
      else toast.success(t("Ran: {result}", { result: t(RUN_STATUS_LABEL[r.run.status] ?? r.run.status) }));
      setTab("runs");
    },
    onError: (e) => toast.error(errorText(e, t("Couldn't run it."))),
  });

  const triggerOptions: Opt[] = TRIGGERS.map((d) => ({ value: d.type, label: t(d.label), hint: t(d.hint), group: d.group === "Task" ? "Task events" : d.group === "Time" ? "Time" : "Other" }));
  const actionOptions: Opt[] = ACTIONS.map((d) => ({ value: d.type, label: t(d.label), group: d.group === "Edit" ? "Edit the task" : d.group === "Create" ? "Create" : "Tell someone" }));
  const dirty = !automation || JSON.stringify(payload()) !== JSON.stringify({ name: automation.name, trigger: automation.trigger, actions: initialActions(automation), conditions: automation.conditions ?? null });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="automation-builder-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <header className="border-b border-border px-6 pb-3 pt-5">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Zap className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <h2 id="automation-builder-title" className="sr-only">{automation ? t("Edit automation") : t("New automation")}</h2>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} placeholder={t("Name this automation")} aria-label={t("Automation name")} className="w-full bg-transparent font-display text-lg font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 disabled:opacity-100" />
              <p className="text-xs text-muted-foreground">{t("For every task in this project")}{readOnly ? ` · ${t("View only: project leads edit automations")}` : ""}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={t("Close")} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
          </div>
          {automation && (
            <div role="tablist" className="mt-3 flex gap-1">
              {(["rule", "runs"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors", tab === k ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60")}>
                  {k === "rule" ? t("Rule") : t("Run log")}{k === "runs" && automation.runCount ? ` · ${automation.runCount}` : ""}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {tab === "runs" && automation ? <RunLog automationId={automation.id} /> : (
            <div>
              <Section label={t("When")}>
                {trigger ? (
                  <div className="rounded-2xl border border-border bg-background p-3">
                    <div className="flex items-center gap-2">
                      {triggerDef && <triggerDef.icon className="h-4 w-4 text-primary" />}
                      <span className="flex-1 text-sm font-semibold">{triggerDef ? t(triggerDef.label) : LEGACY_TRIGGER_LABEL[trigger.type] ? t(LEGACY_TRIGGER_LABEL[trigger.type]) : trigger.type}</span>
                      {!readOnly && (
                        <PickMenu placeholder={t("Search triggers…")} options={triggerOptions} onPick={(v) => setTrigger(v === "SCHEDULED" ? { type: v, config: { frequency: "daily", time: "09:00" } } : v === "DUE_DATE_APPROACHING" ? { type: v, value: "24" } : { type: v })}
                          trigger={<button type="button" className="rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent">{t("Change")}</button>} />
                      )}
                    </div>
                    <div className="mt-2 empty:hidden"><TriggerConfig trigger={trigger} set={setTrigger} ctx={ctx} automation={automation} disabled={readOnly} /></div>
                  </div>
                ) : (
                  <PickMenu placeholder={t("Search triggers…")} options={triggerOptions} onPick={(v) => setTrigger(v === "SCHEDULED" ? { type: v, config: { frequency: "daily", time: "09:00" } } : v === "DUE_DATE_APPROACHING" ? { type: v, value: "24" } : { type: v })} disabled={readOnly}
                    trigger={<button type="button" className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-border bg-background px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"><Plus className="h-4 w-4" /> {t("New trigger")}</button>} />
                )}
              </Section>

              <Connector />

              <Section
                label={t("If (optional)")}
                aside={conditions.rules.length > 1 ? (
                  <Sel label={t("Match")} disabled={readOnly} value={conditions.match} onChange={(v) => setConditions({ ...conditions, match: v === "any" ? "any" : "all" })} className="h-7 text-xs" options={[{ value: "all", label: t("All conditions") }, { value: "any", label: t("Any condition") }]} />
                ) : undefined}
              >
                <div className={cn("space-y-2", conditions.rules.length > 0 && "rounded-2xl border border-border bg-background p-3")}>
                  {conditions.rules.map((r, i) => (
                    <div key={i}>
                      {i > 0 && <div className="pb-1 text-[11px] font-semibold uppercase text-muted-foreground">{conditions.match === "any" ? t("or") : t("and")}</div>}
                      <ConditionRow rule={r} ctx={ctx} disabled={readOnly}
                        set={(nr) => setConditions({ ...conditions, rules: conditions.rules.map((x, j) => (j === i ? nr : x)) })}
                        remove={() => setConditions({ ...conditions, rules: conditions.rules.filter((_, j) => j !== i) })} />
                    </div>
                  ))}
                  {!readOnly && conditions.rules.length < 10 && (
                    <button type="button" onClick={() => setConditions({ ...conditions, rules: [...conditions.rules, { field: "status", op: "is", value: "TODO" }] })} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"><Filter className="h-3.5 w-3.5" /> {t("Add condition")}</button>
                  )}
                  {readOnly && conditions.rules.length === 0 && <p className="text-xs text-muted-foreground">{t("No conditions: every matching event runs it.")}</p>}
                </div>
              </Section>

              <Connector />

              <Section label={t("Do")}>
                <div className="space-y-2">
                  {actions.map((a, i) => {
                    const def = ACTIONS.find((d) => d.type === a.type);
                    return (
                      <div key={i} className="rounded-2xl border border-border bg-background p-3">
                        <div className="flex items-center gap-2">
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold">{i + 1}</span>
                          {def && <def.icon className="h-4 w-4 text-primary" />}
                          <span className="flex-1 text-sm font-semibold">{def ? t(def.label) : a.type}</span>
                          {!readOnly && (
                            <span className="flex items-center">
                              <button type="button" disabled={i === 0} onClick={() => setActions(actions.map((x, j) => (j === i - 1 ? actions[i] : j === i ? actions[i - 1] : x)))} aria-label={t("Move up")} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                              <button type="button" disabled={i === actions.length - 1} onClick={() => setActions(actions.map((x, j) => (j === i + 1 ? actions[i] : j === i ? actions[i + 1] : x)))} aria-label={t("Move down")} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                              <button type="button" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label={t("Remove action")} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                            </span>
                          )}
                        </div>
                        <div className="mt-2 empty:hidden"><ActionConfig action={a} ctx={ctx} disabled={readOnly} set={(na) => setActions(actions.map((x, j) => (j === i ? na : x)))} /></div>
                        {def?.needsTask && noTask && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> {t("This trigger has no task, so this step is skipped. Add a condition to run it on every matching task.")}</p>}
                      </div>
                    );
                  })}
                  {!readOnly && actions.length < 10 && (
                    <PickMenu placeholder={t("Search actions…")} options={actionOptions} onPick={(v) => setActions([...actions, v === "SEND_NOTIFICATION" ? { type: v, config: { to: ["@assignees"] } } : { type: v }])}
                      trigger={<button type="button" className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-border bg-background px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"><Plus className="h-4 w-4" /> {t("New action")}</button>} />
                  )}
                </div>
              </Section>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
          {automation && canEdit && (
            <div className="flex items-center gap-1.5">
              <SelectPicker variant="field" ariaLabel={t("Task to run on")} value={runTaskId} onChange={setRunTaskId} options={[{ value: "", label: t("No task") }, ...ctx.tasks.map((x) => ({ value: x.id, label: x.title }))]} className={cn(picker, "h-8 max-w-[11rem] text-xs")} />
              <button type="button" onClick={() => runNow.mutate()} disabled={runNow.isPending || dirty} title={dirty ? t("Save your changes first") : t("Run it once now")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-accent disabled:opacity-50">
                {runNow.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t("Run now")}
              </button>
            </div>
          )}
          <span className="flex-1" />
          {canEdit && problem && tab === "rule" && <span className="text-xs text-muted-foreground">{problem}</span>}
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">{canEdit ? t("Cancel") : t("Close")}</button>
          {canEdit && (
            <button type="button" disabled={!!problem || save.isPending || !dirty} onClick={() => save.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {automation ? t("Save") : t("Turn on")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

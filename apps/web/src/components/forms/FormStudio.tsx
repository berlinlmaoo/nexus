import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CircleAlert, Copy, Download, ExternalLink, Eye, GitBranch, GripVertical, ImagePlus,
  Inbox, Laptop, Link2, Loader2, Lock, MoreHorizontal, Paperclip, Plus, Route as RouteIcon, Search, Settings2, Smartphone, SmilePlus, Trash2, User, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { nexusApi, ApiError, type NexusForm, type NexusFormBranding } from "@/lib/nexus-api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SelectPicker } from "@/components/SelectPicker";
import { DateField } from "@/components/DateField";
import { Avatar } from "@/components/Avatar";
import { ProjectMark } from "@/components/projects/ProjectIcon";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { fieldChoices } from "@/lib/project-views";
import { qrMatrix, qrSvgPath } from "@/lib/qr";
import { useLang } from "@/lib/lang";
import { useRealtimeRoom } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { FormHead, FormRenderer, QuestionControl } from "./FormRenderer";
import {
  cleanFields, condIncomplete, COVER_PRESETS, fieldTitle, hasOptions, ICON_CHOICES, kindMeta, kindOf, logicParents, MAPPING_TARGETS, needsValue, newFieldId, newQuestion,
  OPERATORS, optionsOf, QUESTION_KINDS, ROUTING_ACTIONS, staleOption, withKind, type FormDraft, type FRule, type QuestionKind, type RichField,
  categoryFieldForSectionQuestion, optionsAreSections, projectCategoryField, selectChoices,
  withMappedRupiah,
} from "./form-model";

/**
 * The form builder, rebuilt Notion-style (owner, 12 Oct 2026: "copy Notion's"). A full-page canvas that
 * looks like the form people fill in — cover, emoji, title, description, then each question as the
 * respondent sees it. Click a question to edit it in place; its settings sit in the side panel (a bottom
 * sheet on a phone). "+" between questions or "/" in a question's title picks a type. Changes save
 * themselves. Tabs: Questions · Settings · Share · Responses, plus a desktop/phone Preview.
 *
 * NEXUS-only behaviour is kept: an answer can fill a task field (mapping), routing rules, autofill from the
 * signed-in account, per-question attachments, Rupiah amounts, schedules (Auto / Force open / Force
 * closed, weekly hours) and every response becoming a task. The stored JSON shape is unchanged, so the
 * released iOS/Android apps keep filling and editing the same forms.
 */

type Tab = "questions" | "settings" | "share" | "responses";
type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
type CustomFieldLite = { id: string; name: string; type?: string; options?: unknown };
type MemberLite = { userId: string; name: string; email?: string | null; avatar?: string | null };
const SETTABLE_FIELD_TYPES = ["SELECT", "MULTI_SELECT", "STATUS", "TEXT"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function initialDraft(form: NexusForm | undefined, t: (s: string) => string): FormDraft {
  if (!form) {
    // A new form starts like Notion's: one question, and that one names the task.
    return {
      name: "",
      description: "",
      fields: [{ ...newQuestion("text"), name: t("What do you need?"), label: t("What do you need?"), required: true, mapping: { target: "task_title" } }],
      isPublic: true,
      requireAuth: true,
      accessSchedule: null,
      branding: null,
      settings: null,
    };
  }
  return {
    name: form.name ?? "",
    description: form.description ?? "",
    // Loaded intact (showIf / routing / mapping survive a save); name ↔ label synced, legacy "select" → "dropdown".
    fields: (form.fields ?? []).map((f) => ({ ...f, type: f.type === "select" ? "dropdown" : f.type, name: f.name || f.label || "", label: f.label || f.name || "" })) as RichField[],
    isPublic: form.isPublic ?? false,
    requireAuth: form.requireAuth ?? false,
    accessSchedule: (form.accessSchedule as Record<string, unknown> | null) ?? null,
    branding: form.branding ?? null,
    settings: (form.settings as Record<string, unknown> | null) ?? null,
  };
}

/* ------------------------------------------------------------------ small pieces */

function AutoTextarea({ value, onChange, placeholder, className, onKeyDown, autoFocus, ariaLabel, inputRef, keepFont }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; onKeyDown?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void; autoFocus?: boolean; ariaLabel?: string; inputRef?: (el: HTMLTextAreaElement | null) => void;
  /** Over 16px already: phones keep this size (styles.css forces other fields to 16px against iOS zoom). */
  keepFont?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => { ref.current = el; inputRef?.(el); }}
      rows={1}
      value={value}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      data-keep-font={keepFont ? "" : undefined}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={cn("block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/50", className)}
    />
  );
}

function Toggle({ checked, onChange, label, hint, icon, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; icon?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent">
      {icon && <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", checked ? "bg-primary" : "bg-muted dark:bg-control-border")}>
        <span className={cn("inline-block h-4 w-4 rounded-full bg-card shadow transition-transform dark:bg-background", checked ? "translate-x-4" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

function PanelSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-border px-3 py-3 first:border-t-0">
      <div className="mb-1.5 flex items-center justify-between px-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4 dark:bg-scrim" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ type menu ("+" and "/") */

function useKindList(query: string) {
  const { t } = useLang();
  const q = query.trim().toLowerCase();
  const list = QUESTION_KINDS.filter((k) => !q || t(k.label).toLowerCase().includes(q) || k.label.toLowerCase().includes(q) || k.keywords.includes(q));
  if (!q) return list;
  // The type whose name is what was typed comes first ("Checkbox" + Enter = Checkbox, not Multiple choice,
  // whose keywords mention checkboxes); then names that start with it; then the rest, in menu order.
  const rank = (k: (typeof QUESTION_KINDS)[number]) => {
    const names = [t(k.label).toLowerCase(), k.label.toLowerCase()];
    return names.includes(q) ? 0 : names.some((n) => n.startsWith(q)) ? 1 : 2;
  };
  return list.map((k, i) => ({ k, i, r: rank(k) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.k);
}

function TypeList({ query, active, onPick, onHover }: { query: string; active: number; onPick: (k: QuestionKind) => void; onHover: (i: number) => void }) {
  const { t } = useLang();
  const list = useKindList(query);
  if (list.length === 0) return <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t("No question type matches “{q}”.", { q: query })}</div>;
  let lastGroup = "";
  return (
    <div role="listbox" aria-label={t("Question type")} className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-1">
      {list.map((k, i) => {
        const head = k.group !== lastGroup ? (lastGroup = k.group) : null;
        return (
          <div key={k.kind}>
            {head && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{head === "basic" ? t("Basic") : t("Specific")}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(k.kind)}
              className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left", i === active ? "bg-muted" : "hover:bg-muted/60")}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground"><k.icon className="h-3.5 w-3.5" /></span>
              <span className="min-w-0">
                <span className="block text-sm">{t(k.label)}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{t(k.hint)}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** "+" → a searchable type menu in a popover. */
function AddQuestionMenu({ onPick, trigger, align = "center" }: { onPick: (k: QuestionKind) => void; trigger: ReactNode; align?: "start" | "center" | "end" }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useKindList(query);
  const pick = (k: QuestionKind) => { setOpen(false); setQuery(""); setActive(0); onPick(k); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQuery(""); setActive(0); } }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && list[active]) { e.preventDefault(); pick(list[active].kind); }
            }}
            placeholder={t("Search question types…")}
            aria-label={t("Search question types…")}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <TypeList query={query} active={active} onPick={pick} onHover={setActive} />
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ canvas: one question */

function OptionsEditor({ field, onChange, disabled }: { field: RichField; onChange: (opts: string[]) => void; disabled?: boolean }) {
  const { t } = useLang();
  const rows = Array.isArray(field.options) ? (field.options as unknown[]).map(String) : optionsOf(field);
  const list = rows.length ? rows : [""];
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    if (focusAt.current !== null) { refs.current[focusAt.current]?.focus(); focusAt.current = null; }
  });
  const multi = field.type === "multi_select";
  return (
    <div className="space-y-0.5">
      {list.map((opt, i) => (
        <div key={i} className="group/opt flex items-center gap-2 rounded-md px-1.5 hover:bg-muted/50">
          <span className={cn("h-4 w-4 shrink-0 border border-muted-foreground/40", multi ? "rounded" : "rounded-full")} aria-hidden />
          <input
            ref={(el) => { refs.current[i] = el; }}
            value={opt}
            disabled={disabled}
            onChange={(e) => { const next = [...list]; next[i] = e.target.value; onChange(next); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); const next = [...list]; next.splice(i + 1, 0, ""); focusAt.current = i + 1; onChange(next); }
              else if (e.key === "Backspace" && opt === "" && list.length > 1) { e.preventDefault(); focusAt.current = Math.max(0, i - 1); onChange(list.filter((_, j) => j !== i)); }
            }}
            placeholder={t("Option {n}", { n: i + 1 })}
            aria-label={t("Option {n}", { n: i + 1 })}
            className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/50 disabled:text-muted-foreground"
          />
          {!disabled && list.length > 1 && (
            <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={t("Delete option")} className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/opt:opacity-100 pointer-coarse:opacity-100"><X className="h-3.5 w-3.5" /></button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={() => { focusAt.current = list.length; onChange([...list, ""]); }} className="mt-0.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> {t("Add option")}
        </button>
      )}
    </div>
  );
}

function Chip({ icon, children, tone = "muted" }: { icon?: ReactNode; children: ReactNode; tone?: "muted" | "accent" | "warn" }) {
  return <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", tone === "accent" ? "bg-accent text-accent-foreground" : tone === "warn" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>{icon}<span className="truncate">{children}</span></span>;
}

function QuestionCard({ field, index, total, selected, others, customFields, taskLists, onSelect, onChange, onDuplicate, onDelete, onOpenPanel, dragProps, slashFor, setSlashFor }: {
  field: RichField; index: number; total: number; selected: boolean; others: RichField[]; customFields: CustomFieldLite[]; taskLists: { id: string; name: string }[];
  onSelect: () => void; onChange: (patch: Partial<RichField> | ((f: RichField) => RichField)) => void; onDuplicate: () => void; onDelete: () => void; onOpenPanel: () => void;
  dragProps: { onGripDragStart: () => void; onGripDragEnd: () => void };
  slashFor: { id: string; before: string } | null; setSlashFor: (v: { id: string; before: string } | null) => void;
}) {
  const { t } = useLang();
  const title = field.name ?? field.label ?? "";
  const slash = slashFor?.id === field.id && title.startsWith("/");
  const [active, setActive] = useState(0);
  const slashQuery = slash ? title.slice(1) : "";
  const slashList = useKindList(slashQuery);
  const pickSlash = (k: QuestionKind) => {
    const before = slashFor?.before ?? "";
    onChange((f) => ({ ...withKind(f, k), name: before, label: before }));
    setSlashFor(null);
    setActive(0);
  };
  const kind = kindOf(withMappedRupiah(field, customFields));
  const meta = kindMeta(kind);
  const mapping = field.mapping?.target && field.mapping.target !== "none" ? field.mapping : null;
  // A "Section" question whose options are categories: its answers land in the category field (server,
  // lib/form-category.ts), so the chip names that field and the options stay editable.
  const sectionCategory = categoryFieldForSectionQuestion(field, customFields, taskLists);
  const mappingLabel = mapping
    ? mapping.target === "custom_field"
      ? (customFields.find((c) => c.id === mapping.customFieldId)?.name ?? t("A project field"))
      : sectionCategory ? sectionCategory.name : t(MAPPING_TARGETS.find((m) => m.value === mapping.target)?.label ?? "")
    : null;
  const parent = field.showIf ? others.find((o) => o.id === field.showIf?.fieldId) : null;
  const opLabel = field.showIf ? t(OPERATORS.find((o) => o.value === field.showIf?.operator)?.label ?? "") : "";
  const rules = field.routingRules?.length ?? 0;
  // Logic that can't work as it stands: no value picked yet, or the value is an option that was renamed away / deleted.
  const condUnfinished = !!parent && condIncomplete(field.showIf);
  const condStale = !!parent && staleOption(parent, field.showIf?.operator, field.showIf?.value);
  const staleRules = (field.routingRules ?? []).filter((r) => staleOption(field, r.operator, r.value)).length;
  const syncedSections = mapping?.target === "task_list" && hasOptions(field) && !sectionCategory;

  return (
    <div
      data-question={field.id}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={cn(
        "group/q relative rounded-xl border bg-card px-4 pb-4 pt-3.5 transition-[border-color,box-shadow] @lg:px-6",
        selected ? "border-accent-foreground/50 shadow-[0_0_0_1px_var(--accent-foreground)]" : "border-border hover:border-foreground/20",
      )}
    >
      {/* Drag handle: in the left gutter on wide screens, Move up/down in the panel on a phone. */}
      <span
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", field.id); /* Firefox starts no drag without data */ dragProps.onGripDragStart(); }}
        onDragEnd={dragProps.onGripDragEnd}
        title={t("Drag to reorder")}
        aria-hidden
        className={cn("absolute -left-8 top-4 hidden cursor-grab rounded p-1 text-muted-foreground/60 transition-opacity hover:bg-muted hover:text-foreground active:cursor-grabbing md:block", selected ? "opacity-100" : "opacity-0 group-hover/q:opacity-100")}
      >
        <GripVertical className="h-4 w-4" />
      </span>

      {/* Also shown while the question has keyboard focus, not on hover only (W-D16). */}
      <div className={cn("absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg bg-card transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover/q:opacity-100 group-focus-within/q:opacity-100 pointer-coarse:opacity-100")}>
        <span className="mr-1 hidden items-center gap-1 text-[11px] text-muted-foreground @md:inline-flex"><meta.icon className="h-3 w-3" /> {t(meta.label)}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenPanel(); }} aria-label={t("Question settings")} title={t("Question settings")} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"><Settings2 className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} aria-label={t("Duplicate question")} title={t("Duplicate question")} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label={t("Delete question")} title={t("Delete question")} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      <div className="relative pr-24 @md:pr-40">
        {/* The required star follows the last word: a hidden copy of the title (same width, font and wrapping)
            sits under the textarea and carries the star. */}
        <div className="relative min-w-0">
          {field.required && (
            <div aria-hidden className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words p-0 text-[15px] font-semibold leading-6 max-md:text-[16px]">
              <span className="invisible">{title || t("Question, or type / for a type")}</span><span className="ml-0.5 text-destructive">*</span>
            </div>
          )}
          <AutoTextarea
            value={title}
            ariaLabel={t("Question {n} title", { n: index + 1 })}
            placeholder={t("Question, or type / for a type")}
            onChange={(raw) => {
              const v = raw.replace(/\n/g, " ");
              if (v.startsWith("/") && !title.startsWith("/")) setSlashFor({ id: field.id, before: title });
              if (!v.startsWith("/") && slashFor?.id === field.id) setSlashFor(null);
              onChange({ name: v, label: v });
            }}
            onKeyDown={(e) => {
              if (!slash) { if (e.key === "Enter") e.preventDefault(); return; }
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, slashList.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (slashList[active]) pickSlash(slashList[active].kind); }
              else if (e.key === "Escape") { e.preventDefault(); const before = slashFor?.before ?? ""; onChange({ name: before, label: before }); setSlashFor(null); }
            }}
            className="relative p-0 text-[15px] font-semibold leading-6"
          />
        </div>
        {slash && (
          <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border bg-popover shadow-pop" onClick={(e) => e.stopPropagation()}>
            <TypeList query={slashQuery} active={active} onPick={pickSlash} onHover={setActive} />
          </div>
        )}
        {field.description !== undefined && (
          <AutoTextarea value={field.description} onChange={(v) => onChange({ description: v })} placeholder={t("Description (optional)")} ariaLabel={t("Question description")} className="mt-0.5 text-sm text-muted-foreground" />
        )}
      </div>

      <div className="mt-3">
        {hasOptions(field) ? (
          syncedSections
            ? <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">{t("Options follow the project's sections: {list}", { list: taskLists.map((s) => s.name).join(", ") || "—" })}</div>
            : <OptionsEditor field={field} onChange={(opts) => onChange({ options: opts })} />
        ) : field.type === "checkbox" ? (
          <div className="flex items-center gap-2.5 text-[15px] text-muted-foreground"><span className="h-4 w-4 rounded border border-muted-foreground/40" aria-hidden /> {fieldTitle(field) || t("Checkbox")}</div>
        ) : (
          <div className="pointer-events-none"><QuestionControl field={withMappedRupiah(field, customFields)} value={undefined} onChange={() => {}} disabled /></div>
        )}
      </div>

      {(mappingLabel || parent || rules > 0 || field.autofill) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mappingLabel && <Chip tone="accent" icon={<ArrowRight className="h-3 w-3 shrink-0" />}>{mappingLabel}</Chip>}
          {parent && (condUnfinished
            ? <Chip tone="warn" icon={<GitBranch className="h-3 w-3 shrink-0" />}>{t("Logic not set yet: pick a value. Until then it always shows.")}</Chip>
            : <Chip tone={condStale ? "warn" : "muted"} icon={condStale ? <CircleAlert className="h-3 w-3 shrink-0" /> : <GitBranch className="h-3 w-3 shrink-0" />}>
                {condStale
                  ? t("“{value}” is no longer an option of “{q}”, so this question never shows", { value: field.showIf?.value ?? "", q: fieldTitle(parent) || t("Question") })
                  : t("Shown when “{q}” {op} {value}", { q: fieldTitle(parent) || t("Question"), op: opLabel, value: needsValue(field.showIf?.operator ?? "") ? `“${field.showIf?.value ?? ""}”` : "" }).trim()}
              </Chip>)}
          {rules > 0 && <Chip tone={staleRules ? "warn" : "muted"} icon={staleRules ? <CircleAlert className="h-3 w-3 shrink-0" /> : <RouteIcon className="h-3 w-3 shrink-0" />}>{staleRules ? t("A routing rule reads an option that no longer exists") : rules === 1 ? t("1 routing rule") : t("{n} routing rules", { n: rules })}</Chip>}
          {field.autofill && <Chip icon={<User className="h-3 w-3 shrink-0" />}>{field.autofill === "email" ? t("Auto-filled: email") : t("Auto-filled: name")}</Chip>}
        </div>
      )}
      <span className="sr-only">{t("Question {n} of {total}", { n: index + 1, total })}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ side panel: the selected question */

function QuestionPanel({ field, index, total, others, customFields, taskLists, members, onChange, onMove, onDuplicate, onDelete }: {
  field: RichField; index: number; total: number; others: RichField[]; customFields: CustomFieldLite[]; taskLists: { id: string; name: string }[]; members: MemberLite[];
  onChange: (patch: Partial<RichField> | ((f: RichField) => RichField)) => void; onMove: (dir: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const { t, tn } = useLang();
  const kind = kindOf(field);
  // Mapped to a Rupiah project field: the question is a Rupiah amount whatever the toggle says (R14-WB-1).
  const mappedRupiah = withMappedRupiah(field, customFields) !== field;
  const pick = "h-auto min-h-[32px] rounded-md bg-background px-2 text-xs";
  const input = "h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-foreground/40";
  const showIf = field.showIf ?? null;
  const parent = showIf ? others.find((o) => o.id === showIf.fieldId) : undefined;
  // Questions this one may depend on: not those already shown only because of it (that loop hides both).
  const parents = logicParents([field, ...others], field.id);
  // Default parent: the closest question above with options (what "Show only when" is mostly for), else the one above.
  const above = parents.filter((o) => others.indexOf(o) < index);
  const defaultParent = [...above].reverse().find((o) => hasOptions(o)) ?? above[above.length - 1] ?? parents[0];
  const parentOpts = parent ? optionsOf(parent).filter(Boolean) : [];
  const ownOpts = optionsOf(field).filter(Boolean);
  const mapping = field.mapping ?? { target: "none" };
  const rules = field.routingRules ?? [];
  const settable = customFields.filter((c) => SETTABLE_FIELD_TYPES.includes((c.type ?? "").toUpperCase()));
  const titleOf = (f: RichField) => fieldTitle(f) || t("Untitled question");
  const sectionCategory = categoryFieldForSectionQuestion(field, customFields, taskLists);
  const projectCategory = projectCategoryField(customFields);

  return (
    <div className="pb-6">
      <div className="px-5 pb-2 pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Question {n}", { n: index + 1 })}</div>
        <div className="mt-2">
          <SelectPicker
            variant="field"
            ariaLabel={t("Question type")}
            value={kind}
            onChange={(v) => onChange((f) => withKind(f, v as QuestionKind))}
            options={QUESTION_KINDS.map((k) => ({ value: k.kind, label: t(k.label), icon: <k.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> }))}
            className="h-9 w-full rounded-md bg-background px-2.5 text-sm"
          />
        </div>
      </div>

      <PanelSection title={t("Options")}>
        <Toggle label={t("Required")} checked={!!field.required} onChange={(v) => onChange({ required: v })} />
        <Toggle label={t("Description")} hint={t("Helper text under the question")} checked={field.description !== undefined} onChange={(v) => onChange((f) => { const n = { ...f }; if (v) n.description = ""; else delete n.description; return n; })} />
        {(kind === "text" || kind === "textarea") && <Toggle label={t("Long answer")} checked={kind === "textarea"} onChange={(v) => onChange((f) => withKind(f, v ? "textarea" : "text"))} />}
        {kind === "dropdown" && <Toggle label={t("Show options as a list")} hint={t("On the web form. The apps show a menu.")} checked={field.display === "list"} onChange={(v) => onChange((f) => { const n = { ...f }; if (v) n.display = "list"; else delete n.display; return n; })} />}
        {(kind === "number" || kind === "rupiah") && (mappedRupiah
          ? <Toggle label={t("Rupiah amount")} hint={t("Always on: the answer fills a Rupiah field")} checked disabled onChange={() => {}} />
          : <Toggle label={t("Rupiah amount")} hint="Rp 1.500.000" checked={kind === "rupiah"} onChange={(v) => onChange((f) => withKind(f, v ? "rupiah" : "number"))} />)}
        {(kind === "text" || kind === "email") && (
          <div className="flex items-center gap-2 px-2 py-2">
            <span className="min-w-0 flex-1 text-sm">{t("Fill from the sender's account")}</span>
            <SelectPicker variant="field" size="sm" ariaLabel={t("Fill from the sender's account")} value={field.autofill ?? ""} onChange={(v) => onChange((f) => { const n = { ...f }; if (v === "name" || v === "email") n.autofill = v; else delete n.autofill; return n; })} options={[{ value: "", label: t("Off") }, { value: "name", label: t("Name") }, { value: "email", label: t("Email") }]} className={pick} />
          </div>
        )}
        {kind !== "file" && <Toggle icon={<Paperclip className="h-3.5 w-3.5" />} label={t("Allow a file with the answer")} checked={!!field.attachmentEnabled} onChange={(v) => onChange((f) => { const n = { ...f }; if (v) n.attachmentEnabled = true; else delete n.attachmentEnabled; return n; })} />}
      </PanelSection>

      <PanelSection title={t("Logic")}>
        <Toggle label={t("Show only when…")} hint={parents.length ? undefined : t("Add another question first.")} checked={!!showIf} onChange={(v) => { if (!v) onChange({ showIf: null }); else if (defaultParent) onChange({ showIf: { fieldId: defaultParent.id, operator: "equals", value: "" } }); }} />
        {showIf && (
          <div className="mt-1 space-y-1.5 rounded-lg bg-muted/40 p-2">
            <SelectPicker variant="field" size="sm" className={cn(pick, "w-full")} ariaLabel={t("Question")} value={showIf.fieldId} onChange={(v) => onChange({ showIf: { ...showIf, fieldId: v, value: "" } })} options={[...parents, ...(parent && !parents.includes(parent) ? [parent] : [])].map((o) => ({ value: o.id, label: titleOf(o) }))} />
            <div className="flex gap-1.5">
              <SelectPicker variant="field" size="sm" className={cn(pick, "shrink-0")} ariaLabel={t("Condition")} value={showIf.operator} onChange={(v) => onChange({ showIf: { ...showIf, operator: v } })} options={OPERATORS.map((op) => ({ value: op.value, label: t(op.label) }))} />
              {needsValue(showIf.operator) && (parentOpts.length
                ? <SelectPicker variant="field" size="sm" className={cn(pick, "min-w-0 flex-1")} ariaLabel={t("Value")} value={showIf.value} onChange={(v) => onChange({ showIf: { ...showIf, value: v } })} placeholder={t("choose value")} options={parentOpts.map((o) => ({ value: o, label: o }))} />
                : <input value={showIf.value} onChange={(e) => onChange({ showIf: { ...showIf, value: e.target.value } })} placeholder={t("value")} aria-label={t("Value")} className={cn(input, "flex-1")} />)}
            </div>
            {condIncomplete(showIf) && <p className="px-0.5 text-[11px] text-muted-foreground">{t("Pick a value. Until then the question always shows.")}</p>}
            {staleOption(parent, showIf.operator, showIf.value) && <p className="flex items-start gap-1 px-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"><CircleAlert className="mt-px h-3 w-3 shrink-0" /> {t("“{value}” is no longer an option, so this question never shows. Pick a value again.", { value: showIf.value })}</p>}
            {parent && !parents.includes(parent) && <p className="flex items-start gap-1 px-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"><CircleAlert className="mt-px h-3 w-3 shrink-0" /> {t("“{q}” is itself shown only after this question, so neither can ever show. Pick another question.", { q: titleOf(parent) })}</p>}
          </div>
        )}
      </PanelSection>

      <PanelSection title={t("Answer goes to")}>
        <div className="space-y-1.5 px-2">
          <SelectPicker variant="field" size="sm" className={cn(pick, "w-full")} ariaLabel={t("Answer goes to")} value={mapping.target ?? "none"} onChange={(v) => onChange({ mapping: v === "custom_field" ? { target: v, customFieldId: mapping.customFieldId } : { target: v } })} options={MAPPING_TARGETS.map((m) => ({ value: m.value, label: t(m.label) }))} />
          {mapping.target === "custom_field" && (
            <SelectPicker variant="field" size="sm" className={cn(pick, "w-full")} ariaLabel={t("Field")} value={mapping.customFieldId ?? ""} onChange={(v) => onChange((f) => {
              // A choice question pointed at a select field whose options are still the section (status)
              // names, or none: it takes the field's options (e.g. "Kategori": AI & Tech / Management…).
              const target = customFields.find((c) => c.id === v);
              const choices = target && (target.type ?? "").toUpperCase() === "SELECT" ? selectChoices(target) : [];
              const adopt = hasOptions(f) && choices.length > 0 && (optionsAreSections(f, taskLists) || optionsOf(f).filter((o) => o.trim()).length === 0);
              return { ...f, mapping: { target: "custom_field", customFieldId: v }, ...(adopt ? { options: choices } : {}) };
            })} placeholder={t("choose custom field")} options={customFields.map((c) => ({ value: c.id, label: c.name }))} />
          )}
          {mapping.target === "custom_field" && (() => {
            const target = customFields.find((c) => c.id === mapping.customFieldId);
            if (!target || (target.type ?? "").toUpperCase() !== "SELECT" || !hasOptions(field)) return null;
            const choices = selectChoices(target).map((o) => o.trim()).filter(Boolean);
            if (!choices.length) return null;
            const have = new Set(ownOpts.map((o) => o.trim().toLowerCase()));
            const known = new Set(choices.map((o) => o.toLowerCase()));
            const extra = ownOpts.filter((o) => !known.has(o.trim().toLowerCase()));
            const same = extra.length === 0 && choices.every((o) => have.has(o.toLowerCase()));
            return (
              <div className="rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                <p>{t("Options of “{field}”: {list}", { field: target.name, list: choices.join(", ") })}</p>
                {extra.length > 0 && <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">{t("Not an option of “{field}”: {list}. These answers are saved as typed.", { field: target.name, list: extra.join(", ") })}</p>}
                {!same && field.type !== "multi_select" && (
                  <button type="button" onClick={() => onChange({ options: choices })} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 font-semibold text-foreground ring-1 ring-border transition hover:bg-muted">
                    <Copy className="h-3 w-3" /> {tn(choices.length, "Use this {n} option", "Use these {n} options")}
                  </button>
                )}
              </div>
            );
          })()}
          {mapping.target === "task_list" && sectionCategory && (
            <div className="rounded-lg bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
              <p>{t("These options are categories, and sections are now the project's statuses. Answers go into “{field}” and the task starts in the first status.", { field: sectionCategory.name })}</p>
              <button type="button" onClick={() => onChange({ mapping: { target: "custom_field", customFieldId: sectionCategory.id } })} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 font-semibold text-foreground ring-1 ring-border transition hover:bg-muted">
                <ArrowRight className="h-3 w-3" /> {t("Send answers to “{field}”", { field: sectionCategory.name })}
              </button>
            </div>
          )}
          {mapping.target === "task_list" && !sectionCategory && (
            <div className="rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <p>{t("This field's answer decides which section the task goes into, by matching the section name. So the options need to match the project's section names exactly. With no match, the task goes into the first section.")}</p>
              {projectCategory && hasOptions(field) && field.type !== "multi_select" && (
                <div className="mt-2">
                  <p>{t("Sections are the project's statuses. To sort answers by category, send them to “{field}”.", { field: projectCategory.name })}</p>
                  <button type="button" onClick={() => onChange((f) => ({ ...f, mapping: { target: "custom_field", customFieldId: projectCategory.id }, ...(optionsAreSections(f, taskLists) || optionsOf(f).filter((o) => o.trim()).length === 0 ? { options: selectChoices(projectCategory) } : {}) }))} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 font-semibold text-foreground ring-1 ring-border transition hover:bg-muted">
                    <ArrowRight className="h-3 w-3" /> {t("Send answers to “{field}”", { field: projectCategory.name })}
                  </button>
                </div>
              )}
              {taskLists.length > 0 ? (
                hasOptions(field) && field.type !== "multi_select" && (
                  <button type="button" onClick={() => onChange({ options: taskLists.map((tl) => tl.name) })} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 font-semibold text-foreground ring-1 ring-border transition hover:bg-muted">
                    <Copy className="h-3 w-3" /> {tn(taskLists.length, "Use this {n} section as options", "Use these {n} sections as options")}
                  </button>
                )
              ) : <p className="mt-2 font-semibold text-amber-600 dark:text-amber-400">{t("This project has no sections yet. Add a section on the board first, then this mapping will work.")}</p>}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t("Every response becomes a task in this project. Answers that go nowhere are listed in the task's description.")}</p>
        </div>
      </PanelSection>

      <PanelSection title={t("Routing")} aside={<button type="button" onClick={() => onChange({ routingRules: [...rules, { id: `r_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, operator: "equals", value: "", action: "assign_user" }] })} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Plus className="h-3 w-3" /> {t("Rule")}</button>}>
        {rules.length === 0 && <p className="px-2 text-xs text-muted-foreground">{t("When this answer matches, assign someone, set a field or move the task to a section.")}</p>}
        <div className="space-y-1.5">
          {rules.map((r, i) => {
            const setRule = (p: Partial<FRule>) => onChange({ routingRules: rules.map((x, xi) => (xi === i ? { ...x, ...p } : x)) });
            const target = settable.find((c) => c.id === r.targetCustomFieldId);
            const choices = target ? fieldChoices(target as Parameters<typeof fieldChoices>[0]) : [];
            return (
              <div key={r.id ?? i} className="space-y-1.5 rounded-lg bg-muted/40 p-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{t("If the answer")}</span>
                  <SelectPicker variant="field" size="sm" className={cn(pick, "shrink-0")} ariaLabel={t("Condition")} value={r.operator} onChange={(v) => setRule({ operator: v })} options={OPERATORS.map((op) => ({ value: op.value, label: t(op.label) }))} />
                  <button type="button" onClick={() => onChange({ routingRules: rules.filter((_, xi) => xi !== i) })} aria-label={t("Delete rule")} className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
                {needsValue(r.operator) && (ownOpts.length
                  ? <SelectPicker variant="field" size="sm" className={cn(pick, "w-full")} ariaLabel={t("Value")} value={r.value} onChange={(v) => setRule({ value: v })} placeholder={t("choose value")} options={ownOpts.map((o) => ({ value: o, label: o }))} />
                  : <input value={r.value} onChange={(e) => setRule({ value: e.target.value })} placeholder={t("value")} aria-label={t("Value")} className={cn(input, "w-full")} />)}
                {staleOption(field, r.operator, r.value) && <p className="flex items-start gap-1 px-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"><CircleAlert className="mt-px h-3 w-3 shrink-0" /> {t("“{value}” is no longer an option, so this rule never runs. Pick a value again.", { value: r.value })}</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  <SelectPicker variant="field" size="sm" className={cn(pick, "shrink-0")} ariaLabel={t("Routing")} value={r.action} onChange={(v) => setRule({ action: v })} options={ROUTING_ACTIONS.map((a) => ({ value: a.value, label: t(a.label) }))} />
                  {r.action === "set_field" ? (
                    <>
                      <SelectPicker variant="field" size="sm" className={cn(pick, "min-w-0 flex-1")} ariaLabel={t("Field")} value={r.targetCustomFieldId ?? ""} onChange={(v) => setRule({ targetCustomFieldId: v || undefined, targetValue: undefined })} placeholder={t("choose field")} options={settable.map((c) => ({ value: c.id, label: c.name }))} />
                      {target && (choices.length
                        ? <SelectPicker variant="field" size="sm" className={cn(pick, "w-full")} ariaLabel={t("Value")} value={r.targetValue ?? ""} onChange={(v) => setRule({ targetValue: v || undefined })} placeholder={t("choose value")} options={choices.map((o) => ({ value: o, label: o }))} />
                        : <input aria-label={t("Value")} value={r.targetValue ?? ""} onChange={(e) => setRule({ targetValue: e.target.value })} placeholder={t("value")} className={cn(input, "w-full")} />)}
                    </>
                  ) : r.action === "set_task_list" ? (
                    <SelectPicker variant="field" size="sm" className={cn(pick, "min-w-0 flex-1")} ariaLabel={t("Section")} value={r.targetTaskListId ?? ""} onChange={(v) => setRule({ targetTaskListId: v })} placeholder={t("choose section")} options={taskLists.map((tl) => ({ value: tl.id, label: tl.name }))} />
                  ) : (
                    <SelectPicker variant="field" size="sm" className={cn(pick, "min-w-0 flex-1")} ariaLabel={t("Person")} value={r.targetUserId ?? ""} onChange={(v) => setRule({ targetUserId: v })} placeholder={t("choose member")} options={members.map((m) => ({ value: m.userId, label: m.name }))} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </PanelSection>

      <PanelSection title={t("Question")}>
        <div className="grid grid-cols-2 gap-1 px-1">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-40"><ArrowUp className="h-3.5 w-3.5" /> {t("Move up")}</button>
          <button type="button" disabled={index >= total - 1} onClick={() => onMove(1)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-40"><ArrowDown className="h-3.5 w-3.5" /> {t("Move down")}</button>
          <button type="button" onClick={onDuplicate} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"><Copy className="h-3.5 w-3.5" /> {t("Duplicate")}</button>
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /> {t("Delete")}</button>
        </div>
      </PanelSection>
    </div>
  );
}

/* ------------------------------------------------------------------ settings tab */

/**
 * The response limit. Clearing it to type a new number keeps the limit on: the empty box is a draft (only
 * a whole number above 0 is saved), and leaving it empty puts the saved number back.
 */
function LimitInput({ value, onChange, className }: { value: number; onChange: (n: number) => void; className?: string }) {
  const { t } = useLang();
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  return (
    <input
      type="number" min={1} inputMode="numeric" aria-label={t("Maximum responses")} value={draft}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => { setDraft(e.target.value); const n = Math.floor(Number(e.target.value)); if (e.target.value.trim() && n > 0) onChange(n); }}
      onBlur={() => { focused.current = false; setDraft(String(value)); }}
      className={className}
    />
  );
}

function SettingsCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SettingsTab({ draft, change, projectName, members, responseCount }: {
  draft: FormDraft; change: (fn: (d: FormDraft) => FormDraft) => void; projectName: string; members: MemberLite[]; responseCount: number;
}) {
  const { t } = useLang();
  const sched = (draft.accessSchedule ?? {}) as { enabled?: boolean; daysOfWeek?: number[]; startTime?: string; endTime?: string; timezone?: string; override?: "open" | "closed"; opensAt?: string; closesAt?: string };
  const enabled = !!sched.enabled;
  const days = Array.isArray(sched.daysOfWeek) ? sched.daysOfWeek : [];
  // Carry the FULL schedule forward so a partial edit never drops a sibling key.
  const setSched = (p: Record<string, unknown>) => change((d) => {
    const cur = (d.accessSchedule ?? {}) as typeof sched;
    const next: Record<string, unknown> = { enabled: !!cur.enabled, daysOfWeek: Array.isArray(cur.daysOfWeek) ? cur.daysOfWeek : [], startTime: cur.startTime ?? "00:00", endTime: cur.endTime ?? "23:59", timezone: cur.timezone ?? "Asia/Jakarta", ...(cur.override ? { override: cur.override } : {}), ...(cur.opensAt ? { opensAt: cur.opensAt } : {}), ...(cur.closesAt ? { closesAt: cur.closesAt } : {}), ...p };
    for (const k of ["override", "opensAt", "closesAt"]) if (next[k] === undefined || next[k] === null || next[k] === "") delete next[k];
    return { ...d, accessSchedule: next };
  });
  const settings = (draft.settings ?? {}) as { confirmationTitle?: string; confirmationMessage?: string; submitLabel?: string; responseLimit?: number; notifyUserIds?: string[] };
  const setSettings = (p: Record<string, unknown>) => change((d) => {
    const next: Record<string, unknown> = { ...(d.settings ?? {}), ...p };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "" || (Array.isArray(next[k]) && (next[k] as unknown[]).length === 0)) delete next[k];
    return { ...d, settings: Object.keys(next).length ? next : null };
  });
  const override = sched.override;
  const OV: { v: "open" | "closed" | undefined; l: string }[] = [{ v: undefined, l: t("Auto") }, { v: "open", l: t("Force open") }, { v: "closed", l: t("Force closed") }];
  const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40";
  const notify = settings.notifyUserIds ?? [];
  const [who, setWho] = useState("");
  const q = who.trim().toLowerCase();
  const shownMembers = q ? members.filter((m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)) : members;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 @lg:px-6 @lg:py-10">
      <SettingsCard title={t("Who can fill it in")}>
        <div className="grid gap-2 @lg:grid-cols-2">
          {[
            { v: true, icon: <Link2 className="h-4 w-4" />, l: t("Anyone with the link"), h: t("Anyone in NEXUS who has the link, even outside this project.") },
            { v: false, icon: <Users className="h-4 w-4" />, l: t("Project members only"), h: t("Only members of {project} can open the link.", { project: projectName || t("this project") }) },
          ].map((o) => (
            <button key={String(o.v)} type="button" role="radio" aria-checked={draft.isPublic === o.v} onClick={() => change((d) => ({ ...d, isPublic: o.v }))}
              className={cn("rounded-lg border p-3 text-left transition-colors", draft.isPublic === o.v ? "border-foreground/60 bg-muted/40" : "border-border hover:bg-muted/40")}>
              <span className="flex items-center gap-2 text-sm font-semibold">{o.icon} {o.l}{draft.isPublic === o.v && <Check className="ml-auto h-4 w-4" />}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{o.h}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("People always sign in with their NEXUS account to send, so every request has a name and shows up in their My Submissions.")}</p>
      </SettingsCard>

      <SettingsCard title={t("When it's open")} hint={t("Times are in {tz}.", { tz: sched.timezone ?? "Asia/Jakarta" })}>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label={t("Form status")}>
          {OV.map((o) => (
            <button key={o.l} type="button" role="radio" aria-checked={override === o.v} onClick={() => setSched({ override: o.v })}
              className={cn("rounded-md px-3 py-1.5 text-xs font-semibold transition-colors", override === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{o.l}</button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {override === "open" ? t("Open: always accepting answers, the schedule is ignored.") : override === "closed" ? t("Closed: not accepting answers for now.") : t("Follows the dates and hours below. With none set, the form is always open.")}
        </p>
        <div className={cn("mt-4 grid gap-3 @lg:grid-cols-2", override && "opacity-50")}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("Opens")}</span>
            <DateField withTime value={sched.opensAt ?? null} onChange={(v) => setSched({ opensAt: v ?? undefined })} placeholder={t("Right away")} ariaLabel={t("Opens")} className={cn(field, "min-h-[38px]")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("Closes")}</span>
            <DateField withTime value={sched.closesAt ?? null} onChange={(v) => setSched({ closesAt: v ?? undefined })} placeholder={t("Never")} ariaLabel={t("Closes")} className={cn(field, "min-h-[38px]")} />
          </label>
        </div>
        <div className={cn("mt-4 border-t border-border pt-3", override && "opacity-50")}>
          <Toggle label={t("Only on certain days and hours")} hint={override ? t("(ignored while the form is forced open or closed)") : undefined} checked={enabled} onChange={(v) => setSched({ enabled: v, daysOfWeek: v && days.length === 0 ? [1, 2, 3, 4, 5] : days })} />
          {enabled && (
            <div className="mt-2 space-y-3 px-2">
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d, i) => {
                  const on = days.includes(i);
                  return <button key={d} type="button" aria-pressed={on} onClick={() => setSched({ daysOfWeek: on ? days.filter((x) => x !== i) : [...days, i].sort((a, b) => a - b) })} className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", on ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted")}>{t(d)}</button>;
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="time" aria-label={t("From")} value={sched.startTime ?? "00:00"} onChange={(e) => setSched({ startTime: e.target.value })} className={cn(field, "w-auto")} />
                <span className="text-muted-foreground">–</span>
                <input type="time" aria-label={t("Until")} value={sched.endTime ?? "23:59"} onChange={(e) => setSched({ endTime: e.target.value })} className={cn(field, "w-auto")} />
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title={t("Responses")}>
        <Toggle label={t("Limit the number of responses")} hint={t("{n} so far", { n: responseCount })} checked={!!settings.responseLimit} onChange={(v) => setSettings({ responseLimit: v ? Math.max(responseCount + 10, 50) : undefined })} />
        {!!settings.responseLimit && (
          <div className="mt-1 flex items-center gap-2 px-2">
            <LimitInput value={settings.responseLimit} onChange={(n) => setSettings({ responseLimit: n })} className={cn(field, "w-32 tabular-nums")} />
            <span className="text-xs text-muted-foreground">{t("then the form closes by itself")}</span>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title={t("After sending")} hint={t("What people see once they send. Leave empty for the default.")}>
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted-foreground">{t("Button text")}</span>
            <input value={settings.submitLabel ?? ""} maxLength={40} onChange={(e) => setSettings({ submitLabel: e.target.value })} placeholder={t("Send")} className={field} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted-foreground">{t("Confirmation title")}</span>
            <input value={settings.confirmationTitle ?? ""} maxLength={120} onChange={(e) => setSettings({ confirmationTitle: e.target.value })} placeholder={t("Sent. Thank you!")} className={field} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted-foreground">{t("Confirmation message")}</span>
            <textarea value={settings.confirmationMessage ?? ""} maxLength={1000} rows={3} onChange={(e) => setSettings({ confirmationMessage: e.target.value })} placeholder={t("e.g. Finance replies within 2 working days. Follow it in My Submissions.")} className={cn(field, "resize-y")} /></label>
        </div>
      </SettingsCard>

      <SettingsCard title={t("Notify people")} hint={t("They get an in-app notification and a push for every new response.")}>
        {notify.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {notify.map((id) => {
              const m = members.find((x) => x.userId === id);
              return (
                <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 py-0.5 pl-0.5 pr-1.5 text-xs font-semibold">
                  <Avatar userId={id} name={m?.name} avatar={m?.avatar} size={20} className="shrink-0" />
                  <span className="truncate">{m?.name ?? t("Former member")}</span>
                  <button type="button" onClick={() => setSettings({ notifyUserIds: notify.filter((x) => x !== id) })} aria-label={t("Remove {name}", { name: m?.name ?? "" })} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                </span>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-foreground/40">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder={t("Search project members")} aria-label={t("Search project members")} className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
        <div className="mt-1.5 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-border p-1">
          {shownMembers.length === 0 && <div className="px-3 py-3 text-center text-xs text-muted-foreground">{t("No members match.")}</div>}
          {shownMembers.map((m) => {
            const on = notify.includes(m.userId);
            return (
              <button key={m.userId} type="button" role="checkbox" aria-checked={on} onClick={() => setSettings({ notifyUserIds: on ? notify.filter((x) => x !== m.userId) : [...notify, m.userId] })} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60">
                <Avatar userId={m.userId} name={m.name} avatar={m.avatar} size={24} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>{on && <Check className="h-3 w-3" />}</span>
              </button>
            );
          })}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ------------------------------------------------------------------ share tab */

function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const { t } = useLang();
  const matrix = useMemo(() => qrMatrix(text), [text]);
  const dim = matrix.length + 8;
  const path = useMemo(() => qrSvgPath(matrix), [matrix]);
  const download = () => {
    const scale = 12;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = dim * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale); }));
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "form-qr.png";
    a.click();
  };
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Always black on white: phones' cameras read that best, in dark mode too. */}
      <svg role="img" aria-label={t("QR code for the form link")} viewBox={`0 0 ${dim} ${dim}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-lg bg-white">
        <path d={path} fill="#000" />
      </svg>
      <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"><Download className="h-3.5 w-3.5" /> {t("Download PNG")}</button>
    </div>
  );
}

function ShareTab({ url, saved, isPublic, onGoSettings }: { url: string | null; saved: boolean; isPublic: boolean; onGoSettings: () => void }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  if (!saved || !url) {
    return <div className="mx-auto max-w-md px-6 py-20 text-center text-sm text-muted-foreground"><Link2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />{t("Give the form a title or edit a question first. The link appears once it's saved.")}</div>;
  }
  const copy = () => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 @lg:px-6 @lg:py-10">
      <SettingsCard title={t("Form link")}>
        <div className="flex flex-col gap-2 @lg:flex-row">
          <input readOnly value={url} aria-label={t("Form link")} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground outline-none" />
          <div className="flex gap-2">
            <button type="button" onClick={copy} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 @lg:flex-none">{copied ? <><Check className="h-4 w-4" /> {t("Copied")}</> : <><Copy className="h-4 w-4" /> {t("Copy link")}</>}</button>
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold transition-colors hover:bg-muted"><ExternalLink className="h-4 w-4" /> {t("Open")}</a>
          </div>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {isPublic ? <Link2 className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
          {isPublic ? t("Anyone in NEXUS with the link can fill it in.") : t("Only project members can open this link.")}
          <button type="button" onClick={onGoSettings} className="font-semibold text-foreground underline-offset-2 hover:underline">{t("Change")}</button>
        </p>
      </SettingsCard>
      <SettingsCard title={t("QR code")} hint={t("Print it or put it on a screen; scanning opens the form.")}>
        <QrCode text={url} />
      </SettingsCard>
    </div>
  );
}

/* ------------------------------------------------------------------ responses tab */

const STATUS_LABEL: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" };

function ResponsesTab({ formId, projectId, onOpenProject, onTaskOpen }: { formId: string | null; projectId: string; onOpenProject: () => void; onTaskOpen: (open: boolean) => void }) {
  const { t, locale } = useLang();
  // New responses arrive live ("form-responses-changed" to the project's room, lib/realtime.tsx), also when
  // the builder was opened from the Forms page, where nothing else has joined the room.
  useRealtimeRoom(projectId ? `project:${projectId}` : null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  // The task popup (z-50, portalled) must sit over the builder (z-[70]): the builder steps down while it's open.
  useEffect(() => { onTaskOpen(!!openTask); }, [openTask, onTaskOpen]);
  useEffect(() => () => onTaskOpen(false), [onTaskOpen]);
  const q = useQuery({ queryKey: ["nexus", "form-responses", formId], queryFn: () => nexusApi.formResponses(formId!), enabled: !!formId, retry: false });
  const rows = q.data?.responses ?? [];
  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), [locale]);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 @lg:px-6 @lg:py-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{q.data ? (q.data.total === 1 ? t("1 response") : t("{n} responses", { n: q.data.total })) : t("Responses")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("Each response is a task in this project. Open one to work on it.")}</p>
        </div>
        <button type="button" onClick={onOpenProject} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-muted"><ExternalLink className="h-3.5 w-3.5" /> {t("Open the project board")}</button>
      </div>
      {!formId || (q.isSuccess && rows.length === 0) ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <div className="text-sm font-semibold">{t("No responses yet")}</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{t("Share the link from the Share tab. Each answer arrives here and on the project board as a task.")}</p>
        </div>
      ) : q.isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : q.isError ? (
        <p className="py-10 text-center text-sm text-destructive">{t("Couldn't load the responses.")}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {rows.map((r) => (
            <button key={r.id} type="button" disabled={!r.task} onClick={() => r.task && setOpenTask(r.task.id)} className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent @lg:px-4">
              {r.submitter ? <Avatar userId={r.submitter.id} name={r.submitter.name} avatar={r.submitter.avatar} size={28} className="shrink-0" /> : <span className="h-7 w-7 shrink-0 rounded-full bg-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.task?.title ?? t("Task deleted")}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.submitter?.name ?? r.submitter?.email ?? t("Unknown sender")} · {fmt.format(new Date(r.createdAt))}</span>
              </span>
              {r.task && <span className="hidden shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground @md:inline">{r.task.section || t(STATUS_LABEL[r.task.status] ?? r.task.status)}</span>}
            </button>
          ))}
        </div>
      )}
      {openTask && <TaskDetailPanel taskId={openTask} onClose={() => { setOpenTask(null); q.refetch(); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ cover / icon pickers */

function CoverPicker({ value, onChange, children }: { value?: string; onChange: (v: string | undefined) => void; children: ReactNode }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">{t("Cover")}</span>
          {value && <button type="button" onClick={() => { onChange(undefined); setOpen(false); }} className="text-xs text-muted-foreground hover:text-foreground">{t("Remove")}</button>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {COVER_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => { onChange(`preset:${p.key}`); setOpen(false); }} aria-label={t(p.label)} title={t(p.label)}
              className={cn("h-12 rounded-md ring-offset-2 ring-offset-popover transition", value === `preset:${p.key}` ? "ring-2 ring-foreground" : "hover:opacity-90")} style={{ background: p.css }} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function IconPicker({ value, onChange, children }: { value?: string; onChange: (v: string | undefined) => void; children: ReactNode }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">{t("Icon")}</span>
          {value && <button type="button" onClick={() => { onChange(undefined); setOpen(false); }} className="text-xs text-muted-foreground hover:text-foreground">{t("Remove")}</button>}
        </div>
        <div className="grid grid-cols-8 gap-1">
          {ICON_CHOICES.map((e) => (
            <button key={e} type="button" onClick={() => { onChange(e); setOpen(false); }} className={cn("grid h-8 w-8 place-items-center rounded-md text-xl transition-colors hover:bg-muted", value === e && "bg-muted")}>{e}</button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ the builder */

export function FormBuilder({ projectId, form, onClose, onCreated }: { projectId: string; form?: NexusForm; onClose: () => void; /** A new form got its id (first save): the address can name it. */ onCreated?: (id: string) => void }) {
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const { t, tn } = useLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<FormDraft>(() => initialDraft(form, t));
  const [meta, setMeta] = useState<{ id: string | null; slug: string | null; count: number }>({ id: form?.id ?? null, slug: form?.slug ?? null, count: form?._count?.submissions ?? 0 });
  const [tab, setTab] = useState<Tab>("questions");
  const [selected, setSelected] = useState<string | null>(null);
  const [panelSheet, setPanelSheet] = useState(false);
  const [preview, setPreview] = useState<null | "desktop" | "phone">(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [slashFor, setSlashFor] = useState<{ id: string; before: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  /** New responses found when Delete was pressed (the count shown in the dialog was older). */
  const [newSinceOpen, setNewSinceOpen] = useState(0);

  // Project context: sections + members power routing; custom fields power mapping; the name labels things.
  const projectQ = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId), enabled: !!projectId, retry: false });
  const taskLists = useMemo(() => (projectQ.data?.taskLists ?? []).map((tl) => ({ id: tl.id, name: tl.name })), [projectQ.data]);
  const membersQ = useQuery({ queryKey: ["nexus", "project-members", projectId], queryFn: () => nexusApi.projectMembers(projectId), enabled: !!projectId, retry: false });
  const members = useMemo<MemberLite[]>(() => {
    const raw = membersQ.data;
    const arr = Array.isArray(raw) ? raw : (raw?.members ?? []);
    return arr
      .map((m) => ({ userId: m.userId ?? m.user?.id ?? "", name: m.user?.name ?? m.user?.email ?? t("Member"), email: m.user?.email ?? null, avatar: (m.user as { avatar?: string | null } | undefined)?.avatar ?? null }))
      .filter((m) => m.userId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [membersQ.data, t]);
  const customFieldsQ = useQuery({ queryKey: ["nexus", "custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), enabled: !!projectId, retry: false });
  const customFields = useMemo<CustomFieldLite[]>(() => (customFieldsQ.data?.fields ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options })), [customFieldsQ.data]);
  const projectName = projectQ.data?.name ?? "";

  /* ---------- autosave ---------- */
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const dirty = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const [rev, setRev] = useState(0);

  const flush = useCallback(async (): Promise<void> => {
    if (inflight.current) { again.current = true; return inflight.current; }
    if (!dirty.current) return;
    dirty.current = false;
    const d = draftRef.current;
    const payload = {
      name: d.name.trim() || t("Untitled form"),
      description: d.description.trim() ? d.description : null,
      fields: cleanFields(d.fields),
      isPublic: d.isPublic,
      requireAuth: d.requireAuth,
      accessSchedule: d.accessSchedule,
      branding: d.branding,
      settings: d.settings,
    };
    setSave("saving");
    inflight.current = (async () => {
      try {
        const id = metaRef.current.id;
        const out = id ? await nexusApi.updateForm(id, payload) : await nexusApi.createForm({ ...payload, projectId });
        setMeta((m) => ({ ...m, id: out.id, slug: out.slug ?? m.slug }));
        if (!id) onCreatedRef.current?.(out.id);
        setSave(dirty.current ? "pending" : "saved");
        qc.invalidateQueries({ queryKey: ["nexus", "forms"] });
      } catch {
        dirty.current = true;
        setSave("error");
      }
    })();
    await inflight.current;
    inflight.current = null;
    if (again.current) { again.current = false; await flush(); }
  }, [projectId, qc, t]);

  useEffect(() => {
    if (!dirty.current) return;
    setSave("pending");
    const h = setTimeout(() => { void flush(); }, 700);
    return () => clearTimeout(h);
  }, [rev, flush]);

  // Leaving the builder any other way (browser Back, a link, the route changing) saves what was typed
  // inside the 700 ms debounce instead of dropping it.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { if (dirty.current) void flushRef.current(); }, []);

  // Leaving with unsaved edits: the browser asks first.
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => { if (dirty.current || inflight.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  const change = useCallback((fn: (d: FormDraft) => FormDraft) => {
    setDraft((d) => fn(d));
    dirty.current = true;
    setRev((r) => r + 1);
  }, []);
  const closeRef = useRef<() => void>(() => {});
  const close = async () => {
    if (dirty.current || inflight.current) await flush();
    onClose();
  };
  closeRef.current = () => { void close(); };

  // Esc closes the builder (unless something on top of it handles Esc first). Like Notion: the first Esc
  // while typing only leaves the field, the next one closes (saving first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      if (taskOpen || confirmDelete || dupOpen) return;
      if (preview) { setPreview(null); return; }
      if (panelSheet) { setPanelSheet(false); return; }
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.matches("input, textarea, select, [contenteditable='true']"))) { el.blur(); return; }
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, panelSheet, taskOpen, confirmDelete, dupOpen]);

  /* ---------- question operations ---------- */
  const fields = draft.fields;
  // Renaming an option carries over to the logic that reads it (other questions' "Show only when" and this
  // question's routing rules), so "Yes" → "Yes please" keeps working. Cleared-then-retyped counts as a
  // rename too: the last text of each option row is remembered while the row is empty.
  const optionMemo = useRef(new Map<string, string>());
  const optionRename = (f: RichField, nextRaw: string[]): [string, string] | null => {
    const prev = Array.isArray(f.options) ? (f.options as unknown[]).map(String) : optionsOf(f);
    if (prev.length !== nextRaw.length) { for (const k of [...optionMemo.current.keys()]) if (k.startsWith(`${f.id}:`)) optionMemo.current.delete(k); return null; }
    let found: [string, string] | null = null;
    nextRaw.forEach((raw, i) => {
      if (raw === prev[i]) return;
      const key = `${f.id}:${i}`;
      const before = prev[i].trim() || optionMemo.current.get(key) || "";
      const after = raw.trim();
      if (!after) { if (before) optionMemo.current.set(key, before); return; }
      optionMemo.current.delete(key);
      if (before && before !== after && !prev.some((o, j) => j !== i && o.trim() === before)) found = [before, after];
    });
    return found;
  };
  const updateField = (id: string, patch: Partial<RichField> | ((f: RichField) => RichField)) =>
    change((d) => {
      const src = d.fields.find((f) => f.id === id);
      const renamed = src && typeof patch !== "function" && Array.isArray(patch.options) && hasOptions(src) ? optionRename(src, patch.options as string[]) : null;
      return {
        ...d,
        fields: d.fields.map((f) => {
          let out = f.id === id ? (typeof patch === "function" ? patch(f) : { ...f, ...patch }) : f;
          if (!renamed) return out;
          const [from, to] = renamed;
          if (out.showIf?.fieldId === id && out.showIf.value === from) out = { ...out, showIf: { ...out.showIf, value: to } };
          if (f.id === id && out.routingRules?.some((r) => r.value === from)) out = { ...out, routingRules: out.routingRules.map((r) => (r.value === from ? { ...r, value: to } : r)) };
          return out;
        }),
      };
    });
  const insertAt = (index: number, kind: QuestionKind) => {
    const q = newQuestion(kind);
    change((d) => { const next = [...d.fields]; next.splice(index, 0, q); return { ...d, fields: next }; });
    setSelected(q.id);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(`[data-question="${q.id}"] textarea`);
      el?.focus();
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };
  const duplicate = (id: string) => {
    const i = fields.findIndex((f) => f.id === id);
    if (i < 0) return;
    const src = fields[i];
    // A copy never inherits "this names the task": two titles would fight.
    const copy: RichField = { ...structuredClone(src), id: newFieldId(), ...(src.mapping?.target === "task_title" ? { mapping: { target: "none" } } : {}) };
    change((d) => { const next = [...d.fields]; next.splice(i + 1, 0, copy); return { ...d, fields: next }; });
    setSelected(copy.id);
  };
  const remove = (id: string) => {
    const i = fields.findIndex((f) => f.id === id);
    if (i < 0) return;
    const gone = fields[i];
    // Questions shown only after this one would never show again (their condition reads a missing answer),
    // so their condition goes with it; Undo puts both back.
    const dependents = new Map(fields.filter((f) => f.showIf?.fieldId === id).map((f) => [f.id, f.showIf]));
    change((d) => ({ ...d, fields: d.fields.filter((f) => f.id !== id).map((f) => (dependents.has(f.id) ? { ...f, showIf: null } : f)) }));
    if (selected === id) { setSelected(null); setPanelSheet(false); }
    toast(t("Question deleted"), {
      description: dependents.size ? (dependents.size === 1 ? t("1 question was shown only after it; it now always shows.") : t("{n} questions were shown only after it; they now always show.", { n: dependents.size })) : undefined,
      action: { label: t("Undo"), onClick: () => change((d) => {
        const next = d.fields.map((f) => (dependents.has(f.id) && !f.showIf ? { ...f, showIf: dependents.get(f.id) } : f));
        next.splice(Math.min(i, next.length), 0, gone);
        return { ...d, fields: next };
      }) },
    });
  };
  const move = (id: string, dir: -1 | 1) => change((d) => {
    const i = d.fields.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= d.fields.length) return d;
    const next = [...d.fields];
    [next[i], next[j]] = [next[j], next[i]];
    return { ...d, fields: next };
  });

  // Drag to reorder (grip = source; the gap above each card = target).
  const dragFrom = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dropTo = (index: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    setDropAt(null);
    if (!from) return;
    change((d) => {
      const i = d.fields.findIndex((f) => f.id === from);
      if (i < 0) return d;
      const next = [...d.fields];
      const [moved] = next.splice(i, 1);
      next.splice(index > i ? index - 1 : index, 0, moved);
      return { ...d, fields: next };
    });
  };

  const sel = fields.find((f) => f.id === selected) ?? null;
  const selIndex = sel ? fields.indexOf(sel) : -1;
  const setBranding = (p: Partial<NexusFormBranding>) => change((d) => {
    const next: Record<string, unknown> = { ...(d.branding ?? {}), ...p };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    return { ...d, branding: Object.keys(next).length ? (next as NexusFormBranding) : null };
  });

  const url = meta.id ? `${window.location.origin}/f/${meta.slug || meta.id}` : null;
  // Delete asks the server to stop if more responses came in than the dialog showed (the count is from
  // when the builder opened): then the dialog shows the new count and asks again. It never deletes
  // responses nobody saw.
  // The count shown in the Delete dialog is re-read when it opens (the builder may have been open for a while).
  const refreshCount = async () => {
    if (!meta.id) return;
    try {
      const f = await nexusApi.form(meta.id);
      const n = (f as { _count?: { submissions?: number } } | undefined)?._count?.submissions;
      if (typeof n === "number") setMeta((m) => ({ ...m, count: n }));
    } catch { /* the server still refuses a delete over unseen responses */ }
  };
  const deleting = useRef(false);
  const del = useMutation({
    mutationFn: async () => {
      if (!meta.id) return;
      await nexusApi.deleteForm(meta.id, meta.count > 0, meta.count);
    },
    onSettled: () => { deleting.current = false; },
    onSuccess: () => { dirty.current = false; qc.invalidateQueries({ queryKey: ["nexus", "forms"] }); toast(t("Form deleted"), { description: t("Control Room → Audit can restore it.") }); onClose(); },
    onError: (e) => {
      const n = e instanceof ApiError && e.status === 409 ? Number((e.payload as { submissionCount?: unknown } | null)?.submissionCount) : NaN;
      if (Number.isFinite(n)) { setNewSinceOpen(Math.max(1, n - meta.count)); setMeta((m) => ({ ...m, count: n })); }
    },
  });

  // Duplicate the form's STRUCTURE into another project (no submissions/tasks). Project-specific bits
  // (custom-field mapping + routing rules) are dropped: their ids don't exist there.
  const [dupName, setDupName] = useState("");
  const projectsQ = useQuery({ queryKey: ["nexus", "projects"], queryFn: nexusApi.projects, enabled: dupOpen, retry: false });
  const dup = useMutation({
    mutationFn: (targetProjectId: string) => nexusApi.createForm({
      name: dupName.trim() || draft.name.trim() || t("Form"),
      description: draft.description || null,
      fields: cleanFields(draft.fields).map((f) => ({ ...f, mapping: f.mapping?.target && f.mapping.target !== "none" && f.mapping.target !== "custom_field" ? { target: f.mapping.target } : null, routingRules: undefined })),
      isPublic: draft.isPublic, requireAuth: draft.requireAuth, projectId: targetProjectId, accessSchedule: draft.accessSchedule, branding: draft.branding,
      settings: draft.settings ? { ...draft.settings, notifyUserIds: undefined } : null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nexus", "forms"] }); setDupOpen(false); toast(t("Form copied to the other project")); },
  });

  const responseCount = meta.count;
  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: "questions", label: t("Questions") },
    { key: "settings", label: t("Settings") },
    { key: "share", label: t("Share") },
    { key: "responses", label: t("Responses"), badge: responseCount || undefined },
  ];

  const saveLabel = save === "saving" ? t("Saving…") : save === "pending" ? t("Unsaved changes") : save === "error" ? t("Couldn't save") : save === "saved" ? t("Saved") : meta.id ? t("Saved") : t("Draft");
  const saveIndicator = (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", save === "error" ? "text-destructive" : "text-muted-foreground")}>
      {save === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : save === "error" ? <CircleAlert className="h-3.5 w-3.5" /> : save === "pending" ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> : <Check className="h-3.5 w-3.5" />}
      {/* The word on a phone too (UI tour run 13, W-M18: a bare check glyph). */}
      <span className="whitespace-nowrap">{saveLabel}</span>
      {save === "error" && <button type="button" onClick={() => { dirty.current = true; void flush(); }} className="font-semibold underline-offset-2 hover:underline">{t("Retry")}</button>}
    </span>
  );

  const rendererForm = { name: draft.name, description: draft.description, fields: cleanFields(draft.fields).map((f) => withMappedRupiah(f, customFields)), branding: draft.branding, settings: draft.settings as { confirmationTitle?: string; confirmationMessage?: string; submitLabel?: string } | null };
  const me = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 }).data?.user;

  const panel = sel ? (
    <QuestionPanel
      key={sel.id}
      field={sel}
      index={selIndex}
      total={fields.length}
      others={fields.filter((f) => f.id !== sel.id)}
      customFields={customFields}
      taskLists={taskLists}
      members={members}
      onChange={(p) => updateField(sel.id, p)}
      onMove={(dir) => move(sel.id, dir)}
      onDuplicate={() => duplicate(sel.id)}
      onDelete={() => remove(sel.id)}
    />
  ) : (
    <div className="px-5 py-5 text-sm text-muted-foreground">
      <div className="text-[11px] font-semibold uppercase tracking-wider">{t("Question settings")}</div>
      <p className="mt-2">{t("Click a question to change its type, make it required, add logic or choose where its answer goes.")}</p>
      <ul className="mt-4 space-y-2 text-xs">
        <li className="flex gap-2"><kbd className="rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-foreground">/</kbd> {t("in a question's title picks its type")}</li>
        <li className="flex gap-2"><GripVertical className="h-4 w-4 shrink-0" /> {t("Drag the handle to reorder")}</li>
        <li className="flex gap-2"><Eye className="h-4 w-4 shrink-0" /> {t("Preview shows the form exactly as people see it")}</li>
      </ul>
    </div>
  );

  return (
    <div className={cn("fixed inset-0 flex flex-col bg-background text-foreground", taskOpen ? "z-40" : "z-[70]")} role="dialog" aria-modal={!taskOpen} aria-label={draft.name || t("Untitled form")}>
      {/* ---------- top bar ---------- */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="flex h-12 items-center gap-2 px-2 sm:px-3">
          <button type="button" onClick={close} aria-label={t("Back to forms")} title={t("Back to forms")} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {projectName && <span className="hidden min-w-0 max-w-[12rem] items-center gap-1.5 truncate text-muted-foreground md:inline-flex"><span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded"><ProjectMark icon={projectQ.data?.icon} color={projectQ.data?.color} className="h-full w-full object-cover" /></span><span className="truncate">{projectName}</span><span className="text-muted-foreground/50">/</span></span>}
            <span className="truncate font-medium">{draft.branding?.icon ? `${draft.branding.icon} ` : ""}{draft.name.trim() || t("Untitled form")}</span>
          </div>
          <nav className="mx-auto hidden items-center gap-0.5 md:flex" aria-label={t("Form builder")}>
            {TABS.map((x) => (
              <button key={x.key} type="button" aria-current={tab === x.key && !preview ? "page" : undefined} onClick={() => { setPreview(null); setTab(x.key); }}
                className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors", tab === x.key && !preview ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
                {x.label}{x.badge ? <span className="rounded-full bg-background px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border">{x.badge}</span> : null}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
            {saveIndicator}
            <button type="button" onClick={() => setPreview((p) => (p ? null : "desktop"))} aria-pressed={!!preview}
              className={cn("ml-1 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors", preview ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted")}>
              <Eye className="h-4 w-4" /> <span className="max-sm:sr-only">{preview ? t("Exit preview") : t("Preview")}</span>
            </button>
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <button type="button" aria-label={t("More")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 p-1">
                {url && <a href={url} target="_blank" rel="noreferrer" onClick={() => setMoreOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"><ExternalLink className="h-4 w-4 text-muted-foreground" /> {t("Open the form page")}</a>}
                <button type="button" disabled={!meta.id} onClick={() => { setMoreOpen(false); setDupName(draft.name); setDupOpen(true); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"><Copy className="h-4 w-4 text-muted-foreground" /> {t("Duplicate to another project")}</button>
                <div className="my-1 h-px bg-border" />
                <button type="button" onClick={() => { setMoreOpen(false); if (meta.id) { setConfirmDelete(true); void refreshCount(); } else onClose(); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /> {meta.id ? t("Delete form") : t("Discard draft")}</button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {/* Phone: the tabs get their own row. */}
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:hidden" aria-label={t("Form builder")}>
          {TABS.map((x) => (
            <button key={x.key} type="button" aria-current={tab === x.key && !preview ? "page" : undefined} onClick={() => { setPreview(null); setTab(x.key); }}
              className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm transition-colors", tab === x.key && !preview ? "bg-muted font-semibold" : "text-muted-foreground")}>
              {x.label}{x.badge ? <span className="text-[11px] tabular-nums text-muted-foreground">{x.badge}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      {/* ---------- body ---------- */}
      {preview ? (
        <div className="flex min-h-0 flex-1 flex-col bg-muted/40">
          <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-background/70 px-3 py-2">
            <div className="inline-flex rounded-lg border border-border bg-background p-0.5" role="radiogroup" aria-label={t("Preview size")}>
              {([["desktop", Laptop, t("Desktop")], ["phone", Smartphone, t("Phone")]] as const).map(([k, Icon, l]) => (
                <button key={k} type="button" role="radio" aria-checked={preview === k} onClick={() => setPreview(k)} className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", preview === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="h-3.5 w-3.5" /> {l}</button>
              ))}
            </div>
            <span className="hidden text-xs text-muted-foreground sm:inline">{t("Answers here are not sent.")}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
            {preview === "desktop" ? (
              <div className="mx-auto min-h-full w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-background shadow-soft">
                <FormRenderer key={`d-${rev}`} form={rendererForm} me={me} mode="preview" />
              </div>
            ) : (
              <div className="mx-auto h-[min(780px,calc(100dvh-9rem))] w-[390px] max-w-full overflow-y-auto overscroll-contain rounded-[28px] border-[6px] border-foreground/10 bg-background shadow-pop">
                <FormRenderer key={`p-${rev}`} form={rendererForm} me={me} mode="preview" />
              </div>
            )}
          </div>
        </div>
      ) : tab === "questions" ? (
        <div className="flex min-h-0 flex-1">
          <div className="@container min-h-0 flex-1 overflow-y-auto" onClick={() => { setSelected(null); setSlashFor(null); }}>
            <div className="group/head relative">
              <FormHead branding={draft.branding}>
                {/* Shown on every size, as on a phone (UI tour run 13, W-D16: on a desktop they appeared on hover only). */}
                <div className={cn("flex flex-wrap gap-1", draft.branding?.cover || draft.branding?.icon ? "mt-2" : "")} onClick={(e) => e.stopPropagation()}>
                  {!draft.branding?.icon && (
                    <IconPicker value={draft.branding?.icon} onChange={(v) => setBranding({ icon: v })}>
                      <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><SmilePlus className="h-3.5 w-3.5" /> {t("Add icon")}</button>
                    </IconPicker>
                  )}
                  <CoverPicker value={draft.branding?.cover} onChange={(v) => setBranding({ cover: v })}>
                    <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ImagePlus className="h-3.5 w-3.5" /> {draft.branding?.cover ? t("Change cover") : t("Add cover")}</button>
                  </CoverPicker>
                  {draft.branding?.icon && (
                    <IconPicker value={draft.branding?.icon} onChange={(v) => setBranding({ icon: v })}>
                      <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><SmilePlus className="h-3.5 w-3.5" /> {t("Change icon")}</button>
                    </IconPicker>
                  )}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <AutoTextarea value={draft.name} onChange={(v) => change((d) => ({ ...d, name: v.replace(/\n/g, " ") }))} placeholder={t("Untitled form")} ariaLabel={t("Form title")} autoFocus={!form} keepFont
                    className="mt-2 font-display text-[28px] font-bold leading-tight tracking-tight @lg:text-[34px]" />
                  <AutoTextarea value={draft.description} onChange={(v) => change((d) => ({ ...d, description: v }))} placeholder={t("Add a description")} ariaLabel={t("Form description")}
                    className="mt-2 text-[15px] text-muted-foreground" />
                </div>
                <button type="button" onClick={(e) => { e.stopPropagation(); setTab("settings"); }} className="mt-5 flex w-full items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted">
                  {draft.isPublic ? <Link2 className="h-3.5 w-3.5 shrink-0" /> : <Users className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1">{draft.isPublic ? t("Anyone in NEXUS with the link can fill this in, after signing in.") : t("Only members of this project can fill this in.")}</span>
                  <span className="shrink-0 font-semibold text-foreground">{t("Change")}</span>
                </button>

                {/* questions */}
                <div className="mt-6 pb-24 md:pl-0" onDragOver={(e) => { if (dragFrom.current) e.preventDefault(); }}>
                  {fields.map((f, i) => (
                    <div key={f.id}>
                      {/* gap above each card: drop target + "add a question here" */}
                      <div
                        className="group/gap relative flex h-5 items-center justify-center"
                        onDragOver={(e) => { if (!dragFrom.current) return; e.preventDefault(); setDropAt(i); }}
                        onDragLeave={() => setDropAt((x) => (x === i ? null : x))}
                        onDrop={(e) => { e.preventDefault(); dropTo(i); }}
                      >
                        {dropAt === i && <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-accent-foreground" />}
                        {i > 0 && dropAt === null && (
                          <AddQuestionMenu onPick={(k) => insertAt(i, k)} trigger={
                            <button type="button" onClick={(e) => e.stopPropagation()} aria-label={t("Add a question here")} className="z-10 grid h-5 w-5 place-items-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-soft transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/gap:opacity-100 data-[state=open]:opacity-100"><Plus className="h-3 w-3" /></button>
                          } />
                        )}
                      </div>
                      <QuestionCard
                        field={f}
                        index={i}
                        total={fields.length}
                        selected={selected === f.id}
                        others={fields.filter((x) => x.id !== f.id)}
                        customFields={customFields}
                        taskLists={taskLists}
                        onSelect={() => { setSelected(f.id); }}
                        onChange={(p) => updateField(f.id, p)}
                        onDuplicate={() => duplicate(f.id)}
                        onDelete={() => remove(f.id)}
                        onOpenPanel={() => { setSelected(f.id); setPanelSheet(true); }}
                        dragProps={{ onGripDragStart: () => { dragFrom.current = f.id; }, onGripDragEnd: () => { dragFrom.current = null; setDropAt(null); } }}
                        slashFor={slashFor}
                        setSlashFor={setSlashFor}
                      />
                    </div>
                  ))}
                  <div
                    className="relative h-5"
                    onDragOver={(e) => { if (!dragFrom.current) return; e.preventDefault(); setDropAt(fields.length); }}
                    onDrop={(e) => { e.preventDefault(); dropTo(fields.length); }}
                  >
                    {dropAt === fields.length && <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-accent-foreground" />}
                  </div>
                  {fields.length === 0 && <p className="mb-3 text-sm text-muted-foreground">{t("No questions yet. Add the first one below.")}</p>}
                  <AddQuestionMenu align="start" onPick={(k) => insertAt(fields.length, k)} trigger={
                    <button type="button" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Plus className="h-4 w-4" /> {t("Add question")}</button>
                  } />
                </div>
              </FormHead>
            </div>
          </div>
          <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-border bg-background lg:block" aria-label={t("Question settings")}>{panel}</aside>
          {/* Phone / tablet: the same panel as a bottom sheet. */}
          {panelSheet && sel && (
            <div className="fixed inset-0 z-[80] flex flex-col justify-end bg-black/30 dark:bg-scrim lg:hidden" onClick={() => setPanelSheet(false)}>
              <div role="dialog" aria-modal="true" aria-label={t("Question settings")} className="max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-pop" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
                  <span className="text-sm font-semibold">{t("Question settings")}</span>
                  <button type="button" onClick={() => setPanelSheet(false)} className="rounded-md px-2 py-1 text-sm font-semibold text-muted-foreground hover:bg-muted">{t("Done")}</button>
                </div>
                {panel}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto bg-muted/20">
          {tab === "settings" && <SettingsTab draft={draft} change={change} projectName={projectName} members={members} responseCount={responseCount} />}
          {tab === "share" && <ShareTab url={url} saved={!!meta.id} isPublic={draft.isPublic} onGoSettings={() => setTab("settings")} />}
          {tab === "responses" && <ResponsesTab formId={meta.id} projectId={projectId} onTaskOpen={setTaskOpen} onOpenProject={() => { void close(); navigate({ to: "/projects/$projectId", params: { projectId } }); }} />}
        </div>
      )}

      {/* ---------- dialogs ---------- */}
      <Modal open={confirmDelete} onClose={() => { setConfirmDelete(false); setNewSinceOpen(0); }} label={t("Delete this form?")}>
        <h3 className="font-display text-base font-bold">{t("Delete this form?")}</h3>
        {newSinceOpen > 0 && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {tn(newSinceOpen, "{n} new response came in while you were here.", "{n} new responses came in while you were here.")}
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {meta.count > 0
            ? `${tn(meta.count, "This form has {n} submission.", "This form has {n} submissions.")} ${t("Their tasks stay on the board, but the responses leave their senders' My Submissions. The link stops working. Control Room → Audit can restore the form with its responses.")}`
            : t("The link stops working. Control Room → Audit can restore it.")}
        </p>
        {del.isError && !(del.error instanceof ApiError && del.error.status === 409) && <p className="mt-2 text-xs font-semibold text-destructive">{t("Couldn't delete the form.")}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => { setConfirmDelete(false); setNewSinceOpen(0); }} className="rounded-lg border border-border px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted">{t("Cancel")}</button>
          <button type="button" disabled={del.isPending} onClick={() => { if (deleting.current) return; deleting.current = true; del.mutate(); }} className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-60">{del.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Delete form")}</button>
        </div>
      </Modal>

      <Modal open={dupOpen} onClose={() => setDupOpen(false)} label={t("Duplicate form")}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-display text-base font-bold">{t("Duplicate form")}</h3>
          <button type="button" onClick={() => setDupOpen(false)} aria-label={t("Close")} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("Copies only the fields of this form to another project. Existing submissions and tasks are not copied. Section and custom field mappings are reset, so set them up again in the other project.")}</p>
        <input value={dupName} onChange={(e) => setDupName(e.target.value)} placeholder={t("New form name")} aria-label={t("New form name")} className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-foreground/40" />
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("Choose target project")}</div>
        <div className="mt-1 max-h-72 space-y-0.5 overflow-y-auto">
          {projectsQ.isLoading && <div className="py-4 text-center text-sm text-muted-foreground">{t("Loading projects…")}</div>}
          {(projectsQ.data ?? []).filter((p) => p.id !== projectId).map((p) => (
            <button key={p.id} type="button" disabled={dup.isPending || !dupName.trim()} onClick={() => dup.mutate(p.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50">
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded bg-muted text-sm"><ProjectMark icon={p.icon} color={p.color} className="h-full w-full object-cover" /></span>
              <span className="truncate">{p.name}</span>
              {dup.isPending && dup.variables === p.id && <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin" />}
            </button>
          ))}
        </div>
        {dup.isError && <p className="mt-2 text-xs font-semibold text-destructive">{t("Couldn't duplicate: {error}", { error: dup.error instanceof Error ? dup.error.message : t("try again") })}</p>}
      </Modal>
    </div>
  );
}

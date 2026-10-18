import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  Columns3,
  Loader,
  Users,
  Eye,
  EyeOff,
  Flag,
  Hash,
  ListChecks,
  ListFilter,
  MessageSquare,
  Plus,
  Search,
  Tags,
  Trash2,
  Type,
  Rows3,
  CircleDot,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { SelectPicker } from "@/components/SelectPicker";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  activeFilterCount,
  countRules,
  groupSkeleton,
  groupLabelIsBuiltin,
  groupableProps,
  isGroup,
  ME,
  newId,
  opsFor,
  propDef,
  ruleIsActive,
  sortableProps,
  type FilterGroup,
  type FilterRule,
  type GroupCalc,
  type PropDef,
  type SortRule,
  type ViewConfig,
  type ViewCtx,
  type ViewFilter,
  type ViewLayout,
} from "@/lib/project-views";

// ─── small parts ─────────────────────────────────────────────────────────────────────────────────────

export function PropIcon({ def, className }: { def?: PropDef; className?: string }) {
  // Notion's property glyphs (16 Oct 2026 pass): 16px, the status sunburst, two people for a person field.
  const cls = cn("h-4 w-4 shrink-0 text-muted-foreground", className);
  if (!def) return <CircleDot className={cls} />;
  if (def.key === "section") return <Columns3 className={cls} />;
  if (def.key === "status") return <Loader className={cls} />;
  if (def.key === "priority") return <Flag className={cls} />;
  if (def.key === "subtasks") return <ListChecks className={cls} />;
  if (def.key === "comments") return <MessageSquare className={cls} />;
  // A CREATED field ("Request by") holds plain text, a name typed in or a timestamp, never a linked person: the text
  // glyph, as its cells and the Board / List "T Request by:" (UI tour run 20, decision 2, R20-WD-2).
  if (def.fieldType === "CREATED") return <Type className={cls} />;
  switch (def.kind) {
    case "title":
    case "text":
      return <Type className={cls} />;
    case "select":
      return <CircleDot className={cls} />;
    case "multi":
      return <Tags className={cls} />;
    case "person":
      return <Users className={cls} />;
    case "date":
      return <Calendar className={cls} />;
    case "number":
    case "count":
      return <Hash className={cls} />;
    case "checkbox":
      return <CheckSquare className={cls} />;
  }
}

/** The label of a property in the current language (custom fields keep their own name). */
export function usePropLabel() {
  const { t } = useLang();
  return (def?: PropDef) => (!def ? t("Deleted property") : def.builtin ? t(def.label) : def.label);
}

export const menuItemCls = "flex min-h-7 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
export const fieldCls = "h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none transition-colors hover:border-foreground/20 focus:border-[color:var(--accent-foreground)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent-foreground)]/20";
/** A SelectPicker sized like `fieldCls` (the view popovers' h-8 fields). */
export const pickerCls = "h-8 rounded-md bg-card px-2 text-sm";
export const panelTitleCls = "px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground";

/** Searchable property list (Notion's "Filter by…" / "Sort by…" / "Group by…"). */
export function PropPicker({ defs, onPick, exclude = [], placeholder }: { defs: PropDef[]; onPick: (key: string) => void; exclude?: string[]; placeholder?: string }) {
  const { t } = useLang();
  const label = usePropLabel();
  const [q, setQ] = useState("");
  const list = defs.filter((d) => !d.hidden && !exclude.includes(d.key) && label(d).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    // Notion's "Filter by…" / "Sort by…" menu: the search field on top, then 28px rows of glyph + name.
    <div className="w-72">
      <div className="relative px-2 pb-1 pt-2">
        <Search className="pointer-events-none absolute left-4 top-[calc(50%+2px)] h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder ?? t("Search properties…")} placeholder={placeholder ?? t("Search properties…")} className="h-7 w-full rounded-lg border border-border bg-muted/40 pl-7 pr-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-ring focus:bg-card focus-visible:ring-2 focus-visible:ring-ring/25" />
      </div>
      <div className="max-h-80 overflow-y-auto p-1">
        {list.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("No properties match.")}</p>}
        {list.map((d) => (
          <button key={d.key} type="button" onClick={() => onPick(d.key)} className={menuItemCls}>
            <PropIcon def={d} />
            <span className="truncate">{label(d)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A toolbar button: quiet until it holds something, then it takes the accent colour. */
export function ToolbarButton({ icon: Icon, label, active, count, onClick, disabled, className, showLabel }: {
  icon: typeof ListFilter; label: string; active?: boolean; count?: number; onClick?: () => void; disabled?: boolean; className?: string; iconOnly?: boolean;
  /** Write the name beside the icon from lg up (a toolbar with room to spare, e.g. on the Overview). */
  showLabel?: boolean;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-sm transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-foreground)]/30 disabled:opacity-40",
        // An applied filter or sort tints its icon (Notion), in NEXUS's violet.
        active ? "bg-accent text-sidebar-primary" : "text-muted-foreground hover:text-foreground",
        showLabel && "lg:px-2",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      {showLabel && <span aria-hidden className="hidden whitespace-nowrap lg:inline">{label}</span>}
      {!!count && <span className="tabular-nums text-xs font-semibold">{count}</span>}
    </button>
  );
  // Icons like Notion's toolbar, each with a quick tooltip that names it on hover and keyboard focus (UI tour
  // run 14, WD-7: the native title tooltip took a second and a half to show, so the icons read as unlabeled).
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── filter ──────────────────────────────────────────────────────────────────────────────────────────

function OptionChecklist({ def, value, onChange, withMe }: { def: PropDef; value: string[]; onChange: (v: string[]) => void; withMe?: boolean }) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const opts = [...(withMe ? [{ value: ME, label: t("Me") }] : []), ...(def.options ?? [])];
  const shown = opts.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="w-56">
      {opts.length > 7 && (
        <div className="p-1"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search options…")} className={cn(fieldCls, "w-full")} /></div>
      )}
      <div className="max-h-64 overflow-y-auto p-1">
        {def.kind === "multi" && def.key === "tags" && (
          <TagInput onAdd={(tag) => !value.includes(tag) && onChange([...value, tag])} />
        )}
        {shown.length === 0 && def.key !== "tags" && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("No options.")}</p>}
        {[...shown, ...value.filter((v) => !opts.some((o) => o.value === v)).map((v) => ({ value: v, label: v }))].map((o) => {
          const on = value.includes(o.value);
          return (
            <button key={o.value} type="button" onClick={() => toggle(o.value)} className={menuItemCls} aria-pressed={on}>
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-[color:var(--accent-foreground)] bg-[color:var(--accent-foreground)] text-white" : "border-border")}>{on && <Check className="h-3 w-3" />}</span>
              <span className="truncate">{def.key === "status" || def.key === "priority" ? t(o.label) : o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const { t } = useLang();
  const [v, setV] = useState("");
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onAdd(v.trim()); setV(""); } }}
      placeholder={t("Type a tag, press Enter")}
      className={cn(fieldCls, "mb-1 w-full")}
    />
  );
}

function RuleValue({ rule, def, onChange }: { rule: FilterRule; def: PropDef; onChange: (value: FilterRule["value"]) => void }) {
  const { t } = useLang();
  const op = opsFor(def.kind).find((o) => o.op === rule.op);
  if (!op?.needsValue) return null;
  if (def.kind === "select" || def.kind === "multi" || def.kind === "person") {
    const value = Array.isArray(rule.value) ? rule.value : [];
    const labelOf = (v: string) => (v === ME ? t("Me") : def.options?.find((o) => o.value === v)?.label ?? v);
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn(fieldCls, "inline-flex min-w-0 flex-1 items-center justify-between gap-1 text-left")}>
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
              {value.length === 0 ? t("Pick values") : value.map((v) => (def.key === "status" || def.key === "priority" ? t(labelOf(v)) : labelOf(v))).join(", ")}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <OptionChecklist def={def} value={value} onChange={onChange} withMe={def.kind === "person"} />
        </PopoverContent>
      </Popover>
    );
  }
  if (def.kind === "date") {
    if (rule.op === "next_days" || rule.op === "past_days") {
      return (
        <label className="inline-flex flex-1 items-center gap-1.5 text-sm text-muted-foreground">
          <input type="number" min={1} max={365} value={typeof rule.value === "number" ? rule.value : String(rule.value ?? "")} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)} className={cn(fieldCls, "w-16")} />
          {t("days")}
        </label>
      );
    }
    return <input type="date" value={typeof rule.value === "string" ? rule.value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={cn(fieldCls, "min-w-0 flex-1")} />;
  }
  if (def.kind === "number" || def.kind === "count") {
    return <input type="number" value={rule.value === undefined ? "" : String(rule.value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className={cn(fieldCls, "min-w-0 flex-1")} />;
  }
  return <input value={typeof rule.value === "string" ? rule.value : ""} onChange={(e) => onChange(e.target.value)} placeholder={t("Type a value…")} className={cn(fieldCls, "min-w-0 flex-1")} />;
}

/** One rule: property · operator · value. */
export function RuleRow({ rule, defs, onChange, onRemove, lead }: { rule: FilterRule; defs: PropDef[]; onChange: (r: FilterRule) => void; onRemove: () => void; lead?: ReactNode }) {
  const { t } = useLang();
  const label = usePropLabel();
  const def = propDef(defs, rule.prop);
  const [pickOpen, setPickOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
      {lead}
      <Popover open={pickOpen} onOpenChange={setPickOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(fieldCls, "inline-flex max-w-40 items-center gap-1.5")}>
            <PropIcon def={def} />
            <span className="truncate">{label(def)}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <PropPicker defs={defs} onPick={(key) => { const d = propDef(defs, key); onChange({ ...rule, prop: key, op: d ? opsFor(d.kind)[0].op : "contains", value: undefined }); setPickOpen(false); }} />
        </PopoverContent>
      </Popover>
      {def && (
        <SelectPicker variant="field" ariaLabel={t("Condition")} value={rule.op} onChange={(v) => onChange({ ...rule, op: v, value: opsFor(def.kind).find((o) => o.op === v)?.needsValue ? rule.value : undefined })} options={opsFor(def.kind).map((o) => ({ value: o.op, label: t(o.label) }))} className={cn(pickerCls, "max-w-44")} />
      )}
      {def && <RuleValue rule={rule} def={def} onChange={(value) => onChange({ ...rule, value })} />}
      <button type="button" onClick={onRemove} aria-label={t("Remove rule")} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function defaultRule(defs: PropDef[], key: string): FilterRule {
  const d = propDef(defs, key);
  return { id: newId(), prop: key, op: d ? opsFor(d.kind)[0].op : "contains" };
}

/** An AND / OR group of rules, with one level of nested groups (Notion's advanced filter). */
export function FilterGroupEditor({ group, defs, depth, onChange, onRemove }: { group: FilterGroup; defs: PropDef[]; depth: number; onChange: (g: FilterGroup) => void; onRemove?: () => void }) {
  const { t } = useLang();
  const [adding, setAdding] = useState(false);
  const setRule = (i: number, r: FilterRule | FilterGroup) => onChange({ ...group, rules: group.rules.map((x, j) => (j === i ? r : x)) });
  const removeRule = (i: number) => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) });
  const lead = (i: number) => (
    <span className="w-14 shrink-0 text-right text-sm text-muted-foreground">
      {i === 0 ? t("Where") : i === 1 ? (
        <SelectPicker variant="field" ariaLabel={t("Match")} value={group.mode} onChange={(v) => onChange({ ...group, mode: v === "or" ? "or" : "and" })} options={[{ value: "and", label: t("And") }, { value: "or", label: t("Or") }]} className={cn(pickerCls, "w-14 px-1")} />
      ) : t(group.mode === "or" ? "Or" : "And")}
    </span>
  );
  return (
    <div className={cn("space-y-1.5", depth > 1 && "rounded-lg border border-border bg-muted/40 p-2")}>
      {group.rules.map((r, i) =>
        isGroup(r) ? (
          <div key={r.id} className="flex items-start gap-1.5">
            {lead(i)}
            <div className="min-w-0 flex-1"><FilterGroupEditor group={r} defs={defs} depth={depth + 1} onChange={(g) => setRule(i, g)} onRemove={() => removeRule(i)} /></div>
          </div>
        ) : (
          <RuleRow key={r.id} rule={r} defs={defs} lead={lead(i)} onChange={(nr) => setRule(i, nr)} onRemove={() => removeRule(i)} />
        ),
      )}
      {group.rules.length === 0 && <p className="px-1 py-1 text-sm text-muted-foreground">{t("No rules yet. Add one to narrow the tasks down.")}</p>}
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <Popover open={adding} onOpenChange={setAdding}>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Plus className="h-4 w-4" />{t("Add filter rule")}</button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-auto rounded-xl p-0 shadow-pop"><PropPicker defs={defs} placeholder={t("Filter by…")} onPick={(key) => { onChange({ ...group, rules: [...group.rules, defaultRule(defs, key)] }); setAdding(false); }} /></PopoverContent>
        </Popover>
        {depth < 2 && (
          <button type="button" onClick={() => onChange({ ...group, rules: [...group.rules, { id: newId(), mode: group.mode === "and" ? "or" : "and", rules: [] }] })} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Plus className="h-4 w-4" />{t("Add rule group")}
          </button>
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"><Trash2 className="h-3.5 w-3.5" />{depth > 1 ? t("Remove group") : t("Delete advanced filter")}</button>
        )}
      </div>
    </div>
  );
}

function ruleSummary(rule: FilterRule, def: PropDef | undefined, t: (s: string, v?: Record<string, string | number>) => string): string {
  if (!def) return "";
  const op = opsFor(def.kind).find((o) => o.op === rule.op);
  if (!op || !ruleIsActive(rule, def.kind)) return "";
  if (!op.needsValue) return t(op.label);
  if (Array.isArray(rule.value)) {
    const names = rule.value.map((v) => (v === ME ? t("Me") : (def.options?.find((o) => o.value === v)?.label ?? v))).map((s) => (def.key === "status" || def.key === "priority" ? t(s) : s));
    const shown = names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "");
    return rule.op === "any_of" ? shown : `${t(op.label)} ${shown}`;
  }
  if (rule.op === "next_days") return t("next {n} days", { n: Number(rule.value) });
  if (rule.op === "past_days") return t("past {n} days", { n: Number(rule.value) });
  return `${t(op.label)} ${rule.value}`;
}

/**
 * The chips row under the toolbar (Notion): one chip per simple rule, one for the advanced filter,
 * "+ Filter", and — when what's on screen differs from the saved view — Reset / Save for everyone.
 */
export function FilterChips({ filter, defs, onChange, dirty, canSave, onSave, onReset, sortLabel, saving }: {
  filter: ViewFilter; defs: PropDef[]; onChange: (f: ViewFilter) => void; dirty: boolean; canSave: boolean; onSave: () => void; onReset: () => void; sortLabel?: string | null; saving?: boolean;
}) {
  const { t } = useLang();
  const label = usePropLabel();
  const [adding, setAdding] = useState(false);
  const advancedCount = countRules(filter.advanced);
  return (
    <div className="flex flex-wrap items-center gap-1.5 nx-gx pb-2">
      {sortLabel && (
        <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-xs text-foreground"><ArrowUpDown className="h-3 w-3 text-muted-foreground" />{sortLabel}</span>
      )}
      {filter.advanced && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full border border-[color:var(--accent-foreground)]/30 bg-accent px-2.5 text-xs font-medium text-[color:var(--accent-foreground)]">
              <ListFilter className="h-3 w-3" />{t(advancedCount === 1 ? "1 rule" : "{n} rules", { n: advancedCount })}<ChevronDown className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(92vw,620px)] p-3">
            <FilterGroupEditor group={filter.advanced} defs={defs} depth={1} onChange={(g) => onChange({ ...filter, advanced: g })} onRemove={() => onChange({ ...filter, advanced: null })} />
          </PopoverContent>
        </Popover>
      )}
      {filter.simple.map((r, i) => {
        const def = propDef(defs, r.prop);
        const summary = ruleSummary(r, def, t);
        return (
          <Popover key={r.id} defaultOpen={!summary && i === filter.simple.length - 1}>
            <PopoverTrigger asChild>
              <button type="button" className={cn("inline-flex h-7 max-w-64 items-center gap-1 rounded-full border px-2.5 text-xs", summary ? "border-[color:var(--accent-foreground)]/30 bg-accent font-medium text-[color:var(--accent-foreground)]" : "border-border bg-card text-muted-foreground")}>
                <PropIcon def={def} className={summary ? "text-current" : undefined} />
                <span className="truncate">{label(def)}{summary ? `: ${summary}` : ""}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(92vw,520px)] p-3">
              <RuleRow rule={r} defs={defs} onChange={(nr) => onChange({ ...filter, simple: filter.simple.map((x) => (x.id === r.id ? nr : x)) })} onRemove={() => onChange({ ...filter, simple: filter.simple.filter((x) => x.id !== r.id) })} />
            </PopoverContent>
          </Popover>
        );
      })}
      <Popover open={adding} onOpenChange={setAdding}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Plus className="h-3 w-3" />{t("Filter")}</button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-auto rounded-xl p-0 shadow-pop">
          <PropPicker defs={defs} placeholder={t("Filter by…")} onPick={(key) => { onChange({ ...filter, simple: [...filter.simple, defaultRule(defs, key)] }); setAdding(false); }} />
          <div className="border-t border-border p-1">
            <button type="button" onClick={() => { onChange({ ...filter, advanced: filter.advanced ?? { id: newId(), mode: "and", rules: [] } }); setAdding(false); }} className={cn(menuItemCls, "text-muted-foreground")}><Plus className="h-4 w-4" />{t("Add advanced filter")}</button>
          </div>
        </PopoverContent>
      </Popover>
      {dirty && (
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onReset} className="h-7 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{t("Reset")}</button>
          {canSave && (
            <button type="button" disabled={saving} onClick={onSave} className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">{t("Save for everyone")}</button>
          )}
        </div>
      )}
    </div>
  );
}

/** Toolbar Filter button: adds the first rule (Notion), or toggles the chips row when there are rules. */
export function FilterButton({ filter, defs, onChange, chipsOpen, onToggleChips }: { filter: ViewFilter; defs: PropDef[]; onChange: (f: ViewFilter) => void; chipsOpen: boolean; onToggleChips: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(filter, defs);
  const hasRules = filter.simple.length > 0 || !!filter.advanced;
  if (hasRules) return <ToolbarButton icon={ListFilter} label={t("Filter")} active={n > 0 || chipsOpen} count={n} onClick={onToggleChips} />;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span><ToolbarButton icon={ListFilter} label={t("Filter")} /></span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-auto rounded-xl p-0 shadow-pop">
        <PropPicker defs={defs} placeholder={t("Filter by…")} onPick={(key) => { onChange({ ...filter, simple: [defaultRule(defs, key)] }); setOpen(false); if (!chipsOpen) onToggleChips(); }} />
        <div className="border-t border-border p-1">
          <button type="button" onClick={() => { onChange({ ...filter, advanced: { id: newId(), mode: "and", rules: [] } }); setOpen(false); if (!chipsOpen) onToggleChips(); }} className={cn(menuItemCls, "text-muted-foreground")}><Plus className="h-4 w-4" />{t("Add advanced filter")}</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── sort ────────────────────────────────────────────────────────────────────────────────────────────

export function SortEditor({ sort, defs, onChange }: { sort: SortRule[]; defs: PropDef[]; onChange: (s: SortRule[]) => void }) {
  const { t } = useLang();
  const label = usePropLabel();
  const [adding, setAdding] = useState(false);
  const usable = sortableProps(defs);
  const move = (i: number, d: -1 | 1) => { const n = [...sort]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div className="w-[min(92vw,400px)] space-y-1 p-2">
      {sort.length === 0 && <p className="px-1 py-1 text-sm text-muted-foreground">{t("Tasks are in their manual order. Add a sort to order them by a property.")}</p>}
      {sort.map((s, i) => (
        <div key={`${s.prop}-${i}`} className="flex items-center gap-1.5">
          <SelectPicker variant="field" ariaLabel={t("Sort by")} value={s.prop} onChange={(v) => onChange(sort.map((x, j) => (j === i ? { ...x, prop: v } : x)))} options={usable.map((d) => ({ value: d.key, label: label(d) }))} className={cn(pickerCls, "min-w-0 flex-1")} />
          <SelectPicker variant="field" ariaLabel={t("Direction")} value={s.dir} onChange={(v) => onChange(sort.map((x, j) => (j === i ? { ...x, dir: v === "desc" ? "desc" : "asc" } : x)))} options={[{ value: "asc", label: t("Ascending") }, { value: "desc", label: t("Descending") }]} className={cn(pickerCls, "w-32")} />
          <div className="flex shrink-0">
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Move up")} className="grid h-8 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={i === sort.length - 1} onClick={() => move(i, 1)} aria-label={t("Move down")} className="grid h-8 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => onChange(sort.filter((_, j) => j !== i))} aria-label={t("Remove sort")} className="grid h-8 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
      {/* Notion's sort menu: "+ Add sort" and "Delete sort" are rows of the menu, under the rules. */}
      <div className={cn("-mx-1 flex flex-col", sort.length > 0 && "mt-1 border-t border-border pt-1")}>
        <Popover open={adding} onOpenChange={setAdding}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(menuItemCls, "text-muted-foreground hover:text-foreground")}><Plus className="h-4 w-4" />{t("Add sort")}</button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-auto rounded-xl p-0 shadow-pop"><PropPicker defs={usable} exclude={sort.map((s) => s.prop)} placeholder={t("Sort by…")} onPick={(key) => { onChange([...sort, { prop: key, dir: "asc" }]); setAdding(false); }} /></PopoverContent>
        </Popover>
        {sort.length > 0 && <button type="button" onClick={() => onChange([])} className={cn(menuItemCls, "text-muted-foreground hover:bg-destructive/10 hover:text-destructive")}><Trash2 className="h-4 w-4" />{t("Delete sort")}</button>}
      </div>
    </div>
  );
}

export function SortButton({ sort, defs, onChange }: { sort: SortRule[]; defs: PropDef[]; onChange: (s: SortRule[]) => void }) {
  const { t } = useLang();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span><ToolbarButton icon={ArrowUpDown} label={t("Sort")} active={sort.length > 0} count={sort.length} /></span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-auto rounded-xl p-0 shadow-pop"><SortEditor sort={sort} defs={defs} onChange={onChange} /></PopoverContent>
    </Popover>
  );
}

export function sortSummary(sort: SortRule[], defs: PropDef[], label: (d?: PropDef) => string): string | null {
  if (!sort.length) return null;
  const first = sort[0];
  const head = `${label(propDef(defs, first.prop))} ${first.dir === "desc" ? "↓" : "↑"}`;
  return sort.length > 1 ? `${head} +${sort.length - 1}` : head;
}

// ─── group ───────────────────────────────────────────────────────────────────────────────────────────

export function GroupEditor({ cfg, layout, defs, ctx, onPatch, readOnly }: { cfg: ViewConfig; layout: ViewLayout; defs: PropDef[]; ctx: ViewCtx; onPatch: (p: Partial<ViewConfig>) => void; readOnly?: boolean }) {
  const { t } = useLang();
  const label = usePropLabel();
  const groupable = groupableProps(defs);
  const numberProps = defs.filter((d) => d.kind === "number");
  const canSubGroup = layout === "board" || layout === "list" || layout === "table";
  const skeleton = useMemo(() => (cfg.groupBy ? groupSkeleton(cfg.groupBy, defs, ctx) : []), [cfg.groupBy, defs, ctx]);
  const hidden = new Set(cfg.hiddenGroups);
  const toggleHidden = (k: string) => onPatch({ hiddenGroups: hidden.has(k) ? cfg.hiddenGroups.filter((x) => x !== k) : [...cfg.hiddenGroups, k] });
  const calcValue = cfg.groupCalc.kind === "sum" || cfg.groupCalc.kind === "avg" ? `${cfg.groupCalc.kind}:${cfg.groupCalc.prop ?? ""}` : cfg.groupCalc.kind;
  const optLabel = (k: string, l: string) => (groupLabelIsBuiltin(cfg.groupBy, k, defs) ? t(l) : l);
  return (
    <fieldset disabled={readOnly} className="w-[min(92vw,320px)] min-w-0 space-y-2 p-2 disabled:opacity-60">
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t("Group by")}</span>
        <SelectPicker variant="field" ariaLabel={t("Group by")} value={cfg.groupBy ?? ""} onChange={(v) => onPatch({ groupBy: v || null, hiddenGroups: [], collapsedGroups: [] })} options={[{ value: "", label: t("None") }, ...groupable.map((d) => ({ value: d.key, label: label(d) }))]} className={cn(pickerCls, "w-44")} />
      </label>
      {canSubGroup && cfg.groupBy && (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{layout === "board" ? t("Sub-group (rows)") : t("Sub-group")}</span>
          <SelectPicker variant="field" ariaLabel={layout === "board" ? t("Sub-group (rows)") : t("Sub-group")} value={cfg.subGroupBy ?? ""} onChange={(v) => onPatch({ subGroupBy: v || null })} options={[{ value: "", label: t("None") }, ...groupable.filter((d) => d.key !== cfg.groupBy).map((d) => ({ value: d.key, label: label(d) }))]} className={cn(pickerCls, "w-44")} />
        </label>
      )}
      {cfg.groupBy && (
        <>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t("Group header shows")}</span>
            <SelectPicker
              variant="field"
              ariaLabel={t("Group header shows")}
              value={calcValue}
              onChange={(v) => {
                const [kind, prop] = v.split(":");
                onPatch({ groupCalc: { kind: kind as GroupCalc["kind"], ...(prop ? { prop } : {}) } });
              }}
              options={[
                { value: "count", label: t("Count") },
                { value: "done", label: t("Done / total") },
                { value: "percent_done", label: t("Percent done") },
                ...numberProps.map((d) => ({ value: `sum:${d.key}`, label: t("Sum of {name}", { name: label(d) }) })),
                ...numberProps.map((d) => ({ value: `avg:${d.key}`, label: t("Average {name}", { name: label(d) }) })),
              ]}
              className={cn(pickerCls, "w-44")}
            />
          </label>
          <label className="flex items-center justify-between gap-2 py-0.5 text-sm">
            <span className="text-muted-foreground">{t("Hide empty groups")}</span>
            <Switch checked={cfg.hideEmptyGroups} onCheckedChange={(v) => onPatch({ hideEmptyGroups: v })} />
          </label>
          {skeleton.length > 0 && (
            <div className="border-t border-border pt-2">
              <div className="mb-1 flex items-center justify-between px-1 text-xs text-muted-foreground">
                <span>{t("Groups")}</span>
                <button type="button" onClick={() => onPatch({ hiddenGroups: cfg.hiddenGroups.length ? [] : skeleton.map((g) => g.key) })} className="font-medium text-[color:var(--accent-foreground)] hover:underline">{cfg.hiddenGroups.length ? t("Show all") : t("Hide all")}</button>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {skeleton.map((g) => (
                  <button key={g.key} type="button" onClick={() => toggleHidden(g.key)} className={menuItemCls}>
                    <span className={cn("min-w-0 flex-1 truncate", hidden.has(g.key) && "text-muted-foreground")}>{optLabel(g.key, g.label)}</span>
                    {hidden.has(g.key) ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}

export function GroupButton(props: Parameters<typeof GroupEditor>[0]) {
  const { t } = useLang();
  const supported = props.layout !== "calendar";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span><ToolbarButton icon={Rows3} label={t("Group")} active={!!props.cfg.groupBy && props.cfg.groupBy !== "section"} disabled={!supported} /></span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        {props.readOnly && <p className="px-3 pt-2 text-xs text-muted-foreground">{t("Only project members can change a shared view.")}</p>}
        <GroupEditor {...props} />
      </PopoverContent>
    </Popover>
  );
}

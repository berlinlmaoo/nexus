import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  GanttChart,
  LayoutGrid,
  Link2,
  List,
  ListTree,
  Lock,
  Palette,
  Pencil,
  Plus,
  Rows3,
  Table2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import type { NexusProjectView } from "@/lib/nexus-api";
import {
  COLOR_KEYS,
  COLOR_PRESETS,
  dateProps,
  groupableProps,
  isBuiltinTab,
  LAYOUT_LABEL,
  ME,
  newId,
  propDef,
  VIEW_LAYOUTS,
  viewName,
  visibleProps,
  type ColorRule,
  type PropDef,
  type ViewConfig,
  type ViewCtx,
  type ViewLayout,
} from "@/lib/project-views";
import { fieldCls, GroupEditor, menuItemCls, pickerCls, PropIcon, SortEditor, usePropLabel } from "./view-controls";
import { SelectPicker } from "@/components/SelectPicker";
import type { SortRule } from "@/lib/project-views";

export const LAYOUT_ICON: Record<ViewLayout, typeof List> = {
  board: Columns3,
  list: List,
  table: Table2,
  calendar: CalendarIcon,
  timeline: GanttChart,
  gallery: LayoutGrid,
};

export const LAYOUT_HINT: Record<ViewLayout, string> = {
  board: "Cards in columns",
  list: "Rows, grouped",
  table: "Editable columns",
  calendar: "Tasks on their dates",
  timeline: "Start to due, as bars",
  gallery: "Cards with a cover image",
};

function LayoutGridPicker({ value, onPick, disabled }: { value?: ViewLayout; onPick: (l: ViewLayout) => void; disabled?: boolean }) {
  const { t } = useLang();
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("Layout")}>
      {VIEW_LAYOUTS.map((l) => {
        const Icon = LAYOUT_ICON[l];
        const on = value === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled && !on}
            onClick={() => onPick(l)}
            title={t(LAYOUT_HINT[l])}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs transition-colors disabled:opacity-40",
              on ? "border-[color:var(--accent-foreground)] bg-accent text-[color:var(--accent-foreground)]" : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {t(LAYOUT_LABEL[l])}
          </button>
        );
      })}
    </div>
  );
}

/** "+" after the tabs: pick a layout, name it, choose who sees it (Notion's "Start from scratch"). */
export function AddViewButton({ canShare, onCreate, busy }: { canShare: boolean; onCreate: (p: { layout: ViewLayout; name: string; shared: boolean }) => void; busy?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<ViewLayout>("table");
  const [name, setName] = useState("");
  const [shared, setShared] = useState(canShare);
  useEffect(() => { if (open) { setName(""); setShared(canShare); } }, [open, canShare]);
  const create = () => { onCreate({ layout, name: name.trim(), shared: shared && canShare }); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t("Add view")} title={t("Add view")} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Plus className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-3">
        <div className="text-sm font-medium">{t("New view")}</div>
        <LayoutGridPicker value={layout} onPick={setLayout} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder={t(LAYOUT_LABEL[layout])}
          aria-label={t("View name")}
          className={cn(fieldCls, "w-full")}
        />
        <div className="space-y-1" role="radiogroup" aria-label={t("Who sees it")}>
          <button type="button" role="radio" aria-checked={!shared} onClick={() => setShared(false)} className={menuItemCls}>
            <Lock className="h-3.5 w-3.5 text-muted-foreground" /><span className="flex-1">{t("Only me")}</span>{!shared && <Check className="h-3.5 w-3.5" />}
          </button>
          <button type="button" role="radio" aria-checked={shared} disabled={!canShare} onClick={() => setShared(true)} className={menuItemCls}>
            <Users className="h-3.5 w-3.5 text-muted-foreground" /><span className="flex-1">{t("Everyone in this project")}</span>{shared && <Check className="h-3.5 w-3.5" />}
          </button>
          {!canShare && <p className="px-2 text-xs text-muted-foreground">{t("Viewers and guests can make views for themselves.")}</p>}
        </div>
        <button type="button" disabled={busy} onClick={create} className="h-8 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">{t("Create view")}</button>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-foreground">{label}</span>
      {children}
    </label>
  );
}

function PropertiesEditor({ cfg, layout, defs, onPatch }: { cfg: ViewConfig; layout: ViewLayout; defs: PropDef[]; onPatch: (p: Partial<ViewConfig>) => void }) {
  const { t } = useLang();
  const label = usePropLabel();
  const shown = visibleProps(cfg, layout, defs);
  const hidden = defs.filter((d) => d.key !== "title" && !d.hidden && !shown.includes(d.key));
  const set = (list: string[]) => onPatch({ visibleProps: list });
  const move = (i: number, d: -1 | 1) => { const n = [...shown]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); set(n); };
  return (
    <div className="space-y-0.5">
      {shown.map((k, i) => {
        const def = propDef(defs, k);
        return (
          <div key={k} className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted">
            <PropIcon def={def} />
            <span className="min-w-0 flex-1 truncate text-sm">{label(def)}</span>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Move up")} className="grid h-7 w-6 place-items-center rounded text-muted-foreground opacity-0 pointer-coarse:opacity-100! transition-opacity hover:text-foreground focus-visible:opacity-100 disabled:hidden group-hover:opacity-100"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={i === shown.length - 1} onClick={() => move(i, 1)} aria-label={t("Move down")} className="grid h-7 w-6 place-items-center rounded text-muted-foreground opacity-0 pointer-coarse:opacity-100! transition-opacity hover:text-foreground focus-visible:opacity-100 disabled:hidden group-hover:opacity-100"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => set(shown.filter((x) => x !== k))} aria-label={t("Hide {name}", { name: label(def) })} className="grid h-7 w-7 place-items-center rounded text-foreground hover:bg-card"><Eye className="h-3.5 w-3.5" /></button>
          </div>
        );
      })}
      {hidden.length > 0 && <div className="px-1 pb-0.5 pt-2 text-xs text-muted-foreground">{t("Hidden")}</div>}
      {hidden.map((def) => (
        <div key={def.key} className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted">
          <PropIcon def={def} />
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{label(def)}</span>
          <button type="button" onClick={() => set([...shown, def.key])} aria-label={t("Show {name}", { name: label(def) })} className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-card hover:text-foreground"><EyeOff className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

function ColorRulesEditor({ cfg, defs, onPatch }: { cfg: ViewConfig; defs: PropDef[]; onPatch: (p: Partial<ViewConfig>) => void }) {
  const { t } = useLang();
  const label = usePropLabel();
  const usable = groupableProps(defs).filter((d) => d.kind !== "date" && d.kind !== "checkbox");
  const set = (rules: ColorRule[]) => onPatch({ colorRules: rules });
  return (
    <div className="space-y-2">
      <Row label={t("Colour cards by")}>
        <SelectPicker variant="field" ariaLabel={t("Colour cards by")} value={cfg.colorBy ?? ""} onChange={(v) => onPatch({ colorBy: v || null })} options={[{ value: "", label: t("None") }, ...usable.filter((d) => d.kind === "select").map((d) => ({ value: d.key, label: label(d) }))]} className={cn(pickerCls, "w-40")} />
      </Row>
      {cfg.colorRules.map((r) => {
        const def = propDef(defs, r.prop);
        const opts = [...(def?.kind === "person" ? [{ value: ME, label: t("Me") }] : []), ...(def?.options ?? [])];
        return (
          <div key={r.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/60 p-1.5">
            <SelectPicker variant="field" ariaLabel={t("Property")} value={r.prop} onChange={(v) => set(cfg.colorRules.map((x) => (x.id === r.id ? { ...x, prop: v, value: "" } : x)))} options={usable.map((d) => ({ value: d.key, label: label(d) }))} className={cn(pickerCls, "w-28")} />
            <SelectPicker variant="field" ariaLabel={t("Value")} value={r.value} onChange={(v) => set(cfg.colorRules.map((x) => (x.id === r.id ? { ...x, value: v } : x)))} placeholder={t("Pick a value…")} options={opts.map((o) => ({ value: o.value, label: r.prop === "status" || r.prop === "priority" ? t(o.label) : o.label }))} className={cn(pickerCls, "min-w-0 flex-1")} />
            <div className="flex items-center gap-0.5">
              {COLOR_KEYS.map((c) => (
                <button key={c} type="button" onClick={() => set(cfg.colorRules.map((x) => (x.id === r.id ? { ...x, color: c } : x)))} aria-label={t(COLOR_PRESETS[c].label)} title={t(COLOR_PRESETS[c].label)}
                  className={cn("h-5 w-5 rounded-full border transition-transform", r.color === c ? "scale-110 border-foreground/50" : "border-transparent hover:scale-105")} style={{ backgroundColor: COLOR_PRESETS[c].bg, boxShadow: `inset 0 0 0 1px ${COLOR_PRESETS[c].border}` }} />
              ))}
            </div>
            <button type="button" onClick={() => set(cfg.colorRules.filter((x) => x.id !== r.id))} aria-label={t("Remove rule")} className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-card hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        );
      })}
      <button type="button" onClick={() => set([...cfg.colorRules, { id: newId(), prop: "status", value: "", color: "sky" }])} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <Plus className="h-3.5 w-3.5" />{t("Add colour rule")}
      </button>
    </div>
  );
}

/**
 * The view's settings, docked on the right (Notion's "View settings"). Everything here saves to the view
 * at once; on a shared view that needs project-member rights, otherwise the controls are read-only and
 * the panel offers a personal copy instead.
 */
type SettingsPage = "root" | "layout" | "props" | "dates" | "cards" | "group" | "sort" | "color" | "share";

/** A Notion settings row: icon, name, the current value in grey, and a chevron into its page. */
function MenuRow({ icon: Icon, label, value, onClick, disabled, danger }: { icon: typeof List; label: string; value?: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(menuItemCls, "h-8 py-0", danger && "text-destructive hover:bg-destructive/10")}>
      <Icon className={cn("h-4 w-4 shrink-0", danger ? "" : "text-foreground/70")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value != null && <span className="max-w-36 shrink-0 truncate text-muted-foreground">{value}</span>}
      {!danger && value !== undefined && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/**
 * View settings, Notion's side panel (16 Oct 2026 pass): a short menu (Layout, Property visibility, Filter-free
 * Group / Sort / Conditional colour, Copy link…) where each row opens its own page with a back arrow. Every
 * setting the old long panel had is still here, one level down.
 */
export function ViewSettingsPanel({ view, cfg, defs, ctx, canEdit, canShare, sort, onSort, onPatch, onRename, onLayout, onShare, onDuplicate, onDelete, onHide, onCopyLink, onClose }: {
  view: NexusProjectView; cfg: ViewConfig; defs: PropDef[]; ctx: ViewCtx; canEdit: boolean; canShare: boolean;
  sort: SortRule[]; onSort: (s: SortRule[]) => void;
  onPatch: (p: Partial<ViewConfig>) => void; onRename: (name: string | null) => void; onLayout: (l: ViewLayout) => void; onShare: (shared: boolean) => void;
  onDuplicate: () => void; onDelete: () => void; onHide: () => void; onCopyLink: () => void; onClose: () => void;
}) {
  const { t } = useLang();
  const label = usePropLabel();
  const [name, setName] = useState(viewName(view, t));
  const [page, setPage] = useState<SettingsPage>("root");
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setName(viewName(view, t)); }, [view.id, view.name, t, view]);
  useEffect(() => {
    // Esc steps back a page first, then closes (Notion).
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape" || e.defaultPrevented) return; setPage((p) => { if (p === "root") onClose(); return "root"; }); };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const commitName = () => {
    const n = name.trim();
    const fallback = viewName({ ...view, name: null }, t);
    if (!n || n === fallback) { if (view.name) onRename(null); setName(fallback); return; }
    if (n !== view.name) onRename(n);
  };
  const layout = view.layout;
  const builtin = isBuiltinTab(view);
  const dates = dateProps(defs);
  const LayoutIcon = LAYOUT_ICON[layout];
  const shownCount = visibleProps(cfg, layout, defs).length;
  const groupDef = cfg.groupBy ? propDef(defs, cfg.groupBy) : undefined;
  const titles: Record<SettingsPage, string> = {
    root: t("View settings"), layout: t("Layout"), props: t("Property visibility"), dates: layout === "calendar" ? t("Calendar") : t("Timeline"),
    cards: t("Cards"), group: t("Group"), sort: t("Sort"), color: t("Conditional color"), share: t("Who sees this view"),
  };
  const locked = !canEdit && page !== "root" && page !== "share";
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={t("View settings")}
      className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-pop outline-none sm:top-[var(--page-sticky-top,0px)] sm:w-[380px] sm:shadow-[-12px_0_32px_-16px_rgba(15,15,15,0.12)] animate-in slide-in-from-right-4 fade-in-0 duration-200"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 px-3">
        {page !== "root" && (
          <button type="button" onClick={() => setPage("root")} aria-label={t("Back")} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
        )}
        <h2 className={cn("flex-1 truncate text-sm font-medium", page === "root" ? "pl-1 text-muted-foreground" : "text-foreground")}>{titles[page]}</h2>
        <button type="button" onClick={onClose} aria-label={t("Close")} className="grid h-6 w-6 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-foreground/10 hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {!canEdit && (page === "root" || locked) && (
          <div className="mx-1 mb-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("This view is shared with the whole project. Only project members can change it — you can still filter and sort on your screen, or make your own copy.")}
            <button type="button" onClick={onDuplicate} className="mt-1.5 block font-medium text-[color:var(--accent-foreground)] hover:underline">{t("Make a personal copy")}</button>
          </div>
        )}
        {page === "root" && (
          <>
            <div className="mb-1 flex items-center gap-1.5 px-1">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground"><LayoutIcon className="h-4 w-4" /></span>
              <input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label={t("View name")} className={cn(fieldCls, "min-w-0 flex-1 disabled:opacity-70")} />
            </div>
            <MenuRow icon={LayoutIcon} label={t("Layout")} value={t(LAYOUT_LABEL[layout])} onClick={() => setPage("layout")} />
            <MenuRow icon={Eye} label={t("Property visibility")} value={shownCount} onClick={() => setPage("props")} />
            {(layout === "calendar" || layout === "timeline") && (
              <MenuRow icon={CalendarIcon} label={layout === "calendar" ? t("Show tasks by") : t("Dates")} value={label(propDef(defs, layout === "calendar" ? cfg.dateProp : cfg.startProp))} onClick={() => setPage("dates")} />
            )}
            {(layout === "board" || layout === "gallery") && (
              <MenuRow icon={LayoutGrid} label={t("Cards")} value={t(cfg.cardSize === "small" ? "Small" : cfg.cardSize === "large" ? "Large" : "Medium")} onClick={() => setPage("cards")} />
            )}
            <MenuRow icon={ArrowUpDown} label={t("Sort")} value={sort.length || ""} onClick={() => setPage("sort")} />
            {layout !== "calendar" && <MenuRow icon={Rows3} label={t("Group")} value={groupDef ? label(groupDef) : ""} onClick={() => setPage("group")} />}
            <MenuRow icon={Palette} label={t("Conditional color")} value={cfg.colorRules.length || ""} onClick={() => setPage("color")} />
            {(layout === "board" || layout === "list" || layout === "table" || layout === "gallery") && (
              <label className={cn(menuItemCls, "h-8 cursor-pointer py-0")}>
                <ListTree className="h-4 w-4 shrink-0 text-foreground/70" />
                <span className="min-w-0 flex-1 truncate">{t("Show subtasks as their own cards")}</span>
                <Switch checked={cfg.showSubtasks} disabled={!canEdit} onCheckedChange={(v) => onPatch({ showSubtasks: v })} />
              </label>
            )}
            <MenuRow icon={Link2} label={t("Copy link to view")} onClick={onCopyLink} />
            <div className="mx-2 my-2 border-t border-border" />
            <div className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">{t("More")}</div>
            <MenuRow icon={view.shared ? Users : Lock} label={t("Who sees this view")} value={view.shared ? t("Everyone in this project") : t("Only me")} onClick={() => setPage("share")} />
            <MenuRow icon={Copy} label={t("Duplicate view")} onClick={onDuplicate} />
            {builtin
              ? <MenuRow icon={EyeOff} label={t("Hide this view")} onClick={onHide} disabled={!canEdit} />
              : <MenuRow icon={Trash2} label={t("Delete view")} onClick={onDelete} disabled={!canEdit} danger />}
          </>
        )}
        <fieldset disabled={!canEdit} className="min-w-0 px-2 disabled:opacity-70">
          {page === "layout" && (
            <>
              <LayoutGridPicker value={layout} onPick={onLayout} disabled={builtin} />
              {builtin && <p className="mt-2 text-xs text-muted-foreground">{t("Built-in views keep their layout. Add a new view for another layout.")}</p>}
            </>
          )}
          {page === "props" && <PropertiesEditor cfg={cfg} layout={layout} defs={defs} onPatch={onPatch} />}
          {page === "dates" && layout === "calendar" && (
            <Row label={t("Show tasks by")}>
              <SelectPicker variant="field" ariaLabel={t("Show tasks by")} value={cfg.dateProp} onChange={(v) => onPatch({ dateProp: v })} options={dates.map((d) => ({ value: d.key, label: label(d) }))} className={cn(pickerCls, "w-40")} />
            </Row>
          )}
          {page === "dates" && layout === "timeline" && (
            <>
              <Row label={t("Bar starts at")}>
                <SelectPicker variant="field" ariaLabel={t("Bar starts at")} value={cfg.startProp} onChange={(v) => onPatch({ startProp: v })} options={dates.map((d) => ({ value: d.key, label: label(d) }))} className={cn(pickerCls, "w-40")} />
              </Row>
              <Row label={t("Bar ends at")}>
                <SelectPicker variant="field" ariaLabel={t("Bar ends at")} value={cfg.endProp} onChange={(v) => onPatch({ endProp: v })} options={dates.map((d) => ({ value: d.key, label: label(d) }))} className={cn(pickerCls, "w-40")} />
              </Row>
            </>
          )}
          {page === "cards" && (
            <>
              <Row label={t("Card size")}>
                <SelectPicker variant="field" ariaLabel={t("Card size")} value={cfg.cardSize} onChange={(v) => onPatch({ cardSize: v as ViewConfig["cardSize"] })} options={[{ value: "small", label: t("Small") }, { value: "medium", label: t("Medium") }, { value: "large", label: t("Large") }]} className={cn(pickerCls, "w-32")} />
              </Row>
              {layout === "gallery" && (
                <Row label={t("Cover")}>
                  <SelectPicker variant="field" ariaLabel={t("Cover")} value={cfg.cardCover} onChange={(v) => onPatch({ cardCover: v === "none" ? "none" : "image" })} options={[{ value: "image", label: t("First image attached") }, { value: "none", label: t("No cover") }]} className={cn(pickerCls, "w-40")} />
                </Row>
              )}
            </>
          )}
          {page === "group" && <div className="-mx-2"><GroupEditor cfg={cfg} layout={layout} defs={defs} ctx={ctx} onPatch={onPatch} readOnly={!canEdit} /></div>}
          {page === "sort" && <div className="-mx-2"><SortEditor sort={sort} defs={defs} onChange={onSort} /></div>}
          {page === "color" && <ColorRulesEditor cfg={cfg} defs={defs} onPatch={onPatch} />}
        </fieldset>
        {page === "share" && (
          <div className="space-y-1 px-1" role="radiogroup" aria-label={t("Who sees this view")}>
            <button type="button" role="radio" aria-checked={view.shared} disabled={!canShare || builtin || view.shared} onClick={() => onShare(true)} className={menuItemCls}>
              <Users className="h-3.5 w-3.5 text-muted-foreground" /><span className="flex-1">{t("Everyone in this project")}</span>{view.shared && <Check className="h-3.5 w-3.5" />}
            </button>
            <button type="button" role="radio" aria-checked={!view.shared} disabled={!canShare || builtin || !view.shared} onClick={() => onShare(false)} className={menuItemCls}>
              <Lock className="h-3.5 w-3.5 text-muted-foreground" /><span className="flex-1">{t("Only me")}</span>{!view.shared && <Check className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/** The small menu on the active tab: rename, settings, duplicate, link, delete. */
export function ViewTabMenu({ view, canEdit, onRename, onSettings, onDuplicate, onCopyLink, onDelete, onHide }: {
  view: NexusProjectView; canEdit: boolean; onRename: () => void; onSettings: () => void; onDuplicate: () => void; onCopyLink: () => void; onDelete: () => void; onHide: () => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const builtin = isBuiltinTab(view);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t("View options")} className="-mr-1 grid h-5 w-5 place-items-center rounded pointer-coarse:-my-3 pointer-coarse:-mr-3 pointer-coarse:-ml-2 pointer-coarse:size-11 text-muted-foreground hover:bg-card hover:text-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        <button type="button" disabled={!canEdit} onClick={run(onRename)} className={menuItemCls}><Pencil className="h-3.5 w-3.5 text-muted-foreground" />{t("Rename")}</button>
        <button type="button" onClick={run(onSettings)} className={menuItemCls}><LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />{t("Edit view")}</button>
        <button type="button" onClick={run(onDuplicate)} className={menuItemCls}><Copy className="h-3.5 w-3.5 text-muted-foreground" />{t("Duplicate view")}</button>
        <button type="button" onClick={run(onCopyLink)} className={menuItemCls}><Link2 className="h-3.5 w-3.5 text-muted-foreground" />{t("Copy link to view")}</button>
        <div className="my-1 border-t border-border" />
        {builtin ? (
          <button type="button" disabled={!canEdit} onClick={run(onHide)} className={menuItemCls}><EyeOff className="h-3.5 w-3.5 text-muted-foreground" />{t("Hide this view")}</button>
        ) : (
          <button type="button" disabled={!canEdit} onClick={run(onDelete)} className={cn(menuItemCls, "text-destructive hover:bg-destructive/10")}><Trash2 className="h-3.5 w-3.5" />{t("Delete view")}</button>
        )}
      </PopoverContent>
    </Popover>
  );
}

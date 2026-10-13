import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  Bold, ChartColumn, DecimalsArrowLeft, DecimalsArrowRight, EllipsisVertical, Funnel, Italic, Link2, ListFilter,
  MessageSquarePlus, Minus, PaintBucket, PaintRoller, Percent, Plus, Printer, Redo2, RemoveFormatting, Search, Sigma,
  Strikethrough, TableCellsMerge, TableCellsSplit, Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { BorderLine, NumberFormatKind, Rotation, WrapMode } from "@/lib/sheet-model";
import {
  DEFAULT_FONT, DEFAULT_FONT_PT, FONT_FAMILIES, FONT_SIZES_PT, MAX_FONT_PT, MIN_FONT_PT, fontStack, type FontFamily,
} from "@/lib/sheet-palette";
import { fontPt, wrapMode, type BorderPreset10, type CellStyle } from "./sheet-style";
import { Floating } from "./sheet-float";
import { Menu, MenuItem, MenuLabel, MenuSep, menuKeyNav } from "./sheet-menu-ui";
import { ColorMenuButton } from "./ColorPicker";
import { BorderGlyph, BordersPanel, loadBorderPrefs, saveBorderPrefs, type BorderPrefs } from "./BordersPanel";

export { Menu, MenuItem, MenuLabel, MenuSep } from "./sheet-menu-ui";

export type CustomFormatKind = "customNumber" | "customDate" | "customCurrency";
/** One row of the "123" menu: a preset (with its grey example), a custom-format dialog, or "sep". */
export type NumberMenuEntry = "sep" | { nf: NumberFormatKind | CustomFormatKind; label: string; example?: string };
export type MergeKind = "all" | "vertical" | "horizontal" | "unmerge";
export type FilterViewAction = { kind: "create" } | { kind: "groupBy"; colId: string } | { kind: "open"; id: string };

export type ToolbarProps = {
  canEdit: boolean;
  /** Formatting of the active cell — what the toggles show as on. */
  style: CellStyle | undefined;
  onStyle: (patch: Partial<Record<keyof CellStyle, unknown>>) => void;
  /** The "123" More formats list (labels in English source or already translated; examples in the sheet locale). */
  numberItems: NumberMenuEntry[];
  onCustomFormat: (kind: CustomFormatKind) => void;
  fontFamilies?: FontFamily[];
  /** A Borders preset with the sticky line style and colour (null = default ink). */
  onBorders: (preset: BorderPreset10, line: BorderLine, color: string | null) => void;
  onClearFormat: () => void;
  onDecimals: (delta: 1 | -1) => void;
  /** 1 = 100%. */
  zoom: number;
  onZoom: (z: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPrint: () => void;
  /** Paint format: off, armed for one paste, or sticky (double-click). */
  paint: "off" | "once" | "sticky";
  /** Click → onPaint(false) (toggle once/off), double-click → onPaint(true) (sticky). */
  onPaint: (sticky: boolean) => void;
  /** The selection is (or contains) a merged block. */
  merged: boolean;
  /** The selection spans more than one cell. */
  canMerge: boolean;
  onMerge: (kind: MergeKind) => void;
  onLink: () => void;
  onComment: () => void;
  onChart: () => void;
  filterOn: boolean;
  onFilter: () => void;
  filterViews: { id: string; name: string }[];
  activeViewId: string | null;
  groupByColumns: { colId: string; label: string }[];
  onFilterView: (action: FilterViewAction) => void;
  onFunction: (name: string) => void;
  /** Σ ▸ categories (English category names are passed through t()). */
  functionCatalog: { category: string; names: string[] }[];
  onSearchMenus: () => void;
  /** The 8 STANDARD colours of the sheet theme (default: Sheets' standard theme). */
  themeColors?: string[];
  onEditTheme?: () => void;
  onOpenCF?: () => void;
  onOpenAlternating?: () => void;
  /** The "$" button's format and symbol (default Rupiah: nf "idr", 0 decimals, "Rp"). */
  currency?: { nf: NumberFormatKind; symbol: string; dp?: number };
  /** A cell editor is open (Sheets disables zoom meanwhile). */
  editing?: boolean;
};

const ZOOMS = [50, 75, 90, 100, 125, 150, 200];
const MORE_W = 36;

/** After a toolbar input commits, typing goes back to the grid (it owns the keyboard). */
function refocusGrid() {
  document.querySelector<HTMLElement>('[role="grid"][tabindex="0"]')?.focus({ preventScroll: true });
}

/**
 * The formatting toolbar, in Google Sheets' exact order so muscle memory carries over (inventory §2):
 * search menus · undo redo print paint-format · zoom · $ % .0 .00 123 · font · size · B I S A ·
 * fill borders merge · align valign wrap rotate · link comment chart · filter, filter views · Σ.
 * One row: groups that don't fit (sidebar open, phone) move, whole, into a trailing "⋮" popover.
 */
export function SheetToolbar(p: ToolbarProps) {
  const { t } = useLang();
  const st = p.style ?? {};
  const off = !p.canEdit;
  const [border, setBorder] = useState<BorderPrefs>(() => loadBorderPrefs());
  const setBorderPrefs = (next: BorderPrefs) => { setBorder(next); saveBorderPrefs(next); };

  const sep = <Sep />;
  const groups: ReactNode[] = [
    // 0 — menu search
    <Btn key="search" label={t("Search the menus (Alt+/)")} onClick={p.onSearchMenus}><Search /></Btn>,

    // 1 — history, print, paint format
    <>
      <Btn label={t("Undo (Ctrl+Z)")} disabled={off || !p.canUndo} onClick={p.onUndo}><Undo2 /></Btn>
      <Btn label={t("Redo (Ctrl+Y)")} disabled={off || !p.canRedo} onClick={p.onRedo}><Redo2 /></Btn>
      <Btn label={t("Print (Ctrl+P)")} onClick={p.onPrint}><Printer /></Btn>
      <Btn
        label={p.paint === "sticky" ? t("Paint format (on until you press Esc)") : t("Paint format")}
        disabled={off}
        active={p.paint !== "off"}
        onClick={(e) => { if (e.detail < 2) p.onPaint(false); }}
        onDoubleClick={() => p.onPaint(true)}
      >
        <PaintRoller />
      </Btn>
    </>,

    // 2 — zoom
    <>
      {sep}
      <Combo
        label={t("Zoom")}
        value={Math.round(p.zoom * 100)}
        suffix="%"
        min={25}
        max={400}
        widthClass="w-11"
        disabled={p.editing}
        items={ZOOMS}
        onCommit={(z) => p.onZoom(z / 100)}
      />
    </>,

    // 3 — number formats
    <>
      {sep}
      <CurrencyBtn p={p} />
      <Btn label={t("Format as percent")} disabled={off} active={st.nf === "pct"} onClick={() => p.onStyle({ nf: st.nf === "pct" ? null : "pct" })}><Percent /></Btn>
      <Btn label={t("Decrease decimal places")} disabled={off} onClick={() => p.onDecimals(-1)}><DecimalsArrowLeft /></Btn>
      <Btn label={t("Increase decimal places")} disabled={off} onClick={() => p.onDecimals(1)}><DecimalsArrowRight /></Btn>
      <Menu label={t("More formats")} disabled={off} bare trigger={<span className="px-0.5 text-[11px] font-semibold tabular-nums">123</span>} panelClassName="min-w-64">
        {(close) => p.numberItems.map((it, i) => {
          if (it === "sep") return <MenuSep key={`s${i}`} />;
          const custom = it.nf === "customNumber" || it.nf === "customDate" || it.nf === "customCurrency";
          return (
            <MenuItem
              key={it.nf}
              active={!custom && (st.nf ?? "auto") === it.nf}
              hint={it.example}
              onClick={() => {
                close();
                if (custom) p.onCustomFormat(it.nf as CustomFormatKind);
                else p.onStyle({ nf: it.nf === "auto" ? null : it.nf, pt: null, ...(it.nf === "auto" ? { dp: null } : {}) });
              }}
            >
              {t(it.label)}
            </MenuItem>
          );
        })}
      </Menu>
    </>,

    // 4 — font family
    <>
      {sep}
      <FontMenu p={p} />
    </>,

    // 5 — font size
    <>
      {sep}
      <FontSize p={p} />
    </>,

    // 6 — text style + text colour
    <>
      {sep}
      <Btn label={t("Bold (Ctrl+B)")} disabled={off} active={Boolean(st.b)} onClick={() => p.onStyle({ b: st.b ? null : 1 })}><Bold /></Btn>
      <Btn label={t("Italic (Ctrl+I)")} disabled={off} active={Boolean(st.i)} onClick={() => p.onStyle({ i: st.i ? null : 1 })}><Italic /></Btn>
      <Btn label={t("Strikethrough (Alt+Shift+5)")} disabled={off} active={Boolean(st.s)} onClick={() => p.onStyle({ s: st.s ? null : 1 })}><Strikethrough /></Btn>
      <ColorMenuButton
        label={t("Text colour")}
        disabled={off}
        value={st.fc}
        defaultBar="var(--foreground)"
        icon={<span className="text-[14px] font-semibold leading-none">A</span>}
        theme={p.themeColors}
        onEditTheme={p.onEditTheme}
        footer={p.onOpenCF ? { cf: p.onOpenCF } : undefined}
        onPick={(c) => p.onStyle({ fc: c })}
      />
    </>,

    // 7 — fill, borders, merge
    <>
      {sep}
      <ColorMenuButton
        label={t("Fill colour")}
        disabled={off}
        value={st.bg}
        icon={<PaintBucket />}
        theme={p.themeColors}
        onEditTheme={p.onEditTheme}
        footer={p.onOpenCF || p.onOpenAlternating ? { cf: p.onOpenCF, alternating: p.onOpenAlternating } : undefined}
        onPick={(c) => p.onStyle({ bg: c })}
      />
      <Menu label={t("Borders")} disabled={off} bare trigger={<BorderGlyph preset="all" />} panelClassName="min-w-0">
        {(close) => (
          <BordersPanel
            line={border.line}
            color={border.color}
            onLine={(line) => setBorderPrefs({ ...border, line })}
            onColor={(color) => setBorderPrefs({ ...border, color })}
            onApply={(preset) => { p.onBorders(preset, border.line, border.color); close(); }}
          />
        )}
      </Menu>
      <MergeControl p={p} />
    </>,

    // 8 — alignment, wrapping, rotation, clear formatting
    <>
      {sep}
      <AlignMenus p={p} />
      <WrapMenu p={p} />
      <RotationMenu p={p} />
      <Btn label={t("Clear formatting (Ctrl+\\)")} disabled={off} onClick={p.onClearFormat}><RemoveFormatting /></Btn>
    </>,

    // 9 — insert
    <>
      {sep}
      <Btn label={t("Insert link (Ctrl+K)")} disabled={off} onClick={p.onLink}><Link2 /></Btn>
      <Btn label={t("Insert comment (Ctrl+Alt+M)")} onClick={p.onComment}><MessageSquarePlus /></Btn>
      <Btn label={t("Insert chart")} disabled={off} onClick={p.onChart}><ChartColumn /></Btn>
    </>,

    // 10 — filter + filter views
    <>
      <Btn label={p.filterOn ? t("Remove filter") : t("Create a filter")} active={p.filterOn} onClick={p.onFilter}><Funnel /></Btn>
      <FilterViewsMenu p={p} />
    </>,

    // 11 — functions
    <FunctionsMenu key="fx" p={p} />,
  ];

  return <OverflowRow label={t("Formatting")} moreLabel={t("More")} groups={groups} />;
}

// ── Overflow: whole groups move into "⋮" from the end ─────────────────────────────────────────────

function OverflowRow({ label, moreLabel, groups }: { label: string; moreLabel: string; groups: ReactNode[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const groupEls = useRef<(HTMLDivElement | null)[]>([]);
  const widths = useRef<number[]>([]);
  const [fit, setFit] = useState(groups.length);
  const [moreAt, setMoreAt] = useState<DOMRect | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const n = groups.length;

  const recompute = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    groupEls.current.forEach((el, i) => { if (el) widths.current[i] = el.offsetWidth + 2; });
    const cs = getComputedStyle(root);
    const avail = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const w = (i: number) => widths.current[i] ?? 32;
    let total = 0;
    for (let i = 0; i < n; i++) total += w(i);
    let next = n;
    if (total > avail) {
      next = 0;
      let acc = 0;
      while (next < n && acc + w(next) <= avail - MORE_W) { acc += w(next); next++; }
    }
    setFit((f) => (f === next ? f : next));
  }, [n]);

  useLayoutEffect(() => { recompute(); });
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(root);
    return () => ro.disconnect();
  }, [recompute]);
  useEffect(() => { if (fit >= n) setMoreAt(null); }, [fit, n]);

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label={label}
      className="flex min-h-9 min-w-0 flex-nowrap items-center overflow-hidden rounded-xl border border-border bg-card px-1.5 py-1"
      // Toolbar buttons must not steal focus from the grid (or commit an open cell editor).
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); }}
    >
      {groups.slice(0, fit).map((g, i) => (
        <div key={i} ref={(el) => { groupEls.current[i] = el; }} className="flex shrink-0 items-center gap-0.5">{g}</div>
      ))}
      {fit < n && (
        <>
          <span className="flex-1" />
          <button
            ref={moreRef}
            type="button"
            title={moreLabel}
            aria-label={moreLabel}
            aria-haspopup="true"
            aria-expanded={Boolean(moreAt)}
            onClick={() => { const r = moreRef.current?.getBoundingClientRect(); setMoreAt(moreAt || !r ? null : r); }}
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-md text-foreground/80 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              moreAt && "bg-muted text-foreground",
            )}
          >
            <EllipsisVertical className="h-4 w-4" />
          </button>
        </>
      )}
      {moreAt && fit < n && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setMoreAt(null)} />
          <Floating
            anchor={{ rect: moreAt }}
            role="toolbar"
            className="max-w-[min(92vw,440px)] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-pop"
            onKeyDown={(e) => { if (e.key === "Escape") setMoreAt(null); }}
          >
            <div
              className="flex flex-wrap items-center gap-y-1"
              onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); }}
            >
              {groups.slice(fit).map((g, i) => (
                <div key={fit + i} className="flex shrink-0 items-center gap-0.5">{g}</div>
              ))}
            </div>
          </Floating>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────────────────────────

function Sep() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function Btn({ label, onClick, onDoubleClick, disabled, active, children, className }: {
  label: string;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "grid h-7 min-w-7 shrink-0 place-items-center rounded-md px-1 text-foreground/80 transition-colors [&_svg]:h-4 [&_svg]:w-4",
        "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-35",
        active && "bg-accent text-accent-foreground hover:bg-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A typeable number box with a ▾ list (zoom %, font size). Enter/blur commits, Esc reverts. */
function Combo({ label, value, suffix = "", min, max, items, onCommit, disabled, widthClass, step, onStep, stepLabels }: {
  label: string;
  value: number;
  suffix?: string;
  min: number;
  max: number;
  items: number[];
  onCommit: (n: number) => void;
  disabled?: boolean;
  widthClass: string;
  /** − / + buttons around the box (font size). */
  step?: boolean;
  onStep?: (delta: 1 | -1) => void;
  stepLabels?: [string, string];
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(",", ".").replace(/[^\d.]/g, ""));
    setDraft(null);
    if (Number.isFinite(v)) onCommit(Math.min(max, Math.max(min, Math.round(v * 2) / 2)));
  };
  return (
    <div className="flex shrink-0 items-center">
      {step && <Btn label={stepLabels?.[0] ?? "-"} disabled={disabled} onClick={() => onStep?.(-1)}><Minus /></Btn>}
      <span className={cn("flex items-center rounded-md", step ? "border border-border" : "hover:bg-muted")}>
        <input
          value={draft ?? shown}
          disabled={disabled}
          aria-label={label}
          title={label}
          inputMode="decimal"
          onFocus={(e) => { setDraft(String(value)); const el = e.currentTarget; window.requestAnimationFrame(() => el.select()); }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); commit(); refocusGrid(); }
            if (e.key === "Escape") { e.preventDefault(); setDraft(null); refocusGrid(); }
          }}
          className={cn("h-6 bg-transparent px-1 text-center text-xs tabular-nums outline-none disabled:opacity-35", widthClass)}
        />
        <Menu label={label} disabled={disabled} trigger={null} className="h-6 px-0.5" panelClassName="min-w-20">
          {(close) => items.map((z) => (
            <MenuItem key={z} active={value === z} onClick={() => { onCommit(z); close(); }}>{z}{suffix}</MenuItem>
          ))}
        </Menu>
      </span>
      {step && <Btn label={stepLabels?.[1] ?? "+"} disabled={disabled} onClick={() => onStep?.(1)}><Plus /></Btn>}
    </div>
  );
}

function CurrencyBtn({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  const st = p.style ?? {};
  const cur = p.currency ?? { nf: "idr" as NumberFormatKind, symbol: "Rp", dp: 0 };
  const on = st.nf === cur.nf;
  return (
    <Btn label={t("Format as currency")} disabled={!p.canEdit} active={on}
      onClick={() => p.onStyle(on ? { nf: null, dp: null } : { nf: cur.nf, dp: cur.dp ?? null, pt: null })}>
      <span className="text-[11px] font-bold">{cur.symbol}</span>
    </Btn>
  );
}

function FontMenu({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  const families = p.fontFamilies ?? FONT_FAMILIES;
  const ff = p.style?.ff;
  const isDefault = !ff || ff === DEFAULT_FONT;
  const defaultLabel = t("Default (Sans Serif)");
  return (
    <Menu
      label={t("Font")}
      disabled={!p.canEdit}
      className="w-[104px] justify-between"
      panelClassName="min-w-52"
      trigger={<span className="min-w-0 flex-1 truncate text-left text-xs" style={{ fontFamily: fontStack(ff, families) }}>{isDefault ? defaultLabel : ff}</span>}
    >
      {(close) => (
        <>
          <MenuLabel>{t("Theme")}</MenuLabel>
          <MenuItem active={isDefault} onClick={() => { p.onStyle({ ff: null }); close(); }}>{defaultLabel}</MenuItem>
          <MenuSep />
          {families.filter((f) => f.name !== DEFAULT_FONT).map((f) => (
            <MenuItem key={f.name} active={!isDefault && ff!.toLowerCase() === f.name.toLowerCase()} style={{ fontFamily: f.css }}
              onClick={() => { p.onStyle({ ff: f.name }); close(); }}>
              {f.name}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function FontSize({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  const pt = fontPt(p.style);
  const set = (v: number) => {
    const n = Math.min(MAX_FONT_PT, Math.max(MIN_FONT_PT, v));
    p.onStyle({ fp: n === DEFAULT_FONT_PT ? null : n, fs: null });
  };
  return (
    <Combo
      label={t("Font size")}
      value={pt}
      min={MIN_FONT_PT}
      max={MAX_FONT_PT}
      widthClass="w-8"
      items={FONT_SIZES_PT}
      disabled={!p.canEdit}
      onCommit={set}
      step
      stepLabels={[t("Decrease font size (Ctrl+Shift+,)"), t("Increase font size (Ctrl+Shift+.)")]}
      onStep={(d) => set(Math.floor(pt) + d)}
    />
  );
}

function MergeControl({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  const off = !p.canEdit;
  const disabled = off || (!p.canMerge && !p.merged);
  return (
    <span className="flex shrink-0 items-center">
      <Btn
        label={p.merged ? t("Unmerge cells") : t("Merge cells")}
        disabled={disabled}
        active={p.merged}
        onClick={() => p.onMerge(p.merged ? "unmerge" : "all")}
        className="rounded-r-none"
      >
        {p.merged ? <TableCellsSplit /> : <TableCellsMerge />}
      </Btn>
      <Menu label={t("Select merge type")} disabled={disabled} trigger={null} className="rounded-l-none px-0.5">
        {(close) => (
          <>
            <MenuItem disabled={!p.canMerge} onClick={() => { p.onMerge("all"); close(); }}>{t("Merge all")}</MenuItem>
            <MenuItem disabled={!p.canMerge} onClick={() => { p.onMerge("vertical"); close(); }}>{t("Merge vertically")}</MenuItem>
            <MenuItem disabled={!p.canMerge} onClick={() => { p.onMerge("horizontal"); close(); }}>{t("Merge horizontally")}</MenuItem>
            <MenuItem disabled={!p.merged} onClick={() => { p.onMerge("unmerge"); close(); }}>{t("Unmerge")}</MenuItem>
          </>
        )}
      </Menu>
    </span>
  );
}

/** A row of icon choices inside a dropdown (alignment, wrapping, rotation — as Sheets draws them). */
function Strip({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5 px-1.5 py-0.5" onKeyDown={(e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    items[(at + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length]?.focus();
  }}>{children}</div>;
}
function StripBtn({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-md text-foreground/80 hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none [&_svg]:h-4 [&_svg]:w-4",
        on && "bg-accent text-accent-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function AlignMenus({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  const st = p.style ?? {};
  const off = !p.canEdit;
  const H = [["l", t("Left (Ctrl+Shift+L)"), AlignLeft], ["c", t("Centre (Ctrl+Shift+E)"), AlignCenter], ["r", t("Right (Ctrl+Shift+R)"), AlignRight]] as const;
  const V = [["t", t("Top"), AlignVerticalJustifyStart], ["m", t("Middle"), AlignVerticalJustifyCenter], ["b", t("Bottom"), AlignVerticalJustifyEnd]] as const;
  const HIcon = H.find(([k]) => k === st.ha)?.[2] ?? AlignLeft;
  const va = st.va ?? "b";
  const VIcon = V.find(([k]) => k === va)?.[2] ?? AlignVerticalJustifyEnd;
  return (
    <>
      <Menu label={t("Horizontal align")} disabled={off} trigger={<HIcon className="h-4 w-4" />} panelClassName="min-w-0">
        {(close) => (
          <Strip>
            {H.map(([k, label, Icon]) => (
              <StripBtn key={k} label={label} on={st.ha === k} onClick={() => { p.onStyle({ ha: k }); close(); }}><Icon /></StripBtn>
            ))}
          </Strip>
        )}
      </Menu>
      <Menu label={t("Vertical align")} disabled={off} trigger={<VIcon className="h-4 w-4" />} panelClassName="min-w-0">
        {(close) => (
          <Strip>
            {V.map(([k, label, Icon]) => (
              <StripBtn key={k} label={label} on={va === k} onClick={() => { p.onStyle({ va: k === "b" ? null : k }); close(); }}><Icon /></StripBtn>
            ))}
          </Strip>
        )}
      </Menu>
    </>
  );
}

function WrapGlyph({ mode }: { mode: WrapMode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4">
      {mode === "o" && <><path d="M11 2.5V13.5" opacity={0.55} /><path d="M2 8H14.5" /><path d="M12.5 6l2 2-2 2" /></>}
      {mode === "w" && <><path d="M14 2.5V13.5" opacity={0.55} /><path d="M2 4.5H11.5" /><path d="M2 8.5H10a2 2 0 0 1 0 4H6.5" /><path d="M8 11l-1.5 1.5L8 14" /><path d="M2 12.5h2" /></>}
      {mode === "c" && <><path d="M11 2.5V13.5" opacity={0.55} /><path d="M2 8H9.5" /></>}
    </svg>
  );
}

function WrapMenu({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  const mode = wrapMode(p.style);
  const opts: [WrapMode, string][] = [["o", t("Overflow")], ["w", t("Wrap")], ["c", t("Clip")]];
  return (
    <Menu label={t("Text wrapping")} disabled={!p.canEdit} trigger={<WrapGlyph mode={mode} />} panelClassName="min-w-0">
      {(close) => (
        <Strip>
          {opts.map(([m, label]) => (
            <StripBtn key={m} label={label} on={mode === m} onClick={() => { p.onStyle({ wr: m === "o" ? null : m, w: null }); close(); }}>
              <WrapGlyph mode={m} />
            </StripBtn>
          ))}
        </Strip>
      )}
    </Menu>
  );
}

function RotGlyph({ rt }: { rt: Rotation }) {
  if (rt === "v") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4" fill="currentColor">
        <text x="6.5" y="7" textAnchor="middle" fontSize="7" fontWeight="700" fontFamily="system-ui, sans-serif">a</text>
        <text x="6.5" y="14" textAnchor="middle" fontSize="7" fontWeight="700" fontFamily="system-ui, sans-serif">b</text>
        <path d="M12.5 2.5V13.5M10.8 11.8l1.7 1.7 1.7-1.7" stroke="currentColor" strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
      <g transform={`rotate(${-rt} 8 8)`}>
        <text x="8" y="9.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fontFamily="system-ui, sans-serif" fill="currentColor">ab</text>
        <path d="M2.5 12.5H13.5" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      </g>
    </svg>
  );
}

function RotationMenu({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  const rt: Rotation = p.style?.rt ?? 0;
  const opts: [Rotation, string][] = [
    [0, t("None")], [45, t("Tilt up")], [-45, t("Tilt down")], ["v", t("Stack vertically")], [90, t("Rotate up")], [-90, t("Rotate down")],
  ];
  const set = (v: Rotation) => p.onStyle({ rt: v === 0 ? null : v });
  return (
    <Menu label={t("Text rotation")} disabled={!p.canEdit} trigger={<RotGlyph rt={rt} />} panelClassName="min-w-0">
      {(close) => (
        <Strip>
          {opts.map(([v, label]) => (
            <StripBtn key={String(v)} label={label} on={rt === v} onClick={() => { set(v); close(); }}><RotGlyph rt={v} /></StripBtn>
          ))}
          <span aria-hidden className="mx-1 h-6 w-px bg-border" />
          <AngleInput value={typeof rt === "number" ? rt : 0} label={t("Custom angle")} onCommit={(deg) => { set(deg); close(); }} />
        </Strip>
      )}
    </Menu>
  );
}

function AngleInput({ value, label, onCommit }: { value: number; label: string; onCommit: (deg: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const commit = (raw = draft) => {
    const v = Math.round(parseFloat(raw.replace(",", ".")));
    if (Number.isFinite(v)) onCommit(Math.max(-90, Math.min(90, v)));
  };
  return (
    <label className="flex items-center gap-0.5 rounded-md border border-border bg-background pr-1.5" title={label}>
      <input
        type="number"
        min={-90}
        max={90}
        step={15}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        className="h-7 w-14 bg-transparent px-1.5 text-xs tabular-nums outline-none"
      />
      <span className="text-xs text-muted-foreground">°</span>
    </label>
  );
}

function FilterViewsMenu({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  return (
    <Menu label={t("Filter views")} active={Boolean(p.activeViewId)} trigger={<ListFilter className="h-4 w-4" />} panelClassName="min-w-60">
      {(close) => (
        <>
          <MenuItem
            disabled={!p.groupByColumns.length}
            submenu={(closeAll) => p.groupByColumns.map((c) => (
              <MenuItem key={c.colId} onClick={() => { closeAll(); p.onFilterView({ kind: "groupBy", colId: c.colId }); }}>{c.label}</MenuItem>
            ))}
          >
            {t("Create group-by filter view")}
          </MenuItem>
          <MenuItem onClick={() => { close(); p.onFilterView({ kind: "create" }); }}>{t("Create new filter view")}</MenuItem>
          {p.filterViews.length > 0 && <MenuSep />}
          {p.filterViews.map((v) => (
            <MenuItem key={v.id} active={p.activeViewId === v.id} onClick={() => { close(); p.onFilterView({ kind: "open", id: v.id }); }}>{v.name}</MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function FunctionsMenu({ p }: { p: ToolbarProps }) {
  const { t } = useLang();
  return (
    <Menu label={t("Functions")} disabled={!p.canEdit} trigger={<Sigma className="h-4 w-4" />} panelClassName="min-w-44">
      {(close) => (
        <>
          {["SUM", "AVERAGE", "COUNT", "MAX", "MIN"].map((fn) => (
            <MenuItem key={fn} onClick={() => { close(); p.onFunction(fn); }}><span className="font-mono">{fn}</span></MenuItem>
          ))}
          {p.functionCatalog.length > 0 && <MenuSep />}
          {p.functionCatalog.map((cat) => (
            <MenuItem
              key={cat.category}
              submenu={(closeAll) => cat.names.map((fn) => (
                <MenuItem key={fn} onClick={() => { closeAll(); p.onFunction(fn); }}><span className="font-mono">{fn}</span></MenuItem>
              ))}
            >
              {t(cat.category)}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

// Re-exported for callers that build their own pickers next to the toolbar.
export { menuKeyNav };

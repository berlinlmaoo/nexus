import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  Baseline, Bold, Check, ChevronDown, DecimalsArrowLeft, DecimalsArrowRight, Filter, Grid2x2, Italic, Link2,
  MessageSquarePlus, PaintBucket, Percent, Redo2, RemoveFormatting, Search, Sigma, SquareDashed, Strikethrough,
  TableCellsMerge, TableCellsSplit, Underline, Undo2, WrapText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import {
  COLOR_NAME, DEFAULT_FONT_SIZE, FONT_SIZES, STYLE_COLORS, SWATCH_CLASS,
  type BorderPreset, type CellStyle, type StyleColor,
} from "./sheet-style";
import { Floating } from "./sheet-float";

export type ToolbarProps = {
  canEdit: boolean;
  /** Formatting of the active cell — what the toggles show as on. */
  style: CellStyle | undefined;
  onStyle: (patch: Partial<Record<keyof CellStyle, unknown>>) => void;
  onBorders: (preset: BorderPreset) => void;
  onClearFormat: () => void;
  onDecimals: (delta: 1 | -1) => void;
  zoom: number;
  onZoom: (z: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** The selection is (or contains) a merged block. */
  merged: boolean;
  canMerge: boolean;
  onMerge: () => void;
  onLink: () => void;
  onComment: () => void;
  filterOn: boolean;
  onFilter: () => void;
  onFunction: (name: string) => void;
  onFind: () => void;
};

const ZOOMS = [50, 75, 90, 100, 125, 150, 200];

/**
 * The formatting toolbar, in the order Sheets uses so muscle memory carries over: history · zoom ·
 * number formats · font size · text style · colours · borders/merge · alignment/wrap · insert ·
 * filter · functions. Drawn with NEXUS tokens and lucide icons.
 */
export function SheetToolbar(p: ToolbarProps) {
  const { t } = useLang();
  const st = p.style ?? {};
  const off = !p.canEdit;
  return (
    <div
      role="toolbar"
      aria-label={t("Formatting")}
      className="flex min-h-9 flex-wrap items-center gap-0.5 rounded-xl border border-border bg-card px-1.5 py-1"
      // Toolbar buttons must not steal focus from the grid (or commit an open cell editor).
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); }}
    >
      <Btn label={t("Undo (Ctrl+Z)")} disabled={off || !p.canUndo} onClick={p.onUndo}><Undo2 /></Btn>
      <Btn label={t("Redo (Ctrl+Y)")} disabled={off || !p.canRedo} onClick={p.onRedo}><Redo2 /></Btn>
      <Sep />
      <Menu
        label={t("Zoom")}
        trigger={<span className="w-11 text-left text-xs tabular-nums">{Math.round(p.zoom * 100)}%</span>}
      >
        {(close) => ZOOMS.map((z) => (
          <MenuItem key={z} active={Math.round(p.zoom * 100) === z} onClick={() => { p.onZoom(z / 100); close(); }}>{z}%</MenuItem>
        ))}
      </Menu>
      <Sep />
      <Btn label={t("Format as Rupiah")} disabled={off} active={st.nf === "idr"} onClick={() => p.onStyle({ nf: st.nf === "idr" ? null : "idr", dp: st.nf === "idr" ? null : 0 })}>
        <span className="text-[11px] font-bold">Rp</span>
      </Btn>
      <Btn label={t("Format as percent")} disabled={off} active={st.nf === "pct"} onClick={() => p.onStyle({ nf: st.nf === "pct" ? null : "pct" })}><Percent /></Btn>
      <Btn label={t("Decrease decimal places")} disabled={off} onClick={() => p.onDecimals(-1)}><DecimalsArrowLeft /></Btn>
      <Btn label={t("Increase decimal places")} disabled={off} onClick={() => p.onDecimals(1)}><DecimalsArrowRight /></Btn>
      <Menu label={t("More formats")} disabled={off} trigger={<span className="text-[11px] font-bold">123</span>}>
        {(close) => ([
          ["auto", t("Automatic"), ""],
          ["num", t("Number"), "1.000,12"],
          ["pct", t("Percent"), "10,12%"],
          ["idr", t("Rupiah"), "Rp 1.000"],
          ["date", t("Date"), "11/10/2026"],
          ["text", t("Plain text"), ""],
        ] as const).map(([nf, label, sample]) => (
          <MenuItem key={nf} active={(st.nf ?? "auto") === nf} hint={sample}
            onClick={() => { p.onStyle({ nf: nf === "auto" ? null : nf, ...(nf === "auto" ? { dp: null } : {}) }); close(); }}>
            {label}
          </MenuItem>
        ))}
      </Menu>
      <Sep />
      <Menu label={t("Font size")} disabled={off} trigger={<span className="w-6 text-left text-xs tabular-nums">{st.fs ?? DEFAULT_FONT_SIZE}</span>}>
        {(close) => FONT_SIZES.map((fs) => (
          <MenuItem key={fs} active={(st.fs ?? DEFAULT_FONT_SIZE) === fs} onClick={() => { p.onStyle({ fs: fs === DEFAULT_FONT_SIZE ? null : fs }); close(); }}>{fs}</MenuItem>
        ))}
      </Menu>
      <Sep />
      <Btn label={t("Bold (Ctrl+B)")} disabled={off} active={Boolean(st.b)} onClick={() => p.onStyle({ b: st.b ? null : 1 })}><Bold /></Btn>
      <Btn label={t("Italic (Ctrl+I)")} disabled={off} active={Boolean(st.i)} onClick={() => p.onStyle({ i: st.i ? null : 1 })}><Italic /></Btn>
      <Btn label={t("Strikethrough (Alt+Shift+5)")} disabled={off} active={Boolean(st.s)} onClick={() => p.onStyle({ s: st.s ? null : 1 })}><Strikethrough /></Btn>
      <Btn label={t("Underline (Ctrl+U)")} disabled={off} active={Boolean(st.u)} onClick={() => p.onStyle({ u: st.u ? null : 1 })}><Underline /></Btn>
      <ColorMenu label={t("Text colour")} disabled={off} value={st.fc} icon={<Baseline />} onPick={(c) => p.onStyle({ fc: c })} />
      <ColorMenu label={t("Fill colour")} disabled={off} value={st.bg} icon={<PaintBucket />} onPick={(c) => p.onStyle({ bg: c })} />
      <Sep />
      <Menu label={t("Borders")} disabled={off} trigger={<Grid2x2 className="h-4 w-4" />}>
        {(close) => ([
          ["all", t("All borders")], ["outer", t("Outer borders")], ["inner", t("Inner borders")],
          ["top", t("Top border")], ["bottom", t("Bottom border")], ["left", t("Left border")], ["right", t("Right border")],
          ["none", t("Clear borders")],
        ] as const).map(([preset, label]) => (
          <MenuItem key={preset} onClick={() => { p.onBorders(preset); close(); }}>{label}</MenuItem>
        ))}
      </Menu>
      <Btn label={p.merged ? t("Unmerge cells") : t("Merge cells")} disabled={off || !p.canMerge} active={p.merged} onClick={p.onMerge}>
        {p.merged ? <TableCellsSplit /> : <TableCellsMerge />}
      </Btn>
      <Sep />
      <Menu label={t("Horizontal align")} disabled={off}
        trigger={st.ha === "c" ? <AlignCenter className="h-4 w-4" /> : st.ha === "r" ? <AlignRight className="h-4 w-4" /> : <AlignLeft className="h-4 w-4" />}>
        {(close) => ([["l", t("Align left"), AlignLeft], ["c", t("Align centre"), AlignCenter], ["r", t("Align right"), AlignRight]] as const).map(([ha, label, Icon]) => (
          <MenuItem key={ha} active={st.ha === ha} icon={<Icon className="h-3.5 w-3.5" />} onClick={() => { p.onStyle({ ha: st.ha === ha ? null : ha }); close(); }}>{label}</MenuItem>
        ))}
      </Menu>
      <Menu label={t("Vertical align")} disabled={off}
        trigger={st.va === "t" ? <AlignVerticalJustifyStart className="h-4 w-4" /> : st.va === "m" ? <AlignVerticalJustifyCenter className="h-4 w-4" /> : <AlignVerticalJustifyEnd className="h-4 w-4" />}>
        {(close) => ([["t", t("Align top"), AlignVerticalJustifyStart], ["m", t("Align middle"), AlignVerticalJustifyCenter], ["b", t("Align bottom"), AlignVerticalJustifyEnd]] as const).map(([va, label, Icon]) => (
          <MenuItem key={va} active={(st.va ?? "b") === va} icon={<Icon className="h-3.5 w-3.5" />} onClick={() => { p.onStyle({ va: va === "b" ? null : va }); close(); }}>{label}</MenuItem>
        ))}
      </Menu>
      <Btn label={t("Wrap text")} disabled={off} active={Boolean(st.w)} onClick={() => p.onStyle({ w: st.w ? null : 1 })}><WrapText /></Btn>
      <Btn label={t("Clear formatting (Ctrl+\\)")} disabled={off} onClick={p.onClearFormat}><RemoveFormatting /></Btn>
      <Sep />
      <Btn label={t("Insert link (Ctrl+K)")} disabled={off} onClick={p.onLink}><Link2 /></Btn>
      <Btn label={t("Insert comment (Ctrl+Alt+M)")} onClick={p.onComment}><MessageSquarePlus /></Btn>
      <Btn label={t("Filter this column")} active={p.filterOn} onClick={p.onFilter}><Filter /></Btn>
      <Menu label={t("Functions")} disabled={off} trigger={<Sigma className="h-4 w-4" />}>
        {(close) => ["SUM", "AVERAGE", "COUNT", "MAX", "MIN", "IF", "VLOOKUP", "XLOOKUP", "TODAY"].map((fn) => (
          <MenuItem key={fn} onClick={() => { p.onFunction(fn); close(); }}><span className="font-mono">{fn}</span></MenuItem>
        ))}
      </Menu>
      <div className="ml-auto flex items-center">
        <Btn label={t("Find and replace (Ctrl+F)")} onClick={p.onFind}><Search /></Btn>
      </div>
    </div>
  );
}

function Sep() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function Btn({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid h-7 min-w-7 shrink-0 place-items-center rounded-md px-1 text-foreground/80 transition-colors [&_svg]:h-4 [&_svg]:w-4",
        "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-35",
        active && "bg-accent text-accent-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** A toolbar button that opens a small menu (portaled: the toolbar sits above overflow containers). */
export function Menu({ label, trigger, disabled, children }: {
  label: string; trigger: ReactNode; disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const close = () => setAt(null);
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at]);
  return (
    <>
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        disabled={disabled}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          setAt(at || !r ? null : r);
        }}
        className={cn(
          "flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-foreground/80 transition-colors",
          "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35",
          at && "bg-muted text-foreground",
        )}
      >
        {trigger}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {at && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={close} />
          <Floating
            anchor={{ rect: at }}
            role="menu"
            className="min-w-40 rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop"
          >
            {children(close)}
          </Floating>
        </>,
        document.body,
      )}
    </>
  );
}

export function MenuItem({ children, onClick, active, hint, icon, danger, disabled }: {
  children: ReactNode; onClick: () => void; active?: boolean; hint?: string; icon?: ReactNode; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-40",
        danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted",
      )}
    >
      <span className="grid w-3.5 shrink-0 place-items-center text-muted-foreground">
        {active ? <Check className="h-3.5 w-3.5 text-foreground" /> : icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 pl-3 text-2xs text-muted-foreground tabular-nums">{hint}</span>}
    </button>
  );
}

function ColorMenu({ label, value, icon, onPick, disabled }: {
  label: string; value: StyleColor | undefined; icon: ReactNode; onPick: (c: StyleColor | null) => void; disabled?: boolean;
}) {
  const { t } = useLang();
  return (
    <Menu
      label={label}
      disabled={disabled}
      trigger={
        <span className="relative grid h-5 w-5 place-items-center [&_svg]:h-4 [&_svg]:w-4">
          {icon}
          <span className={cn("absolute -bottom-0.5 left-0.5 right-0.5 h-1 rounded-sm", value ? SWATCH_CLASS[value] : "bg-transparent")} />
        </span>
      }
    >
      {(close) => (
        <div className="px-2 py-1.5">
          <div className="grid grid-cols-5 gap-1.5">
            {STYLE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={t(COLOR_NAME[c])}
                aria-label={t(COLOR_NAME[c])}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(c); close(); }}
                className={cn("h-6 w-6 rounded-full border border-border transition-transform hover:scale-110", SWATCH_CLASS[c],
                  value === c && "ring-2 ring-ring ring-offset-2 ring-offset-popover")}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onPick(null); close(); }}
            className="mt-2 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SquareDashed className="h-3.5 w-3.5" /> {t("Reset")}
          </button>
        </div>
      )}
    </Menu>
  );
}

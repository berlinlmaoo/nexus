import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { BORDER_LINES, type BorderLine } from "@/lib/sheet-model";
import { toHex } from "@/lib/sheet-palette";
import { Floating } from "./sheet-float";
import { ColorPicker } from "./ColorPicker";
import type { BorderPreset10 } from "./sheet-style";

export type { BorderPreset10 } from "./sheet-style";

/** English source labels (shown through t()). */
export const BORDER_PRESET_LABEL: Record<BorderPreset10, string> = {
  all: "All borders",
  inner: "Inner borders",
  horizontal: "Horizontal borders",
  vertical: "Vertical borders",
  outer: "Outer borders",
  left: "Left border",
  top: "Top border",
  right: "Right border",
  bottom: "Bottom border",
  clear: "Clear borders",
};
export const BORDER_LINE_LABEL: Record<BorderLine, string> = {
  thin: "Thin", medium: "Medium", thick: "Thick", dotted: "Dotted", dashed: "Dashed", double: "Double",
};

const ROW1: BorderPreset10[] = ["all", "inner", "horizontal", "vertical", "outer"];
const ROW2: BorderPreset10[] = ["left", "top", "right", "bottom", "clear"];

// ── Sticky choice (per device) ───────────────────────────────────────────────────────────────────

const PREFS_KEY = "nexus-sheet-border";
export type BorderPrefs = { line: BorderLine; color: string | null };
export function loadBorderPrefs(): BorderPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<BorderPrefs>;
    return {
      line: raw.line && BORDER_LINES.includes(raw.line) ? raw.line : "thin",
      color: toHex(raw.color ?? null),
    };
  } catch {
    return { line: "thin", color: null };
  }
}
export function saveBorderPrefs(p: BorderPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// ── Glyphs: a 3×3 cell drawn faint, the preset's lines drawn solid (one stroke for all ten) ─────────

type Seg = "t" | "b" | "l" | "r" | "h" | "v";
const SEG_PATH: Record<Seg, string> = { t: "M2.5 2.5H13.5", b: "M2.5 13.5H13.5", l: "M2.5 2.5V13.5", r: "M13.5 2.5V13.5", h: "M2.5 8H13.5", v: "M8 2.5V13.5" };
const PRESET_SEGS: Record<BorderPreset10, Seg[]> = {
  all: ["t", "b", "l", "r", "h", "v"], inner: ["h", "v"], horizontal: ["h"], vertical: ["v"], outer: ["t", "b", "l", "r"],
  left: ["l"], top: ["t"], right: ["r"], bottom: ["b"], clear: [],
};

export function BorderGlyph({ preset, className }: { preset: BorderPreset10; className?: string }) {
  const on = new Set(PRESET_SEGS[preset]);
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="square" aria-hidden className={cn("h-4 w-4", className)}>
      {(Object.keys(SEG_PATH) as Seg[]).map((s) => on.has(s)
        ? <path key={s} d={SEG_PATH[s]} strokeWidth={1.6} />
        : <path key={s} d={SEG_PATH[s]} strokeWidth={1} strokeDasharray="1 1.5" opacity={0.45} />)}
    </svg>
  );
}

export function LineSample({ line, className }: { line: BorderLine; className?: string }) {
  const w = line === "medium" ? 2 : line === "thick" ? 3 : 1;
  return (
    <svg viewBox="0 0 48 8" className={cn("h-2 w-12", className)} aria-hidden>
      {line === "double" ? (
        <><path d="M0 2.5H48" stroke="currentColor" strokeWidth={1} /><path d="M0 5.5H48" stroke="currentColor" strokeWidth={1} /></>
      ) : (
        <path d="M0 4H48" stroke="currentColor" strokeWidth={w}
          strokeDasharray={line === "dotted" ? "1 2" : line === "dashed" ? "4 2" : undefined} />
      )}
    </svg>
  );
}

/**
 * The Borders dropdown content (Sheets: two rows of five presets, then Border colour ✎▾ and Border
 * style ▾ on the right). The colour and style are owned by the caller and stick across clicks.
 */
export function BordersPanel({ onApply, line, color, onLine, onColor }: {
  onApply: (preset: BorderPreset10) => void;
  line: BorderLine;
  color: string | null;
  onLine: (l: BorderLine) => void;
  onColor: (c: string | null) => void;
}) {
  const { t } = useLang();
  const [pop, setPop] = useState<null | { kind: "color" | "style"; rect: DOMRect }>(null);
  const colorBtn = useRef<HTMLButtonElement>(null);
  const styleBtn = useRef<HTMLButtonElement>(null);
  const open = (kind: "color" | "style", el: HTMLButtonElement | null) => {
    if (!el) return;
    setPop((p) => (p?.kind === kind ? null : { kind, rect: el.getBoundingClientRect() }));
  };
  const presetBtn = (preset: BorderPreset10) => (
    <button
      key={preset}
      type="button"
      role="menuitem"
      title={t(BORDER_PRESET_LABEL[preset])}
      aria-label={t(BORDER_PRESET_LABEL[preset])}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onApply(preset)}
      className="grid h-8 w-8 place-items-center rounded-md text-foreground/80 hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
    >
      <BorderGlyph preset={preset} />
    </button>
  );
  return (
    <div className="flex items-stretch gap-1 px-1.5 py-0.5">
      <div className="grid grid-cols-5 gap-0.5">
        {ROW1.map(presetBtn)}
        {ROW2.map(presetBtn)}
      </div>
      <div className="flex flex-col justify-around border-l border-border pl-1">
        <button
          ref={colorBtn}
          type="button"
          title={t("Border colour")}
          aria-label={t("Border colour")}
          aria-haspopup="menu"
          aria-expanded={pop?.kind === "color"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => open("color", colorBtn.current)}
          className={cn("flex h-8 items-center gap-0.5 rounded-md px-1 text-foreground/80 hover:bg-muted hover:text-foreground", pop?.kind === "color" && "bg-muted")}
        >
          <span className="relative grid h-5 w-4 place-items-center">
            <Pencil className="-mt-1 h-3.5 w-3.5" />
            <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-[1px]" style={{ backgroundColor: color ?? "var(--foreground)" }} />
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
        <button
          ref={styleBtn}
          type="button"
          title={t("Border style")}
          aria-label={t("Border style")}
          aria-haspopup="menu"
          aria-expanded={pop?.kind === "style"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => open("style", styleBtn.current)}
          className={cn("flex h-8 items-center gap-0.5 rounded-md px-1 text-foreground/80 hover:bg-muted hover:text-foreground", pop?.kind === "style" && "bg-muted")}
        >
          <LineStackIcon />
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </div>
      {pop && createPortal(
        <>
          <div className="fixed inset-0 z-[62]" onMouseDown={() => setPop(null)} />
          <Floating anchor={{ rect: pop.rect }} role="menu" className="z-[63] rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop">
            {pop.kind === "color" ? (
              <ColorPicker value={color} onPick={(c) => { onColor(c); setPop(null); }} />
            ) : (
              <div className="py-0.5">
                {BORDER_LINES.map((l) => (
                  <PopRow key={l} on={l === line} label={t(BORDER_LINE_LABEL[l])} onClick={() => { onLine(l); setPop(null); }}>
                    <LineSample line={l} />
                  </PopRow>
                ))}
              </div>
            )}
          </Floating>
        </>,
        document.body,
      )}
    </div>
  );
}

function PopRow({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} title={label} aria-label={label}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
      <span className="grid w-3.5 place-items-center">{on && <Check className="h-3.5 w-3.5" />}</span>
      {children}
    </button>
  );
}

function LineStackIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2 3.5H14" strokeWidth={2} />
      <path d="M2 8H14" strokeWidth={1.2} strokeDasharray="2.5 1.5" />
      <path d="M2 12H14" strokeWidth={1.2} strokeDasharray="1 1.5" />
    </svg>
  );
}

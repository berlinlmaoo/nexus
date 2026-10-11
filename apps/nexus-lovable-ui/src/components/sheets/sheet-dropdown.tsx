import { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { isHexColor, readableText } from "@/lib/sheet-palette";
import { CHIP_COLOR_CLASS } from "./sheet-types";
import { Floating } from "./sheet-float";

/**
 * Chip colours for dropdown items. Rules use the formatting palette (red, orange…); dropdown COLUMNS
 * (the older per-column type) use the header palette (rose, amber…). Both resolve here.
 */
const STYLE_CHIP: Record<string, string> = {
  black: "bg-zinc-700 text-white dark:bg-zinc-200 dark:text-zinc-900",
  slate: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  green: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-100",
};
/** The default chip: Sheets' neutral grey. */
export const CHIP_DEFAULT = "bg-muted text-foreground";

/** Classes for a chip colour: legacy names map to a light/dark pair; hex is painted by chipStyle. */
export function chipClass(color: string | undefined): string {
  if (!color) return CHIP_DEFAULT;
  if (isHexColor(color)) return "";
  return CHIP_COLOR_CLASS[color] ?? STYLE_CHIP[color] ?? CHIP_DEFAULT;
}

/** Inline paint for a hex chip colour ("#ffcfc9", as Sheets stores it), with readable text on top. */
export function chipStyle(color: string | undefined): CSSProperties | undefined {
  return color && isHexColor(color) ? { backgroundColor: color, color: readableText(color) } : undefined;
}

/**
 * A dropdown cell as Sheets draws it: one rounded chip per picked item with a ▾ (an empty grey chip
 * when nothing is picked), or plain text with a ▾ ("arrow" style), or just the text ("plain").
 */
export function DropdownCell({ picked, colors, display, canEdit, wrap, onOpen }: {
  picked: string[];
  colors?: Record<string, string>;
  display: "chip" | "arrow" | "plain";
  canEdit: boolean;
  wrap: boolean;
  onOpen: () => void;
}) {
  if (display === "plain") return <span className={cn("block", wrap ? "whitespace-pre-wrap break-words" : "truncate")}>{picked.join(", ")}</span>;
  if (display === "arrow") {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className={cn("min-w-0 flex-1", wrap ? "whitespace-pre-wrap break-words" : "truncate")}>{picked.join(", ")}</span>
        {canEdit && (
          <button type="button" tabIndex={-1} onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onOpen(); }}
            className="shrink-0 rounded text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
        )}
      </span>
    );
  }
  return (
    <span
      onMouseDown={(e) => { if (canEdit && e.button === 0 && !e.shiftKey) { e.stopPropagation(); e.preventDefault(); onOpen(); } }}
      // Only the chips open the list (like Sheets); the rest of the cell just selects it.
      className={cn("inline-flex max-w-full min-w-0 items-center gap-1 align-middle", wrap ? "flex-wrap" : "overflow-hidden", canEdit && "cursor-pointer")}
    >
      {picked.length === 0 ? (
        <span className={cn("inline-flex h-5 w-14 items-center justify-end rounded-full px-1.5", CHIP_DEFAULT)}>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </span>
      ) : picked.map((v, i) => (
        <span key={`${v}${i}`} style={chipStyle(colors?.[v])} className={cn("inline-flex h-5 max-w-full shrink-0 items-center gap-0.5 rounded-full pl-2 pr-1 text-[12px] font-medium leading-5", chipClass(colors?.[v]))}>
          <span className="truncate">{v}</span>
          {i === picked.length - 1 && <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />}
        </span>
      ))}
    </span>
  );
}

/**
 * The list a dropdown cell opens: search box, the items as chips, ticks for what's picked. One pick
 * closes it; with multiple selections it stays open until Done (or a click outside).
 */
export function DropdownPicker({ anchor, options, colors, picked: initial, multiple, onCommit, onClose }: {
  anchor: DOMRect;
  options: string[];
  colors?: Record<string, string>;
  picked: string[];
  multiple: boolean;
  onCommit: (values: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(initial);
  const [hi, setHi] = useState(0);
  // Values already in the cell that the list no longer offers still show (ticked), never dropped.
  const all = useMemo(() => [...options, ...initial.filter((v) => !options.includes(v))], [options, initial]);
  const shown = all.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (v: string) => {
    if (!multiple) { onCommit(picked[0] === v ? [] : [v]); return; }
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  };
  const finish = () => (multiple ? onCommit(picked) : onClose());
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={finish} />
      <Floating
        anchor={{ rect: anchor }}
        role="listbox"
        className="w-64 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-pop"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          if (e.key === "Enter") { e.preventDefault(); if (shown[hi] !== undefined) pick(shown[hi]); else finish(); }
        }}
      >
        <label className="mb-1 flex items-center gap-1.5 rounded-lg border border-border bg-background px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            placeholder={t("Search")}
            aria-label={t("Search")}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{all.length ? t("No match.") : t("This dropdown has no items yet.")}</p>}
        {shown.map((o, i) => (
          <button
            key={o}
            type="button"
            role="option"
            aria-selected={picked.includes(o)}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHi(i)}
            onClick={() => pick(o)}
            className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left", i === hi ? "bg-muted" : "")}
          >
            <span className="grid w-3.5 shrink-0 place-items-center">{picked.includes(o) && <Check className="h-3.5 w-3.5" />}</span>
            <span style={chipStyle(colors?.[o])} className={cn("min-w-0 max-w-full truncate rounded-full px-2 text-[12px] font-medium leading-5", chipClass(colors?.[o]))}>{o}</span>
            {!options.includes(o) && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{t("not in the list")}</span>}
          </button>
        ))}
        <div className="mt-1 flex gap-1 border-t border-border pt-1">
          {picked.length > 0 && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onCommit([])}
              className="flex-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{t("Clear")}</button>
          )}
          {multiple && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onCommit(picked)}
              className="flex-1 rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">{t("Done")}</button>
          )}
        </div>
      </Floating>
    </>,
    document.body,
  );
}

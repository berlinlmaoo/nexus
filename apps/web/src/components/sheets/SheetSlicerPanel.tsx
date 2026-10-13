import { useEffect, useRef, useState } from "react";
import { ChevronDown, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { Slicer } from "@/lib/sheet-model";
import { FieldLabel, SidePanel, inputClass, selectClass } from "./sheet-shell";

/** Data ▸ Add a slicer: the "Slicer" sidebar — Data (range, column) and Customise (title, colour). */
export function SlicerPanel({ slicer, columns, sheetName, rangeA1, onChange, onRangeChange, onClose }: {
  slicer: Slicer;
  /** The columns of the slicer's range, labelled by their header text. */
  columns: { colId: string; label: string }[];
  sheetName: string;
  /** The slicer's data range in A1 ("A1:E8"). */
  rangeA1: string;
  onChange: (next: Slicer) => void;
  /** A typed range; return false when it can't be read (the field turns red). */
  onRangeChange: (a1: string) => boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [tab, setTab] = useState<"data" | "custom">("data");
  const [range, setRange] = useState(`${sheetName}!${rangeA1}`);
  const [bad, setBad] = useState(false);
  useEffect(() => { setRange(`${sheetName}!${rangeA1}`); setBad(false); }, [sheetName, rangeA1]);
  const commitRange = () => { if (range.trim() !== `${sheetName}!${rangeA1}`) setBad(!onRangeChange(range.trim())); };
  const tabBtn = (on: boolean) => cn("-mb-px flex-1 border-b-2 px-2 py-2 text-xs font-semibold transition", on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");
  const bg = slicer.bg ?? "#ffffff";

  return (
    <SidePanel title={t("Slicer")} onClose={onClose}>
      <div role="tablist" className="flex border-b border-border px-3">
        <button role="tab" type="button" aria-selected={tab === "data"} onClick={() => setTab("data")} className={tabBtn(tab === "data")}>{t("Data")}</button>
        <button role="tab" type="button" aria-selected={tab === "custom"} onClick={() => setTab("custom")} className={tabBtn(tab === "custom")}>{t("Customise")}</button>
      </div>
      {tab === "data" ? (
        <div className="space-y-4 p-3">
          <div className="space-y-1">
            <FieldLabel htmlFor="sl-range">{t("Data range")}</FieldLabel>
            <input
              id="sl-range"
              value={range}
              placeholder={t("e.g. Sheet1!A2:A5")}
              onChange={(e) => { setRange(e.target.value); setBad(false); }}
              onBlur={commitRange}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitRange(); }}
              aria-invalid={bad}
              className={cn(inputClass, "font-mono", bad && "border-destructive")}
            />
            {bad && <p className="text-[11px] text-destructive">{t("Enter a valid range, e.g. Sheet1!A1:B10")}</p>}
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor="sl-col">{t("Column")}</FieldLabel>
            <select
              id="sl-col"
              value={slicer.colId}
              onChange={(e) => onChange({ ...slicer, colId: e.target.value, crit: undefined })}
              className={selectClass}
            >
              {!columns.some((c) => c.colId === slicer.colId) && <option value={slicer.colId} disabled>{t("Select a column")}</option>}
              {columns.map((c) => <option key={c.colId} value={c.colId}>{c.label}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-3">
          <div className="space-y-1">
            <FieldLabel htmlFor="sl-title">{t("Title")}</FieldLabel>
            <input
              id="sl-title"
              value={slicer.title ?? ""}
              placeholder={columns.find((c) => c.colId === slicer.colId)?.label ?? ""}
              onChange={(e) => onChange({ ...slicer, title: e.target.value || undefined })}
              onKeyDown={(e) => e.stopPropagation()}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor="sl-bg">{t("Background colour")}</FieldLabel>
            <div className="flex items-center gap-2">
              <input id="sl-bg" type="color" value={bg} onChange={(e) => onChange({ ...slicer, bg: e.target.value.toLowerCase() })} className="h-8 w-10 cursor-pointer rounded border border-border bg-background p-0.5" />
              <span className="font-mono text-[11px] uppercase text-muted-foreground">{bg}</span>
              {slicer.bg && <button type="button" onClick={() => onChange({ ...slicer, bg: undefined })} className="ml-auto text-[11px] font-medium text-info hover:underline">{t("Reset")}</button>}
            </div>
          </div>
        </div>
      )}
    </SidePanel>
  );
}

/** Black or white text, whichever reads better on a background colour. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#202124" : "#ffffff";
}

/**
 * The floating slicer chip over the grid ("Status ▾"): filter icon, title, "N of M" when filtered.
 * Click selects it; the caret (or a second click) opens the value list at the returned rect.
 */
export function SlicerChip({ slicer, label, active, selected, onOpen, onSelect, shown, total }: {
  slicer: Slicer;
  /** The column's header text (the title falls back to it). Empty = no column picked yet. */
  label: string;
  /** A filter is applied. */
  active: boolean;
  selected: boolean;
  onOpen: (rect: DOMRect) => void;
  onSelect: () => void;
  /** Values shown / all values, for "N of M" when filtered. */
  shown?: number;
  total?: number;
}) {
  const { t } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const title = slicer.title || label;
  const bg = slicer.bg;
  const style = bg ? { background: bg, color: inkOn(bg) } : undefined;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-haspopup="listbox"
      aria-label={title ? t("Slicer: {name}", { name: title }) : t("Slicer")}
      onClick={() => { if (selected && ref.current) onOpen(ref.current.getBoundingClientRect()); else onSelect(); }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && ref.current) { e.preventDefault(); onOpen(ref.current.getBoundingClientRect()); } }}
      style={{ width: slicer.w ?? 200, ...style }}
      className={cn(
        "flex h-9 cursor-pointer select-none items-center gap-2 rounded-full px-3 text-xs shadow-sm outline-none",
        bg ? "" : "bg-foreground text-background",
        selected && "ring-2 ring-info ring-offset-1",
        "focus-visible:ring-2 focus-visible:ring-info",
      )}
    >
      <Filter className={cn("h-3.5 w-3.5 shrink-0", active && "fill-current")} />
      <span className={cn("min-w-0 flex-1 truncate", !title && "opacity-70")}>{title || t("Select a column first")}</span>
      {active && shown !== undefined && total !== undefined && (
        <span className="shrink-0 text-[10px] opacity-80">{t("{n} of {m}", { n: shown, m: total })}</span>
      )}
      {title && (
        <button
          type="button"
          aria-label={t("Filter by values")}
          onClick={(e) => { e.stopPropagation(); if (ref.current) onOpen(ref.current.getBoundingClientRect()); }}
          className="-mr-1 shrink-0 rounded-full p-0.5 hover:bg-white/15"
        ><ChevronDown className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { NexusSheet } from "@/lib/nexus-api";
import { engineFor, formatWithStyle, isError, isFormulaCell } from "@/lib/sheet-formula";
import {
  COLUMN_TYPE_LABEL, buildSheetData, displayCell, editFormula, editValue, inputToCell, isLinkCell, readMulti, sameCell,
} from "./sheet-types";
import { colLetter } from "./SheetGrid";
import { horizontalClass, styleClasses, styleInline, verticalClass } from "./sheet-style";
import { buildRuleIndex, checkboxValue, dropdownOptions, invalidMessage, isChecked, isDropdown, pickedValues, validateCell, type ValidationRule } from "@/lib/sheet-validation";
import { DropdownCell, DropdownPicker } from "./sheet-dropdown";
import { CHIP_COLORS } from "./sheet-types";

const CELL_W = 108;
const CELL_H = 34;
const GUTTER_W = 40;
const HEAD_H = 26;
const BUFFER = 10;

/**
 * The phone view, the way the Sheets app does it: the real grid (letters, row numbers, formatting),
 * tap a cell to select it, edit it in a bar at the bottom — never a tiny input inside a cell.
 * Rows are windowed like the desktop grid, so a long sheet stays smooth.
 */
export function SheetMobile({ sheet, onSetCells, footer, saving }: {
  sheet: NexusSheet;
  onSetCells: (edits: { rowId: string; values: Record<string, unknown> }[]) => void;
  footer: ReactNode;
  saving: boolean;
}) {
  const { t } = useLang();
  const settings = sheet.settings ?? {};
  const hiddenRows = useMemo(() => new Set(settings.hiddenRows ?? []), [settings.hiddenRows]);
  const hiddenCols = useMemo(() => new Set(settings.hiddenCols ?? []), [settings.hiddenCols]);
  const columns = useMemo(() => sheet.columns.map((c, i) => ({ col: c, index: i })).filter(({ col }) => !hiddenCols.has(col.id)), [sheet.columns, hiddenCols]);
  const rows = useMemo(() => sheet.rows.map((r, i) => ({ row: r, index: i })).filter(({ row }) => !hiddenRows.has(row.id)), [sheet.rows, hiddenRows]);
  const data = useMemo(() => buildSheetData(sheet.columns, sheet.rows), [sheet.columns, sheet.rows]);
  const engine = engineFor(data);
  const showLabels = sheet.columns.some((c) => c.name.trim() || c.type !== "text");
  // Data validation, same as the desktop grid: explicit rules, then dropdown columns.
  const explicitAt = useMemo(() => buildRuleIndex((settings.validations ?? []) as ValidationRule[], data.shape), [settings.validations, data.shape]);
  const ruleAt = (rawRow: number, colIndex: number): ValidationRule | null => {
    const r = explicitAt(rawRow, colIndex);
    if (r) return r;
    const col = sheet.columns[colIndex];
    if (!col || (col.type !== "select" && col.type !== "multiselect")) return null;
    return {
      id: `col:${col.id}`, ranges: [], kind: "list", values: col.options ?? [], multiple: col.type === "multiselect",
      colors: Object.fromEntries((col.options ?? []).map((o, i) => [o, col.optionColors?.[o] ?? CHIP_COLORS[i % CHIP_COLORS.length]])),
    };
  };
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const headH = HEAD_H + (showLabels ? HEAD_H : 0);

  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setScroll((p) => (p.top === el.scrollTop && p.height === el.clientHeight ? p : { top: el.scrollTop, height: el.clientHeight }));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const offsets = useMemo(() => {
    const out = [0];
    for (const { row } of rows) out.push(out[out.length - 1] + Math.max(CELL_H, row.height ?? CELL_H));
    return out;
  }, [rows]);
  let first = 0;
  while (first < rows.length && offsets[first + 1] <= scroll.top) first += 1;
  let last = first;
  while (last < rows.length && offsets[last] < scroll.top + scroll.height) last += 1;
  first = Math.max(0, first - BUFFER);
  last = Math.min(rows.length, last + BUFFER);

  const active = sel ? { row: rows[sel.r]?.row, col: columns[sel.c]?.col, rowIndex: rows[sel.r]?.index ?? 0, colIndex: columns[sel.c]?.index ?? 0 } : null;
  const raw = active?.row && active.col ? active.row.cells[active.col.id] : undefined;
  const activeRule = active?.col ? ruleAt(active.rowIndex, active.colIndex) : null;
  const initial = active?.col ? editFormula(raw, data.shape) ?? editValue(active.col.type, raw) : "";
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(initial); setDirty(false); }, [initial, sel?.r, sel?.c]);

  const commit = (text: string) => {
    if (!active?.row || !active.col || !sheet.canEdit) return;
    const next = inputToCell(active.col, text, data.shape, raw);
    if (!sameCell(raw, next)) onSetCells([{ rowId: active.row.id, values: { [active.col.id]: next } }]);
    setDirty(false);
  };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div
          ref={scrollRef}
          onScroll={(e) => { const el = e.currentTarget; setScroll({ top: el.scrollTop, height: el.clientHeight }); }}
          className="relative h-[58dvh] overflow-auto overscroll-contain"
        >
          <table className="border-separate border-spacing-0 text-[13px]" style={{ tableLayout: "fixed", width: GUTTER_W + columns.length * CELL_W }}>
            <colgroup>
              <col style={{ width: GUTTER_W }} />
              {columns.map(({ col }) => <col key={col.id} style={{ width: col.width ? Math.min(160, Math.max(80, col.width * 0.8)) : CELL_W }} />)}
            </colgroup>
            <thead>
              <tr style={{ height: HEAD_H }}>
                <th rowSpan={showLabels ? 2 : 1} className="sticky left-0 top-0 z-30 border-b border-r border-border bg-muted" />
                {columns.map(({ col, index }, ci) => (
                  <th key={col.id} className={cn("sticky top-0 z-20 border-b border-r border-border text-center text-[11px] font-medium",
                    sel?.c === ci ? "bg-[color-mix(in_oklab,var(--info)_16%,var(--muted))] text-foreground" : "bg-muted text-muted-foreground")}>
                    {colLetter(index)}
                  </th>
                ))}
              </tr>
              {showLabels && (
                <tr style={{ height: HEAD_H }}>
                  {columns.map(({ col }) => (
                    <th key={col.id} style={{ top: HEAD_H }} className="sticky z-20 truncate border-b border-r border-border bg-card px-1.5 text-left text-xs font-semibold">
                      {col.name || <span className="font-normal text-muted-foreground">{t(COLUMN_TYPE_LABEL[col.type])}</span>}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {first > 0 && <tr style={{ height: offsets[first] }} aria-hidden><td colSpan={columns.length + 1} /></tr>}
              {rows.slice(first, last).map(({ row, index }, k) => {
                const r = first + k;
                return (
                  <tr key={row.id} style={{ height: Math.max(CELL_H, row.height ?? CELL_H) }}>
                    <td className={cn("sticky left-0 z-10 border-b border-r border-border text-center text-[11px] tabular-nums",
                      sel?.r === r ? "bg-[color-mix(in_oklab,var(--info)_16%,var(--muted))] text-foreground" : "bg-muted text-muted-foreground")}>{index + 1}</td>
                    {columns.map(({ col }, ci) => {
                      const v = row.cells[col.id];
                      const st = row.styles?.[col.id];
                      const computed = engine.value(row.id, col.id);
                      const styled = formatWithStyle(computed, st?.nf, st?.dp, isFormulaCell(v) ? engine.format(row.id, col.id) : col.type === "currency" ? "idr" : null);
                      const text = col.type === "multiselect" ? readMulti(v).join(", ")
                        : styled ?? displayCell(col.type, v, { data, rowId: row.id, colId: col.id });
                      const selected = sel?.r === r && sel?.c === ci;
                      const rule = ruleAt(index, sheet.columns.indexOf(col));
                      const invalid = rule ? !validateCell(rule, v, computed, { engine, shape: data.shape, at: { r: index, c: sheet.columns.indexOf(col) } }) : false;
                      const checkbox = col.type === "checkbox" || rule?.kind === "checkbox";
                      const on = col.type === "checkbox" ? v === true : isChecked(rule, v);
                      return (
                        <td
                          key={col.id}
                          onClick={() => setSel({ r, c: ci })}
                          style={{ ...styleInline(st), ...(selected ? { boxShadow: "inset 0 0 0 2px var(--info)" } : {}) }}
                          className={cn(
                            "relative overflow-hidden border-b border-r border-border/80 px-1.5",
                            verticalClass(st), horizontalClass(st, typeof computed === "number"), styleClasses(st),
                            col.type === "checkbox" && "text-center",
                          )}
                        >
                          {invalid && rule && <span title={invalidMessage(rule, t)} className="absolute right-0 top-0 h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-red-600" />}
                          {checkbox ? (
                            <span role="checkbox" aria-checked={on} className={cn("mx-auto grid h-4 w-4 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-control-border")}>
                              {on && <Check className="h-3 w-3" />}
                            </span>
                          ) : isDropdown(rule) && rule ? (
                            <DropdownCell picked={rule.multiple ? pickedValues(v) : v === undefined || v === null || v === "" ? [] : [String(Array.isArray(v) ? v.join(", ") : v)]}
                              colors={rule.colors} display={rule.display ?? "chip"} canEdit={false} wrap={Boolean(st?.w)} onOpen={() => {}} />
                          ) : (
                            <span className={cn("block", st?.w ? "whitespace-pre-wrap break-words" : "truncate",
                              isLinkCell(v) && "text-info underline", isError(computed) && "text-destructive")}>
                              {text}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {last < rows.length && <tr style={{ height: offsets[rows.length] - offsets[last] }} aria-hidden><td colSpan={columns.length + 1} /></tr>}
            </tbody>
          </table>
        </div>

        {/* The edit bar: the selected cell's address and its content, edited here. */}
        <div className="flex items-center gap-1.5 border-t border-border bg-card p-1.5">
          <span className="w-12 shrink-0 rounded-md bg-muted px-1.5 py-1.5 text-center font-mono text-xs tabular-nums text-muted-foreground">
            {active?.col ? `${colLetter(active.colIndex)}${active.rowIndex + 1}` : "—"}
          </span>
          {active?.col && (active.col.type === "checkbox" || activeRule?.kind === "checkbox") ? (() => {
            const on = active.col.type === "checkbox" ? raw === true : isChecked(activeRule, raw);
            return (
              <button
                disabled={!sheet.canEdit}
                onClick={() => {
                  if (!active.row || !active.col) return;
                  onSetCells([{ rowId: active.row.id, values: { [active.col.id]: active.col.type === "checkbox" ? !on : checkboxValue(activeRule, !on) } }]);
                }}
                className="h-9 flex-1 rounded-lg border border-border px-3 text-left text-sm"
              >
                {on ? t("Ticked — tap to untick") : t("Not ticked — tap to tick")}
              </button>
            );
          })() : isDropdown(activeRule) && activeRule ? (
            <button
              disabled={!sheet.canEdit}
              onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
              className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-border bg-background px-2 text-left text-sm"
            >
              <DropdownCell picked={activeRule.multiple ? pickedValues(raw) : raw === undefined || raw === null || raw === "" ? [] : [String(Array.isArray(raw) ? raw.join(", ") : raw)]}
                colors={activeRule.colors} display="chip" canEdit={false} wrap={false} onOpen={() => {}} />
            </button>
          ) : (
            <input
              disabled={!active?.col}
              readOnly={!sheet.canEdit}
              type={active?.col?.type === "date" && !draft.startsWith("=") ? "date" : "text"}
              inputMode={active?.col?.type === "number" || active?.col?.type === "currency" ? "decimal" : undefined}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(draft); setSel((s) => (s ? { r: Math.min(rows.length - 1, s.r + 1), c: s.c } : s)); }
                if (e.key === "Escape") { setDraft(initial); setDirty(false); }
              }}
              placeholder={active?.col ? (sheet.canEdit ? t("Type a value or a formula…") : "") : t("Tap a cell")}
              aria-label={t("Cell content")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
            />
          )}
          {dirty && (
            <>
              <button onClick={() => { setDraft(initial); setDirty(false); }} aria-label={t("Cancel")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"><X className="h-4 w-4" /></button>
              <button onClick={() => commit(draft)} aria-label={t("Save")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Check className="h-4 w-4" /></button>
            </>
          )}
        </div>
        {picker && active?.row && active.col && activeRule && (
          <DropdownPicker
            anchor={picker}
            options={dropdownOptions(activeRule, engine, data.shape)}
            colors={activeRule.colors}
            picked={activeRule.multiple ? pickedValues(raw) : raw === undefined || raw === null || raw === "" ? [] : [String(raw)]}
            multiple={Boolean(activeRule.multiple)}
            onClose={() => setPicker(null)}
            onCommit={(values) => {
              setPicker(null);
              const next = values.length ? values.join(", ") : null;
              if (active.row && active.col && !sameCell(raw, next)) onSetCells([{ rowId: active.row.id, values: { [active.col.id]: next } }]);
            }}
          />
        )}
        <div className="flex min-h-9 items-center gap-2 border-t border-border bg-muted/60 px-1.5">
          <div className="min-w-0 flex-1">{footer}</div>
          {saving && <span className="shrink-0 text-2xs text-muted-foreground">{t("Saving…")}</span>}
        </div>
      </div>
    </div>
  );
}

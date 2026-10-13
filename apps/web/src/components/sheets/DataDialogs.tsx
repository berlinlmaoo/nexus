import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { SplitSep } from "@/lib/sheet-datatools";
import { Floating } from "./sheet-float";
import { SelectPicker } from "@/components/SelectPicker";
import { FieldLabel, SheetDialog, inputClass, primaryBtn, secondaryBtn, selectClass } from "./sheet-shell";

export type DataColumn = { index: number; letter: string; header: string };

const colName = (c: DataColumn, header: boolean, t: (en: string, vars?: Record<string, string | number>) => string) =>
  header && c.header.trim() ? c.header : t("Column {c}", { c: c.letter });

const checkbox = "h-3.5 w-3.5 accent-primary";

// ── Sort range (advanced) ──────────────────────────────────────────────────────────────────────

/**
 * "Sort range" — advanced options: ☐ Data has header row (switches the column list to header names
 * and leaves row 1 in place), one or more sort columns each A → Z / Z → A, Cancel / Sort.
 */
export function SortRangeDialog({ columns, defaultHeader, onSort, onClose }: {
  columns: DataColumn[];
  defaultHeader: boolean;
  onSort: (opts: { header: boolean; keys: { col: number; dir: "asc" | "desc" }[] }) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [header, setHeader] = useState(defaultHeader);
  const [keys, setKeys] = useState<{ col: number; dir: "asc" | "desc" }[]>(() => [{ col: columns[0]?.index ?? 0, dir: "asc" }]);
  const unused = columns.find((c) => !keys.some((k) => k.col === c.index));
  return (
    <SheetDialog
      title={t("Sort range")}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={secondaryBtn}>{t("Cancel")}</button>
          <button type="button" onClick={() => { onSort({ header, keys }); onClose(); }} disabled={!keys.length} className={primaryBtn}>{t("Sort")}</button>
        </>
      )}
    >
      <label className="mb-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} className={checkbox} /> {t("Data has header row")}
      </label>
      <div className="space-y-2">
        {keys.map((k, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{i === 0 ? t("Sort by") : t("then by")}</span>
            <SelectPicker value={String(k.col)} ariaLabel={t("Sort column")} variant="field" size="sm" className="w-40"
              onChange={(v) => setKeys(keys.map((x, j) => (j === i ? { ...x, col: Number(v) } : x)))}
              options={columns.map((c) => ({ value: String(c.index), label: colName(c, header, t) }))} />
            <div className="flex items-center gap-3 text-xs" role="radiogroup">
              {([["asc", "A → Z"], ["desc", "Z → A"]] as const).map(([d, l]) => (
                <label key={d} className="flex items-center gap-1.5">
                  <input type="radio" name={`sort-dir-${i}`} checked={k.dir === d} onChange={() => setKeys(keys.map((x, j) => (j === i ? { ...x, dir: d } : x)))} className="accent-primary" />
                  {l}
                </label>
              ))}
            </div>
            {i > 0 && (
              <button type="button" onClick={() => setKeys(keys.filter((_, j) => j !== i))} aria-label={t("Remove sort column")}
                className="ml-auto rounded p-1 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
            )}
          </div>
        ))}
      </div>
      {unused && (
        <button type="button" onClick={() => setKeys([...keys, { col: unused.index, dir: "asc" }])}
          className="mt-3 flex items-center gap-1 text-xs font-semibold text-info hover:underline">
          <Plus className="h-3.5 w-3.5" /> {t("Add another sort column")}
        </button>
      )}
    </SheetDialog>
  );
}

// ── Remove duplicates ──────────────────────────────────────────────────────────────────────────

/** "Remove duplicates": header row, which columns to compare (Select all), Cancel / Remove duplicates. */
export function RemoveDuplicatesDialog({ rowCount, columns, onApply, onClose }: {
  rowCount: number;
  columns: DataColumn[];
  onApply: (opts: { header: boolean; cols: number[] }) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [header, setHeader] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(columns.map((c) => c.index)));
  const all = columns.length > 0 && columns.every((c) => picked.has(c.index));
  return (
    <SheetDialog
      title={t("Remove duplicates")}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={secondaryBtn}>{t("Cancel")}</button>
          <button type="button" disabled={!picked.size}
            onClick={() => { onApply({ header, cols: columns.map((c) => c.index).filter((i) => picked.has(i)) }); onClose(); }}
            className={primaryBtn}>{t("Remove duplicates")}</button>
        </>
      )}
    >
      <p className="mb-3 text-xs text-muted-foreground">{t("{r} rows and {c} columns selected", { r: rowCount, c: columns.length })}</p>
      <label className="mb-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} className={checkbox} /> {t("Data has header row")}
      </label>
      <FieldLabel>{t("Columns to analyse")}</FieldLabel>
      <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input type="checkbox" checked={all} onChange={(e) => setPicked(e.target.checked ? new Set(columns.map((c) => c.index)) : new Set())} className={checkbox} />
          {t("Select all")}
        </label>
        {columns.map((c) => (
          <label key={c.index} className="flex items-center gap-2 pl-4 text-xs">
            <input type="checkbox" checked={picked.has(c.index)} className={checkbox}
              onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.index); else n.delete(c.index); return n; })} />
            <span className="truncate">{colName(c, header, t)}</span>
          </label>
        ))}
      </div>
    </SheetDialog>
  );
}

// ── Find and replace ───────────────────────────────────────────────────────────────────────────

export type FindOpts = {
  find: string;
  replace: string;
  scope: "all" | "sheet" | "range";
  matchCase: boolean;
  entire: boolean;
  regex: boolean;
  formulas: boolean;
  links: boolean;
};

/**
 * "Find and replace": Find, Replace with, Search (All sheets / This sheet / Specific range), the five
 * options, and Find / Replace / Replace all / Done. The callbacks return how many matches they found
 * or replaced; the dialog shows "N instances of X replaced" or "No more results".
 */
export function FindReplaceDialog({ canEdit, hasSelection, onFind, onReplace, onReplaceAll, onClose }: {
  canEdit: boolean;
  hasSelection: boolean;
  onFind: (o: FindOpts) => number;
  onReplace: (o: FindOpts) => number;
  onReplaceAll: (o: FindOpts) => number;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [o, setO] = useState<FindOpts>({ find: "", replace: "", scope: "sheet", matchCase: false, entire: false, regex: false, formulas: false, links: false });
  const [status, setStatus] = useState<string | null>(null);
  const set = (patch: Partial<FindOpts>) => { setO((x) => ({ ...x, ...patch })); setStatus(null); };
  const off = !o.find;
  const replaced = (n: number) => setStatus(n
    ? (n === 1 ? t("1 instance of {x} replaced", { x: o.find }) : t("{n} instances of {x} replaced", { n, x: o.find }))
    : t("No more results"));
  const opts: [keyof FindOpts, string][] = [
    ["matchCase", "Match case"],
    ["entire", "Match entire cell contents"],
    ["regex", "Search using regular expressions"],
    ["formulas", "Also search within formulas"],
    ["links", "Also search within links"],
  ];
  return (
    <SheetDialog
      title={t("Find and replace")}
      onClose={onClose}
      width={480}
      footer={(
        <>
          {status && <span role="status" className="mr-auto text-xs text-muted-foreground">{status}</span>}
          <button type="button" disabled={off} onClick={() => { const n = onFind(o); if (!n) setStatus(t("No more results")); }} className={cn(secondaryBtn, "border border-border")}>{t("Find")}</button>
          <button type="button" disabled={off || !canEdit} onClick={() => replaced(onReplace(o))} className={cn(secondaryBtn, "border border-border")}>{t("Replace")}</button>
          <button type="button" disabled={off || !canEdit} onClick={() => replaced(onReplaceAll(o))} className={cn(secondaryBtn, "border border-border")}>{t("Replace all")}</button>
          <button type="button" onClick={onClose} className={primaryBtn}>{t("Done")}</button>
        </>
      )}
    >
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-xs">
        <label htmlFor="fr-find">{t("Find")}</label>
        <input id="fr-find" value={o.find} onChange={(e) => set({ find: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter" && o.find) { const n = onFind(o); if (!n) setStatus(t("No more results")); } }} className={inputClass} />
        <label htmlFor="fr-replace">{t("Replace with")}</label>
        <input id="fr-replace" value={o.replace} disabled={!canEdit} onChange={(e) => set({ replace: e.target.value })} className={inputClass} />
        <label htmlFor="fr-scope">{t("Search")}</label>
        <SelectPicker id="fr-scope" value={o.scope} onChange={(v) => set({ scope: v as FindOpts["scope"] })} variant="field" size="sm" searchable={false} className="w-44"
          ariaLabel={t("Search")}
          options={[
            { value: "all", label: t("All sheets") },
            { value: "sheet", label: t("This sheet") },
            { value: "range", label: t("Specific range"), disabled: !hasSelection },
          ]} />
        <span />
        <div className="space-y-2 pt-1">
          {opts.map(([k, l]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={Boolean(o[k])} onChange={(e) => set({ [k]: e.target.checked } as Partial<FindOpts>)} className={checkbox} /> {t(l)}
            </label>
          ))}
        </div>
      </div>
    </SheetDialog>
  );
}

// ── Split text to columns: the floating separator chooser ─────────────────────────────────────

const SEPARATORS: { key: string; label: string; value: SplitSep }[] = [
  { key: "auto", label: "Detect automatically", value: "auto" },
  { key: ",", label: "Comma", value: "," },
  { key: ";", label: "Semicolon", value: ";" },
  { key: ".", label: "Period", value: "." },
  { key: " ", label: "Space", value: " " },
  { key: "custom", label: "Custom", value: { custom: "" } },
];
const sepKey = (v: SplitSep) => (typeof v === "object" ? "custom" : v === "\t" ? "auto" : v);

/**
 * The "Separator: [Detect automatically ▾]" chip that floats below the split cells. Changing it
 * re-splits through `onChange`; it stays until the user clicks elsewhere (the caller closes it).
 */
export function SplitSeparatorChip({ anchor, value, onChange, onClose }: {
  anchor: DOMRect;
  value: SplitSep;
  onChange: (sep: SplitSep) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [custom, setCustom] = useState(typeof value === "object" ? value.custom : "");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const key = sepKey(value);
  return createPortal(
    <Floating anchor={{ rect: anchor }} role="dialog"
      className="flex items-center gap-1.5 rounded-lg border border-border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-pop">
      <label htmlFor="split-sep" className="text-muted-foreground">{t("Separator:")}</label>
      <SelectPicker id="split-sep" value={key} variant="field" size="sm" searchable={false} ariaLabel={t("Separator:")}
        onChange={(v) => {
          const s = SEPARATORS.find((x) => x.key === v);
          if (!s) return;
          if (typeof s.value === "object") { if (custom) onChange({ custom }); else onChange({ custom: "" }); }
          else onChange(s.value);
        }}
        options={SEPARATORS.map((s) => ({ value: s.key, label: t(s.label) }))} />
      {key === "custom" && (
        <input value={custom} autoFocus aria-label={t("Custom separator")} placeholder="|" maxLength={10}
          onChange={(e) => { setCustom(e.target.value); onChange({ custom: e.target.value }); }}
          className={cn(inputClass, "h-7 w-16")} />
      )}
      <button type="button" onClick={onClose} aria-label={t("Close")} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
    </Floating>,
    document.body,
  );
}

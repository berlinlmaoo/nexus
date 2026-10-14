import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, GripVertical, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { toDisplay, toStored, type SheetShape } from "@/lib/sheet-formula";
import { newRuleId, rangeFromA1, rangeToA1, type ValidationKind, type ValidationRule } from "@/lib/sheet-validation";
import { chipClass, chipStyle } from "./sheet-dropdown";
import { Floating } from "./sheet-float";
import { COLOR_NAME, STYLE_COLORS, SWATCH_CLASS, type StyleColor } from "./sheet-style";
import { SelectPicker } from "@/components/SelectPicker";

/** A rule as the panel edits it: ranges as typed text, a column-backed rule flagged. */
export type PanelRule = ValidationRule & { columnId?: string };

type Draft = {
  id: string;
  columnId?: string;
  ranges: string[];
  kind: ValidationKind;
  items: { key: string; value: string; color?: string }[];
  values: string[];
  source: string;
  formula: string;
  multiple: boolean;
  strict: boolean;
  display: "chip" | "arrow" | "plain";
  helpOn: boolean;
  help: string;
  customCheckbox: boolean;
  checked: string;
  unchecked: string;
};

const CRITERIA: { group: string; kinds: { kind: ValidationKind; label: string }[] }[] = [
  { group: "Dropdown", kinds: [{ kind: "list", label: "Dropdown" }, { kind: "listRange", label: "Dropdown (from a range)" }] },
  {
    group: "Text", kinds: [
      { kind: "textContains", label: "Text contains" }, { kind: "textNotContains", label: "Text does not contain" },
      { kind: "textIs", label: "Text is exactly" }, { kind: "email", label: "Text is valid email" }, { kind: "url", label: "Text is valid URL" },
    ],
  },
  {
    group: "Date", kinds: [
      { kind: "dateValid", label: "Is valid date" }, { kind: "dateIs", label: "Date is" }, { kind: "dateBefore", label: "Date is before" },
      { kind: "dateAfter", label: "Date is after" }, { kind: "dateBetween", label: "Date is between" },
    ],
  },
  {
    group: "Number", kinds: [
      { kind: "gt", label: "Greater than" }, { kind: "gte", label: "Greater than or equal to" }, { kind: "lt", label: "Less than" },
      { kind: "lte", label: "Less than or equal to" }, { kind: "eq", label: "Is equal to" }, { kind: "neq", label: "Is not equal to" },
      { kind: "between", label: "Is between" }, { kind: "notBetween", label: "Is not between" },
    ],
  },
  { group: "Other", kinds: [{ kind: "checkbox", label: "Checkbox" }, { kind: "formula", label: "Custom formula is" }] },
];
const LABEL = Object.fromEntries(CRITERIA.flatMap((g) => g.kinds.map((k) => [k.kind, k.label]))) as Record<ValidationKind, string>;
const TWO_VALUES: ValidationKind[] = ["between", "notBetween", "dateBetween"];
const ONE_VALUE: ValidationKind[] = ["textContains", "textNotContains", "textIs", "dateIs", "dateBefore", "dateAfter", "gt", "gte", "lt", "lte", "eq", "neq"];
let itemSeq = 0;
const item = (value: string, color?: string) => ({ key: `i${itemSeq++}`, value, color });

function toDraft(rule: PanelRule, shape: SheetShape): Draft {
  return {
    id: rule.id,
    columnId: rule.columnId,
    ranges: rule.ranges.map((r) => rangeToA1(r, shape)),
    kind: rule.kind,
    items: (rule.kind === "list" ? rule.values ?? [] : []).map((v) => item(v, rule.colors?.[v])),
    values: rule.kind === "list" ? [] : rule.values ?? [],
    source: rule.source ? rangeToA1(rule.source, shape) : "",
    formula: rule.formula ? toDisplay(rule.formula, shape) : "",
    multiple: Boolean(rule.multiple),
    strict: Boolean(rule.strict),
    display: rule.display ?? "chip",
    helpOn: Boolean(rule.help),
    help: rule.help ?? "",
    customCheckbox: Boolean(rule.checked || rule.unchecked),
    checked: rule.checked ?? "",
    unchecked: rule.unchecked ?? "",
  };
}

/**
 * "Data validation rules" — the right-hand sidebar, laid out like Google Sheets': the sheet's rules
 * as a list, "Add rule", and per rule: Apply to range (one or more), Criteria, the criteria's own
 * fields (dropdown items with drag handle, colour chip and delete; values; a checkbox's custom cell
 * values; a custom formula), Advanced options (warning vs reject, help text, chip/arrow/plain), and
 * "Remove rule" / "Done" at the bottom.
 *
 * Dropdown COLUMNS (the older per-column type) appear as rules over their whole column; editing one
 * edits the column's choices, removing one turns the column back into text.
 */
export function DataValidationPanel({ rules, shape, sheetName, selectionRange, editId, canEdit, onSave, onRemove, onClose, onEditChange }: {
  rules: PanelRule[];
  shape: SheetShape;
  sheetName: string;
  /** The current selection as A1, prefilled into a new rule. */
  selectionRange: string;
  /** Rule being edited (a new rule is passed in `rules` already, with its id here). */
  editId: string | null;
  canEdit: boolean;
  onSave: (rule: PanelRule) => void;
  onRemove: (rule: PanelRule) => void;
  onClose: () => void;
  onEditChange: (id: string | null) => void;
}) {
  const { t } = useLang();
  const editing = editId ? rules.find((r) => r.id === editId) ?? null : null;
  const [draft, setDraft] = useState<Draft | null>(editing ? toDraft(editing, shape) : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [palette, setPalette] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  useEffect(() => {
    setDraft(editing ? toDraft(editing, shape) : null);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = () => {
    if (!draft || !editing) return;
    const errs: Record<string, string> = {};
    const ranges = draft.ranges.map((r, i) => {
      const stored = rangeFromA1(r, shape);
      if (!stored) errs[`range${i}`] = t("Invalid range");
      return stored;
    });
    let source: string | undefined;
    if (draft.kind === "listRange") {
      source = rangeFromA1(draft.source, shape) ?? undefined;
      if (!source) errs.source = t("Invalid range");
    }
    let formula: string | undefined;
    if (draft.kind === "formula") {
      const f = draft.formula.trim();
      if (!f) errs.formula = t("Enter a formula");
      else formula = toStored(f.startsWith("=") ? f : `=${f}`, shape);
    }
    if (ONE_VALUE.includes(draft.kind) && !(draft.values[0] ?? "").trim()) errs.value = t("Enter a value");
    if (TWO_VALUES.includes(draft.kind) && (!(draft.values[0] ?? "").trim() || !(draft.values[1] ?? "").trim())) errs.value = t("Enter both values");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const items = draft.items.map((x) => ({ ...x, value: x.value.trim() })).filter((x) => x.value);
    const rule: PanelRule = {
      id: draft.id,
      ...(draft.columnId ? { columnId: draft.columnId } : {}),
      ranges: ranges as string[],
      kind: draft.kind,
      ...(draft.kind === "list" ? { values: [...new Set(items.map((x) => x.value))] } : {}),
      ...(draft.kind === "list" && items.some((x) => x.color) ? { colors: Object.fromEntries(items.filter((x) => x.color).map((x) => [x.value, x.color as string])) } : {}),
      ...(ONE_VALUE.includes(draft.kind) ? { values: [draft.values[0].trim()] } : {}),
      ...(TWO_VALUES.includes(draft.kind) ? { values: [draft.values[0].trim(), draft.values[1].trim()] } : {}),
      ...(source ? { source } : {}),
      ...(formula ? { formula } : {}),
      ...((draft.kind === "list" || draft.kind === "listRange") && draft.multiple ? { multiple: true } : {}),
      ...(draft.strict ? { strict: true } : {}),
      ...((draft.kind === "list" || draft.kind === "listRange") && draft.display !== "chip" ? { display: draft.display } : {}),
      ...(draft.helpOn && draft.help.trim() ? { help: draft.help.trim() } : {}),
      ...(draft.kind === "checkbox" && draft.customCheckbox ? { checked: draft.checked.trim() || "TRUE", unchecked: draft.unchecked.trim() || "FALSE" } : {}),
    };
    onSave(rule);
    onEditChange(null);
  };

  const summary = (r: PanelRule) => {
    if (r.kind === "list") return t("Dropdown");
    if (r.kind === "listRange") return `${t("Dropdown (from a range)")}: ${r.source ? rangeToA1(r.source, shape) : ""}`;
    if (r.kind === "formula") return `${t("Custom formula is")} ${r.formula ? toDisplay(r.formula, shape) : ""}`;
    const v = r.values ?? [];
    return `${t(LABEL[r.kind])}${v.length ? ` ${v.join(` ${t("and")} `)}` : ""}`;
  };

  const field = "h-8 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-ring disabled:opacity-60";
  const label = "text-2xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <aside data-sheet-panel="" aria-label={t("Data validation rules")} className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("Data validation rules")}</h2>
        <button onClick={onClose} aria-label={t("Close")} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
      </header>

      {!draft || !editing ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {rules.length === 0 && (
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                {t("No rules yet. Select cells, then add a rule: a dropdown, a checkbox, or a check on text, dates or numbers.")}
              </p>
            )}
            {rules.map((r) => (
              <button
                key={r.id}
                onClick={() => onEditChange(r.id)}
                className="block w-full rounded-lg border border-border px-2.5 py-2 text-left transition hover:border-ring/60 hover:bg-muted/50"
              >
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {r.ranges.map((x) => `${sheetName}!${rangeToA1(x, shape)}`).join(", ")}
                </div>
                <div className="mt-0.5 truncate text-xs font-medium">{summary(r)}</div>
                {r.kind === "list" && (r.values?.length ?? 0) > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(r.values ?? []).slice(0, 6).map((v) => <span key={v} style={chipStyle(r.colors?.[v])} className={cn("max-w-[120px] truncate rounded-full px-2 text-[11px] leading-5", chipClass(r.colors?.[v]))}>{v}</span>)}
                    {(r.values?.length ?? 0) > 6 && <span className="text-[11px] text-muted-foreground">+{(r.values?.length ?? 0) - 6}</span>}
                  </div>
                )}
                {r.columnId && <div className="mt-1 text-[10px] text-muted-foreground">{t("Dropdown column")}</div>}
              </button>
            ))}
          </div>
          {canEdit && (
            <div className="border-t border-border p-2">
              <button
                onClick={() => onSave({ id: newRuleId(), ranges: [rangeFromA1(selectionRange, shape) ?? ""].filter(Boolean), kind: "list", values: [t("Option 1"), t("Option 2")], __new: true } as PanelRule & { __new: true })}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" /> {t("Add rule")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            <section className="space-y-1.5">
              <div className={label}>{t("Apply to range")}</div>
              {draft.ranges.map((r, i) => (
                <div key={i}>
                  <div className="flex items-center gap-1">
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{sheetName}!</span>
                    <input
                      value={r}
                      disabled={!canEdit || Boolean(draft.columnId)}
                      onChange={(e) => set({ ranges: draft.ranges.map((x, j) => (j === i ? e.target.value : x)) })}
                      aria-label={t("Apply to range")}
                      className={cn(field, "font-mono", errors[`range${i}`] && "border-destructive")}
                    />
                    {draft.ranges.length > 1 && !draft.columnId && (
                      <button onClick={() => set({ ranges: draft.ranges.filter((_, j) => j !== i) })} aria-label={t("Remove range")}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                  {errors[`range${i}`] && <p className="mt-0.5 text-[11px] text-destructive">{errors[`range${i}`]}</p>}
                </div>
              ))}
              {draft.columnId ? (
                <p className="text-[11px] text-muted-foreground">{t("This dropdown comes from the column's type, so it covers the whole column.")}</p>
              ) : canEdit && (
                <button onClick={() => set({ ranges: [...draft.ranges, ""] })} className="text-xs font-medium text-info hover:underline">{t("Add another range")}</button>
              )}
            </section>

            <section className="space-y-1.5">
              <div className={label}>{t("Criteria")}</div>
              <SelectPicker
                value={draft.kind}
                disabled={!canEdit || Boolean(draft.columnId)}
                onChange={(v) => set({ kind: v as ValidationKind, values: [], ...(v === "list" && !draft.items.length ? { items: [item(t("Option 1")), item(t("Option 2"))] } : {}) })}
                ariaLabel={t("Criteria")}
                variant="field"
                size="sm"
                searchable={false}
                className="w-full"
                options={CRITERIA.flatMap((g) => g.kinds.map((k) => ({ value: k.kind, label: t(k.label), group: t(g.group) })))}
              />

              {draft.kind === "list" && (
                <div className="space-y-1 pt-1">
                  {draft.items.map((it, i) => (
                    <div
                      key={it.key}
                      onDragOver={(e) => { e.preventDefault(); if (dragKey && dragKey !== it.key) {
                        const from = draft.items.findIndex((x) => x.key === dragKey);
                        const next = [...draft.items];
                        const [moved] = next.splice(from, 1);
                        next.splice(i, 0, moved);
                        set({ items: next });
                      } }}
                      className={cn("flex items-center gap-1", dragKey === it.key && "opacity-50")}
                    >
                      <span
                        draggable={canEdit}
                        onDragStart={() => setDragKey(it.key)}
                        onDragEnd={() => setDragKey(null)}
                        title={t("Drag to reorder")}
                        className="cursor-grab text-muted-foreground/70 active:cursor-grabbing"
                      ><GripVertical className="h-4 w-4" /></span>
                      <button
                        disabled={!canEdit}
                        onClick={(e) => setPalette({ key: it.key, rect: e.currentTarget.getBoundingClientRect() })}
                        title={t("Chip colour")}
                        aria-label={t("Chip colour")}
                        style={chipStyle(it.color)}
                        className={cn("h-5 w-5 shrink-0 rounded-full border border-border", it.color ? SWATCH_CLASS[it.color as StyleColor] ?? chipClass(it.color) : "bg-muted")}
                      />
                      <input
                        value={it.value}
                        disabled={!canEdit}
                        onChange={(e) => set({ items: draft.items.map((x) => (x.key === it.key ? { ...x, value: e.target.value } : x)) })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); set({ items: [...draft.items.slice(0, i + 1), item(""), ...draft.items.slice(i + 1)] }); } }}
                        placeholder={t("Value")}
                        aria-label={t("Item {n}", { n: i + 1 })}
                        className={cn(field, "h-7")}
                      />
                      {canEdit && (
                        <button onClick={() => set({ items: draft.items.filter((x) => x.key !== it.key) })} aria-label={t("Delete item")}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button onClick={() => set({ items: [...draft.items, item("")] })} className="ml-5 text-xs font-medium text-info hover:underline">{t("Add another item")}</button>
                  )}
                </div>
              )}
              {draft.kind === "listRange" && (
                <div>
                  <input value={draft.source} disabled={!canEdit} onChange={(e) => set({ source: e.target.value })} placeholder="A2:A20"
                    aria-label={t("Range of items")} className={cn(field, "font-mono", errors.source && "border-destructive")} />
                  {errors.source && <p className="mt-0.5 text-[11px] text-destructive">{errors.source}</p>}
                </div>
              )}
              {(draft.kind === "list" || draft.kind === "listRange") && (
                <label className="flex items-center gap-2 pt-1 text-xs">
                  <input type="checkbox" disabled={!canEdit} checked={draft.multiple} onChange={(e) => set({ multiple: e.target.checked })} className="h-3.5 w-3.5 accent-primary" />
                  {t("Allow multiple selections")}
                </label>
              )}
              {(ONE_VALUE.includes(draft.kind) || TWO_VALUES.includes(draft.kind)) && (
                <div className="flex items-center gap-1.5">
                  <input value={draft.values[0] ?? ""} disabled={!canEdit} onChange={(e) => set({ values: [e.target.value, draft.values[1] ?? ""] })}
                    placeholder={draft.kind.startsWith("date") ? "11/10/2026" : t("Value or formula")} aria-label={t("Value")}
                    className={cn(field, errors.value && "border-destructive")} />
                  {TWO_VALUES.includes(draft.kind) && (
                    <>
                      <span className="shrink-0 text-xs text-muted-foreground">{t("and")}</span>
                      <input value={draft.values[1] ?? ""} disabled={!canEdit} onChange={(e) => set({ values: [draft.values[0] ?? "", e.target.value] })}
                        placeholder={draft.kind.startsWith("date") ? "31/10/2026" : ""} aria-label={t("Second value")}
                        className={cn(field, errors.value && "border-destructive")} />
                    </>
                  )}
                </div>
              )}
              {errors.value && <p className="text-[11px] text-destructive">{errors.value}</p>}
              {draft.kind === "formula" && (
                <div>
                  <input value={draft.formula} disabled={!canEdit} onChange={(e) => set({ formula: e.target.value })} placeholder="=A2>0"
                    aria-label={t("Custom formula")} className={cn(field, "font-mono", errors.formula && "border-destructive")} />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t("Written for the first cell of the range; it shifts for the others, like a filled formula.")}</p>
                  {errors.formula && <p className="text-[11px] text-destructive">{errors.formula}</p>}
                </div>
              )}
              {draft.kind === "checkbox" && (
                <div className="space-y-1.5 pt-1">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" disabled={!canEdit} checked={draft.customCheckbox} onChange={(e) => set({ customCheckbox: e.target.checked })} className="h-3.5 w-3.5 accent-primary" />
                    {t("Use custom cell values")}
                  </label>
                  {draft.customCheckbox && (
                    <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 pl-5">
                      <span className="text-xs text-muted-foreground">{t("Ticked")}</span>
                      <input value={draft.checked} disabled={!canEdit} onChange={(e) => set({ checked: e.target.value })} placeholder="TRUE" className={cn(field, "h-7")} />
                      <span className="text-xs text-muted-foreground">{t("Unticked")}</span>
                      <input value={draft.unchecked} disabled={!canEdit} onChange={(e) => set({ unchecked: e.target.value })} placeholder="FALSE" className={cn(field, "h-7")} />
                    </div>
                  )}
                </div>
              )}
            </section>

            {!draft.columnId && (
              <section className="space-y-2">
                <button onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center gap-1 text-left">
                  <span className={label}>{t("Advanced options")}</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", advanced && "rotate-180")} />
                </button>
                {advanced && (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" disabled={!canEdit} checked={draft.helpOn} onChange={(e) => set({ helpOn: e.target.checked })} className="h-3.5 w-3.5 accent-primary" />
                      {t("Show help text for a selected cell")}
                    </label>
                    {draft.helpOn && (
                      <textarea value={draft.help} disabled={!canEdit} onChange={(e) => set({ help: e.target.value })} rows={2} maxLength={500}
                        placeholder={t("Enter help text")} aria-label={t("Help text")}
                        className="w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring" />
                    )}
                    <fieldset className="space-y-1">
                      <legend className="mb-1 text-xs text-muted-foreground">{t("If the data is invalid:")}</legend>
                      {([[false, t("Show a warning")], [true, t("Reject the input")]] as const).map(([v, l]) => (
                        <label key={String(v)} className="flex items-center gap-2 text-xs">
                          <input type="radio" disabled={!canEdit} checked={draft.strict === v} onChange={() => set({ strict: v })} className="accent-primary" /> {l}
                        </label>
                      ))}
                    </fieldset>
                    {(draft.kind === "list" || draft.kind === "listRange") && (
                      <fieldset className="space-y-1">
                        <legend className="mb-1 text-xs text-muted-foreground">{t("Display style")}</legend>
                        {([["chip", t("Chip")], ["arrow", t("Arrow")], ["plain", t("Plain text")]] as const).map(([v, l]) => (
                          <label key={v} className="flex items-center gap-2 text-xs">
                            <input type="radio" disabled={!canEdit} checked={draft.display === v} onChange={() => set({ display: v })} className="accent-primary" /> {l}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
          {canEdit && (
            <footer className="flex items-center gap-2 border-t border-border p-2">
              <button onClick={() => { onRemove(editing); onEditChange(null); }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10">{t("Remove rule")}</button>
              <button onClick={save} className="ml-auto rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground">{t("Done")}</button>
            </footer>
          )}
        </div>
      )}

      {palette && draft && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setPalette(null)} />
          <Floating anchor={{ rect: palette.rect }} className="rounded-xl border border-border bg-popover p-2 shadow-pop">
            <div className="grid grid-cols-5 gap-1.5">
              {STYLE_COLORS.map((c) => (
                <button key={c} title={t(COLOR_NAME[c])} aria-label={t(COLOR_NAME[c])}
                  onClick={() => { set({ items: draft.items.map((x) => (x.key === palette.key ? { ...x, color: c } : x)) }); setPalette(null); }}
                  className={cn("h-6 w-6 rounded-full border border-border", SWATCH_CLASS[c])} />
              ))}
            </div>
            <button onClick={() => { set({ items: draft.items.map((x) => (x.key === palette.key ? { ...x, color: undefined } : x)) }); setPalette(null); }}
              className="mt-2 w-full rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{t("Default (grey)")}</button>
          </Floating>
        </>,
        document.body,
      )}
    </aside>
  );
}

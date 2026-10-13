import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bold, ChevronDown, ChevronUp, GripVertical, Italic, PaintBucket, Plus, Strikethrough, Table2, Trash2, Underline, Baseline,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { toDisplay, toStored, type SheetShape } from "@/lib/sheet-formula";
import type { CondKind, CondRule, CondStyle, Hex, ScalePoint, ScalePointType } from "@/lib/sheet-model";
import { rangeFromA1, rangeRect, rangeToA1 } from "@/lib/sheet-validation";
import {
  COND_ONE_VALUE, COND_PRESETS, COND_TWO_VALUES, DEFAULT_COND_STYLE, SCALE_PRESETS, interpolateHex, newCondId, type ScalePreset,
} from "@/lib/sheet-cf";
import { Floating } from "./sheet-float";
import { SelectPicker } from "@/components/SelectPicker";
import { FieldLabel, SidePanel, inputClass, primaryBtn, secondaryBtn } from "./sheet-shell";

// ── Palette (Sheets' 10 × 8 swatches, palette.txt) ─────────────────────────────────────────────────

export const HEX_PALETTE: Hex[][] = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
];

/** The 10 × 8 swatch grid with Reset and a custom colour, as in Sheets' colour menus. */
export function HexSwatchGrid({ value, onPick, allowReset = true }: { value?: Hex; onPick: (hex: Hex | undefined) => void; allowReset?: boolean }) {
  const { t } = useLang();
  return (
    <div className="w-[236px] space-y-2">
      {allowReset && (
        <button type="button" onClick={() => onPick(undefined)} className="w-full rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted">{t("Reset")}</button>
      )}
      <div className="grid grid-cols-10 gap-[3px]" role="listbox" aria-label={t("Colours")}>
        {HEX_PALETTE.flat().map((c) => (
          <button
            key={c}
            type="button"
            role="option"
            aria-selected={value?.toLowerCase() === c}
            title={c}
            aria-label={c}
            onClick={() => onPick(c)}
            style={{ background: c }}
            className={cn("h-5 w-5 rounded-full border border-black/10", value?.toLowerCase() === c && "ring-2 ring-ring ring-offset-1 ring-offset-popover")}
          />
        ))}
      </div>
      <label className="flex items-center gap-2 px-1.5 text-xs text-muted-foreground">
        <input type="color" value={value ?? "#000000"} onChange={(e) => onPick(e.target.value.toLowerCase())} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" />
        {t("Custom")}
      </label>
    </div>
  );
}

/** A colour button that opens the swatch grid in a popover. */
export function HexColorButton({ value, onChange, label, icon, disabled, allowReset = true }: {
  value?: Hex; onChange: (hex: Hex | undefined) => void; label: string; icon?: ReactNode; disabled?: boolean; allowReset?: boolean;
}) {
  const [at, setAt] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={(e) => setAt(e.currentTarget.getBoundingClientRect())}
        className="flex h-7 items-center gap-0.5 rounded-md px-1 text-foreground/80 transition hover:bg-muted disabled:opacity-35"
      >
        {icon ? (
          <span className="flex flex-col items-center leading-none">
            {icon}
            <span className="mt-0.5 h-[3px] w-4 rounded-sm border border-black/10" style={{ background: value ?? "transparent" }} />
          </span>
        ) : (
          <span className="h-4 w-4 rounded-full border border-border" style={{ background: value ?? "transparent" }} />
        )}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {at && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setAt(null)} />
          <Floating anchor={{ rect: at }} className="rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-pop">
            <HexSwatchGrid value={value} allowReset={allowReset} onPick={(c) => { onChange(c); setAt(null); }} />
          </Floating>
        </>,
        document.body,
      )}
    </>
  );
}

// ── Conditions ─────────────────────────────────────────────────────────────────────────────────

/** "Format cells if…" in Sheets' order; null = separator. */
export const COND_OPTIONS: (CondKind | null)[] = [
  "empty", "notEmpty", "textContains", "textNotContains", "textStarts", "textEnds", "textIs", null,
  "dateIs", "dateBefore", "dateAfter", null,
  "gt", "gte", "lt", "lte", "eq", "neq", "between", "notBetween", null,
  "formula",
];
export const COND_LABEL: Record<CondKind, string> = {
  empty: "Is empty",
  notEmpty: "Is not empty",
  textContains: "Text contains",
  textNotContains: "Text does not contain",
  textStarts: "Text starts with",
  textEnds: "Text ends with",
  textIs: "Text is exactly",
  dateIs: "Date is",
  dateBefore: "Date is before",
  dateAfter: "Date is after",
  gt: "Greater than",
  gte: "Greater than or equal to",
  lt: "Less than",
  lte: "Less than or equal to",
  eq: "Is equal to",
  neq: "Is not equal to",
  between: "Is between",
  notBetween: "Is not between",
  formula: "Custom formula is",
};
export const DATE_MODES = [
  ["today", "Today"], ["tomorrow", "Tomorrow"], ["yesterday", "Yesterday"],
  ["week", "In the past week"], ["month", "In the past month"], ["year", "In the past year"], ["exact", "Exact date"],
] as const;
export type DateMode = (typeof DATE_MODES)[number][0];
export const isDateKind = (k: CondKind) => k === "dateIs" || k === "dateBefore" || k === "dateAfter";

/** The rule's one-line description, as in the rule list ("Cell is not empty", "Colour scale"). */
export function describeCondRule(rule: CondRule, shape: SheetShape, t: (en: string, vars?: Record<string, string | number>) => string): string {
  if (rule.type === "scale") return t("Colour scale");
  const k = rule.cond ?? "notEmpty";
  if (k === "empty") return t("Cell is empty");
  if (k === "notEmpty") return t("Cell is not empty");
  if (k === "formula") return `${t(COND_LABEL.formula)} ${rule.formula ? toDisplay(rule.formula, shape) : ""}`;
  const v = rule.values ?? [];
  if (isDateKind(k)) {
    const mode = DATE_MODES.find(([m]) => m === v[0]);
    const what = mode && mode[0] !== "exact" ? t(mode[1]) : mode ? v[1] ?? "" : v[0] ?? "";
    return `${t(COND_LABEL[k])} ${what}`.trim();
  }
  return `${t(COND_LABEL[k])} ${v.filter((x) => x !== "").join(` ${t("and")} `)}`.trim();
}

/** Inline style of the "123" preview swatch. */
export function condSwatchStyle(rule: CondRule): CSSProperties {
  if (rule.type === "scale" && rule.scale) {
    const s = rule.scale;
    const stops = s.mid && s.mid.type !== "none" ? [s.min.color, s.mid.color, s.max.color] : [s.min.color, s.max.color];
    return { background: `linear-gradient(90deg, ${stops.join(", ")})`, color: "#000000" };
  }
  const st = rule.style ?? {};
  return {
    background: st.bg ?? "transparent",
    color: st.fc ?? undefined,
    fontWeight: st.b ? 700 : undefined,
    fontStyle: st.i ? "italic" : undefined,
    textDecoration: [st.u ? "underline" : "", st.s ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
  };
}

// ── Draft ──────────────────────────────────────────────────────────────────────────────────────

type Scale = NonNullable<CondRule["scale"]>;
const DEFAULT_SCALE: Scale = {
  min: { type: "min", color: "#ffffff" },
  mid: { type: "none", color: interpolateHex("#ffffff", "#57bb8a", 0.5) },
  max: { type: "max", color: "#57bb8a" },
};
type Draft = {
  id: string;
  isNew: boolean;
  ranges: string;
  type: "single" | "scale";
  cond: CondKind;
  values: [string, string];
  dateMode: DateMode;
  formula: string;
  style: CondStyle;
  scale: Scale;
};

function toDraft(rule: CondRule, shape: SheetShape, isNew = false): Draft {
  const cond = rule.cond ?? "notEmpty";
  const v = rule.values ?? [];
  let dateMode: DateMode = "today";
  let values: [string, string] = [v[0] ?? "", v[1] ?? ""];
  if (isDateKind(cond)) {
    const known = DATE_MODES.find(([m]) => m === v[0]);
    dateMode = known ? known[0] : v[0] ? "exact" : "today";
    values = [dateMode === "exact" ? (known ? v[1] ?? "" : v[0] ?? "") : "", ""];
  }
  return {
    id: rule.id,
    isNew,
    ranges: rule.ranges.map((r) => rangeToA1(r, shape)).join(", "),
    type: rule.type,
    cond,
    values,
    dateMode,
    formula: rule.formula ? toDisplay(rule.formula, shape) : "",
    style: rule.style ?? { ...DEFAULT_COND_STYLE },
    scale: rule.scale ? { ...rule.scale, mid: rule.scale.mid ?? DEFAULT_SCALE.mid } : DEFAULT_SCALE,
  };
}

/** The draft as a rule; `strict` reports what's missing instead of quietly dropping it. */
function fromDraft(d: Draft, shape: SheetShape, strict: boolean): { rule: CondRule | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const parts = d.ranges.split(",").map((x) => x.trim()).filter(Boolean);
  const ranges = parts.map((p) => rangeFromA1(p, shape));
  if (strict && (!parts.length || ranges.some((r) => !r))) errors.range = "Invalid range";
  const valid = ranges.filter((r): r is string => Boolean(r));
  if (!valid.length) return { rule: null, errors: { range: "Invalid range", ...errors } };
  if (d.type === "scale") {
    const s = d.scale;
    const needs = (p: ScalePoint) => (p.type === "num" || p.type === "pct" || p.type === "pctile") && !(p.value ?? "").trim();
    if (strict && (needs(s.min) || needs(s.max) || (s.mid && needs(s.mid)))) errors.value = "Enter a value";
    return {
      rule: { id: d.id, ranges: valid, type: "scale", scale: { min: s.min, max: s.max, ...(s.mid && s.mid.type !== "none" ? { mid: s.mid } : {}) } },
      errors,
    };
  }
  let values: string[] | undefined;
  let formula: string | undefined;
  if (d.cond === "formula") {
    const f = d.formula.trim();
    if (!f) { if (strict) errors.formula = "Enter a formula"; }
    else formula = toStored(f.startsWith("=") ? f : `=${f}`, shape);
  } else if (isDateKind(d.cond)) {
    if (d.dateMode === "exact") {
      if (strict && !d.values[0].trim()) errors.value = "Enter a value";
      values = [d.values[0].trim()];
    } else values = [d.dateMode];
  } else if (COND_TWO_VALUES.includes(d.cond)) {
    if (strict && (!d.values[0].trim() || !d.values[1].trim())) errors.value = "Enter both values";
    values = [d.values[0].trim(), d.values[1].trim()];
  } else if (COND_ONE_VALUE.includes(d.cond)) {
    if (strict && !d.values[0].trim()) errors.value = "Enter a value";
    values = [d.values[0].trim()];
  }
  return {
    rule: { id: d.id, ranges: valid, type: "single", cond: d.cond, ...(values ? { values } : {}), ...(formula ? { formula } : {}), style: d.style },
    errors,
  };
}

const placeIn = (rules: CondRule[], rule: CondRule | null, id: string) => {
  if (!rule) return rules.filter((r) => r.id !== id);
  const i = rules.findIndex((r) => r.id === id);
  if (i < 0) return [...rules, rule];
  return rules.map((r) => (r.id === id ? rule : r));
};

const overlaps = (a: { top: number; bottom: number; left: number; right: number }, b: typeof a) =>
  a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;

// ── Panel ──────────────────────────────────────────────────────────────────────────────────────

/**
 * "Conditional format rules" — the right-hand sidebar, like Google Sheets'. Opening it on a selection
 * no rule touches starts a new "Is not empty" rule (green fill) right away, shown live; otherwise it
 * lists the sheet's rules (preview swatch, condition, range; delete on hover; drag or ↑↓ to change
 * priority — the first matching rule wins). Every edit is previewed live through `onPreview`; Done
 * saves the whole list through `onSave`, Cancel reverts the preview. The parent should drop its
 * preview when `onSave` or `onClose` is called.
 */
export function ConditionalFormatPanel({ rules, shape, sheetName, selectionRange, editId, canEdit, onPreview, onSave, onClose }: {
  rules: CondRule[];
  shape: SheetShape;
  sheetName: string;
  /** The current selection as A1 ("C2:C8"). */
  selectionRange: string;
  editId: string | null;
  canEdit: boolean;
  onPreview: (rules: CondRule[]) => void;
  onSave: (rules: CondRule[]) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const newDraft = (): Draft => toDraft({ id: newCondId(), ranges: [rangeFromA1(selectionRange, shape) ?? ""].filter(Boolean), type: "single", cond: "notEmpty", style: { ...DEFAULT_COND_STYLE } }, shape, true);
  const initial = (): Draft | null => {
    if (editId) {
      const r = rules.find((x) => x.id === editId);
      return r ? toDraft(r, shape) : null;
    }
    if (!canEdit) return null;
    const sel = rangeFromA1(selectionRange, shape);
    const selRect = sel ? rangeRect(sel, shape) : null;
    const covered = selRect && rules.some((r) => r.ranges.some((x) => { const rc = rangeRect(x, shape); return rc && overlaps(rc, selRect); }));
    return covered || !selRect ? null : newDraft();
  };
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [presetAt, setPresetAt] = useState<DOMRect | null>(null);
  const [scaleAt, setScaleAt] = useState<DOMRect | null>(null);
  // The saved list as this panel last knew it: the prop, or what it just handed to onSave (the prop
  // catches up a moment later), so the preview of the next rule never drops the one just saved.
  const savedRef = useRef(rules);
  const rulesKey = useMemo(() => JSON.stringify(rules), [rules]);
  useEffect(() => { savedRef.current = rules; }, [rules]);
  const save = (next: CondRule[]) => { savedRef.current = next; onSave(next); };

  useEffect(() => {
    if (!editId) return;
    const r = rules.find((x) => x.id === editId);
    if (r) { setDraft(toDraft(r, shape)); setErrors({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Live preview of the rule being edited.
  useEffect(() => {
    if (!draft) return;
    onPreview(placeIn(savedRef.current, fromDraft(draft, shape, false).rule, draft.id));
    // Keyed on the rules' CONTENT: callers pass `settings.condFormats ?? []`, a new array per render,
    // and depending on its identity re-ran this effect on every render the preview itself caused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, rulesKey]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setStyle = (patch: Partial<CondStyle>) => setDraft((d) => {
    if (!d) return d;
    const style: CondStyle = { ...d.style, ...patch };
    for (const k of Object.keys(style) as (keyof CondStyle)[]) if (style[k] === undefined) delete style[k];
    return { ...d, style };
  });
  const setPoint = (which: "min" | "mid" | "max", patch: Partial<ScalePoint>) =>
    setDraft((d) => {
      if (!d) return d;
      const cur: ScalePoint = d.scale[which] ?? { type: "none", color: "#ffffff" };
      const point: ScalePoint = { ...cur, ...patch };
      const scale: Scale = which === "min" ? { ...d.scale, min: point } : which === "max" ? { ...d.scale, max: point } : { ...d.scale, mid: point };
      return { ...d, scale };
    });

  const cancel = () => {
    onPreview(savedRef.current);
    setDraft(null);
    setErrors({});
    if (!savedRef.current.length) onClose();
  };
  /** Validate and save the rule being edited; false when something is missing. */
  const done = (): boolean => {
    if (!draft) return false;
    const { rule, errors: errs } = fromDraft(draft, shape, true);
    setErrors(errs);
    if (!rule || Object.keys(errs).length) return false;
    save(placeIn(savedRef.current, rule, draft.id));
    setDraft(null);
    return true;
  };
  const close = () => {
    // Sheets keeps what is on screen when the sidebar is closed; an unfinished rule is dropped.
    if (draft && canEdit) {
      const { rule, errors: errs } = fromDraft(draft, shape, true);
      if (rule && !Object.keys(errs).length) save(placeIn(savedRef.current, rule, draft.id));
      else onPreview(savedRef.current);
    }
    onClose();
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rules.length || from === to) return;
    const next = [...rules];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    save(next);
  };

  const scalePreset = (p: ScalePreset) => set({
    scale: {
      min: { ...(draft?.scale.min ?? DEFAULT_SCALE.min), color: p.min },
      max: { ...(draft?.scale.max ?? DEFAULT_SCALE.max), color: p.max },
      mid: p.mid
        ? { type: draft?.scale.mid && draft.scale.mid.type !== "none" ? draft.scale.mid.type : "pctile", value: draft?.scale.mid?.value || "50", color: p.mid }
        : { type: "none", color: interpolateHex(p.min, p.max, 0.5) },
    },
  });

  const draftRule = useMemo(() => (draft ? fromDraft(draft, shape, false).rule : null), [draft, shape]);
  const errText = (k: string) => (errors[k] ? t(errors[k]) : null);

  return (
    <SidePanel title={t("Conditional format rules")} onClose={close}>
      {!draft ? (
        <div className="flex flex-col">
          {rules.length === 0 && (
            <p className="px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">{t("No conditional formatting yet. Select cells, then add a rule.")}</p>
          )}
          <ul className="divide-y divide-border border-b border-border">
            {rules.map((r, i) => (
              <li
                key={r.id}
                onDragOver={(e) => { if (dragId && dragId !== r.id) { e.preventDefault(); } }}
                onDrop={(e) => { e.preventDefault(); if (dragId) move(rules.findIndex((x) => x.id === dragId), i); setDragId(null); }}
                className={cn("group relative flex items-center gap-2 px-2 py-2 transition hover:bg-muted/50", dragId === r.id && "opacity-50")}
              >
                {canEdit && (
                  <span
                    draggable
                    onDragStart={() => setDragId(r.id)}
                    onDragEnd={() => setDragId(null)}
                    title={t("Drag to reorder")}
                    className="cursor-grab text-muted-foreground/50 opacity-0 pointer-coarse:opacity-100! transition group-hover:opacity-100 active:cursor-grabbing"
                  ><GripVertical className="h-4 w-4" /></span>
                )}
                <button
                  type="button"
                  onClick={() => { setDraft(toDraft(r, shape)); setErrors({}); }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-black/5 text-xs" style={condSwatchStyle(r)}>123</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{describeCondRule(r, shape, t)}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground" title={`${sheetName}!${r.ranges.map((x) => rangeToA1(x, shape)).join(", ")}`}>
                      {r.ranges.map((x) => rangeToA1(x, shape)).join(", ")}
                    </span>
                  </span>
                </button>
                {canEdit && (
                  <span className="flex shrink-0 items-center opacity-0 pointer-coarse:opacity-100! transition group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                    <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={t("Move up")} title={t("Move up")}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => move(i, i + 1)} disabled={i === rules.length - 1} aria-label={t("Move down")} title={t("Move down")}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => save(rules.filter((x) => x.id !== r.id))} aria-label={t("Delete rule")} title={t("Delete rule")}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <button type="button" onClick={() => { setDraft(newDraft()); setErrors({}); }}
              className="flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-info hover:underline">
              <Plus className="h-4 w-4" /> {t("Add another rule")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4 pb-3">
          <div role="tablist" className="grid grid-cols-2 border-b border-border text-xs font-semibold">
            {([["single", "Single colour"], ["scale", "Colour scale"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={draft.type === k} disabled={!canEdit}
                onClick={() => set({ type: k })}
                className={cn("border-b-2 px-2 py-2.5 transition", draft.type === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t(l)}
              </button>
            ))}
          </div>

          <section className="space-y-1.5 px-3">
            <FieldLabel htmlFor="cf-range">{t("Apply to range")}</FieldLabel>
            <div className="relative">
              <input id="cf-range" value={draft.ranges} disabled={!canEdit} onChange={(e) => set({ ranges: e.target.value })}
                placeholder="A1:B10, D2:D" className={cn(inputClass, "pr-8 font-mono", errors.range && "border-destructive")} />
              <button type="button" disabled={!canEdit} onClick={() => set({ ranges: selectionRange })} title={t("Use the selected range")} aria-label={t("Use the selected range")}
                className="absolute right-1 top-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Table2 className="h-3.5 w-3.5" /></button>
            </div>
            {errText("range") && <p className="text-[11px] text-destructive">{errText("range")}</p>}
          </section>

          {draft.type === "single" ? (
            <>
              <section className="space-y-1.5 px-3">
                <div className="text-xs font-semibold">{t("Format rules")}</div>
                <FieldLabel htmlFor="cf-cond">{t("Format cells if…")}</FieldLabel>
                <SelectPicker id="cf-cond" value={draft.cond} disabled={!canEdit} ariaLabel={t("Format cells if…")} variant="field" size="sm" className="w-full"
                  onChange={(v) => set({ cond: v as CondKind, values: ["", ""], dateMode: "today" })}
                  options={COND_OPTIONS.flatMap((k) => (k ? [{ value: k, label: t(COND_LABEL[k]) }] : []))} />
                {isDateKind(draft.cond) && (
                  <>
                    <SelectPicker value={draft.dateMode} disabled={!canEdit} onChange={(v) => set({ dateMode: v as DateMode })} ariaLabel={t("Date")} variant="field" size="sm" searchable={false} className="w-full"
                      options={DATE_MODES.map(([m, l]) => ({ value: m, label: t(l) }))} />
                    {draft.dateMode === "exact" && (
                      <input value={draft.values[0]} disabled={!canEdit} onChange={(e) => set({ values: [e.target.value, ""] })} placeholder="11/10/2026"
                        aria-label={t("Value")} className={cn(inputClass, errors.value && "border-destructive")} />
                    )}
                  </>
                )}
                {!isDateKind(draft.cond) && (COND_ONE_VALUE.includes(draft.cond) || COND_TWO_VALUES.includes(draft.cond)) && (
                  <div className="space-y-1.5">
                    <input value={draft.values[0]} disabled={!canEdit} onChange={(e) => set({ values: [e.target.value, draft.values[1]] })}
                      placeholder={t("Value or formula")} aria-label={t("Value")} className={cn(inputClass, errors.value && "border-destructive")} />
                    {COND_TWO_VALUES.includes(draft.cond) && (
                      <input value={draft.values[1]} disabled={!canEdit} onChange={(e) => set({ values: [draft.values[0], e.target.value] })}
                        placeholder={t("Value or formula")} aria-label={t("Second value")} className={cn(inputClass, errors.value && "border-destructive")} />
                    )}
                  </div>
                )}
                {draft.cond === "formula" && (
                  <>
                    <input value={draft.formula} disabled={!canEdit} onChange={(e) => set({ formula: e.target.value })} placeholder="=C2>10"
                      aria-label={t("Custom formula")} className={cn(inputClass, "font-mono", errors.formula && "border-destructive")} />
                    <p className="text-[11px] text-muted-foreground">{t("Written for the first cell of the range; it shifts for the others, like a filled formula.")}</p>
                    {errText("formula") && <p className="text-[11px] text-destructive">{errText("formula")}</p>}
                  </>
                )}
                {errText("value") && <p className="text-[11px] text-destructive">{errText("value")}</p>}
              </section>

              <section className="space-y-1.5 px-3">
                <FieldLabel>{t("Formatting style")}</FieldLabel>
                <div className="overflow-hidden rounded-md border border-border">
                  <button type="button" disabled={!canEdit} onClick={(e) => setPresetAt(e.currentTarget.getBoundingClientRect())}
                    aria-haspopup="dialog" aria-label={t("Pick a default format")}
                    className="flex w-full items-center px-2.5 py-2 text-left text-xs" style={condSwatchStyle({ id: "", ranges: [], type: "single", style: draft.style })}>
                    <span className="flex-1">{t("Default")}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </button>
                  <div className="flex items-center gap-0.5 border-t border-border bg-card px-1 py-0.5">
                    {([["b", "Bold", Bold], ["i", "Italic", Italic], ["u", "Underline", Underline], ["s", "Strikethrough", Strikethrough]] as const).map(([k, l, Icon]) => (
                      <button key={k} type="button" disabled={!canEdit} aria-pressed={Boolean(draft.style[k])} title={t(l)} aria-label={t(l)}
                        onClick={() => setStyle({ [k]: draft.style[k] ? undefined : 1 } as Partial<CondStyle>)}
                        className={cn("grid h-7 w-7 place-items-center rounded-md transition hover:bg-muted disabled:opacity-35", draft.style[k] && "bg-muted text-foreground")}>
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    ))}
                    <HexColorButton label={t("Text colour")} icon={<Baseline className="h-3.5 w-3.5" />} disabled={!canEdit} value={draft.style.fc} onChange={(c) => setStyle({ fc: c })} />
                    <span className="mx-0.5 h-4 w-px bg-border" />
                    <HexColorButton label={t("Fill colour")} icon={<PaintBucket className="h-3.5 w-3.5" />} disabled={!canEdit} value={draft.style.bg} onChange={(c) => setStyle({ bg: c })} />
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section className="space-y-3 px-3">
              <div className="text-xs font-semibold">{t("Format rules")}</div>
              <div className="space-y-1.5">
                <FieldLabel>{t("Preview")}</FieldLabel>
                <button type="button" disabled={!canEdit} onClick={(e) => setScaleAt(e.currentTarget.getBoundingClientRect())} aria-haspopup="dialog" aria-label={t("Pick a colour scale")}
                  className="flex h-9 w-full items-center overflow-hidden rounded-md border border-border text-left text-xs">
                  <span className="px-2.5 font-medium">{t("Default")}</span>
                  <span className="h-full flex-1" style={draftRule ? condSwatchStyle(draftRule) : undefined} />
                  <ChevronDown className="mx-1 h-3.5 w-3.5 opacity-60" />
                </button>
              </div>
              {(["min", "mid", "max"] as const).map((which) => {
                const p = draft.scale[which] ?? DEFAULT_SCALE.mid!;
                const types: [ScalePointType, string][] = which === "min"
                  ? [["min", "Min value"], ["num", "Number"], ["pct", "Percent"], ["pctile", "Percentile"]]
                  : which === "max"
                    ? [["max", "Max value"], ["num", "Number"], ["pct", "Percent"], ["pctile", "Percentile"]]
                    : [["none", "None"], ["num", "Number"], ["pct", "Percent"], ["pctile", "Percentile"]];
                const valueOn = p.type === "num" || p.type === "pct" || p.type === "pctile";
                return (
                  <div key={which} className="space-y-1">
                    <FieldLabel>{t(which === "min" ? "Minpoint" : which === "mid" ? "Midpoint" : "Maxpoint")}</FieldLabel>
                    <div className="flex items-center gap-1.5">
                      <SelectPicker value={p.type} disabled={!canEdit} ariaLabel={t("Point type")} variant="field" size="sm" searchable={false} className="w-[118px] shrink-0"
                        onChange={(v) => {
                          const type = v as ScalePointType;
                          setPoint(which, { type, value: type === "pct" || type === "pctile" ? p.value || "50" : type === "num" ? p.value ?? "" : undefined });
                        }}
                        options={types.map(([v, l]) => ({ value: v, label: t(l) }))} />
                      <input value={valueOn ? p.value ?? "" : ""} disabled={!canEdit || !valueOn} onChange={(e) => setPoint(which, { value: e.target.value })}
                        aria-label={t("Value")} className={cn(inputClass, "min-w-0 flex-1", valueOn && errors.value && !(p.value ?? "").trim() && "border-destructive")} />
                      <HexColorButton label={t("Colour")} icon={<PaintBucket className="h-3.5 w-3.5" />} allowReset={false}
                        disabled={!canEdit || p.type === "none"} value={p.color} onChange={(c) => c && setPoint(which, { color: c })} />
                    </div>
                  </div>
                );
              })}
              {errText("value") && <p className="text-[11px] text-destructive">{errText("value")}</p>}
            </section>
          )}

          {canEdit && (
            <div className="flex items-center justify-end gap-2 px-3">
              <button type="button" onClick={cancel} className={cn(secondaryBtn, "border border-border")}>{t("Cancel")}</button>
              <button type="button" onClick={() => done()} className={primaryBtn}>{t("Done")}</button>
            </div>
          )}
          {canEdit && (
            <button type="button" onClick={() => { if (done()) { setDraft(newDraft()); setErrors({}); } }}
              className="flex items-center gap-1.5 border-t border-border px-4 pt-3 text-xs font-semibold text-info hover:underline">
              <Plus className="h-4 w-4" /> {t("Add another rule")}
            </button>
          )}
        </div>
      )}

      {presetAt && draft && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setPresetAt(null)} />
          <Floating anchor={{ rect: presetAt }} className="w-[260px] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-pop">
            <div className="px-1 pb-1.5 text-[11px] font-semibold text-muted-foreground">{t("Default formatting style")}</div>
            <div className="grid grid-cols-6 gap-1.5">
              {COND_PRESETS.map((p, i) => (
                <button key={i} type="button" title={`${p.fc} / ${p.bg}`} aria-label={t("Style {n}", { n: i + 1 })}
                  onClick={() => { setStyle({ fc: p.fc, bg: p.bg }); setPresetAt(null); }}
                  className="grid h-8 place-items-center rounded-md border border-black/10 text-xs font-semibold" style={{ background: p.bg, color: p.fc }}>
                  123
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setStyle({ fc: undefined, bg: undefined, b: undefined, i: undefined, u: undefined, s: undefined }); setPresetAt(null); }}
              className="mt-2 w-full rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{t("No formatting")}</button>
          </Floating>
        </>,
        document.body,
      )}
      {scaleAt && draft && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setScaleAt(null)} />
          <Floating anchor={{ rect: scaleAt }} className="w-[260px] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-pop">
            <div className="grid grid-cols-2 gap-1.5">
              {SCALE_PRESETS.map((p, i) => (
                <button key={i} type="button" aria-label={t("Colour scale {n}", { n: i + 1 })}
                  onClick={() => { scalePreset(p); setScaleAt(null); }}
                  className="h-7 rounded-md border border-black/10"
                  style={{ background: `linear-gradient(90deg, ${[p.min, p.mid, p.max].filter(Boolean).join(", ")})` }} />
              ))}
            </div>
          </Floating>
        </>,
        document.body,
      )}
    </SidePanel>
  );
}

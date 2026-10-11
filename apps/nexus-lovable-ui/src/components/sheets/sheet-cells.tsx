import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { NexusSheetColumnColor } from "@/lib/nexus-api";
import { SUPPORTED_FUNCTIONS } from "@/lib/sheet-formula";
import { Floating } from "./sheet-float";
import {
  COLUMN_COLOR_CLASS, COLUMN_COLOR_LABEL, COLUMN_TYPE_LABEL, CHIP_COLORS, CHIP_COLOR_CLASS, RULE_OP_LABEL, RULE_STYLE_CLASS,
  optionColor, readMulti,
  type NexusSheetColumn, type NexusSheetColumnType, type NexusSheetRule,
} from "./sheet-types";

/** Where the cursor goes after a commit. */
export type Next = "down" | "up" | "right" | "left" | null;

/**
 * The picker for a multi-select cell.
 *
 * A tick list rather than a native `<select multiple>`: the native one needs Ctrl-click to add a
 * second value, which nobody discovers, and it can't be made to fit a 29px row. Portaled + fixed like
 * every other popover here, because the grid's overflow:auto would clip it.
 *
 * Commits on close, not on every tick — one undo entry per visit instead of one per checkbox.
 */
export function ChoiceEditor({ col, multi, initial, onCommit, onCancel }: {
  col: NexusSheetColumn;
  /** false = pick one and close, true = tick several then close. */
  multi: boolean;
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const [picked, setPicked] = useState<string[]>(() => (multi ? readMulti(initial) : initial ? [initial] : []));
  const boxRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    const r = boxRef.current?.closest("td")?.getBoundingClientRect();
    if (r) setAnchor(r);
  }, []);

  const toggle = (v: string) => {
    // Single choice closes on the click — an extra "Selesai" step for one value is friction nobody
    // asked for. Multi keeps the list open so several ticks are one visit.
    if (!multi) { onCommit(picked[0] === v ? "" : v); return; }
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  };

  const options = col.options ?? [];
  // Values already in the cell that are no longer offered still show, ticked — hiding them would
  // silently drop data the moment someone opened the picker.
  const extras = picked.filter((v) => !options.includes(v));

  return (
    <>
      <span ref={boxRef} className="block truncate text-xs text-muted-foreground">
        {picked.length ? picked.join(", ") : "—"}
      </span>
      {anchor && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => onCommit(multi ? picked.join(", ") : (picked[0] ?? ""))} />
          <Floating
            anchor={{ rect: anchor }}
            className="w-56 rounded-xl border border-border bg-card p-1 shadow-pop"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter") onCommit(multi ? picked.join(", ") : (picked[0] ?? ""));
            }}
          >
            {options.length === 0 && extras.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                {t("This column has no choices yet. Open the column settings to add some.")}
              </p>
            )}
            {[...options, ...extras].map((o) => (
              <button
                key={o}
                onClick={() => toggle(o)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-semibold transition hover:bg-muted"
              >
                <span className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded border",
                  picked.includes(o) ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  {picked.includes(o) && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className={cn("min-w-0 max-w-full truncate rounded-full px-2 leading-5", optionColor(col, o))}>{o}</span>
                {!options.includes(o) && <span className="shrink-0 text-[9px] text-muted-foreground">{t("not in the list")}</span>}
              </button>
            ))}
            {multi ? (
              <button
                onClick={() => onCommit(picked.join(", "))}
                className="mt-1 w-full rounded-lg bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground"
              >{t("Done")}</button>
            ) : (
              <button
                onClick={() => onCommit("")}
                className="mt-1 w-full rounded-lg border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-rose-300 hover:text-rose-600"
              >{t("Clear")}</button>
            )}
          </Floating>
        </>,
        document.body,
      )}
    </>
  );
}

export function ColumnPopover({ col, anchor, onClose, onSave }: {
  col: NexusSheetColumn;
  /** Screen rect of the header cell. */
  anchor: DOMRect | null;
  onClose: () => void;
  onSave: (patch: { name: string; type: NexusSheetColumnType; options?: string[]; optionColors?: Record<string, NexusSheetColumnColor>; color?: NexusSheetColumnColor; rules?: NexusSheetRule[] }) => void;
}) {
  const { t } = useLang();
  const [name, setName] = useState(col.name);
  const [type, setType] = useState<NexusSheetColumnType>(col.type);
  const [options, setOptions] = useState<string[]>(col.options ?? []);
  const [optionColors, setOptionColors] = useState<Record<string, NexusSheetColumnColor>>(col.optionColors ?? {});
  /** Which choice has its palette open, if any. */
  const [palette, setPalette] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<NexusSheetColumnColor | undefined>(col.color);
  const [rules, setRules] = useState<NexusSheetRule[]>(col.rules ?? []);
  const addOption = () => {
    const v = draft.trim();
    // Silently ignoring a duplicate beats an error toast: the choice the user wanted is already there.
    if (!v || options.includes(v)) { setDraft(""); return; }
    setOptions((o) => [...o, v.slice(0, 80)]);
    setDraft("");
  };
  const save = () => onSave({
    name: name.trim(),
    type,
    // Choices only mean anything on a select column; carrying them on a text column would resurrect
    // a stale list the moment someone switched the type back.
    options: type === "select" || type === "multiselect" ? options : [],
    // Colours for choices that no longer exist are dropped, so a deleted-then-retyped choice starts
    // from the automatic colour instead of resurrecting an old one.
    optionColors: Object.fromEntries(Object.entries(optionColors).filter(([k]) => options.includes(k))),
    color,
    rules: rules.length ? rules : undefined,
  });
  // Portaled and fixed, for the same reason as the autocomplete and the comment thread: anchored
  // inside the <th> it was clipped by the grid's overflow:auto, which hid the colour picker and the
  // rules editor below the fold entirely.
  // Placed by useFloating: below the header when it fits, flipped/clamped and scrolling otherwise —
  // the popover grows with the number of choices and rules, so no fixed number is ever right.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <Floating
        anchor={{ rect: anchor ?? { left: 80, top: 120, right: 80, bottom: 120 } }}
        className="w-56 space-y-2 rounded-xl border border-border bg-card p-3 font-normal shadow-pop"
      >
        <input
          autoFocus value={name} maxLength={80} placeholder={t("Column name (optional)")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") save();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs font-normal outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-1">
          {(Object.keys(COLUMN_TYPE_LABEL) as NexusSheetColumnType[]).map((ty) => (
            <button key={ty} onClick={() => setType(ty)}
              className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold transition",
                type === ty ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
              {t(COLUMN_TYPE_LABEL[ty])}
            </button>
          ))}
        </div>
        {/* The choices themselves. Without this a "Pilihan" column rendered an empty dropdown and
            there was nowhere in the app to fill it. */}
        {(type === "select" || type === "multiselect") && (
          <div className="space-y-1 border-t border-border pt-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Dropdown choices")}</div>
            {options.length > 0 && (
              <div className="space-y-0.5">
                {options.map((o, i) => (
                  <div key={o}>
                    <div className="flex items-center gap-1">
                      {/* The swatch opens this choice's palette. Colours default to cycling the
                          palette by position, so the list is legible before anyone touches it. */}
                      <button
                        onClick={() => setPalette((c) => (c === o ? null : o))}
                        title={t("Colour of this choice")}
                        className={cn("h-4 w-4 shrink-0 rounded-full border border-border",
                          (optionColors[o] ? CHIP_COLOR_CLASS[optionColors[o]] : CHIP_COLOR_CLASS[CHIP_COLORS[i % CHIP_COLORS.length]]).split(" ")[0])}
                      />
                      <span className={cn("min-w-0 flex-1 truncate rounded-full px-2 text-[11px] font-semibold leading-5",
                        optionColors[o] ? CHIP_COLOR_CLASS[optionColors[o]] : CHIP_COLOR_CLASS[CHIP_COLORS[i % CHIP_COLORS.length]])}>{o}</span>
                      <button onClick={() => {
                        setOptions((xs) => xs.filter((_, j) => j !== i));
                        setOptionColors((c) => { const n = { ...c }; delete n[o]; return n; });
                      }} className="shrink-0 text-muted-foreground hover:text-rose-600"><X className="h-2.5 w-2.5" /></button>
                    </div>
                    {palette === o && (
                      <div className="flex flex-wrap gap-1 py-1 pl-5">
                        {CHIP_COLORS.map((c) => (
                          <button key={c} title={t(COLUMN_COLOR_LABEL[c])}
                            onClick={() => { setOptionColors((prev) => ({ ...prev, [o]: c })); setPalette(null); }}
                            className={cn("h-4 w-4 rounded-full border border-border", CHIP_COLOR_CLASS[c].split(" ")[0])} />
                        ))}
                        <button title={t("Back to automatic")}
                          onClick={() => { setOptionColors((prev) => { const n = { ...prev }; delete n[o]; return n; }); setPalette(null); }}
                          className="rounded-full border border-dashed border-border px-1.5 text-[9px] font-bold text-muted-foreground">{t("auto")}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") { e.preventDefault(); addOption(); }
                  if (e.key === "Escape") onClose();
                }}
                placeholder={t("Type a choice, Enter")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs font-normal outline-none focus:border-primary"
              />
              <button onClick={addOption} disabled={!draft.trim()}
                className="shrink-0 rounded-lg border border-border px-2 text-xs font-bold text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-40">+</button>
            </div>
          </div>
        )}

        {/* Header tint. */}
        <div className="space-y-1 border-t border-border pt-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Header colour")}</div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setColor(undefined)}
              title={t("No colour")}
              className={cn("h-5 w-5 rounded-full border bg-muted", !color ? "border-primary ring-2 ring-primary/30" : "border-border")}
            />
            {(Object.keys(COLUMN_COLOR_CLASS) as NexusSheetColumnColor[]).map((c) => (
              <button key={c} onClick={() => setColor(c)} title={t(COLUMN_COLOR_LABEL[c])}
                className={cn("h-5 w-5 rounded-full border", COLUMN_COLOR_CLASS[c].split(" ")[0],
                  color === c ? "border-primary ring-2 ring-primary/30" : "border-border")} />
            ))}
          </div>
        </div>

        {/* Conditional formatting — the first matching rule wins, so order is meaningful. */}
        <div className="space-y-1 border-t border-border pt-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Conditional formatting")}</div>
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-1">
              <select
                value={r.op}
                onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, op: e.target.value as NexusSheetRule["op"] } : x)))}
                onKeyDown={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[11px] font-normal outline-none"
              >
                {(Object.keys(RULE_OP_LABEL) as NexusSheetRule["op"][]).map((o) => (
                  <option key={o} value={o}>{t(RULE_OP_LABEL[o])}</option>
                ))}
              </select>
              {r.op !== "empty" && r.op !== "notEmpty" && (
                <input
                  value={r.value ?? ""}
                  onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={t("value")}
                  className="w-16 rounded border border-border bg-background px-1 py-0.5 text-[11px] font-normal outline-none"
                />
              )}
              <select
                value={r.style}
                onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, style: e.target.value as NexusSheetRule["style"] } : x)))}
                onKeyDown={(e) => e.stopPropagation()}
                className={cn("rounded border border-border px-1 py-0.5 text-[11px] font-normal outline-none", RULE_STYLE_CLASS[r.style])}
              >
                <option value="red">{t("red")}</option>
                <option value="amber">{t("yellow")}</option>
                <option value="green">{t("green")}</option>
                <option value="blue">{t("blue")}</option>
                <option value="grey">{t("grey")}</option>
                <option value="bold">{t("bold")}</option>
              </select>
              <button onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                className="shrink-0 text-muted-foreground hover:text-rose-600"><X className="h-3 w-3" /></button>
            </div>
          ))}
          {rules.length < 8 && (
            <button
              onClick={() => setRules((rs) => [...rs, { op: "lt", value: "0", style: "red" }])}
              className="w-full rounded-lg border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            >{t("+ Rule")}</button>
          )}
        </div>

        <button onClick={save}
          className="w-full rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-primary-foreground">{t("Save")}</button>
      </Floating>
    </>,
    document.body,
  );
}

/**
 * A cell pointing at a real NEXUS task — the thing a plain spreadsheet can't do.
 *
 * The cell stores only the task id; the title and status are read live, so a task renamed or moved to
 * Done updates here without anyone touching the sheet.
 */
export function TaskCell({ taskId, tasks, canEdit, onOpen, onPick }: {
  taskId: string;
  tasks: { id: string; title: string; status?: string | null }[];
  canEdit: boolean;
  onOpen?: (taskId: string) => void;
  onPick: (taskId: string) => void;
}) {
  const { t } = useLang();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const task = tasks.find((t) => t.id === taskId);

  if (picking) {
    const matches = tasks.filter((t) => t.title.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
    return (
      <div className="relative">
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setPicking(false); }}
          onBlur={() => setTimeout(() => setPicking(false), 120)}
          placeholder={t("Search tasks…")}
          // Fills the cell exactly (the grid places it absolutely), so editing never changes a row's
        // height — the window's pixel offsets depend on that. The blue frame is the active cell's.
        className="h-full w-full select-text bg-card px-1.5 text-[13px] text-foreground outline-none [box-shadow:inset_0_0_0_2px_var(--info)]"
        />
        <div className="absolute left-0 top-full z-40 mt-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-border bg-card shadow-pop">
          {taskId && (
            <button onMouseDown={(e) => { e.preventDefault(); onPick(""); setPicking(false); }}
              className="block w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent">{t("Clear")}</button>
          )}
          {matches.map((t) => (
            <button key={t.id} onMouseDown={(e) => { e.preventDefault(); onPick(t.id); setPicking(false); }}
              className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-accent">{t.title}</button>
          ))}
          {!matches.length && <div className="px-3 py-2 text-xs text-muted-foreground">{t("No match.")}</div>}
        </div>
      </div>
    );
  }

  if (!task) {
    return canEdit ? (
      <button onClick={() => setPicking(true)} className="text-xs text-muted-foreground/60 hover:text-primary">
        {taskId ? t("task not found") : t("+ task")}
      </button>
    ) : <span />;
  }
  const done = (task.status ?? "").toUpperCase() === "DONE";
  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => onOpen?.(task.id)}
        title={t("Open task")}
        className={cn("min-w-0 truncate text-left text-xs font-semibold text-primary hover:underline", done && "line-through opacity-60")}
      >{task.title}</button>
      {canEdit && (
        <button onClick={() => setPicking(true)} title={t("Change task")}
          className="shrink-0 text-[10px] text-muted-foreground hover:text-primary">✎</button>
      )}
    </span>
  );
}


/** The one mounted input. Uncontrolled on purpose: a refetch can never overwrite what's being typed. */
export function CellEditor({ col, initial, seeded, onCommit, onCancel, onDraftChange, registerEditor }: {
  col: NexusSheetColumn; initial: string;
  /** True when `initial` is the keystroke that OPENED the editor, rather than the cell's value. */
  seeded: boolean;
  onCommit: (raw: string, next: Next) => void;
  onCancel: () => void;
  onDraftChange: (text: string) => void;
  registerEditor: (el: HTMLInputElement | null) => void;
}) {
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (!(el instanceof HTMLInputElement)) return;
    // Caret at the END, like Sheets: F2 / double-click / Enter APPEND to what's there (typing a
    // character instead replaces the cell — that path arrives here already seeded with the key).
    // Never select-all: a keystroke opening the editor would then eat the next one ("=SUM" -> "SUM").
    try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* date inputs */ }
  }, [seeded]);

  const finish = (next: Next) => {
    if (done.current) return;
    done.current = true;
    onCommit(ref.current?.value ?? "", next);
  };

  // A dropdown COLUMN opened with Enter/double-click shows its list; typing into it (seeded) edits
  // the text like any other cell.
  if ((col.type === "multiselect" || col.type === "select") && !seeded) {
    return (
      <ChoiceEditor
        col={col}
        multi={col.type === "multiselect"}
        initial={initial}
        onCommit={(v) => onCommit(v, null)}
        onCancel={onCancel}
      />
    );
  }

  return (
    <FormulaInput
      inputRef={ref as React.RefObject<HTMLInputElement>}
      col={col}
      initial={initial}
      seeded={seeded}
      onFinish={finish}
      onCancel={() => { done.current = true; onCancel(); }}
      onDraftChange={onDraftChange}
      registerEditor={registerEditor}
    />
  );
}

/**
 * The cell input, plus the function autocomplete that appears once the text starts with "=".
 *
 * The list only offers functions the engine actually implements (SUPPORTED_FUNCTIONS lives next to
 * the evaluator's switch) — suggesting SUMPRODUCT and then returning #NAME? would be worse than not
 * suggesting it. Rendered through a portal with fixed positioning because the grid scroll container
 * has `overflow:auto`, which would otherwise clip a dropdown anchored inside a <td>.
 */
function FormulaInput({ inputRef, col, initial, seeded, onFinish, onCancel, onDraftChange, registerEditor }: {
  inputRef: React.RefObject<HTMLInputElement>;
  col: NexusSheetColumn;
  initial: string;
  /** Opened by typing (replace mode): arrow keys commit and move, like Sheets. */
  seeded: boolean;
  onFinish: (next: Next) => void;
  onCancel: () => void;
  onDraftChange: (text: string) => void;
  registerEditor: (el: HTMLInputElement | null) => void;
}) {
  const [text, setTextRaw] = useState(initial);
  const { lang, t } = useLang();
  // The grid needs the live draft to know whether a click should insert a reference, and to draw the
  // dashed outlines — so every change goes up as well as into local state.
  const setText = useCallback((v: string) => { setTextRaw(v); onDraftChange(v); }, [onDraftChange]);
  useEffect(() => {
    onDraftChange(initial);
    registerEditor(inputRef.current);
    return () => { onDraftChange(""); registerEditor(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [pick, setPick] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  /**
   * What to complete right now.
   *   ""   -> the caret sits right after "=", an operator, "(" or a separator: offer everything,
   *           which is what a spreadsheet does the instant you type "=".
   *   "SU" -> filter by that prefix.
   *   null -> nothing to complete (mid-number, after ")" or a closing quote).
   */
  const token = useMemo(() => {
    if (!text.startsWith("=")) return null;
    const letters = /([A-Za-z]+)$/.exec(text);
    if (letters) return letters[1].toUpperCase();
    return /[=+\-*/^&<>(,;:]$/.test(text) ? "" : null;
  }, [text]);

  const matches = useMemo(
    () => (token === null ? [] : SUPPORTED_FUNCTIONS.filter((f) => f.name.startsWith(token))),
    [token],
  );
  const open = matches.length > 0;

  useEffect(() => { setPick(0); }, [token]);
  useEffect(() => {
    if (!open) { setAnchor(null); return; }
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setAnchor(r);
  }, [open, text, inputRef]);

  const accept = (name: string) => {
    // Replace the half-typed name and open the bracket, the way every spreadsheet does.
    const next = `${text.replace(/[A-Za-z]+$/, "")}${name}(`;
    setText(next);
    const el = inputRef.current;
    if (el) {
      el.value = next;
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.length, next.length); });
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type={col.type === "date" && !text.startsWith("=") ? "date" : "text"}
        inputMode={col.type === "number" || col.type === "currency" ? "decimal" : undefined}
        defaultValue={initial}
        onChange={(e) => setText(e.target.value)}
        onSelect={(e) => setTextRaw((e.target as HTMLInputElement).value)}
        // Blur while clicking a suggestion would commit before the pick lands; the list uses
        // onMouseDown+preventDefault so focus never leaves in the first place.
        onBlur={() => onFinish(null)}
        onKeyDown={(e) => {
          e.stopPropagation(); // arrows move the caret, not the grid selection
          if (open) {
            if (e.key === "ArrowDown") { e.preventDefault(); setPick((p) => (p + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setPick((p) => (p - 1 + matches.length) % matches.length); return; }
            if (e.key === "Tab") { e.preventDefault(); accept(matches[pick].name); return; }
            if (e.key === "Enter" && token) { e.preventDefault(); accept(matches[pick].name); return; }
            if (e.key === "Escape") { e.preventDefault(); setText(`${text} `); return; } // close list, keep editing
          }
          if (e.key === "Enter") { e.preventDefault(); onFinish(e.shiftKey ? "up" : "down"); }
          else if (e.key === "Tab") { e.preventDefault(); onFinish(e.shiftKey ? "left" : "right"); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          else if (seeded && !text.startsWith("=") && !e.shiftKey && !e.metaKey && !e.ctrlKey &&
            (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            // Typed straight into the cell (not F2): arrows commit and move on, as in Sheets.
            e.preventDefault();
            onFinish(e.key === "ArrowDown" ? "down" : e.key === "ArrowUp" ? "up" : e.key === "ArrowLeft" ? "left" : "right");
          }
        }}
        // Fills the cell exactly (the grid places it absolutely), so editing never changes a row's
        // height — the window's pixel offsets depend on that. The blue frame is the active cell's.
        className="h-full w-full select-text bg-card px-1.5 text-[13px] text-foreground outline-none [box-shadow:inset_0_0_0_2px_var(--info)]"
      />
      {open && anchor && createPortal(
        <Floating
          anchor={{ rect: anchor }}
          style={{ width: Math.max(240, anchor.width) }}
          className="rounded-xl border border-border bg-card shadow-pop"
        >
          <div className="max-h-64 overflow-y-auto">
          {matches.map((f, i) => (
            <button
              key={f.name}
              onMouseDown={(e) => { e.preventDefault(); accept(f.name); }}
              onMouseEnter={() => setPick(i)}
              className={cn("block w-full px-3 py-1.5 text-left transition", i === pick ? "bg-primary/10" : "hover:bg-accent")}
            >
              <div className="font-mono text-xs font-bold">
                {f.name}<span className="font-normal text-muted-foreground">{f.args}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">{lang === "en" ? f.descEn : f.desc}</div>
            </button>
          ))}
          </div>
          <div className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
            <b>Tab</b> {t("to pick")} · <b>↑↓</b> {t("to move")}
          </div>
        </Floating>,
        document.body,
      )}
    </>
  );
}

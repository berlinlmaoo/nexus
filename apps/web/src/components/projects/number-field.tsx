import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { RupiahInput } from "@/components/RupiahInput";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import {
  BAR_COLORS,
  NUMBER_DECIMALS,
  filterNumberFormats,
  formatNumberWith,
  normalizeNumberFieldValue,
  numberEditText,
  numberFill,
  numberFormatLabel,
  numberOptions,
  numberOptionsToStore,
  storedNumber,
  typedNumberFieldValue,
  type BarColor,
  type NumberOptions,
  type NumberShowAs,
} from "@/lib/custom-field-number";

/**
 * Number properties, Notion-style (owner, 15 Oct 2026): a field's Number format, Decimal places and
 * Show as (Number / Bar / Ring) live in its options (lib/custom-field-number.ts) and apply to every view
 * showing it. Every number reads with Indonesian grouping in both languages.
 */

/** Bar / Ring colours: the status palette's dots ("Default" is green, as in Notion). */
const BAR_COLOR_VAR: Record<BarColor, string> = {
  default: "var(--st-green-dot)",
  gray: "var(--st-gray-dot)",
  brown: "var(--st-brown-dot)",
  orange: "var(--st-orange-dot)",
  yellow: "var(--st-yellow-dot)",
  green: "var(--st-green-dot)",
  blue: "var(--st-blue-dot)",
  purple: "var(--st-purple-dot)",
  pink: "var(--st-pink-dot)",
  red: "var(--st-red-dot)",
};
const BAR_COLOR_LABEL: Record<BarColor, string> = {
  default: "Default", gray: "Gray", brown: "Brown", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple", pink: "Pink", red: "Red",
};

function Ring({ fill, color, size = 16 }: { fill: number; color: string; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2} className="stroke-muted" />
      {fill > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2} stroke={color} strokeLinecap="round" strokeDasharray={`${c * fill} ${c}`} />}
    </svg>
  );
}

/**
 * A number value as its field shows it: the formatted text, or a Bar / Ring with (or without) the number.
 * `align="end"` right-aligns a plain number (table cells); a Bar always starts at the left, like Notion.
 */
export function NumberValue({ n, options, align = "start", className, title }: { n: number; options: NumberOptions; align?: "start" | "end"; className?: string; title?: string }) {
  const text = formatNumberWith(n, options);
  const fill = numberFill(n, options);
  const color = BAR_COLOR_VAR[options.barColor] ?? BAR_COLOR_VAR.default;
  const pct = `${Math.round(fill * 100)}%`;
  if (options.showAs === "bar") {
    return (
      <span className={cn("flex min-w-0 items-center gap-2 tabular-nums", className)} title={title ? `${title}: ${text}` : text}>
        {options.showNumber && <span className="shrink-0">{text}</span>}
        <span role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)} aria-label={options.showNumber ? undefined : text} className="relative h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-muted">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct, backgroundColor: color }} />
        </span>
      </span>
    );
  }
  if (options.showAs === "ring") {
    return (
      <span className={cn("flex min-w-0 items-center gap-1.5 tabular-nums", align === "end" && "justify-end", className)} title={title ? `${title}: ${text}` : text} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)} aria-label={text}>
        {options.showNumber && <span className="truncate">{text}</span>}
        <Ring fill={fill} color={color} />
      </span>
    );
  }
  return <span className={cn("block truncate tabular-nums", align === "end" && "text-right", className)} title={title ? `${title}: ${text}` : undefined}>{text}</span>;
}

/** A stored NUMBER field value in its field's look; text that is no number shows as it is. */
export function NumberFieldValue({ raw, fieldOptions, align, className, title }: { raw: unknown; fieldOptions: unknown; align?: "start" | "end"; className?: string; title?: string }) {
  const n = storedNumber(raw, fieldOptions);
  if (n === null) return typeof raw === "string" && raw.trim() ? <span className={cn("block truncate", className)}>{raw}</span> : null;
  return <NumberValue n={n} options={numberOptions(fieldOptions)} align={align} className={className} title={title} />;
}

/** The value a write sends, compared as stored: a number and its text ("12" / 12) are the same write. */
function sameValue(a: number | string, b: number | string): boolean {
  return String(a) === String(b);
}

/**
 * A NUMBER field you can edit in place: reads in its format (Bar / Ring too) and becomes a box on click.
 * Rupiah without decimals keeps the "Rp" box that groups while you type. Hands back what to store: a JS number
 * (the server keeps a JSON number as it is), "" to clear, or the typed text when it is no number.
 *
 * Owner bug 27 Oct 2026 ("Harga" in a form-made task went back to the old amount after Enter): the row showed the
 * OLD amount until the save's refetch came back, a click in that window opened the box with the old amount, and
 * leaving that box wrote the old amount back over the new one. Now
 *   - the amount just saved shows at once and stays until the server's value arrives (or the save fails);
 *   - only what was typed is written: opening and leaving the box without a change writes nothing;
 *   - Enter and Tab save straight away, Escape cancels, and a box that goes away mid-edit still saves.
 * `onSet` may return a promise: a rejected save puts the stored value back (the caller says why).
 */
export function NumberFieldInput({ raw, fieldOptions, onSet, ariaLabel, inline, align = "start", placeholder }: {
  raw: string;
  fieldOptions: unknown;
  onSet: (stored: number | string) => void | Promise<unknown>;
  ariaLabel?: string;
  /** Table cell: no box until focused. */
  inline?: boolean;
  align?: "start" | "end";
  placeholder?: string;
}) {
  const { lang } = useLang();
  const o = useMemo(() => numberOptions(fieldOptions), [fieldOptions]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // The value just written, shown until the stored value changes (the refetch) or the save fails.
  const [pending, setPending] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const opened = useRef<number | string>("");
  const live = useRef({ editing: false, draft: "", closed: true });
  const wholeRupiah = o.numberFormat === "IDR" && !o.decimals;
  const stored = raw.trim();
  const shownRaw = pending ?? stored;
  useEffect(() => { setPending(null); }, [stored]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  const read = (text: string): number | string => typedNumberFieldValue(text, fieldOptions, wholeRupiah ? "id" : lang);
  const save = (text: string) => {
    const next = read(text);
    // Only a change the person typed: a box opened on a stale amount and left as it was writes nothing.
    if (sameValue(next, opened.current)) return;
    const shown = typeof next === "number" ? String(next) : next;
    setPending(shown);
    const drop = () => setPending((p) => (p === shown ? null : p));
    let r: void | Promise<unknown>;
    try { r = onSet(next); } catch { drop(); return; }
    // Saved but stored the same as before (nothing for the refetch to change): let the stored value show again.
    if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).then(() => { setTimeout(drop, 5000); }, drop);
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const finish = (commit: boolean) => {
    if (live.current.closed) return;
    live.current.closed = true;
    setEditing(false);
    if (commit) save(live.current.draft);
  };
  live.current.editing = editing;
  live.current.draft = draft;
  // The box goes away while open (the panel closes, the row re-renders under a new key): what was typed is kept.
  useEffect(() => () => { if (live.current.editing && !live.current.closed) { live.current.closed = true; saveRef.current(live.current.draft); } }, []);
  const box = inline
    ? "w-full min-w-0 rounded-md border border-primary bg-background px-1.5 py-1 text-sm outline-none"
    : "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring";
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
  };
  if (editing) {
    if (wholeRupiah) {
      return (
        <RupiahInput value={draft} onChange={setDraft} onBlur={() => finish(true)} ariaLabel={ariaLabel} className={cn(box, align === "end" && "text-right")} inputRef={ref}
          allowNegative onKeyDown={onKeyDown} />
      );
    }
    return (
      <input ref={ref} value={draft} inputMode="decimal" aria-label={ariaLabel} autoComplete="off" onChange={(e) => setDraft(e.target.value)} onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
        className={cn(box, "tabular-nums", align === "end" && "text-right")} />
    );
  }
  const start = () => {
    if (editing) return;
    const text = wholeRupiah ? normalizeNumberFieldValue(shownRaw, fieldOptions) : numberEditText(shownRaw, fieldOptions, lang);
    opened.current = read(text);
    live.current = { editing: true, draft: text, closed: false };
    setDraft(text);
    setEditing(true);
  };
  const shown = shownRaw ? <NumberFieldValue raw={shownRaw} fieldOptions={fieldOptions} align={align} /> : <span className="text-muted-foreground/70">{placeholder ?? ""}</span>;
  return (
    <button type="button" onClick={start} onFocus={start} aria-label={ariaLabel}
      className={cn("block w-full min-w-0 text-left text-sm", inline ? "min-h-7 rounded-md px-1.5 py-1 hover:bg-muted" : "min-h-[34px] rounded-lg border border-border bg-background px-2.5 py-1.5 hover:border-ring/40")}>
      {shown}
    </button>
  );
}

// ─── settings ───────────────────────────────────────────────────────────────────────────────────────

function Row({ label, value, children }: { label: string; value: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
          <span>{label}</span>
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground"><span className="truncate">{value}</span><ChevronRight className="h-3.5 w-3.5 shrink-0" /></span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 p-1">{children(() => setOpen(false))}</PopoverContent>
    </Popover>
  );
}

function FormatList({ value, onPick }: { value: string; onPick: (f: string) => void }) {
  const { t, lang } = useLang();
  const [q, setQ] = useState("");
  const list = filterNumberFormats(q, lang);
  return (
    <div>
      <label className="mb-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 focus-within:border-ring">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filter formats…")} aria-label={t("Filter formats…")} className="w-full bg-transparent text-sm outline-none"
          onKeyDown={(e) => { if (e.key === "Enter" && list[0]) onPick(list[0]); }} />
      </label>
      <div className="max-h-72 overflow-y-auto" role="listbox" aria-label={t("Number format")}>
        {list.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("No format matches.")}</p>}
        {list.map((f) => (
          <button key={f} type="button" role="option" aria-selected={f === value} onClick={() => onPick(f)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
            <span className="truncate">{numberFormatLabel(f, lang)}</span>
            {f === value && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

const SAMPLE = 42;

/**
 * The Number section of a field's settings (Notion's Edit property): Number format, Decimal places, Show as
 * with Color / Divide by / Show number, and the note that it applies to every view. `value` is the field's
 * stored options; `onChange` gets the options to store (legacy `format` kept for Rupiah).
 */
export function NumberFieldSettings({ value, onChange }: { value: unknown; onChange: (options: Record<string, unknown> | null) => void }) {
  const { t, lang } = useLang();
  const o = numberOptions(value);
  const set = (patch: Partial<NumberOptions>) => onChange(numberOptionsToStore({ ...o, ...patch }));
  const [divideBy, setDivideBy] = useState(String(o.divideBy));
  useEffect(() => setDivideBy(String(o.divideBy)), [o.divideBy]);
  const commitDivide = () => {
    const n = Number(divideBy.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) set({ divideBy: n });
    else setDivideBy(String(o.divideBy));
  };
  const tiles: Array<{ key: NumberShowAs; label: string; preview: ReactNode }> = [
    { key: "number", label: t("Number"), preview: <span className="text-base font-medium tabular-nums">{SAMPLE}</span> },
    { key: "bar", label: t("Bar"), preview: <span className="relative block h-1 w-12 overflow-hidden rounded-full bg-muted"><span className="absolute inset-y-0 left-0 w-1/2 rounded-full" style={{ backgroundColor: BAR_COLOR_VAR[o.barColor] }} /></span> },
    { key: "ring", label: t("Ring"), preview: <Ring fill={0.42} color={BAR_COLOR_VAR[o.barColor]} size={18} /> },
  ];
  return (
    <div className="space-y-2">
      <div>
        <Row label={t("Number format")} value={numberFormatLabel(o.numberFormat, lang, true)}>
          {(close) => <FormatList value={o.numberFormat} onPick={(f) => { set({ numberFormat: f }); close(); }} />}
        </Row>
        <Row label={t("Decimal places")} value={o.decimals === null ? t("Default") : String(o.decimals)}>
          {(close) => (
            <div role="listbox" aria-label={t("Decimal places")}>
              {[null, ...NUMBER_DECIMALS].map((d) => (
                <button key={String(d)} type="button" role="option" aria-selected={o.decimals === d} onClick={() => { set({ decimals: d }); close(); }} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                  <span>{d === null ? t("Default") : d}</span>
                  <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">{formatNumberWith(1234.5, { ...o, decimals: d, numberFormat: o.numberFormat === "percent" ? "number_with_separators" : o.numberFormat })}{o.decimals === d && <Check className="h-3.5 w-3.5 text-foreground" />}</span>
                </button>
              ))}
            </div>
          )}
        </Row>
      </div>
      <div className="border-t border-border pt-2">
        <p className="px-2 pb-1.5 text-xs text-muted-foreground">{t("Show as")}</p>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("Show as")}>
          {tiles.map((tile) => (
            <button key={tile.key} type="button" role="radio" aria-checked={o.showAs === tile.key} onClick={() => set({ showAs: tile.key })}
              className={cn("flex h-14 flex-col items-center justify-center gap-1.5 rounded-lg border text-xs transition-colors", o.showAs === tile.key ? "border-primary text-primary ring-1 ring-primary" : "border-border text-muted-foreground hover:bg-muted")}>
              <span className="grid h-5 place-items-center">{tile.preview}</span>
              {tile.label}
            </button>
          ))}
        </div>
        {o.showAs !== "number" && (
          <div className="mt-2 space-y-1 rounded-lg bg-muted/50 p-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-sm">{t("Color")}</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
                    <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: BAR_COLOR_VAR[o.barColor] }} />{t(BAR_COLOR_LABEL[o.barColor === "default" ? "green" : o.barColor])}<ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 p-1">
                  {BAR_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => set({ barColor: c })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: BAR_COLOR_VAR[c] }} />
                      <span className="flex-1">{t(BAR_COLOR_LABEL[c])}</span>
                      {(o.barColor === c || (o.barColor === "default" && c === "green")) && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
            {o.numberFormat !== "percent" && (
              <label className="flex items-center justify-between gap-2 px-1">
                <span className="text-sm">{t("Divide by")}</span>
                <input value={divideBy} inputMode="decimal" onChange={(e) => setDivideBy(e.target.value)} onBlur={commitDivide} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-ring" />
              </label>
            )}
            <label className="flex items-center justify-between gap-2 px-1 py-1">
              <span className="text-sm">{t("Show number")}</span>
              <Switch checked={o.showNumber} onCheckedChange={(v) => set({ showNumber: v })} aria-label={t("Show number")} />
            </label>
          </div>
        )}
      </div>
      <p className="px-2 text-xs text-muted-foreground">{t("Changes apply to all views showing this property.")}</p>
    </div>
  );
}

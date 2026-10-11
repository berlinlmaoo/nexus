import { Fragment, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { SheetLocaleCode } from "@/lib/sheet-model";
import {
  CURRENCIES, CURRENCY_VARIANTS, DATE_FIELDS, DATE_SAMPLE, NUMBER_PRESETS,
  currencyPattern, datePartSample, datePresets, formatPattern, joinDatePattern, parseDatePattern,
  type CurrencyVariant, type DateField, type DatePart,
} from "@/lib/sheet-numfmt";
import { Floating, type FloatAnchor } from "./sheet-float";
import { SheetDialog, inputClass, primaryBtn, selectClass } from "./sheet-shell";

// Format › Number › Custom currency / Custom date and time / Custom number format — Sheets'
// three dialogs (inventory 4.21, shots r24–r26). Every sample renders in the SHEET locale through the
// same formatter the grid uses, so what the list shows is what the cell will show.

const RECENT_KEY = "nexus-sheet-recent-formats";
const RECENT_MAX = 8;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
function pushRecent(pattern: string) {
  try {
    const next = [pattern, ...readRecent().filter((p) => p !== pattern)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode: no history */ }
}

const rowClass = "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left text-xs last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";
const listClass = "overflow-hidden rounded-lg border border-border";

/** A sample in its format's colour ([Red] etc.); the colour is user data, so it's a literal hex. */
function Sample({ value, pattern, locale, className }: { value: number | string; pattern: string; locale: SheetLocaleCode; className?: string }) {
  const r = formatPattern(value, pattern, locale);
  return <span style={r.color ? { color: r.color } : undefined} className={cn("whitespace-pre tabular-nums", className)}>{r.text}</span>;
}

// ── Custom number format ────────────────────────────────────────────────────────────────────────

export function CustomNumberFormatDialog({ initial, sample, locale, onApply, onClose }: {
  initial?: string;
  sample: number;
  locale: SheetLocaleCode;
  onApply: (pattern: string) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [pattern, setPattern] = useState(initial ?? "");
  const [recent] = useState(readRecent);
  const presets = useMemo(() => [...recent, ...NUMBER_PRESETS.filter((p) => !recent.includes(p))], [recent]);
  const apply = () => {
    const p = pattern.trim();
    if (!p) return;
    pushRecent(p);
    onApply(p);
  };
  return (
    <SheetDialog title={t("Custom number formats")} onClose={onClose} width={500}>
      <div className="flex gap-2">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
          placeholder={t("Custom number format")}
          aria-label={t("Custom number format")}
          spellCheck={false}
          className={cn(inputClass, "h-9 font-mono")}
        />
        <button type="button" onClick={apply} disabled={!pattern.trim()} className={primaryBtn}>{t("Apply")}</button>
      </div>
      <div className="mt-3 flex items-baseline gap-2 text-xs">
        <span className="text-muted-foreground">{t("Example:")}</span>
        <Sample value={sample} pattern={pattern.trim() || "General"} locale={locale} className="min-w-0 flex-1 truncate font-medium" />
      </div>
      <div role="listbox" aria-label={t("Number format presets")} className={cn(listClass, "mt-3")}>
        {presets.map((p, i) => (
          <Fragment key={p}>
            {i === 0 && recent.length > 0 && <div className="bg-muted/50 px-3 py-1 text-[11px] font-semibold text-muted-foreground">{t("Recently used")}</div>}
            {i === recent.length && recent.length > 0 && <div className="border-t border-border" />}
            <button
              type="button"
              role="option"
              aria-selected={p === pattern}
              onClick={() => setPattern(p)}
              onDoubleClick={() => { pushRecent(p); onApply(p); }}
              className={cn(rowClass, p === pattern && "bg-muted")}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{p}</span>
              <Sample value={p === "@" ? String(sample) : sample} pattern={p} locale={locale} className="shrink-0 text-muted-foreground" />
            </button>
          </Fragment>
        ))}
      </div>
    </SheetDialog>
  );
}

// ── Custom date and time ────────────────────────────────────────────────────────────────────────

const fieldLabel = (f: DateField) => DATE_FIELDS.find((x) => x.field === f)?.label ?? f;

/** Always a literal between two chips (and at both ends) so separators can be typed anywhere. */
function normalizeParts(parts: DatePart[]): DatePart[] {
  const out: DatePart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.kind === "lit") {
      if (last?.kind === "lit") last.text += p.text;
      else out.push({ ...p });
    } else {
      if (!last || last.kind === "token") out.push({ kind: "lit", text: "" });
      out.push({ ...p });
    }
  }
  if (!out.length || out[out.length - 1].kind === "token") out.push({ kind: "lit", text: "" });
  return out;
}

export function DateTimeFormatDialog({ initial, sample, locale, onApply, onClose }: {
  initial?: string;
  sample: number;
  locale: SheetLocaleCode;
  onApply: (pattern: string) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [parts, setParts] = useState<DatePart[]>(() => normalizeParts(parseDatePattern(initial || "yyyy-mm-dd")));
  const [menu, setMenu] = useState<{ index: number | "add"; anchor: FloatAnchor } | null>(null);
  const pattern = joinDatePattern(parts);
  const presets = useMemo(() => datePresets(locale), [locale]);
  // The dialog's preview uses the cell's own value when it is a date, else Sheets' sample.
  const shown = Number.isFinite(sample) && sample > 0 ? sample : DATE_SAMPLE;

  const setPart = (i: number, p: DatePart | null) =>
    setParts((cur) => normalizeParts(p ? cur.map((x, k) => (k === i ? p : x)) : cur.filter((_, k) => k !== i)));
  const open = (index: number | "add", el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ index, anchor: { rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } } });
  };
  const apply = () => { if (pattern) onApply(pattern); };
  const menuPart = menu && menu.index !== "add" ? parts[menu.index] : null;

  return (
    <SheetDialog title={t("Custom date and time formats")} onClose={onClose} width={520}>
      <div className="flex items-start gap-2">
        <div className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-y-1 rounded-md border border-border bg-background px-1.5 py-1">
          {parts.map((p, i) =>
            p.kind === "lit" ? (
              <input
                key={i}
                value={p.text}
                onChange={(e) => setPart(i, { kind: "lit", text: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
                aria-label={t("Separator text")}
                size={Math.max(1, p.text.length)}
                className="h-6 min-w-[0.75rem] bg-transparent px-0.5 text-center text-xs outline-none focus:bg-muted"
              />
            ) : (
              <button
                key={i}
                type="button"
                onClick={(e) => open(i, e.currentTarget)}
                aria-haspopup="menu"
                aria-label={t("Change {field} format", { field: t(fieldLabel(p.field)) })}
                className="inline-flex h-6 items-center gap-1 rounded border border-border bg-card px-1.5 text-xs font-medium hover:bg-muted"
              >
                {t(fieldLabel(p.field))} ({datePartSample(p.field, p.code, locale, shown)})
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          onClick={(e) => open("add", e.currentTarget)}
          aria-haspopup="menu"
          aria-label={t("Add date or time format")}
          title={t("Add date or time format")}
          className="grid h-9 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button type="button" onClick={apply} disabled={!pattern} className={cn(primaryBtn, "h-9")}>{t("Apply")}</button>
      </div>
      <div className="mt-3 flex items-baseline gap-2 text-xs">
        <span className="text-muted-foreground">{t("Example:")}</span>
        <Sample value={shown} pattern={pattern || "General"} locale={locale} className="min-w-0 flex-1 truncate font-medium" />
      </div>
      <div role="listbox" aria-label={t("Date and time format presets")} className={cn(listClass, "mt-3")}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            role="option"
            aria-selected={p === pattern}
            title={p}
            onClick={() => setParts(normalizeParts(parseDatePattern(p)))}
            onDoubleClick={() => onApply(p)}
            className={cn(rowClass, p === pattern && "bg-muted")}
          >
            <Sample value={DATE_SAMPLE} pattern={p} locale={locale} />
          </button>
        ))}
      </div>

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[74]" onMouseDown={() => setMenu(null)} />
          <Floating anchor={menu.anchor} role="menu" className="z-[75] min-w-[200px] rounded-lg border border-border bg-popover py-1 text-xs text-popover-foreground shadow-pop">
            {menu.index === "add"
              ? DATE_FIELDS.map((f) => (
                  <button
                    key={f.field}
                    type="button"
                    role="menuitem"
                    onClick={() => { setParts((cur) => normalizeParts([...cur, { kind: "token", field: f.field, code: f.codes[0] }])); setMenu(null); }}
                    className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-muted"
                  >
                    <span>{t(f.label)}</span>
                    <span className="text-muted-foreground">{datePartSample(f.field, f.codes[0], locale, shown)}</span>
                  </button>
                ))
              : menuPart && menuPart.kind === "token" && (
                  <>
                    {(DATE_FIELDS.find((f) => f.field === menuPart.field)?.codes ?? []).map((code) => (
                      <button
                        key={code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={code === menuPart.code}
                        onClick={() => { setPart(menu.index as number, { ...menuPart, code }); setMenu(null); }}
                        className={cn("flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-muted", code === menuPart.code && "font-semibold")}
                      >
                        <span>{datePartSample(menuPart.field, code, locale, shown)}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{code}</span>
                      </button>
                    ))}
                    <div className="my-1 border-t border-border" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setPart(menu.index as number, null); setMenu(null); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t("Remove")}
                    </button>
                  </>
                )}
          </Floating>
        </>,
        document.body,
      )}
    </SheetDialog>
  );
}

// ── Custom currency ─────────────────────────────────────────────────────────────────────────────

const VARIANT_LABEL: Record<CurrencyVariant, string> = {
  symbol: "Symbol first",
  symbolRounded: "Symbol first, rounded",
  symbolParen: "Negative in brackets",
  symbolRed: "Negative in red",
  symbolAfter: "Symbol after",
  code: "Currency code",
};

export function CurrencyFormatDialog({ locale, onApply, onClose }: {
  locale: SheetLocaleCode;
  onApply: (pattern: string) => void;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const [query, setQuery] = useState("");
  const [variant, setVariant] = useState<CurrencyVariant>("symbol");
  const [code, setCode] = useState(locale === "en-US" ? "USD" : "IDR");
  const name = (c: (typeof CURRENCIES)[number]) => (lang === "id" ? c.nameId : c.nameEn);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? CURRENCIES.filter((c) => [c.code, c.symbol, c.nameEn, c.nameId].some((s) => s.toLowerCase().includes(q)))
      : CURRENCIES;
  }, [query]);
  const apply = (c = code) => onApply(currencyPattern(c, variant));
  return (
    <SheetDialog title={t("Custom currencies")} onClose={onClose} width={500}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && list[0]) { setCode(list[0].code); apply(list[0].code); } }}
            placeholder={t("Search currencies")}
            aria-label={t("Search currencies")}
            className={cn(inputClass, "h-9 pl-7")}
          />
        </div>
        <select
          value={variant}
          onChange={(e) => setVariant(e.target.value as CurrencyVariant)}
          aria-label={t("Currency format")}
          className={cn(selectClass, "h-9 w-auto max-w-[45%]")}
        >
          {CURRENCY_VARIANTS.map((v) => (
            <option key={v} value={v}>
              {formatPattern(-1000, currencyPattern(code, v), locale).text} · {t(VARIANT_LABEL[v])}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => apply()} className={primaryBtn}>{t("Apply")}</button>
      </div>
      <div role="listbox" aria-label={t("Custom currencies")} className={cn(listClass, "mt-3")}>
        {list.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t("No currencies match")}</div>}
        {list.map((c) => (
          <button
            key={c.code}
            type="button"
            role="option"
            aria-selected={c.code === code}
            onClick={() => setCode(c.code)}
            onDoubleClick={() => { setCode(c.code); apply(c.code); }}
            className={cn(rowClass, c.code === code && "bg-muted")}
          >
            <span className="min-w-0 flex-1 truncate">{name(c)} <span className="text-muted-foreground">({c.code})</span></span>
            <Sample value={1000.12} pattern={currencyPattern(c.code, variant)} locale={locale} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </SheetDialog>
  );
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Copy, ExternalLink, FileSpreadsheet, Link2, Link2Off, Pencil, Search, TextCursorInput } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { serialToYmd, todaySerial, ymdToSerial } from "@/lib/sheet-formula";
import { Floating } from "./sheet-float";
import { inputClass, primaryBtn } from "./sheet-shell";

type Box = { left: number; top: number; right: number; bottom: number };
const below = (a: Box) => ({ rect: { left: a.left, top: a.top, right: a.right, bottom: a.bottom } });

// ── Date picker ─────────────────────────────────────────────────────────────────────────────────

/** Day of week of a serial, 0 = Sunday (serial 0 is Saturday 30 Dec 1899). */
const weekday = (serial: number) => (((Math.floor(serial) + 6) % 7) + 7) % 7;

/**
 * The calendar Sheets opens when a date cell is edited (Enter / F2 / double-click): month header with
 * ‹ ›, weekday initials starting Sunday, a 6-week grid with the neighbouring months greyed, the picked
 * day filled, today outlined, and "Today". Arrows move the day, PageUp/PageDown the month, Enter picks,
 * Escape closes.
 */
export function DatePicker({ anchor, value, locale, onPick, onClose }: {
  anchor: DOMRect | Box;
  /** Serial date (whole part used), or null for an empty cell. */
  value: number | null;
  locale: "id-ID" | "en-US";
  onPick: (serial: number) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const today = todaySerial();
  const start = value !== null && Number.isFinite(value) ? Math.floor(value) : today;
  const [focus, setFocus] = useState(start);
  const [month, setMonth] = useState(() => { const d = serialToYmd(start); return { y: d.y, m: d.m }; });
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => gridRef.current?.focus())); return () => cancelAnimationFrame(id); }, []);

  const title = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.y, month.m - 1, 1))),
    [locale, month],
  );
  const initials = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: locale.startsWith("id") ? "short" : "narrow", timeZone: "UTC" });
    const long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
    // 4 Jan 1970 was a Sunday.
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.UTC(1970, 0, 4 + i)); return { short: f.format(d), long: long.format(d) }; });
  }, [locale]);
  const fullDate = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }), [locale]);

  const first = ymdToSerial(month.y, month.m, 1);
  const gridStart = first - weekday(first);
  const days = Array.from({ length: 42 }, (_, i) => gridStart + i);

  const shiftMonth = (delta: number) => setMonth((m) => {
    const z = m.y * 12 + (m.m - 1) + delta;
    return { y: Math.floor(z / 12), m: (z % 12) + 1 };
  });
  const moveFocus = (s: number) => {
    setFocus(s);
    const d = serialToYmd(s);
    setMonth({ y: d.y, m: d.m });
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key] !== undefined) { e.preventDefault(); moveFocus(focus + step[e.key]); return; }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const d = serialToYmd(focus);
      const z = d.y * 12 + (d.m - 1) + (e.key === "PageUp" ? -1 : 1);
      const y = Math.floor(z / 12), m = (z % 12) + 1;
      const dim = serialToYmd(ymdToSerial(y, m + 1, 1) - 1).d;
      moveFocus(ymdToSerial(y, m, Math.min(d.d, dim)));
      return;
    }
    if (e.key === "Home") { e.preventDefault(); moveFocus(focus - weekday(focus)); return; }
    if (e.key === "End") { e.preventDefault(); moveFocus(focus + 6 - weekday(focus)); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(focus); return; }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <Floating anchor={below(anchor)} className="w-[232px] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-pop">
        <div className="flex items-center gap-1 px-1 pb-1">
          <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize" aria-live="polite">{title}</span>
          <button type="button" onClick={() => shiftMonth(-1)} aria-label={t("Previous month")} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => shiftMonth(1)} aria-label={t("Next month")} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div
          ref={gridRef}
          role="grid"
          tabIndex={0}
          aria-label={title}
          aria-activedescendant={`dp-${focus}`}
          onKeyDown={onKey}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <div role="row" className="grid grid-cols-7">
            {initials.map((w, i) => (
              <abbr key={i} role="columnheader" title={w.long} className="grid h-7 place-items-center text-[11px] font-medium text-muted-foreground no-underline">{w.short}</abbr>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, wk) => (
            <div role="row" key={wk} className="grid grid-cols-7">
              {days.slice(wk * 7, wk * 7 + 7).map((s) => {
                const ymd = serialToYmd(s);
                const outside = ymd.m !== month.m;
                const selected = value !== null && Math.floor(value) === s;
                const isToday = s === today;
                return (
                  <button
                    key={s}
                    id={`dp-${s}`}
                    type="button"
                    role="gridcell"
                    tabIndex={-1}
                    aria-selected={selected}
                    aria-label={fullDate.format(new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)))}
                    onClick={() => onPick(s)}
                    className={cn(
                      "mx-auto grid h-7 w-7 place-items-center rounded-full text-[11px] tabular-nums transition",
                      outside ? "text-muted-foreground/50" : "text-foreground",
                      selected ? "bg-info font-semibold text-white" : "hover:bg-muted",
                      !selected && isToday && "ring-1 ring-inset ring-info",
                      s === focus && !selected && "bg-muted",
                    )}
                  >{ymd.d}</button>
                );
              })}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => onPick(today)} className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-info hover:bg-info/10">{t("Today")}</button>
      </Floating>
    </>,
    document.body,
  );
}

// ── Note ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A cell note (Insert ▸ Note, Shift+F2): a plain-text sticky beside the cell, no author. Shown
 * read-only on hover; editing saves on click outside, Escape or Ctrl+Enter (like Sheets, a note is
 * never lost by clicking away). Saving an empty note removes it (the caller decides).
 */
export function NotePopover({ anchor, value, editing, canEdit, onSave, onClose }: {
  anchor: DOMRect | Box;
  value: string;
  editing: boolean;
  canEdit: boolean;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [text, setText] = useState(value);
  const live = editing && canEdit;
  // Floating renders the card hidden until it has measured it, and a hidden textarea can't take focus.
  const focused = useRef(false);
  const ref = (el: HTMLTextAreaElement | null) => {
    if (!el || !live || focused.current) return;
    focused.current = true;
    // Floating keeps the card invisible until it is placed; focus once it shows.
    requestAnimationFrame(() => requestAnimationFrame(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }));
  };
  const commit = () => { if (text !== value) onSave(text); onClose(); };
  // Beside the cell's top-right corner.
  const at = { rect: { left: anchor.right + 4, right: anchor.right + 244, top: anchor.top - 4, bottom: anchor.top - 4 } };
  const card = (
    <Floating
      anchor={at}
      role={live ? "dialog" : "note"}
      className={cn(
        "w-60 rounded-md border border-amber-200 bg-amber-50 text-amber-950 shadow-pop dark:border-amber-800/60 dark:bg-amber-950 dark:text-amber-50",
        !live && "pointer-events-none",
      )}
    >
      {live ? (
        <textarea
          ref={ref}
          aria-label={t("Note")}
          value={text}
          placeholder={t("Type here")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commit(); }
          }}
          rows={5}
          className="block min-h-[96px] w-full resize-y bg-transparent p-2 text-xs leading-relaxed outline-none placeholder:text-amber-900/50 dark:placeholder:text-amber-100/40"
        />
      ) : (
        <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words p-2 text-xs leading-relaxed">{value}</p>
      )}
    </Floating>
  );
  return createPortal(
    live ? <><div className="fixed inset-0 z-[60]" onMouseDown={commit} />{card}</> : card,
    document.body,
  );
}

// ── Insert link ─────────────────────────────────────────────────────────────────────────────────

/** "example.com" → "https://example.com"; in-file links ("#gid=…", "#range=…") and schemes stay. */
export function normalizeLink(url: string): string {
  const u = url.trim();
  if (!u) return "";
  if (u.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`;
  return `https://${u}`;
}

/**
 * Insert ▸ Link (Ctrl+K): a popover on the cell with an optional Text field and a "Search or paste a
 * link" box that also offers this file's sheets and named ranges ("#gid=<sheetId>", "#range=<name>").
 */
export function LinkPopover({ anchor, text, url, sheets, namedRanges, onApply, onRemove, onClose }: {
  anchor: DOMRect | Box;
  text: string;
  url: string;
  sheets: { id: string; name: string }[];
  namedRanges: { name: string }[];
  onApply: (link: { text: string; url: string }) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [label, setLabel] = useState(text);
  const [link, setLink] = useState(url);
  const [active, setActive] = useState(-1);
  const linkRef = useRef<HTMLInputElement>(null);
  const showText = text === "" || text !== url;
  useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => { linkRef.current?.focus(); linkRef.current?.select(); })); return () => cancelAnimationFrame(id); }, []);

  const q = link.trim().toLowerCase();
  const suggestions = useMemo(() => [
    ...sheets.map((s) => ({ key: `s:${s.id}`, kind: "sheet" as const, label: s.name, url: `#gid=${s.id}` })),
    ...namedRanges.map((r) => ({ key: `r:${r.name}`, kind: "range" as const, label: r.name, url: `#range=${r.name}` })),
  ].filter((s) => !q || (q.startsWith("#") ? s.url.toLowerCase().startsWith(q) : s.label.toLowerCase().includes(q))).slice(0, 8), [sheets, namedRanges, q]);

  const apply = (target = link, name = label) => {
    const u = normalizeLink(target);
    if (!u) return;
    onApply({ text: name.trim() || (showText ? target.trim() : text), url: u });
  };
  const pick = (s: (typeof suggestions)[number]) => {
    setLink(s.url);
    const name = label.trim() ? label : s.label;
    setLabel(name);
    apply(s.url, name);
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <Floating
        anchor={below(anchor)}
        role="dialog"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
        className="w-[340px] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-pop"
      >
        <div className="space-y-2">
          {showText && (
            <label className="flex items-center gap-2">
              <TextCursorInput className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Text")} aria-label={t("Text")} className={inputClass} />
            </label>
          )}
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={linkRef}
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls="sheet-link-suggestions"
              aria-activedescendant={active >= 0 ? `sheet-link-${active}` : undefined}
              aria-label={t("Link")}
              value={link}
              placeholder={t("Search or paste a link")}
              onChange={(e) => { setLink(e.target.value); setActive(-1); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(suggestions.length - 1, i + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && suggestions[active]) pick(suggestions[active]); else apply(); }
              }}
              className={inputClass}
            />
            <button type="button" onClick={() => apply()} disabled={!link.trim()} className={cn(primaryBtn, "shrink-0 px-3")}>{t("Apply")}</button>
          </div>
        </div>
        {suggestions.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <div className="px-1 pb-1 text-[11px] font-semibold text-muted-foreground">{t("Sheets and named ranges")}</div>
            <ul id="sheet-link-suggestions" role="listbox" aria-label={t("Sheets and named ranges")}>
              {suggestions.map((s, i) => (
                <li key={s.key} id={`sheet-link-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(s)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs", i === active ? "bg-muted" : "hover:bg-muted")}
                  >
                    {s.kind === "sheet" ? <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{s.kind === "sheet" ? t("Sheet") : t("Named range")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {onRemove && url && (
          <div className="mt-2 flex justify-start border-t border-border pt-2">
            <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10">
              <Link2Off className="h-3.5 w-3.5" />{t("Remove link")}
            </button>
          </div>
        )}
      </Floating>
    </>,
    document.body,
  );
}

/**
 * The card on a linked cell (selected or hovered): the address — web links open in a new tab, in-file
 * links go through onFollow — plus Copy / Edit / Remove link.
 */
export function LinkCard({ anchor, url, onCopy, onEdit, onRemove, onClose, onFollow }: {
  anchor: DOMRect | Box;
  url: string;
  onCopy: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
  /** In-file links (#gid=…, #range=…): the caller jumps there. Web links open in a new tab. */
  onFollow?: (url: string) => void;
}) {
  const { t } = useLang();
  const internal = url.startsWith("#");
  let host = url;
  try { if (!internal) host = new URL(url).host || url; } catch { /* keep the raw text */ }
  const btn = "grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground";
  return createPortal(
    <Floating
      anchor={below(anchor)}
      role="dialog"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      className="flex w-[300px] items-center gap-2 rounded-xl border border-border bg-popover py-1.5 pl-3 pr-1.5 text-popover-foreground shadow-pop"
    >
      {internal ? <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        {internal ? (
          <button type="button" onClick={() => onFollow?.(url)} className="block max-w-full truncate text-left text-xs font-medium text-info hover:underline">{url}</button>
        ) : (
          <a href={url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs font-medium text-info hover:underline">{url}</a>
        )}
        {!internal && host !== url && <div className="truncate text-[10px] text-muted-foreground">{host}</div>}
      </div>
      <button type="button" onClick={onCopy} title={t("Copy link")} aria-label={t("Copy link")} className={btn}><Copy className="h-3.5 w-3.5" /></button>
      <button type="button" onClick={onEdit} title={t("Edit link")} aria-label={t("Edit link")} className={btn}><Pencil className="h-3.5 w-3.5" /></button>
      <button type="button" onClick={onRemove} title={t("Remove link")} aria-label={t("Remove link")} className={btn}><Link2Off className="h-3.5 w-3.5" /></button>
    </Floating>,
    document.body,
  );
}

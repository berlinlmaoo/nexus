import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clock, Loader2, Smile, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { patchPresence, presenceApi, presenceText, usePresence, type PresenceAvailability } from "@/lib/presence";

/**
 * Set / clear one's own manual status from a start to an end (owner, 19 Oct 2026; layout of the UI round of the same
 * day, U-1: Slack-like). Top bar Cancel · Status · Save, one text field with an emoji button, quick picks as a list,
 * "Recently used" (this browser's own last statuses, only when there are any), then Clear after / Starts and one
 * summary line. Times are WIB (the company's clock), whatever the browser's zone. Everyone in the workspace sees it;
 * nobody is notified; it ends by itself. Availability (N-1, owner 19 Oct 2026) is a segmented choice Online · Away ·
 * Do not disturb (green / amber / red, the same dots as everywhere); Away is the default, as before. The server checks the same rules (src/lib/presence-core.ts checkManualStatus) and says why when it refuses.
 * The emoji is stored as the start of the text ("🗓️ Meeting") — the API has one text field.
 */

const TEXT_MAX = 80;

type EndChoice = "30m" | "1h" | "2h" | "3h" | "today" | "custom";
const END_MINUTES: Partial<Record<EndChoice, number>> = { "30m": 30, "1h": 60, "2h": 120, "3h": 180 };

/** Quick picks: tap fills text + emoji + duration. No WFH/sick: those are attendance requests. */
const QUICK: ReadonlyArray<{ emoji: string; text: string; end: EndChoice }> = [
  { emoji: "🗓️", text: "Meeting", end: "1h" },
  { emoji: "🍽️", text: "Lunch", end: "1h" },
  { emoji: "🎬", text: "Out for a shoot", end: "3h" },
  { emoji: "🚗", text: "On the road", end: "1h" },
];

/** Availability choices. Labels match the server's status words in both languages (presence-core.ts STATE_WORD). */
const AVAIL: ReadonlyArray<{ value: PresenceAvailability; en: string; id: string; dot: string }> = [
  { value: "online", en: "Online", id: "Online", dot: "bg-emerald-500" },
  { value: "away", en: "Away", id: "Away", dot: "bg-amber-400" },
  { value: "dnd", en: "Do not disturb", id: "Jangan diganggu", dot: "bg-rose-500" },
];

const EMOJIS = ["🗓️", "🍽️", "🎬", "🚗", "💬", "🎧", "📞", "✈️", "🏃", "☕", "📍", "🎯"] as const;

/** This browser's last statuses (a per-viewer convenience; the server keeps only the running one). */
const RECENT_KEY = "nexus-presence-recent";
type Recent = { emoji: string; text: string; end: EndChoice };
function readRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((r) => r && typeof r.text === "string" && r.text).slice(0, 5) : [];
  } catch { return []; }
}
function pushRecent(r: Recent) {
  try {
    const key = (x: Recent) => `${x.emoji} ${x.text}`.trim().toLowerCase();
    const list = [r, ...readRecent().filter((x) => key(x) !== key(r))].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* storage blocked: no recents */ }
}

/** "🗓️ Meeting" → { emoji: "🗓️", text: "Meeting" }. */
const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;
function splitEmoji(s: string): { emoji: string; text: string } {
  const m = LEADING_EMOJI.exec(s);
  return m ? { emoji: m[1], text: s.slice(m[0].length) } : { emoji: "", text: s };
}

/** "YYYY-MM-DD" and "HH:MM" of an instant on the WIB clock. */
function wibParts(d: Date): { day: string; time: string } {
  const w = new Date(d.getTime() + 7 * 3600e3).toISOString();
  return { day: w.slice(0, 10), time: w.slice(11, 16) };
}
function wibInstant(day: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${day}T${time}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function SetStatusDialog({ open, onOpenChange, meId }: { open: boolean; onOpenChange: (o: boolean) => void; meId: string | null | undefined }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const current = usePresence(meId);
  const manual = current?.manual ?? null;

  const [emoji, setEmoji] = useState("");
  const [text, setText] = useState("");
  const [availability, setAvailability] = useState<PresenceAvailability>("away");
  const [pickEmoji, setPickEmoji] = useState(false);
  const [later, setLater] = useState(false);
  const [startDay, setStartDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [end, setEnd] = useState<EndChoice>("1h");
  const [endDay, setEndDay] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const inHour = wibParts(new Date(now.getTime() + 3600e3));
    const nowP = wibParts(now);
    const cur = splitEmoji(manual?.text ?? "");
    setEmoji(cur.emoji);
    setText(cur.text);
    setAvailability(manual?.availability ?? "away");
    setPickEmoji(false);
    setLater(false);
    setStartDay(nowP.day);
    setStartTime(nowP.time);
    setEnd("1h");
    setEndDay(inHour.day);
    setEndTime(inHour.time);
    setError(null);
    setRecent(readRecent());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAt = useMemo(() => (later ? wibInstant(startDay, startTime) : null), [later, startDay, startTime]);
  const endAt = useMemo(() => {
    const from = startAt ?? new Date();
    const mins = END_MINUTES[end];
    if (mins) return new Date(from.getTime() + mins * 60e3);
    if (end === "today") return wibInstant(wibParts(from).day, "23:59");
    return wibInstant(endDay, endTime);
  }, [end, endDay, endTime, startAt]);

  const full = `${emoji ? `${emoji} ` : ""}${text.trim()}`;
  const save = useMutation({
    mutationFn: () => presenceApi.setManual({
      text: full,
      startsAt: startAt ? startAt.toISOString() : null,
      endsAt: endAt ? endAt.toISOString() : "",
      availability,
    }),
    onSuccess: (r) => {
      patchPresence(qc, r.status);
      const isQuick = QUICK.some((q) => q.emoji === emoji && t(q.text) === text.trim());
      if (!isQuick) pushRecent({ emoji, text: text.trim(), end: end === "custom" ? "1h" : end });
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : t("Could not save. Try again.")),
  });
  const clear = useMutation({
    mutationFn: () => presenceApi.clearManual(manual?.id ?? null),
    onSuccess: (r) => { patchPresence(qc, r.status); onOpenChange(false); },
    onError: (e) => setError(e instanceof Error ? e.message : t("Could not save. Try again.")),
  });

  const fmt = (d: Date | null) => d ? `${d.toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" })} ${wibParts(d).time}` : "—";
  const busy = save.isPending || clear.isPending;
  const canSave = text.trim().length > 0 && !!endAt && !busy;
  const pick = (p: { emoji: string; text: string; end: EndChoice }, translate: boolean) => {
    setEmoji(p.emoji);
    setText(translate ? t(p.text) : p.text);
    setEnd(p.end);
    setError(null);
    inputRef.current?.focus();
  };
  const durationLabel = (e: EndChoice) => {
    const m = END_MINUTES[e];
    return m ? (m < 60 ? t("{n} min", { n: m }) : t("{n} h", { n: m / 60 })) : e === "today" ? t("Today") : "";
  };
  const select = "h-9 appearance-none rounded-lg border border-border bg-background pl-3 pr-8 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const field = "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const row = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const sectionLabel = "px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] max-w-md flex-col gap-0 overflow-hidden rounded-2xl p-0 [&>button:last-child]:hidden" lang={lang}>
        {/* Top bar: Cancel · Status · Save. No bottom buttons. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-border px-3 py-2.5">
          <button type="button" onClick={() => onOpenChange(false)} className="justify-self-start rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">{t("Cancel")}</button>
          <DialogTitle className="text-sm font-bold tracking-tight">{t("Status")}</DialogTitle>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!canSave}
            className={cn("inline-flex items-center gap-1.5 justify-self-end rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors", canSave ? "bg-primary text-primary-foreground hover:opacity-90" : "text-muted-foreground/60")}
          >
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Save")}
          </button>
        </div>
        <DialogDescription className="sr-only">{t("Everyone in your workspace sees it next to your name until it ends. Nobody is notified.")}</DialogDescription>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* The text field: emoji button + text + counter. */}
          <div className="space-y-2">
            <div className="flex h-11 items-center gap-1 rounded-xl border border-border bg-background pl-1.5 pr-3 focus-within:ring-2 focus-within:ring-primary/40">
              <button
                type="button"
                onClick={() => setPickEmoji((v) => !v)}
                aria-label={t("Choose an emoji")}
                aria-expanded={pickEmoji}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg transition-colors hover:bg-accent"
              >
                {emoji || <Smile className="h-4.5 w-4.5 text-muted-foreground" />}
              </button>
              <input
                id="presence-text"
                ref={inputRef}
                value={text}
                maxLength={TEXT_MAX}
                onChange={(e) => { setText(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && canSave) save.mutate(); }}
                placeholder={t("What are you up to?")}
                aria-label={t("What are you up to?")}
                className="h-full min-w-0 flex-1 bg-transparent text-sm focus-visible:outline-none"
                autoFocus
              />
              {(text || emoji) && (
                <button type="button" onClick={() => { setText(""); setEmoji(""); inputRef.current?.focus(); }} aria-label={t("Clear text")} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{[...full].length}/{TEXT_MAX}</span>
            </div>
            {pickEmoji && (
              <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1.5" role="group" aria-label={t("Choose an emoji")}>
                {EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => { setEmoji(e); setPickEmoji(false); inputRef.current?.focus(); }} className={cn("grid h-8 w-8 place-items-center rounded-lg text-lg transition-colors hover:bg-background", emoji === e && "bg-background ring-1 ring-primary/40")}>{e}</button>
                ))}
                {emoji && (
                  <button type="button" onClick={() => { setEmoji(""); setPickEmoji(false); }} className="rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-background">{t("No emoji")}</button>
                )}
              </div>
            )}
          </div>

          {/* Availability: its own line, not a prefix in the field. Segmented Online · Away · Do not disturb. */}
          <div className="space-y-2">
            <div id="presence-availability" className="text-sm font-medium">{t("Availability")}</div>
            <div role="radiogroup" aria-labelledby="presence-availability" className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1">
              {AVAIL.map((a) => {
                const on = availability === a.value;
                return (
                  <button
                    key={a.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => { setAvailability(a.value); setError(null); }}
                    className={cn(
                      "inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 py-1.5 text-xs font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      on ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", a.dot)} />
                    {/* Wraps instead of truncating: "Jangan diganggu" does not fit one line on a 390 px phone. */}
                    <span className="min-w-0 text-center [overflow-wrap:anywhere]">{lang === "id" ? a.id : a.en}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {manual && current && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Now:")}</div>
                <div className="truncate text-sm font-medium">{presenceText(current, lang)}</div>
              </div>
              <button type="button" onClick={() => clear.mutate()} disabled={busy} className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50">
                {clear.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Clear status")}
              </button>
            </div>
          )}

          <div>
            <div className={sectionLabel}>{t("Quick picks")}</div>
            <div className="-mx-1">
              {QUICK.map((q) => (
                <button key={q.text} type="button" onClick={() => pick(q, true)} className={row}>
                  <span aria-hidden className="w-6 text-center text-lg leading-none">{q.emoji}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{t(q.text)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{durationLabel(q.end)}</span>
                </button>
              ))}
            </div>
          </div>

          {recent.length > 0 && (
            <div>
              <div className={sectionLabel}>{t("Recently used")}</div>
              <div className="-mx-1">
                {recent.map((r) => (
                  <button key={`${r.emoji}${r.text}`} type="button" onClick={() => pick(r, false)} className={row}>
                    <span aria-hidden className="w-6 text-center text-lg leading-none">{r.emoji || <Clock className="mx-auto h-4 w-4 text-muted-foreground" />}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.text}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{durationLabel(r.end)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="presence-end" className="text-sm font-medium">{t("Clear after")}</label>
              <span className="relative">
                <select id="presence-end" value={end} onChange={(e) => setEnd(e.target.value as EndChoice)} className={select}>
                  <option value="30m">{t("30 minutes")}</option>
                  <option value="1h">{t("1 hour")}</option>
                  <option value="2h">{t("2 hours")}</option>
                  <option value="3h">{t("3 hours")}</option>
                  <option value="today">{t("Today")}</option>
                  <option value="custom">{t("Pick a time")}</option>
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </span>
            </div>
            {end === "custom" && (
              <div className="flex items-center justify-end gap-1.5">
                <input type="date" value={endDay} onChange={(e) => setEndDay(e.target.value)} className={field} aria-label={t("End date")} />
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field} aria-label={t("End time")} />
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="presence-start" className="text-sm font-medium">{t("Starts")}</label>
              <span className="relative">
                <select id="presence-start" value={later ? "later" : "now"} onChange={(e) => setLater(e.target.value === "later")} className={select}>
                  <option value="now">{t("Now")}</option>
                  <option value="later">{t("Later")}</option>
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </span>
            </div>
            {later && (
              <div className="flex items-center justify-end gap-1.5">
                <input type="date" value={startDay} onChange={(e) => setStartDay(e.target.value)} className={field} aria-label={t("Start date")} />
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={field} aria-label={t("Start time")} />
              </div>
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              {later ? t("{from} – {to} WIB", { from: fmt(startAt), to: fmt(endAt) }) : t("Until {when} WIB", { when: fmt(endAt) })}
            </p>
            <p className="text-xs text-muted-foreground">{t("Everyone in your workspace sees it next to your name until it ends. Nobody is notified.")}</p>
          </div>

          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

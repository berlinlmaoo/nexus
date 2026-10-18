import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { PresenceChip, patchPresence, presenceApi, usePresence } from "@/lib/presence";

/**
 * Set / clear one's own manual status, "Away · <text>" from a start to an end (owner, 19 Oct 2026). Times are WIB
 * (the company's clock), whatever the browser's zone. Everyone in the workspace sees it; nobody is notified; it ends
 * by itself. The server checks the same rules (src/lib/presence-core.ts checkManualStatus) and says why when it refuses.
 */

const SUGGESTIONS = ["Meeting", "Lunch", "Out for a shoot", "At the dentist", "Potong rambut"] as const;
const TEXT_MAX = 80;

type EndChoice = "30m" | "1h" | "2h" | "today" | "custom";

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

  const [text, setText] = useState("");
  const [later, setLater] = useState(false);
  const [startDay, setStartDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [end, setEnd] = useState<EndChoice>("1h");
  const [endDay, setEndDay] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const inHour = wibParts(new Date(now.getTime() + 3600e3));
    const nowP = wibParts(now);
    setText(manual?.text ?? "");
    setLater(false);
    setStartDay(nowP.day);
    setStartTime(nowP.time);
    setEnd("1h");
    setEndDay(inHour.day);
    setEndTime(inHour.time);
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAt = useMemo(() => (later ? wibInstant(startDay, startTime) : null), [later, startDay, startTime]);
  const endAt = useMemo(() => {
    const from = startAt ?? new Date();
    if (end === "30m") return new Date(from.getTime() + 30 * 60e3);
    if (end === "1h") return new Date(from.getTime() + 3600e3);
    if (end === "2h") return new Date(from.getTime() + 2 * 3600e3);
    if (end === "today") return wibInstant(wibParts(from).day, "23:59");
    return wibInstant(endDay, endTime);
  }, [end, endDay, endTime, startAt]);

  const save = useMutation({
    mutationFn: () => presenceApi.setManual({
      text: text.trim(),
      startsAt: startAt ? startAt.toISOString() : null,
      endsAt: endAt ? endAt.toISOString() : "",
    }),
    onSuccess: (r) => { patchPresence(qc, r.status); onOpenChange(false); },
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
  const chip = "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const chipOn = "border-primary bg-primary/10 text-primary";
  const chipOff = "border-border bg-background text-foreground hover:bg-accent";
  const field = "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl p-5 sm:p-6" lang={lang}>
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-base font-bold tracking-tight">{t("Set a status")}</DialogTitle>
          <DialogDescription className="text-xs">{t("Everyone in your workspace sees it next to your name until it ends. Nobody is notified.")}</DialogDescription>
        </DialogHeader>

        {current && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("Now:")}</span>
            <PresenceChip userId={meId} />
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="presence-text" className="text-xs font-semibold text-muted-foreground">{t("What are you up to?")}</label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-amber-600 dark:text-amber-300">{t("Away ·")}</span>
            <input
              id="presence-text"
              value={text}
              maxLength={TEXT_MAX}
              onChange={(e) => { setText(e.target.value); setError(null); }}
              placeholder={t("e.g. Potong rambut")}
              className={cn(field, "h-10 w-full pl-[4.25rem] pr-12")}
              autoFocus
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground">{[...text].length}/{TEXT_MAX}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => setText(t(s))} className={cn(chip, chipOff, "py-1 font-medium")}>{t(s)}</button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">{t("From")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setLater(false)} className={cn(chip, !later ? chipOn : chipOff)} aria-pressed={!later}>{t("Now")}</button>
            <button type="button" onClick={() => setLater(true)} className={cn(chip, later ? chipOn : chipOff)} aria-pressed={later}>{t("Later")}</button>
            {later && (
              <span className="flex items-center gap-1.5">
                <input type="date" value={startDay} onChange={(e) => setStartDay(e.target.value)} className={field} aria-label={t("Start date")} />
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={field} aria-label={t("Start time")} />
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">{t("Clear after")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {([["30m", t("30 minutes")], ["1h", t("1 hour")], ["2h", t("2 hours")], ["today", t("Today")], ["custom", t("Pick a time")]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setEnd(k)} className={cn(chip, end === k ? chipOn : chipOff)} aria-pressed={end === k}>{label}</button>
            ))}
          </div>
          {end === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={endDay} onChange={(e) => setEndDay(e.target.value)} className={field} aria-label={t("End date")} />
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field} aria-label={t("End time")} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("{from} – {to} WIB", { from: later ? fmt(startAt) : t("Now"), to: fmt(endAt) })}</p>
        </div>

        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {manual && (
            <button type="button" onClick={() => clear.mutate()} disabled={busy} className="mr-auto rounded-lg px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50">
              {clear.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Clear status")}
            </button>
          )}
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">{t("Cancel")}</button>
          <button type="button" onClick={() => save.mutate()} disabled={!canSave} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save status")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

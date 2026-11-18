import { AlertTriangle, Loader2, Plug, Printer } from "lucide-react";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { disconnectedText, reasonText, usePrinterStatus, usePrinting, type PrinterState, type PrinterStatus, type QueueJob } from "@/lib/print-api";

/**
 * The office printer right now (owner, 18 Nov 2026: "is it printing, who is printing, how many are waiting"): state,
 * the printer's reasons (out of paper, ink…), who is printing, how many wait. Other people's jobs show a name only.
 * A job not sent from NEXUS reads "Outside NEXUS"; a print sent straight to the printer over WiFi never reaches the
 * server, so it can't show here at all (said in the footnote). Polls every 5 s while the tab is in front.
 */

const DOT: Record<PrinterState, string> = {
  idle: "bg-emerald-500",
  printing: "bg-primary animate-pulse",
  stopped: "bg-amber-500",
  error: "bg-destructive",
  disconnected: "bg-amber-500",
  unreachable: "bg-muted-foreground",
};

function stateText(state: PrinterState, t: (s: string) => string): string {
  switch (state) {
    case "idle": return t("Ready");
    case "printing": return t("Printing");
    case "stopped": return t("Stopped");
    case "error": return t("Needs attention");
    case "disconnected": return t("Not connected");
    case "unreachable": return t("Can't be reached");
  }
}

function jobLine(j: QueueJob, t: (s: string, v?: Record<string, string | number>) => string): string {
  const who = j.mine ? t("You") : j.who ? j.who.name : t("Outside NEXUS");
  const what = j.mine && j.title ? ` · ${j.title}` : "";
  return `${who}${what}`;
}

/** The whole panel (Print page) or a compact one (inside the Print dialog). */
export function PrinterStatusPanel({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t, tn } = useLang();
  const printing = usePrinting();
  const q = usePrinterStatus(printing.enabled);
  const s = q.data;

  if (!printing.enabled) return null;
  const box = cn("rounded-xl border border-border bg-card shadow-soft", compact ? "p-3" : "p-4", className);

  if (q.isPending) {
    return <div className={cn(box, "flex items-center gap-2 text-sm text-muted-foreground")}><Loader2 className="h-4 w-4 animate-spin" /> {t("Checking the printer…")}</div>;
  }
  if (q.isError || !s) {
    return (
      <div className={cn(box, "flex items-start gap-2 text-sm text-muted-foreground")}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t("Couldn't read the printer status. It is checked again in a few seconds.")}</span>
      </div>
    );
  }
  return compact ? <Compact s={s} className={box} /> : <Full s={s} className={box} name={printing.printerName ?? ""} tn={tn} />;
}

function Headline({ s, name }: { s: PrinterStatus; name?: string }) {
  const { t } = useLang();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[s.state])} aria-hidden />
      <span className="text-sm font-semibold">{stateText(s.state, t)}</span>
      {name && <span className="truncate text-sm text-muted-foreground">· {name}</span>}
    </div>
  );
}

function Notes({ s }: { s: PrinterStatus }) {
  const { t } = useLang();
  if (s.state === "unreachable") {
    return <p className="text-sm text-muted-foreground">{t("The server can't reach the printer's computer right now. Prints can't be sent until it's back.")}</p>;
  }
  const lines: string[] = [];
  if (s.state === "disconnected") lines.push(disconnectedText());
  for (const r of s.reasons) {
    const text = reasonText(r.keyword);
    if (!(s.state === "disconnected" && ["offline", "connecting-to-device", "timed-out"].includes(r.keyword))) lines.push(text);
  }
  if (!s.acceptingJobs) lines.push(t("The printer isn't taking new prints."));
  if (!lines.length) return null;
  const warn = s.state === "error" || s.state === "disconnected" || s.state === "stopped";
  return (
    <ul className={cn("space-y-0.5 text-sm", warn ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
      {lines.map((l) => <li key={l} className="flex items-start gap-1.5">{s.state === "disconnected" && l === lines[0] ? <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}<span>{l}</span></li>)}
    </ul>
  );
}

function Full({ s, className, name, tn }: { s: PrinterStatus; className: string; name: string; tn: (n: number, one: string, many: string, v?: Record<string, string | number>) => string }) {
  const { t } = useLang();
  const now = s.jobs.find((j) => j.state === "printing" || j.state === "stalled");
  const waiting = s.jobs.filter((j) => j !== now);
  return (
    <section aria-label={t("Printer status")} aria-live="polite" className={cn(className, "space-y-3")}>
      <div className="flex items-start justify-between gap-3">
        <Headline s={s} name={name} />
        <Printer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <Notes s={s} />
      {s.reachable && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{now?.state === "stalled" ? t("Waiting for the printer") : t("Printing now")}</dt>
            <dd className="truncate font-medium">{now ? jobLine(now, t) : t("No one")}</dd>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t("In the queue")}</dt>
            <dd className="font-medium tabular-nums">{tn(s.waiting, "{n} waiting", "{n} waiting")}</dd>
          </div>
        </dl>
      )}
      {waiting.length > 0 && (
        <ol className="space-y-1 text-sm">
          {waiting.map((j) => (
            <li key={j.position} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{j.position}.</span>
              <span className={cn("min-w-0 truncate", j.mine && "font-medium")}>{jobLine(j, t)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">{t("Prints sent straight to the printer over WiFi don't show here.")}</p>
    </section>
  );
}

function Compact({ s, className }: { s: PrinterStatus; className: string }) {
  const { t, tn } = useLang();
  const now = s.jobs.find((j) => j.state === "printing" || j.state === "stalled");
  return (
    <section aria-label={t("Printer status")} aria-live="polite" className={cn(className, "space-y-1.5")}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Headline s={s} />
        {s.reachable && <span className="text-xs text-muted-foreground tabular-nums">{tn(s.waiting, "{n} waiting", "{n} waiting")}</span>}
      </div>
      {now && s.state !== "disconnected" && <div className="truncate text-xs text-muted-foreground">{t("Printing now")}: {jobLine(now, t)}</div>}
      <Notes s={s} />
    </section>
  );
}

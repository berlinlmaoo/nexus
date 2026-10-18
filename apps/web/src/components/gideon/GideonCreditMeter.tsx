import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { History, Infinity as InfinityIcon, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang, type LangApi } from "@/lib/lang";
import { formatCount } from "@/lib/number-format";
import { cn } from "@/lib/utils";
import { CREDIT_TIER_NAME, fetchCreditHistory, useGideonCredits, type CreditSummary } from "@/lib/gideon-credits";

/**
 * The GIDEON credit meter under the composer (owner, 18 Oct 2026): "Credits today 64/100", the monthly pool
 * on hover / tap, "Unlimited" for BoD and One Above All. It moves with every answer (the chat stream's
 * `credits` event and the socket `gideon-credits`), and opens the person's own usage history.
 */

const fmtDay = (key: string, L: LangApi) =>
  new Date(`${key}T00:00:00+07:00`).toLocaleDateString(L.locale, { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });

function tone(used: number, limit: number): "ok" | "low" | "out" {
  if (limit <= 0) return used > 0 ? "out" : "ok";
  if (used >= limit) return "out";
  return used / limit >= 0.85 ? "low" : "ok";
}

function Bar({ used, limit, className }: { used: number; limit: number; className?: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : used > 0 ? 100 : 0;
  const t = tone(used, limit);
  return (
    <span aria-hidden className={cn("relative block h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", t === "out" ? "bg-destructive/80" : t === "low" ? "bg-amber-500" : "bg-sidebar-primary")}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function GideonCreditMeter({ className }: { className?: string }) {
  const L = useLang();
  const { t } = L;
  const q = useGideonCredits();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); }, []);
  const s = q.data;
  if (!s) return null;

  const label = s.unlimited
    ? t("Credits today {used} · Unlimited", { used: formatCount(s.today.used) })
    : t("Credits today {used}/{limit}", { used: formatCount(s.today.used), limit: formatCount(s.today.limit) });
  const dayTone = s.unlimited ? "ok" : tone(s.today.used, s.today.limit);
  const poolOut = !s.unlimited && s.pool.remaining <= 0 && s.today.remaining <= 0;

  // Hover opens it on a pointer device; a tap / click / Enter toggles it everywhere.
  const hover = (on: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpen(on), on ? 250 : 200);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onPointerEnter={hover(true)}
            onPointerLeave={hover(false)}
            aria-label={`${label}. ${t("Show GIDEON credits")}`}
            className={cn(
              "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dayTone === "out" && !s.unlimited && "text-destructive",
              className,
            )}
          >
            {s.unlimited ? <InfinityIcon className="h-3.5 w-3.5 shrink-0 text-sidebar-primary" /> : <Bar used={s.today.used} limit={s.today.limit} className="w-8 shrink-0" />}
            <span className="truncate">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-80 p-0"
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <CreditDetails s={s} L={L} onHistory={() => { setOpen(false); setHistory(true); }} poolOut={poolOut} />
        </PopoverContent>
      </Popover>
      <CreditHistoryDialog open={history} onOpenChange={setHistory} />
    </>
  );
}

function CreditDetails({ s, L, onHistory, poolOut }: { s: CreditSummary; L: LangApi; onHistory: () => void; poolOut: boolean }) {
  const { t } = L;
  const row = "flex items-baseline justify-between gap-3 text-sm";
  return (
    <div lang={L.lang} className="space-y-3 p-4">
      <div>
        <div className="font-display text-sm font-semibold">{t("GIDEON credits")}</div>
        <div className="text-xs text-muted-foreground">{t("Each answer costs what its model costs. Model 0 is free.")}</div>
      </div>
      {s.unlimited ? (
        <div className="space-y-1">
          <div className={row}><span>{t("Today")}</span><span className="font-semibold tabular-nums">{formatCount(s.today.used)}</span></div>
          <div className={row}><span>{t("This period")}</span><span className="font-semibold tabular-nums">{formatCount(s.period_used)}</span></div>
          <p className="pt-1 text-xs text-muted-foreground">{t("Your role has unlimited GIDEON credits.")}</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className={row}>
              <span>{t("Today")}</span>
              <span className="font-semibold tabular-nums">{formatCount(s.today.used)} <span className="font-normal text-muted-foreground">/ {formatCount(s.today.limit)}</span></span>
            </div>
            <Bar used={s.today.used} limit={s.today.limit} />
            <div className="text-xs text-muted-foreground">{t("Resets at 00:00 WIB. Unused credits don't carry over.")}</div>
          </div>
          <div className="space-y-1.5">
            <div className={row}>
              <span>{t("Monthly pool")}</span>
              <span className="font-semibold tabular-nums">{formatCount(s.pool.used)} <span className="font-normal text-muted-foreground">/ {formatCount(s.pool.limit)}</span></span>
            </div>
            <Bar used={s.pool.used} limit={s.pool.limit} />
            <div className="text-xs text-muted-foreground">
              {t("Used after today's credits run out. {start} – {end}, renews on the 28th.", { start: fmtDay(s.period.startKey, L), end: fmtDay(s.period.endKey, L) })}
              {s.pool.bonus > 0 && <> {t("Includes {n} bonus credits.", { n: formatCount(s.pool.bonus) })}</>}
            </div>
          </div>
          {s.over > 0 && (
            <div className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
              {t("{n} credits over your limit this period.", { n: formatCount(s.over) })} {!s.enforced && t("Nothing is blocked yet.")}
            </div>
          )}
          {s.enforced && poolOut && (
            <div className="rounded-md bg-accent px-2.5 py-2 text-xs text-accent-foreground">
              {s.next === "blocked"
                ? t("You're out of credits for today, including backup answers. GIDEON Model 0 is still free.")
                : t("You're out of credits: GIDEON Aphrodite answers instead ({left} left today).", { left: formatCount(Math.max(0, s.fallbackPerDay - s.fallbackToday)) })}
            </div>
          )}
        </>
      )}
      <div className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
        {t("A typical question: Phaëthon ≈ 10 credits, Artemis ≈ 45, Aphrodite ≈ 1, Model 0 free.")}
      </div>
      <button type="button" onClick={onHistory} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <History className="h-4 w-4" />{t("Usage history")}
      </button>
    </div>
  );
}

const TRIGGER_LABEL: Record<string, string> = { CHAT: "Chat", WRITE: "Ask AI", MENTION: "@mention", SCHEDULE: "Schedule", AUTOFILL: "Autofill", TICKET: "Support ticket", REFLECTION: "Reflection" };

export function CreditHistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const L = useLang();
  const { t } = L;
  const q = useInfiniteQuery({
    queryKey: ["gideon-credit-history"],
    queryFn: ({ pageParam }) => fetchCreditHistory(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled: open,
  });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const days = first?.days ?? [];
  const maxDay = Math.max(1, ...days.map((d) => d.credits));
  const s = first?.summary;
  const time = (iso: string) => new Date(iso).toLocaleString(L.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent lang={L.lang} className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="font-display">{t("GIDEON usage")}</DialogTitle>
          <DialogDescription>
            {s ? t("{start} – {end} · {n} credits this period", { start: fmtDay(s.period.startKey, L), end: fmtDay(s.period.endKey, L), n: formatCount(s.period_used) }) : t("Your answers and what each one cost.")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("Loading…")}</div>
          ) : q.isError ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{t("Couldn't load your GIDEON usage.")}</div>
          ) : (
            <>
              {days.length > 0 && (
                <div className="border-b border-border px-5 py-4">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">{t("Credits per day")}</div>
                  <div className="flex h-16 items-end gap-[3px]" role="img" aria-label={t("Credits per day")}>
                    {days.map((d) => (
                      <div key={d.dayKey} title={`${fmtDay(d.dayKey, L)} · ${formatCount(d.credits)} ${t("credits")} · ${formatCount(d.answers)} ${t("answers")}`} className="flex min-w-0 flex-1 flex-col justify-end">
                        <div className={cn("rounded-t-sm", d.dayKey === s?.dayKey ? "bg-sidebar-primary" : "bg-sidebar-primary/35")} style={{ height: `${Math.max(4, Math.round((d.credits / maxDay) * 64))}px` }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {items.length === 0 ? (
                <div className="p-10 text-center">
                  <div className="text-sm font-semibold">{t("No answers yet")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t("Ask GIDEON something. Each answer shows up here with what it cost.")}</div>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((it) => (
                    <li key={it.id} className="flex items-start gap-3 px-5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{it.title || t(TRIGGER_LABEL[it.trigger] ?? "Chat")}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {time(it.createdAt)} · GIDEON {CREDIT_TIER_NAME[it.tier] ?? it.tier}
                          {it.fallback && <> · {t("backup answer")}</>}
                          {!it.billable && <> · {t("not charged")}</>}
                        </div>
                      </div>
                      <div
                        className="shrink-0 text-right text-sm font-semibold tabular-nums"
                        title={t("{input} input · {cached} cached · {output} output tokens", { input: formatCount(it.inputTokens), cached: formatCount(it.cachedTokens), output: formatCount(it.outputTokens) })}
                      >
                        {it.credits === 0 ? t("Free") : formatCount(it.credits)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {q.hasNextPage && (
                <div className="p-3 text-center">
                  <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {q.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("Show more")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

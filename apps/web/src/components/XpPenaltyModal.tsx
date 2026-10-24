import { useEffect, useMemo, useState } from "react";
import { useModalTurn } from "@/lib/modal-queue";
import { EscClose } from "@/hooks/use-escape";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, TrendingDown, X } from "lucide-react";
import { fmtDate, fmtTime, nexusApi, type NexusXpPenalty } from "@/lib/nexus-api";
import { t as tr, tn } from "@/lib/lang";
import { formatSigned } from "@/lib/number-format";

/**
 * Global "your XP got cut" alert. On app open (and after check-in, via ["my-penalties"] invalidation),
 * it shows the user's recent XP penalties — late absen (with exact minutes), lupa check-out, alpha,
 * or an admin reduction. Dismissed penalty ids are remembered in localStorage so it only fires once
 * per item per device.
 */
const LS_KEY = "nexus.xp-penalty.dismissed";
function readDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
function writeDismissed(ids: string[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(ids.slice(-150))); } catch { /* storage full/blocked */ }
}

function penaltyLabel(p: NexusXpPenalty): string {
  switch (p.kind) {
    case "late": {
      // Exact (uncapped) minutes when the backend has them; else derive from the capped XP (-1/min, max 120).
      if (typeof p.lateMinutes === "number" && p.lateMinutes > 0) return tr("Checked in {n} min late", { n: p.lateMinutes });
      const m = Math.abs(p.amount);
      return m ? tr("Checked in {n} min late", { n: m >= 120 ? "120+" : m }) : tr("Checked in late");
    }
    case "nocheckout": return tr("Forgot to check out");
    case "alpha": return tr("Absent — no notice");
    case "admin": {
      const note = p.reason.startsWith("admin:adjust:") ? p.reason.slice("admin:adjust:".length) : "";
      return note ? tr("XP cut by admin · {note}", { note }) : tr("XP cut by admin");
    }
    // Unknown negative reasons: never show a raw machine string to staff.
    // (New penalty types should be added to kindOf() on the backend + a case here.)
    default: return tr("XP lost");
  }
}

export function XpPenaltyModal() {
  const q = useQuery({ queryKey: ["my-penalties"], queryFn: nexusApi.myPenalties, retry: 1, staleTime: 30_000 });
  const [dismissedSession, setDismissedSession] = useState(false);
  const [seenIds, setSeenIds] = useState<string[]>(() => (typeof localStorage !== "undefined" ? readDismissed() : []));

  const penalties = q.data?.penalties ?? [];
  const fresh = useMemo(() => penalties.filter((p) => !seenIds.includes(p.id)), [penalties, seenIds]);
  const wanted = !dismissedSession && fresh.length > 0;
  // First in the start-up modal queue (C-D1): the others wait until this one is closed.
  const turn = useModalTurn("xpPenalty", q.isLoading ? "pending" : wanted ? "want" : "idle");
  const shouldShow = wanted && turn;

  useEffect(() => {
    if (!shouldShow) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [shouldShow]);

  const dismiss = () => {
    if (dismissedSession) return; // guard against double-fire (backdrop + button)
    const next = [...seenIds, ...fresh.map((p) => p.id)];
    writeDismissed(next);
    setSeenIds(next);
    setDismissedSession(true);
  };

  if (typeof document === "undefined") return null;
  const total = fresh.reduce((s, p) => s + p.amount, 0);

  return createPortal(
    <AnimatePresence>
      {shouldShow && (
        <div className="fixed inset-0 z-[90] grid grid-cols-1 place-items-center p-4">
          <EscClose onClose={dismiss} />
          <motion.div className="absolute inset-0 bg-foreground/40 dark:bg-scrim backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={dismiss} />
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-pop"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border bg-gradient-to-br from-rose-100 via-card to-rose-50 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-500/15 text-rose-600 dark:text-rose-400"><TrendingDown className="h-5 w-5" /></div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-600 dark:text-rose-400">{tr("XP deducted")}</p>
                  <h2 className="mt-0.5 font-display text-xl font-bold tracking-tight">{tr("Your XP went down")}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tn(fresh.length, "{n} deduction since you last looked.", "{n} deductions since you last looked.", { n: fresh.length })}</p>
                </div>
              </div>
              <button onClick={dismiss} aria-label={tr("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-2 p-5">
              {fresh.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-border bg-muted/20 px-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                  <div className="min-w-0 flex-1">
                    <div title={penaltyLabel(p)} className="line-clamp-2 break-words text-sm font-semibold leading-snug">{penaltyLabel(p)}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtDate(p.createdAt)} {fmtTime(p.createdAt)}</div>
                  </div>
                  <div className="shrink-0 text-sm font-black tabular-nums text-rose-600 dark:text-rose-400">{formatSigned(p.amount)} XP</div>
                </div>
              ))}
              {fresh.length > 1 && (
                <div className="flex items-center justify-between rounded-2xl bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-700 dark:text-rose-300">
                  <span>{tr("Total")}</span><span className="tabular-nums">{formatSigned(total)} XP</span>
                </div>
              )}
              <button onClick={dismiss} className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99]">{tr("Got it")}</button>
              <p className="text-center text-[11px] text-muted-foreground">{tr("Late = −1 XP per minute (max −120). Check in on time to avoid it.")}</p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

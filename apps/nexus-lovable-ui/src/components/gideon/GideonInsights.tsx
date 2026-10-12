import { useState } from "react";
import { EscClose } from "@/hooks/use-escape";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { GideonMark } from "./GideonMark";
import { gideonRunDetail, gideonRuns, type GideonRunRow } from "@/lib/gideon";
import { useLang, type LangApi } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { HScroll } from "@/components/HScroll";

/**
 * GIDEON "Insights" (12 Oct 2026, after Notion's agent Insights): every run — chat, @mention, scheduled
 * digest, support ticket, reflection summary — with when, what started it, how it ended, the tools it
 * used and the error if it failed. Control Room › GIDEON shows all of them to BoD; a project's GIDEON card
 * shows that project's to its leads. Somebody else's chat shows as "Chat" without its question.
 */

const TRIGGER_LABEL: Record<string, string> = { CHAT: "Chat", MENTION: "@mention", SCHEDULE: "Schedule", TICKET: "Support ticket", REFLECTION: "Reflection" };
const STATUS_LABEL: Record<string, string> = { RUNNING: "Running", SUCCEEDED: "Succeeded", FAILED: "Failed" };
const STATUS_TONE: Record<string, string> = { RUNNING: "bg-primary", SUCCEEDED: "bg-emerald-500", FAILED: "bg-destructive" };

function fmt(iso: string, L: LangApi) {
  return new Date(iso).toLocaleString(L.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
}
function dur(ms: number | null) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}

export function GideonInsights() {
  const L = useLang();
  const { t } = L;
  const [trigger, setTrigger] = useState("");
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["nexus", "gideon-runs", "all", trigger, status], queryFn: () => gideonRuns({ trigger, status, limit: 100 }), retry: false });
  const totals = q.data?.totals;
  const chip = (on: boolean) => cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors", on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent");
  return (
    <div lang={L.lang} className="space-y-4">
      {totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={t("Runs")} value={totals.runs} hint={t("Last {n} days", { n: totals.days })} />
          <Tile label={t("Completion rate")} value={totals.completionRate == null ? "—" : `${totals.completionRate}%`} hint={L.tn(totals.failures, "1 failure", "{n} failures")} />
          <Tile label={t("Failures")} value={totals.failures} hint={t("Last {n} days", { n: totals.days })} tone={totals.failures > 0 ? "warn" : undefined} />
          <Tile label={t("Active people")} value={totals.activeUsers} hint={t("Last {n} days", { n: totals.days })} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(!trigger)} onClick={() => setTrigger("")}>{t("All")}</button>
        {Object.entries(TRIGGER_LABEL).map(([k, v]) => <button key={k} type="button" className={chip(trigger === k)} onClick={() => setTrigger(trigger === k ? "" : k)}>{t(v)}</button>)}
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className={chip(status === "FAILED")} onClick={() => setStatus(status === "FAILED" ? "" : "FAILED")}>{t("Failed only")}</button>
      </div>
      {q.isLoading && <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
      {q.isError && <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">{t("Couldn't load GIDEON's run log.")}</div>}
      {q.data && <GideonRunList runs={q.data.runs} />}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-display text-2xl font-bold tabular-nums", tone === "warn" && "text-destructive")}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function GideonRunList({ runs, compact }: { runs: GideonRunRow[]; compact?: boolean }) {
  const L = useLang();
  const { t } = L;
  const [openId, setOpenId] = useState<string | null>(null);
  if (!runs.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
        <GideonMark className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
        <div className="text-sm font-semibold">{t("No GIDEON runs yet")}</div>
        <p className="mt-1 text-xs text-muted-foreground">{t("Chats, @GIDEON mentions and scheduled digests show up here once they run.")}</p>
      </div>
    );
  }
  return (
    <HScroll className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold text-muted-foreground">
            <th className="px-3 py-2">{t("Run")}</th>
            {!compact && <th className="px-3 py-2">{t("For")}</th>}
            <th className="px-3 py-2">{t("Status")}</th>
            <th className="px-3 py-2">{t("Started")}</th>
            <th className="px-3 py-2">{t("Trigger")}</th>
            <th className="px-3 py-2 text-right">{t("Tools")}</th>
            <th className="px-3 py-2 text-right">{t("Took")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer border-b border-border/60 align-top last:border-0 hover:bg-accent/40">
              <td className="max-w-[18rem] px-3 py-2">
                <div className="truncate font-medium">{r.titleHidden ? <span className="text-muted-foreground">{t("Chat (private)")}</span> : r.title || "—"}</div>
                {r.error && <div className="truncate text-xs text-destructive" title={r.error}>{r.error}</div>}
              </td>
              {!compact && <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.user?.name ?? "—"}</td>}
              <td className="whitespace-nowrap px-3 py-2"><span className="inline-flex items-center gap-1.5 text-xs font-semibold"><span className={cn("h-2 w-2 rounded-full", STATUS_TONE[r.status] ?? "bg-muted")} />{t(STATUS_LABEL[r.status] ?? r.status)}</span></td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{fmt(r.startedAt, L)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs"><span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-muted-foreground">{t(TRIGGER_LABEL[r.trigger] ?? r.trigger)}</span></td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-muted-foreground" title={r.toolsUsed.join(", ")}>{r.toolCalls}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{dur(r.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {openId && <RunDetail id={openId} onClose={() => setOpenId(null)} />}
    </HScroll>
  );
}

/** One run with its tool calls, as a centred dialog (house style: details pop up in the middle). */
function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const L = useLang();
  const { t } = L;
  const q = useQuery({ queryKey: ["nexus", "gideon-run", id], queryFn: () => gideonRunDetail(id), retry: false });
  const r = q.data?.run;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 dark:bg-scrim p-4" onClick={onClose}>
      <EscClose onClose={onClose} />
      <div role="dialog" aria-modal="true" lang={L.lang} className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <GideonMark className="mt-1 h-4 w-4" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{r ? (r.titleHidden ? t("Chat (private)") : r.title || "—") : t("Loading…")}</div>
            {r && <div className="text-xs text-muted-foreground">{[t(TRIGGER_LABEL[r.trigger] ?? r.trigger), r.user?.name, fmt(r.startedAt, L), dur(r.durationMs), r.tier].filter(Boolean).join(" · ")}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        {r?.error && <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{r.error}</div>}
        {q.isLoading && <Loader2 className="mx-auto mt-4 h-4 w-4 animate-spin text-muted-foreground" />}
        {q.data && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t("Steps")}</div>
            {q.data.stepsHidden ? (
              <p className="text-xs text-muted-foreground">{t("Hidden: what somebody asks GIDEON in a chat stays between them and GIDEON.")}</p>
            ) : q.data.steps.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("No tools were used.")}</p>
            ) : (
              <ol className="space-y-1">
                {q.data.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-xs">
                    {s.ok === false ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                    <span className="min-w-0 flex-1">{s.label}{s.error && <span className="block text-destructive">{s.error}</span>}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{dur(s.durationMs)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

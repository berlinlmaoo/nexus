import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Gauge, Loader2, MessageSquareWarning, Repeat2, ThermometerSun, Wrench, XCircle, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GideonMark } from "./GideonMark";
import { useLang, type LangApi } from "@/lib/lang";
import { formatCount } from "@/lib/number-format";
import { cn } from "@/lib/utils";
import { PERF_TIERS, PERF_TIER_NAME, useGideonPerf, type PerfAlertKey, type PerfSummary, type PerfTier, type PerfTierId } from "@/lib/gideon-perf";

/**
 * Control Room › GIDEON › Performance (owner, 18 Oct 2026). BoD / One Above All (the server answers 403 to
 * anyone else, and only lets them into the `gideon:perf` socket room). Live: GPU readings every ~5 s while this is
 * open, the tier cards and charts refetch when an answer starts or ends. Numbers only, never questions.
 *
 * Tier colours: one fixed hue per tier (validated categorical set, light + dark), with the tier name always
 * next to it — colour is never the only cue.
 */

const TIER_VAR: Record<PerfTierId, string> = { astra: "var(--gp-astra)", luna: "var(--gp-luna)", terra: "var(--gp-terra)", experimental: "var(--gp-model0)" };
const TIER_CSS = `
.gp-root{--gp-astra:#6250d6;--gp-luna:#eb6834;--gp-terra:#1baf7a;--gp-model0:#2a78d6}
.dark .gp-root{--gp-astra:#9085e9;--gp-luna:#d95926;--gp-terra:#199e70;--gp-model0:#3987e5}
`;

const STATUS: Record<PerfTier["status"], { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  online: { label: "Online", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  busy: { label: "Busy", cls: "bg-accent text-accent-foreground", icon: Zap },
  loading: { label: "Loading", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300", icon: Loader2 },
  unavailable: { label: "Unavailable", cls: "bg-destructive/10 text-destructive", icon: XCircle },
};
const REASON: Record<string, string> = {
  transcribing: "The GPU is transcribing a meeting.",
  loading: "Loading the model into the GPU.",
  down: "The local engine isn't responding.",
  failing: "The last 3 answers failed.",
};
const ALERT_LABEL: Record<PerfAlertKey, string> = {
  model0_down: "Model 0 is down",
  error_rate: "Error rate is high",
  vram_full: "GPU memory is full",
  gpu_hot: "GPU is running hot",
};

const card = "rounded-2xl border border-border bg-card p-4 shadow-soft";
const tooltipStyle = { borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12 } as const;

function ms(v: number | null): string {
  if (v == null) return "—";
  return v < 1000 ? `${formatCount(v)} ms` : `${formatCount(v / 1000, 1)} s`;
}
function pct(v: number | null, digits = 0): string {
  return v == null ? "—" : `${formatCount(v * 100, digits)}%`;
}
function gb(mib: number | null | undefined, digits = 1): string {
  return mib == null ? "—" : formatCount(mib / 1024, digits);
}
function bytesGb(b: number): string {
  return formatCount(b / 1024 ** 3, 1);
}
function hourLabel(iso: string, L: LangApi) {
  return new Date(iso).toLocaleTimeString(L.locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
}
function timeLabel(iso: string, L: LangApi) {
  return new Date(iso).toLocaleTimeString(L.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
}
function toolName(tool: string) {
  return tool.replace(/^nexus_/, "").replace(/_/g, " ");
}

/** Seconds since `iso`, ticking once a second while shown. */
function useAgo(iso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null;
}

export function GideonPerformance() {
  const L = useLang();
  const { t } = L;
  const q = useGideonPerf();
  const d = q.data;

  if (q.isLoading) {
    return <div className={cn(card, "p-8 text-center text-sm text-muted-foreground")}><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>;
  }
  if (q.isError || !d) {
    return (
      <div className={cn(card, "p-8 text-center")}>
        <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-semibold">{t("Couldn't load GIDEON performance.")}</div>
        <button type="button" onClick={() => void q.refetch()} className="mt-3 inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-accent">{t("Try again")}</button>
      </div>
    );
  }

  return (
    <div lang={L.lang} className="gp-root space-y-5">
      <style>{TIER_CSS}</style>
      <LiveBar d={d} />
      <Alerts d={d} />
      <section aria-label={t("Tiers")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PERF_TIERS.map((id) => {
          const tier = d.tiers.find((x) => x.id === id);
          return tier ? <TierCard key={id} tier={tier} /> : null;
        })}
      </section>
      <Model0Panel d={d} />
      <Charts d={d} />
      <Quality d={d} />
    </div>
  );
}

function LiveBar({ d }: { d: PerfSummary }) {
  const L = useLang();
  const { t } = L;
  const ago = useAgo(d.telemetry.lastAt);
  const stale = d.telemetry.lastAt == null || (ago != null && ago > 180);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm">
        <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", stale ? "bg-muted-foreground/50" : "bg-emerald-500")}>
          {!stale && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60 motion-reduce:hidden" />}
        </span>
        <span className="font-semibold">{stale ? t("GPU readings stopped") : t("Live data")}</span>
        <span className="text-muted-foreground">
          {d.telemetry.lastAt == null
            ? t("No reading from the GPU host yet.")
            : ago != null && ago < 60
              ? t("GPU updated {n} s ago", { n: ago })
              : t("GPU updated at {time}", { time: timeLabel(d.telemetry.lastAt, L) })}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{t("Answers: last 15 min · Charts: last 24 h")}</span>
    </div>
  );
}

function Alerts({ d }: { d: PerfSummary }) {
  const L = useLang();
  const { t } = L;
  const active = d.alerts.filter((a) => a.active);
  if (!active.length) return null;
  return (
    <div role="status" className="space-y-2">
      {active.map((a) => (
        <div key={a.key} className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-3.5 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <span className="font-semibold text-destructive">{t(ALERT_LABEL[a.key])}</span>
            {a.value && <span className="ml-1.5 tabular-nums text-foreground">{a.value}</span>}
            {a.since && <span className="ml-1.5 text-muted-foreground">· {t("since {time}", { time: timeLabel(a.since, L) })}</span>}
            <div className="text-xs text-muted-foreground">{t("The One Above All was notified.")}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TierCard({ tier }: { tier: PerfTier }) {
  const L = useLang();
  const { t } = L;
  const st = STATUS[tier.status];
  const Icon = st.icon;
  const errorHigh = tier.errorRate != null && tier.errorRate > 0.05;
  return (
    <div className={cn(card, "flex min-w-0 flex-col gap-3")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TIER_VAR[tier.id] }} />
          <div className="min-w-0 truncate font-display text-[15px] font-semibold">GIDEON {PERF_TIER_NAME[tier.id]}</div>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", st.cls)}>
          <Icon className={cn("h-3.5 w-3.5", tier.status === "loading" && "animate-spin motion-reduce:animate-none")} />
          {t(st.label)}
        </span>
      </div>
      {tier.reason && REASON[tier.reason] && <div className="-mt-1 text-xs text-muted-foreground">{t(REASON[tier.reason])}</div>}
      <div>
        <div className="font-display text-2xl font-bold tabular-nums">{ms(tier.p50Ms)}</div>
        <div className="text-xs text-muted-foreground">{t("Typical answer time (p50)")}</div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Metric label={t("Slowest 5% (p95)")} value={ms(tier.p95Ms)} />
        <Metric label={t("Error rate")} value={tier.errorRate == null ? "—" : pct(tier.errorRate, 1)} warn={errorHigh} hint={tier.failures15m ? L.tn(tier.failures15m, "1 failed", "{n} failed") : undefined} />
        <Metric label={t("Answering now")} value={formatCount(tier.inFlight)} />
        <Metric label={t("Credits per answer")} value={tier.id === "experimental" ? t("Free") : tier.avgCredits15m != null ? formatCount(tier.avgCredits15m, 1) : "—"} hint={tier.id !== "experimental" && tier.avgCredits15m == null && tier.avgCredits24h != null ? t("Avg {n} over 24 h", { n: formatCount(tier.avgCredits24h, 1) }) : undefined} />
      </dl>
      <div className="mt-auto border-t border-border/70 pt-2 text-xs text-muted-foreground">
        {tier.answers15m === 0 && tier.inFlight === 0
          ? t("No answers in the last 15 min · {n} in 24 h", { n: formatCount(tier.answers24h) })
          : t("{a} answers in 15 min · {n} in 24 h", { a: formatCount(tier.answers15m), n: formatCount(tier.answers24h) })}
      </div>
    </div>
  );
}

function Metric({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-semibold tabular-nums", warn && "text-destructive")}>{value}</dd>
      {hint && <dd className="text-[11px] leading-tight text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function Meter({ icon: Icon, label, value, sub, frac, warn }: { icon: typeof Cpu; label: string; value: string; sub?: string; frac: number | null; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className={cn("mt-1 whitespace-nowrap font-display text-lg font-bold tabular-nums sm:text-xl", warn && "text-destructive")}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", warn ? "bg-destructive" : "bg-sidebar-primary")} style={{ width: `${Math.round(Math.max(0, Math.min(1, frac ?? 0)) * 100)}%` }} />
      </div>
    </div>
  );
}

function Model0Panel({ d }: { d: PerfSummary }) {
  const L = useLang();
  const { t } = L;
  const g = d.live?.gpu ?? null;
  const eng = d.live?.engine ?? null;
  const m = eng?.model ?? null;
  const w = d.live?.whisper ?? null;
  const memFrac = g?.memUsedMiB != null && g.memTotalMiB ? g.memUsedMiB / g.memTotalMiB : null;
  const th = d.thresholds;
  const lastLoad = d.model0.loads[0];
  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_VAR.experimental }} />
          {t("Model 0 and the office GPU")}
        </h3>
        <span className="text-xs text-muted-foreground">{g?.name ?? t("GPU")}</span>
      </div>
      {!d.live ? (
        <EmptyNote icon={Cpu} title={t("No GPU readings yet")} body={t("They appear once the exporter on the GPU host sends its first reading.")} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Meter icon={Gauge} label={t("GPU use")} value={g?.util != null ? `${formatCount(g.util)}%` : "—"} frac={g?.util != null ? g.util / 100 : null} />
            <Meter icon={Cpu} label={t("VRAM")} value={`${gb(g?.memUsedMiB)} / ${gb(g?.memTotalMiB)} GB`} sub={memFrac != null ? `${formatCount(memFrac * 100)}%` : undefined} frac={memFrac} warn={memFrac != null && memFrac * 100 >= th.vramFullPct} />
            <Meter icon={ThermometerSun} label={t("Temperature")} value={g?.tempC != null ? `${formatCount(g.tempC)}°C` : "—"} sub={t("Alert at {n}°C", { n: th.gpuHotC })} frac={g?.tempC != null ? g.tempC / 100 : null} warn={g?.tempC != null && g.tempC >= th.gpuHotC} />
            <Meter icon={Zap} label={t("Power")} value={g?.powerW != null ? `${formatCount(g.powerW)} W` : "—"} sub={g?.powerLimitW != null ? t("of {n} W", { n: formatCount(g.powerLimitW) }) : undefined} frac={g?.powerW != null && g.powerLimitW ? g.powerW / g.powerLimitW : null} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="min-w-0 rounded-xl border border-border/70 p-3">
              <div className="text-xs font-medium text-muted-foreground">{t("Loaded model")}</div>
              {!eng ? (
                <div className="mt-1 text-sm text-muted-foreground">—</div>
              ) : !eng.up ? (
                <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-destructive"><XCircle className="h-4 w-4" />{t("The local engine isn't responding.")}</div>
              ) : !m ? (
                <div className="mt-1 text-sm">{t("None loaded. It loads on the next question.")}</div>
              ) : (
                <>
                  <div className="mt-1 truncate font-mono text-sm font-semibold" title={m.name}>{m.name}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {m.gpuShare != null && m.gpuShare >= 0.995 ? (
                      <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">{t("Fully on GPU")}</span>
                    ) : (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-800 dark:text-amber-300">{t("Partly on CPU · {p} on GPU", { p: pct(m.gpuShare) })}</span>
                    )}
                    <span className="text-muted-foreground tabular-nums">{t("{a} of {b} GB in VRAM", { a: bytesGb(m.sizeVramBytes), b: bytesGb(m.sizeBytes) })}</span>
                  </div>
                </>
              )}
            </div>
            <div className="min-w-0 rounded-xl border border-border/70 p-3">
              <div className="text-xs font-medium text-muted-foreground">{t("Speed (last 24 h)")}</div>
              <div className="mt-1 font-display text-xl font-bold tabular-nums">{d.model0.avgEvalTps24h != null ? t("{n} tokens/s", { n: formatCount(d.model0.avgEvalTps24h, 1) }) : "—"}</div>
              <div className="text-[11px] text-muted-foreground">
                {L.tn(d.model0.gens24h, "1 generation", "{n} generations")}
                {lastLoad ? ` · ${t("last load {s} s at {time}", { s: lastLoad.loadSec != null ? formatCount(lastLoad.loadSec, 1) : "—", time: hourLabel(lastLoad.at, L) })}` : ""}
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-border/70 p-3">
              <div className="text-xs font-medium text-muted-foreground">{t("Meeting transcriber")}</div>
              {!w ? (
                <div className="mt-1 text-sm text-muted-foreground">{t("Not reported")}</div>
              ) : !w.up ? (
                <div className="mt-1 text-sm font-semibold text-destructive">{t("Not responding")}</div>
              ) : (
                <>
                  <div className="mt-1 font-display text-xl font-bold">{w.busy ? t("Transcribing") : t("Idle")}</div>
                  <div className="text-[11px] text-muted-foreground">{L.tn(w.queued, "1 waiting", "{n} waiting")}</div>
                </>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Recent Model 0 generations")}</div>
            {d.model0.recent.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("None yet.")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">{t("Time")}</th>
                      <th className="py-1 pr-3 text-right font-medium">{t("Tokens/s")}</th>
                      <th className="hidden py-1 pr-3 text-right font-medium sm:table-cell">{t("Reading prompt")}</th>
                      <th className="py-1 pr-3 text-right font-medium">{t("Tokens out")}</th>
                      <th className="py-1 text-right font-medium">{t("Took")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.model0.recent.slice(0, 5).map((r) => (
                      <tr key={r.at} className="border-t border-border/60 tabular-nums">
                        <td className="py-1.5 pr-3 text-muted-foreground">{timeLabel(r.at, L)}</td>
                        <td className="py-1.5 pr-3 text-right font-semibold">{r.evalTps != null ? formatCount(r.evalTps, 1) : "—"}</td>
                        <td className="hidden py-1.5 pr-3 text-right text-muted-foreground sm:table-cell">{r.promptTps != null ? t("{n}/s", { n: formatCount(r.promptTps) }) : "—"}</td>
                        <td className="py-1.5 pr-3 text-right">{r.outTokens != null ? formatCount(r.outTokens) : "—"}</td>
                        <td className="py-1.5 text-right">{ms(r.totalMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ChartCard({ title, sub, children, empty }: { title: string; sub?: string; children: ReactNode; empty?: string | null }) {
  return (
    <div className={cn(card, "min-w-0")}>
      <div className="mb-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      {empty ? <div className="grid h-[200px] place-items-center text-sm text-muted-foreground">{empty}</div> : <div className="h-[200px]">{children}</div>}
    </div>
  );
}

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };

function Charts({ d }: { d: PerfSummary }) {
  const L = useLang();
  const { t } = L;
  const rows = useMemo(
    () => d.hours.map((h) => ({
      label: hourLabel(h.t, L),
      ...Object.fromEntries(PERF_TIERS.map((id) => [`q_${id}`, h.questions[id]])),
      ...Object.fromEntries(PERF_TIERS.map((id) => [`p_${id}`, h.p50Ms[id] != null ? h.p50Ms[id]! / 1000 : null])),
      credits: h.credits,
      cache: h.cacheHit != null ? Math.round(h.cacheHit * 1000) / 10 : null,
    })),
    [d.hours, L],
  );
  const anyQ = d.hours.some((h) => PERF_TIERS.some((id) => h.questions[id] > 0));
  const anyCredits = d.hours.some((h) => h.credits > 0);
  const anyCache = d.hours.some((h) => h.cacheHit != null);
  const totalIn = d.hours.reduce((s, h) => s + h.inputTokens, 0);
  const totalCached = d.hours.reduce((s, h) => s + h.cachedTokens, 0);
  const cache24 = totalIn + totalCached > 0 ? totalCached / (totalIn + totalCached) : null;
  const totalCredits = d.hours.reduce((s, h) => s + h.credits, 0);
  const tierName = (id: PerfTierId) => PERF_TIER_NAME[id];
  const legend = <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />;
  const x = <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />;
  const noData = t("No answers in the last 24 h.");
  return (
    <section aria-label={t("Last 24 hours")} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ChartCard title={t("Questions per tier")} sub={t("Per hour, last 24 h")} empty={anyQ ? null : noData}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
            {grid}{x}
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} allowDecimals={false} tickFormatter={(v: number) => formatCount(v)} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} contentStyle={tooltipStyle} formatter={(v: number | string, n: string) => [formatCount(Number(v)), n]} />
            {legend}
            {PERF_TIERS.map((id, i) => (
              <Bar key={id} dataKey={`q_${id}`} name={tierName(id)} stackId="q" fill={TIER_VAR[id]} stroke="var(--card)" strokeWidth={1} maxBarSize={22} radius={i === PERF_TIERS.length - 1 ? [4, 4, 0, 0] : undefined} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title={t("Typical answer time")} sub={t("p50 per hour, seconds")} empty={anyQ ? null : noData}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            {grid}{x}
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => formatCount(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number | string, n: string) => [`${formatCount(Number(v), 1)} s`, n]} />
            {legend}
            {PERF_TIERS.map((id) => (
              <Line key={id} type="monotone" dataKey={`p_${id}`} name={tierName(id)} stroke={TIER_VAR[id]} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: TIER_VAR[id] }} activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title={t("Credits spent")} sub={t("{n} in 24 h", { n: formatCount(totalCredits) })} empty={anyCredits ? null : t("No credits spent in the last 24 h.")}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            {grid}{x}
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatCount(v)} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} contentStyle={tooltipStyle} formatter={(v: number | string) => [formatCount(Number(v)), t("Credits")]} />
            <Bar dataKey="credits" name={t("Credits")} fill="var(--sidebar-primary)" maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title={t("Prompt cache hits")} sub={cache24 != null ? t("{p} of input tokens came from the cache in 24 h", { p: pct(cache24) }) : t("Share of input tokens served from the cache")} empty={anyCache ? null : noData}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            {grid}{x}
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number | string) => [`${formatCount(Number(v), 1)}%`, t("Cache hits")]} />
            <Line type="monotone" dataKey="cache" name={t("Cache hits")} stroke="var(--sidebar-primary)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: "var(--sidebar-primary)" }} activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}

function EmptyNote({ icon: Icon, title, body }: { icon: typeof Cpu; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-4 text-center">
      <Icon className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground/60" />
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function ToolList({ rows, mode }: { rows: { tool: string; calls: number; failures: number }[]; mode: "used" | "failing" }) {
  const L = useLang();
  const { t } = L;
  const max = Math.max(1, ...rows.map((r) => (mode === "used" ? r.calls : r.failures)));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const v = mode === "used" ? r.calls : r.failures;
        return (
          <li key={r.tool} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate" title={r.tool}>{toolName(r.tool)}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {mode === "used" ? formatCount(r.calls) : t("{f} of {n}", { f: formatCount(r.failures), n: formatCount(r.calls) })}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={cn("h-full rounded-full", mode === "used" ? "bg-sidebar-primary" : "bg-destructive")} style={{ width: `${(v / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Quality({ d }: { d: PerfSummary }) {
  const L = useLang();
  const { t } = L;
  const qd = d.quality;
  const missRate = qd.answers24h ? qd.routerMisses24h / qd.answers24h : null;
  return (
    <section className="space-y-3">
      <h3 className="font-display text-base font-semibold">{t("Quality")}</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className={card}>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Repeat2 className="h-3.5 w-3.5" />{t("Retried with all tools")}</div>
          <div className="mt-1 font-display text-2xl font-bold tabular-nums">{formatCount(qd.routerMisses24h)}</div>
          <div className="text-[11px] text-muted-foreground">{missRate != null ? t("{p} of {n} answers in 24 h", { p: pct(missRate, 1), n: formatCount(qd.answers24h) }) : t("Last 24 h")}</div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{t("GIDEON first said it couldn't, then answered again with every tool loaded.")}</p>
          {qd.recentMisses.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {qd.recentMisses.map((m) => (
                <li key={m.at} className="flex justify-between gap-2 tabular-nums">
                  <span className="text-muted-foreground">{timeLabel(m.at, L)}</span>
                  <span>{m.tier && (PERF_TIERS as string[]).includes(m.tier) ? PERF_TIER_NAME[m.tier as PerfTierId] : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={card}>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Wrench className="h-3.5 w-3.5" />{t("Most-used tools")}</div>
          {qd.topTools.length ? <ToolList rows={qd.topTools} mode="used" /> : <div className="text-sm text-muted-foreground">{t("No tool calls in the last 24 h.")}</div>}
        </div>
        <div className={card}>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" />{t("Most-failing tools")}</div>
          {qd.failingTools.length ? <ToolList rows={qd.failingTools} mode="failing" /> : <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />{t("No tool failures in the last 24 h.")}</div>}
        </div>
        <div className={card}>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><MessageSquareWarning className="h-3.5 w-3.5" />{t("Thumbs down")}</div>
          {qd.thumbsDown == null ? (
            <div className="rounded-xl border border-dashed border-border p-3 text-center">
              <GideonMark className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground/50" />
              <div className="text-sm font-semibold">{t("Not collected yet")}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("GIDEON answers don't have a thumbs up/down yet. This fills in once they do.")}</p>
            </div>
          ) : (
            <div className="font-display text-2xl font-bold tabular-nums">{formatCount(qd.thumbsDown)}</div>
          )}
        </div>
      </div>
    </section>
  );
}

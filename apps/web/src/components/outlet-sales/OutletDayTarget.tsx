import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, PencilLine, Target } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { outletApi, outletKey, type OutletDay, type OutletMonthResponse, type OutletTargetSource } from "@/lib/outlet-sales-api";
import { Meter, count, dayLong, rupiah } from "./outlet-ui";

function digitsOf(v: string): number | null {
  const d = v.replace(/\D/g, "");
  return d ? Number(d) : null;
}
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : new Intl.NumberFormat("id-ID").format(Math.round(n)));

/**
 * The calendar's picked day against its target (owner, 14 Oct 2026, after a meeting with Ryan): the day's
 * sales and pax (its events added up) against the target in force — the day's own, else the month's
 * target split over its days, per metric. Those who set the monthly target can give the day its own
 * sales target, pax target, or both; an empty box = the month's share again. Numbers from the server
 * (`days`, lib/outlet-sales.ts buildMonthDays).
 */
export function DayTargetPanel({ projectId, data, day }: { projectId: string; data: OutletMonthResponse; day: string }) {
  const { t, lang, locale } = useLang();
  const qc = useQueryClient();
  const info: OutletDay | undefined = data.days?.find((d) => d.date === day);
  const own = data.dayTargets?.find((d) => d.date === day);
  const [editing, setEditing] = useState(false);
  const [sales, setSales] = useState("");
  const [pax, setPax] = useState("");
  useEffect(() => { setEditing(false); }, [day]);

  const save = useMutation({
    mutationFn: () => outletApi.putDayTarget(projectId, { date: day, salesTarget: digitsOf(sales), paxTarget: digitsOf(pax) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outletKey(projectId) });
      toast.success(t("Target for {day} saved.", { day: dayLong(day, locale, data.today.slice(0, 4)) }));
      setEditing(false);
    },
    onError: (error) => {
      const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
      toast.error(typeof payload?.error === "string" ? payload.error : t("The target wasn't saved. Try again."));
    },
  });
  if (!info) return null;

  // What an empty box falls back to: the month's target split over its days.
  const shareSales = data.target?.salesTarget != null ? data.target.salesTarget / daysOf(data.month) : null;
  const sharePax = data.target?.paxTarget != null ? data.target.paxTarget / daysOf(data.month) : null;

  const start = () => {
    setSales(fmt(own?.salesTarget ?? null));
    setPax(fmt(own?.paxTarget ?? null));
    setEditing(true);
  };

  const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-right text-sm tabular-nums outline-none transition-colors hover:border-control-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-11";

  return (
    <section aria-label={t("Day target")} className="mb-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Target aria-hidden className="h-4 w-4 text-muted-foreground" /> {t("Day target")}
        </h4>
        {data.canManageTargets && !editing && (
          // An outlined button, not bare bold text: it has to read as something to click (UI tour run 13, W-B12).
          <button type="button" onClick={start} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[40px]">
            <PencilLine aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {own ? t("Change day target") : t("Set day target")}
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t("Sales target")}
            <span className="relative mt-1 block">
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs">Rp</span>
              <input inputMode="numeric" value={sales} onChange={(e) => setSales(fmt(digitsOf(e.target.value)))} placeholder={shareSales === null ? t("No target") : fmt(shareSales)} className={cn(input, "pl-9")} />
            </span>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            {t("Pax target")}
            <input inputMode="numeric" value={pax} onChange={(e) => setPax(fmt(digitsOf(e.target.value)))} placeholder={sharePax === null ? t("No target") : fmt(sharePax)} className={cn(input, "mt-1")} />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {t("Fill sales, pax or both. An empty box uses the month's target split over its days.")}
          </p>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11">{t("Cancel")}</button>
            <button type="submit" disabled={save.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60 pointer-coarse:h-11">
              {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
              {t("Save target")}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Metric label={t("Sales")} actual={info.sales} target={info.salesTarget} pct={info.salesPct} source={info.salesTargetSource} fmt={(n) => rupiah(n, lang)} />
          <Metric label={t("Pax")} actual={info.pax} target={info.paxTarget} pct={info.paxPct} source={info.paxTargetSource} fmt={(n) => count(n === null ? null : Math.round(n), lang)} />
        </div>
      )}
    </section>
  );
}

function daysOf(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function Metric({
  label, actual, target, pct, source, fmt: f,
}: {
  label: string; actual: number | null; target: number | null; pct: number | null; source: OutletTargetSource; fmt: (n: number | null) => string;
}) {
  const { t } = useLang();
  return (
    <div className="min-w-0">
      <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium">{label}</span>
        <span>{source === "day" ? t("Own target") : source === "month" ? t("Month's target ÷ days") : t("No target")}</span>
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
        <span className="text-lg font-semibold">{f(actual)}</span>
        {target !== null && <span className="text-sm text-muted-foreground">/ {f(target)}</span>}
        {pct !== null && (
          <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-xs font-semibold", pct >= 100 ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-primary/10 text-primary")}>{pct}%</span>
        )}
      </p>
      {target !== null && <div className="mt-2"><Meter pct={pct} label={label} /></div>}
    </div>
  );
}

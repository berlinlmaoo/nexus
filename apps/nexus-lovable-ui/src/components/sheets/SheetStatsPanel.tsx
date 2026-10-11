import { useMemo, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Minus, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { CellValue } from "@/lib/sheet-formula";
import { columnStats, type FrequencyRow } from "@/lib/sheet-stats";
import { SidePanel } from "./sheet-shell";

const TABLE_ROWS = 10;

/** A bar chart from plain divs: one bar per item, labels under it, a value axis on the left. */
function Bars({ items, fmt }: { items: { label: string; count: number }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const shown = items.slice(0, 40);
  return (
    <div className="flex h-40 gap-1.5">
      <div className="flex flex-col justify-between pb-4 text-right text-[10px] tabular-nums text-muted-foreground">
        <span>{fmt(max)}</span><span>{fmt(max / 2)}</span><span>{fmt(0)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-end gap-[3px] border-b border-border">
          {shown.map((it, i) => (
            <div
              key={i}
              title={`${it.label}: ${it.count}`}
              className="min-w-[3px] flex-1 rounded-t-sm bg-info/80 transition hover:bg-info"
              style={{ height: `${(it.count / max) * 100}%` }}
            />
          ))}
        </div>
        <div className="flex h-4 gap-[3px] overflow-hidden">
          {shown.map((it, i) => (
            <span key={i} className="min-w-[3px] flex-1 truncate text-center text-[9px] leading-4 text-muted-foreground">{shown.length <= 12 ? it.label : ""}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Data ▸ Column stats: counts, frequency table, a count chart and a histogram for one column. */
export function ColumnStatsPanel({ columns, colIndex, onColIndex, valuesOf, onClose }: {
  columns: { index: number; label: string }[];
  colIndex: number;
  onColIndex: (i: number) => void;
  /** Every cell of the column top to bottom (hidden and filtered rows included, like Sheets). */
  valuesOf: (colIndex: number) => { value: CellValue; text: string }[];
  onClose: () => void;
}) {
  const { t, locale } = useLang();
  const [ignore, setIgnore] = useState(0);
  const [chart, setChart] = useState<"count" | "dist">("count");
  const [order, setOrder] = useState<"most" | "least">("most");
  const pos = Math.max(0, columns.findIndex((c) => c.index === colIndex));
  const current = columns[pos];
  const stats = useMemo(() => columnStats(valuesOf(colIndex), ignore), [valuesOf, colIndex, ignore]);
  const nf = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }), [locale]);
  const short = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const num = (n: number | null) => (n === null ? "—" : nf.format(n));

  const freqRows: FrequencyRow[] = order === "most" ? stats.frequency : [...stats.frequency].reverse();
  const chartItems = chart === "count"
    ? stats.counts.map((c) => ({ label: c.text, count: c.count }))
    : stats.distribution.map((b) => ({ label: `${short.format(b.from)}–${short.format(b.to)}`, count: b.count }));

  const totals: [string, string][] = [
    [t("Total rows"), nf.format(stats.total)],
    [t("Empty cells"), nf.format(stats.empty)],
    [t("Unique values"), nf.format(stats.unique)],
    ...(stats.numeric ? ([
      [t("Sum"), num(stats.sum)],
      [t("Average"), num(stats.avg)],
      [t("Median"), num(stats.median)],
      [t("Minimum value"), num(stats.min)],
      [t("Maximum value"), num(stats.max)],
    ] as [string, string][]) : []),
  ];
  const tabBtn = (on: boolean) => cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition", on ? "text-primary" : "text-muted-foreground hover:text-foreground");
  const go = (d: number) => { const next = columns[pos + d]; if (next) onColIndex(next.index); };

  return (
    <SidePanel title={t("Column stats")} onClose={onClose}>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold" aria-live="polite">{current?.label ?? "—"}</span>
          <button type="button" onClick={() => go(-1)} disabled={pos <= 0} aria-label={t("Previous column")} className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => go(1)} disabled={pos >= columns.length - 1} aria-label={t("Next column")} className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>

        <div className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
          <span id="cs-ignore">{t("Ignore rows")}</span>
          <button type="button" onClick={() => setIgnore((n) => Math.max(0, n - 1))} disabled={ignore === 0} aria-label={t("Ignore one row fewer")} className="rounded border border-border p-0.5 hover:bg-muted disabled:opacity-30"><Minus className="h-3 w-3" /></button>
          <input
            aria-labelledby="cs-ignore"
            inputMode="numeric"
            value={ignore}
            onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); setIgnore(Number.isFinite(n) ? n : 0); }}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-6 w-10 rounded border border-border bg-background text-center text-xs tabular-nums text-foreground outline-none focus:border-ring"
          />
          <button type="button" onClick={() => setIgnore((n) => n + 1)} aria-label={t("Ignore one more row")} className="rounded border border-border p-0.5 hover:bg-muted"><Plus className="h-3 w-3" /></button>
        </div>

        <section className="rounded-xl border border-border p-2">
          <div role="tablist" className="mb-2 flex justify-center gap-2">
            <button role="tab" aria-selected={chart === "count"} type="button" onClick={() => setChart("count")} className={tabBtn(chart === "count")}><BarChart3 className="h-3.5 w-3.5" />{t("Count by value")}</button>
            <span className="w-px bg-border" />
            <button role="tab" aria-selected={chart === "dist"} type="button" onClick={() => setChart("dist")} className={tabBtn(chart === "dist")}><BarChart3 className="h-3.5 w-3.5" />{t("Distribution")}</button>
          </div>
          {chartItems.length
            ? <Bars items={chartItems} fmt={(n) => short.format(n)} />
            : <p className="py-10 text-center text-[11px] text-muted-foreground">{chart === "dist" ? t("No numbers in this column.") : t("This column is empty.")}</p>}
        </section>

        <section className="rounded-xl border border-border p-2">
          <div role="tablist" className="mb-1 flex justify-center gap-2">
            <button role="tab" aria-selected={order === "most"} type="button" onClick={() => setOrder("most")} className={tabBtn(order === "most")}><TrendingUp className="h-3.5 w-3.5" />{t("Most frequent")}</button>
            <span className="w-px bg-border" />
            <button role="tab" aria-selected={order === "least"} type="button" onClick={() => setOrder("least")} className={tabBtn(order === "least")}><TrendingDown className="h-3.5 w-3.5" />{t("Least frequent")}</button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-1 py-1 text-left font-medium">{t("Value")}</th>
                <th className="px-1 py-1 text-right font-medium">{t("Frequency")}</th>
              </tr>
            </thead>
            <tbody>
              {freqRows.slice(0, TABLE_ROWS).map((r) => (
                <tr key={r.text} className="border-t border-border">
                  <td className="max-w-[180px] truncate px-1 py-1.5 font-semibold">{r.text}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{nf.format(r.count)}</td>
                </tr>
              ))}
              {!freqRows.length && <tr><td colSpan={2} className="py-4 text-center text-[11px] text-muted-foreground">{t("This column is empty.")}</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border border-border">
          <dl>
            {totals.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-2 text-xs first:border-t-0">
                <dt className="font-medium">{k}</dt>
                <dd className="tabular-nums text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <p className="text-[10px] leading-snug text-muted-foreground">{t("All stats include data in hidden or filtered rows.")}</p>
      </div>
    </SidePanel>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell as RCell, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { nexusApi, type NexusFinanceDashboard } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const rp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const rpShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)} M`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(0)} jt`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)} rb`;
  return String(Math.round(n || 0));
};

function SummaryCard({ label, value, tone, icon }: { label: string; value: string; tone?: "opex" | "rev" | "profit"; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">{icon} {label}</div>
      <div className={cn("mt-1.5 font-display text-xl font-black tracking-tight md:text-2xl", tone === "rev" && "text-emerald-600", tone === "opex" && "text-rose-600", tone === "profit" && "text-primary")}>{value}</div>
    </div>
  );
}

/** One editable monthly cell — uncontrolled (defaultValue) so typing never loses focus on refetch. */
function Cell({ projectId, lineItemId, year, month, amount, canEdit }: { projectId: string; lineItemId: string; year: number; month: number; amount: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (v: number) => nexusApi.setFinanceValue({ projectId, lineItemId, year, month, amount: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-dashboard", projectId, year] }),
  });
  if (!canEdit) return <span className="tabular-nums text-muted-foreground">{amount ? rpShort(amount) : "–"}</span>;
  return (
    <input
      key={`${lineItemId}-${month}-${year}`}
      defaultValue={amount || ""}
      inputMode="numeric"
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        const v = Number(String(e.target.value).replace(/[^\d.-]/g, "")) || 0;
        if (v !== amount) save.mutate(v);
      }}
      className="w-20 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-xs tabular-nums outline-none hover:border-border focus:border-primary focus:bg-background"
      placeholder="–"
    />
  );
}

export function FinanceDashboardView({ projectId, canEdit = true }: { projectId: string; canEdit?: boolean }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const q = useQuery({ queryKey: ["finance-dashboard", projectId, year], queryFn: () => nexusApi.financeDashboard(projectId, year), retry: 1 });
  const d = q.data as NexusFinanceDashboard | undefined;

  const chartData = MONTHS.map((m, i) => ({
    month: m,
    OPEX: d?.totals.opexByMonth[i] ?? 0,
    Revenue: d?.totals.revenueByMonth[i] ?? 0,
    Profit: d?.totals.profitByMonth[i] ?? 0,
  }));

  const opexTotal = d?.totals.opexTotal ?? 0;
  const revenueTotal = d?.totals.revenueTotal ?? 0;
  const profitTotal = d?.totals.profitTotal ?? 0;
  const margin = revenueTotal > 0 ? (profitTotal / revenueTotal) * 100 : 0;

  const opexCats = (d?.categories ?? []).filter((c) => c.kind === "OPEX");

  return (
    <div className="space-y-5 p-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">Finance Dashboard</h2>
          <p className="text-xs text-muted-foreground">OPEX & Revenue bulanan — input tiap bulan, total & profit otomatis.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setYear((y) => y - 1)} className="rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold hover:bg-accent">‹</button>
          <span className="min-w-16 text-center font-display text-lg font-bold tabular-nums">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} disabled={year >= nowYear + 1} className="rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold hover:bg-accent disabled:opacity-40">›</button>
        </div>
      </div>

      {q.isLoading && <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      {q.isError && <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">Gagal memuat. Butuh akses member project ini.</div>}

      {d && !q.isLoading && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="Total Revenue" value={rp(revenueTotal)} tone="rev" icon={<TrendingUp className="h-3.5 w-3.5" />} />
            <SummaryCard label="Total OPEX" value={rp(opexTotal)} tone="opex" icon={<TrendingDown className="h-3.5 w-3.5" />} />
            <SummaryCard label="Profit" value={rp(profitTotal)} tone="profit" icon={<Wallet className="h-3.5 w-3.5" />} />
            <SummaryCard label="Margin" value={`${margin.toFixed(1)}%`} tone="profit" icon={<Wallet className="h-3.5 w-3.5" />} />
          </div>

          {/* Monthly chart */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="mb-2 text-sm font-bold">Tren bulanan {year}</div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={rpShort} width={48} />
                <Tooltip formatter={(v: number) => rp(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="OPEX" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                <Line dataKey="Profit" stroke="#6366f1" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* OPEX breakdown by category */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="mb-2 text-sm font-bold">Breakdown OPEX per kategori</div>
            <ResponsiveContainer width="100%" height={Math.max(120, opexCats.length * 34)}>
              <BarChart data={opexCats.map((c) => ({ name: c.name, total: c.subtotal }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tickFormatter={rpShort} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => `${rp(v)}${opexTotal ? ` · ${((v / opexTotal) * 100).toFixed(1)}%` : ""}`} />
                <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                  {opexCats.map((_, i) => <RCell key={i} fill={["#f43f5e", "#fb923c", "#f59e0b", "#84cc16", "#06b6d4", "#8b5cf6", "#ec4899"][i % 7]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Editable matrix */}
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0">
                <tr className="border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 z-10 min-w-52 bg-muted/40 px-3 py-2 text-left">Pos</th>
                  {MONTHS.map((m) => <th key={m} className="px-1.5 py-2 text-right font-semibold">{m}</th>)}
                  <th className="px-3 py-2 text-right">TOTAL</th>
                  <th className="px-2 py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {(d.categories ?? []).map((c) => (
                  <CategoryRows key={c.id} cat={c} projectId={projectId} year={year} canEdit={canEdit} opexTotal={opexTotal} />
                ))}
                <tr className="border-t-2 border-foreground/20 bg-primary/5 font-black">
                  <td className="sticky left-0 z-10 bg-primary/5 px-3 py-2">▶ TOTAL OPEX</td>
                  {(d.totals.opexByMonth).map((v, i) => <td key={i} className="px-1.5 py-2 text-right tabular-nums">{v ? rpShort(v) : "–"}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600">{rp(opexTotal)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">100%</td>
                </tr>
                <tr className="bg-emerald-50 font-black">
                  <td className="sticky left-0 z-10 bg-emerald-50 px-3 py-2">▶ TOTAL REVENUE</td>
                  {(d.totals.revenueByMonth).map((v, i) => <td key={i} className="px-1.5 py-2 text-right tabular-nums">{v ? rpShort(v) : "–"}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{rp(revenueTotal)}</td>
                  <td className="px-2 py-2"></td>
                </tr>
                <tr className="bg-primary/5 font-black">
                  <td className="sticky left-0 z-10 bg-primary/5 px-3 py-2">▶ PROFIT</td>
                  {(d.totals.profitByMonth).map((v, i) => <td key={i} className={cn("px-1.5 py-2 text-right tabular-nums", v < 0 && "text-rose-600")}>{v ? rpShort(v) : "–"}</td>)}
                  <td className={cn("px-3 py-2 text-right tabular-nums", profitTotal < 0 ? "text-rose-600" : "text-primary")}>{rp(profitTotal)}</td>
                  <td className="px-2 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">Klik cell buat input angka bulanan. Subtotal, total, % & profit dihitung otomatis.</p>
        </>
      )}
    </div>
  );
}

function CategoryRows({ cat, projectId, year, canEdit, opexTotal }: { cat: NexusFinanceDashboard["categories"][number]; projectId: string; year: number; canEdit: boolean; opexTotal: number }) {
  return (
    <>
      <tr className="border-t border-border bg-muted/20">
        <td className="sticky left-0 z-10 bg-muted/20 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-foreground" colSpan={15}>{cat.name}</td>
      </tr>
      {cat.lineItems.map((li) => {
        const pct = cat.kind === "OPEX" && opexTotal > 0 ? (li.total / opexTotal) * 100 : null;
        return (
          <tr key={li.id} className="border-t border-border/60 hover:bg-accent/30">
            <td className="sticky left-0 z-10 bg-card px-3 py-1 text-foreground">{li.name}</td>
            {li.monthly.map((amt, m) => (
              <td key={m} className="px-0.5 py-0.5 text-right">
                <Cell projectId={projectId} lineItemId={li.id} year={year} month={m + 1} amount={amt} canEdit={canEdit} />
              </td>
            ))}
            <td className="px-3 py-1 text-right font-semibold tabular-nums">{li.total ? rpShort(li.total) : "–"}</td>
            <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{pct != null ? `${pct.toFixed(1)}%` : ""}</td>
          </tr>
        );
      })}
      <tr className="border-t border-border bg-muted/10 font-bold">
        <td className="sticky left-0 z-10 bg-muted/10 px-3 py-1.5 text-[11px]">Subtotal {cat.name}</td>
        {cat.subtotalByMonth.map((v, i) => <td key={i} className="px-1.5 py-1.5 text-right tabular-nums">{v ? rpShort(v) : "–"}</td>)}
        <td className="px-3 py-1.5 text-right tabular-nums">{rpShort(cat.subtotal)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{cat.kind === "OPEX" && opexTotal > 0 ? `${((cat.subtotal / opexTotal) * 100).toFixed(1)}%` : ""}</td>
      </tr>
    </>
  );
}

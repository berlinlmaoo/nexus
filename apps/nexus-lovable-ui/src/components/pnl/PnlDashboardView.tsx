import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Hourglass,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  Tags,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  nexusApi,
  type PnlCategory,
  type PnlDashboard,
  type PnlExpense,
  type PnlIncome,
  type PnlRecurring,
  type PnlStage,
} from "@/lib/nexus-api";
import { Reveal } from "@/components/motion";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const rp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const rpShort = (n: number) => {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (a >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)} B`;
  if (a >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} M`;
  if (a >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)} K`;
  return sign + String(Math.round(abs));
};
/** "1.500.000" / "1500000" / "Rp 1,5jt-style junk" → number (digits only). */
const parseAmount = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;
/** LOCAL calendar day — never toISOString here: in WIB (UTC+7) between 00:00–06:59 the UTC day
 *  is still yesterday, which silently dated new entries (and even months) wrong. */
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Stored dates are UTC-midnight ISO strings — the first 10 chars ARE the intended day. */
const isoDay = (s: string) => String(s).slice(0, 10);

const PALETTE = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16", "#94a3b8"];

// ───────────────────────── shared bits ─────────────────────────

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const reduce = useReducedMotion();
  // Lock background scroll while the sheet is open (mobile bottom-sheet behavior).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className={cn("relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl sm:pb-5", wide ? "sm:max-w-2xl" : "sm:max-w-md")}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base font-extrabold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

/** Rupiah text input with live thousand-dot formatting. Pass `value` to make it follow
 *  programmatic changes too (e.g. the PELUNASAN/30%/50% quick chips). */
function RpInput({ value, defaultValue, onValue, placeholder, autoFocus }: { value?: number; defaultValue?: number; onValue: (n: number) => void; placeholder?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(() => {
    const init = value ?? defaultValue;
    return init ? new Intl.NumberFormat("id-ID").format(init) : "";
  });
  useEffect(() => {
    if (value === undefined) return;
    if (parseAmount(text) !== value) setText(value ? new Intl.NumberFormat("id-ID").format(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      value={text}
      inputMode="numeric"
      autoFocus={autoFocus}
      placeholder={placeholder ?? "0"}
      onChange={(e) => {
        const n = parseAmount(e.target.value);
        setText(n ? new Intl.NumberFormat("id-ID").format(n) : "");
        onValue(n);
      }}
      className={cn(inputCls, "text-right font-semibold tabular-nums")}
    />
  );
}

function ColorDots({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PALETTE.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} className={cn("h-6 w-6 rounded-full ring-2 transition", value === c ? "ring-foreground" : "ring-transparent")} style={{ background: c }} />
      ))}
    </div>
  );
}

// ───────────────────────── summary cards ─────────────────────────

function SummaryCard({ label, value, sub, icon, gradient, negative }: { label: string; value: number; sub?: string; icon: React.ReactNode; gradient: string; negative?: boolean }) {
  // Big number = compact "12,5 jt" (fits 380px, readable at a glance); exact rupiah on the sub line.
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border p-4 shadow-soft", gradient)}>
      <div className="flex items-center gap-2 text-xs font-semibold text-white/85">{icon} {label}</div>
      <div className={cn("mt-1.5 truncate font-display text-xl font-black tracking-tight text-white md:text-2xl", negative && "text-red-100")}>
        {negative ? "-" : ""}{value === 0 ? "Rp 0" : `Rp ${rpShort(Math.abs(value))}`}
      </div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-white/75">{negative ? "-" : ""}{rp(Math.abs(value))}{sub ? ` · ${sub}` : ""}</div>
    </div>
  );
}

// ───────────────────────── main view ─────────────────────────

export function PnlDashboardView({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | null>(now.getMonth() + 1);
  const [expenseModal, setExpenseModal] = useState<{ open: boolean; edit?: PnlExpense } | null>(null);
  // Store IDs, not snapshots — the open modal must show FRESH data after a mutation (e.g. a
  // deleted payment disappearing immediately), so we resolve from the latest dashboard payload.
  const [incomeModal, setIncomeModal] = useState<{ open: boolean; editId?: string } | null>(null);
  const [paymentForId, setPaymentForId] = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [showStages, setShowStages] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);

  const q = useQuery({
    queryKey: ["pnl", projectId, year, month],
    queryFn: () => nexusApi.pnlDashboard(projectId, year, month),
    retry: 1,
    // Keep showing the previous month/year while the next loads — no full-page spinner blink.
    placeholderData: keepPreviousData,
  });
  const d = q.data as PnlDashboard | undefined;
  const editIncome = incomeModal?.editId ? d?.incomes.find((i) => i.id === incomeModal.editId) : undefined;
  const paymentIncome = paymentForId ? d?.incomes.find((i) => i.id === paymentForId) ?? null : null;
  const invalidate = () => qc.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "pnl" && query.queryKey[1] === projectId });

  const chartData = useMemo(
    () =>
      MONTHS.map((m, i) => ({
        name: m,
        In: d?.months.income[i] ?? 0,
        Out: d?.months.expense[i] ?? 0,
        Profit: (d?.months.income[i] ?? 0) - (d?.months.expense[i] ?? 0),
        Budget: d?.months.budget[i] ?? null,
      })),
    [d]
  );

  if (q.isLoading) {
    return (
      <div className="grid place-items-center p-16 text-muted-foreground">
        <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading P&L…</div>
      </div>
    );
  }
  if (q.isError || !d) {
    const status = (q.error as { status?: number } | null)?.status;
    const forbidden = status === 403;
    return (
      <div className="p-8">
        <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
          <div className="font-display text-base font-extrabold">{forbidden ? "P&L is BoD-and-up only" : "Couldn't load P&L"}</div>
          <p className="mt-1 text-sm text-muted-foreground">{forbidden ? "Access to this finance view is limited to BoD and One Above All." : "Network or server's acting up — give it another shot."}</p>
          {!forbidden && (
            <button onClick={() => q.refetch()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90">
              {q.isFetching && <Loader2 className="h-4 w-4 animate-spin" />} Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const selBudget = month ? d.months.budget[month - 1] : null;
  const selExpense = month ? d.months.expense[month - 1] : 0;
  const budgetPct = selBudget ? Math.min(150, Math.round((selExpense / selBudget) * 100)) : null;

  return (
    <div className={cn("space-y-5 p-4 md:p-8", q.isFetching && "opacity-70 transition-opacity")}>
      {/* header: year switch + primary action + tools */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-soft">
          <button onClick={() => setYear((y) => Math.max(2000, y - 1))} className="rounded-lg p-1.5 transition hover:bg-accent"><ChevronLeft className="h-4 w-4" /></button>
          <span className="px-2 font-display text-sm font-extrabold tabular-nums">{year}</span>
          <button onClick={() => setYear((y) => Math.min(2100, y + 1))} className="rounded-lg p-1.5 transition hover:bg-accent"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {/* #1 mobile flow — always reachable without scrolling */}
        <button onClick={() => setExpenseModal({ open: true })} className="inline-flex items-center gap-1 rounded-xl bg-rose-500 px-3 py-1.5 text-xs font-bold text-white shadow-soft transition hover:bg-rose-600 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" />Expense</button>
        <button onClick={() => setIncomeModal({ open: true })} className="inline-flex items-center gap-1 rounded-xl bg-[#0091ff] px-3 py-1.5 text-xs font-bold text-white shadow-soft transition hover:bg-[#0080e0] active:scale-[0.98]"><Plus className="h-3.5 w-3.5" />Deal</button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={() => setShowCategories(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-soft transition hover:bg-accent"><Tags className="h-3.5 w-3.5" />Categories</button>
          <button onClick={() => setShowRecurring(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-soft transition hover:bg-accent"><Repeat className="h-3.5 w-3.5" />Recurring</button>
          <a href={nexusApi.pnlExportUrl(projectId, year)} download className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-soft transition hover:bg-accent"><Download className="h-3.5 w-3.5" />CSV</a>
        </div>
      </div>

      {/* summary cards */}
      <Reveal>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Money In" value={d.totals.income} sub={`${year} · actually cashed in`} icon={<TrendingUp className="h-3.5 w-3.5" />} gradient="bg-gradient-to-br from-emerald-500 to-emerald-700" />
          <SummaryCard label="Expenses" value={d.totals.expense} sub={`${year}`} icon={<TrendingDown className="h-3.5 w-3.5" />} gradient="bg-gradient-to-br from-rose-500 to-rose-700" />
          <SummaryCard label="Profit" value={d.totals.profit} negative={d.totals.profit < 0} sub={d.totals.profit < 0 ? "in the red 😬" : "in − out"} icon={<Wallet className="h-3.5 w-3.5" />} gradient="bg-gradient-to-br from-[#7b68ee] to-[#5b48ce]" />
          <SummaryCard label="Pipeline" value={d.totals.pipelineOutstanding} sub={`${d.incomes.filter((i) => i.outstanding > 0).length} deals not yet cashed`} icon={<Hourglass className="h-3.5 w-3.5" />} gradient="bg-gradient-to-br from-[#0091ff] to-[#0066cc]" />
        </div>
      </Reveal>

      {/* monthly trend */}
      <div className="rounded-3xl border border-border bg-card p-4 shadow-soft">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-sm font-extrabold">Monthly trend {year}</div>
          <div className="text-[11px] text-muted-foreground">tap a month chip below for the daily breakdown</div>
        </div>
        <div className="h-56 md:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v: number) => rpShort(v)} tick={{ fontSize: 10 }} width={48} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number | string, n: string) => [rp(Number(v)), n]} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }} />
              <Bar dataKey="In" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={26} onClick={(_: unknown, idx: number) => setMonth(idx + 1)} className="cursor-pointer">
                {chartData.map((_, i) => <Cell key={i} fillOpacity={month === i + 1 ? 1 : 0.55} />)}
              </Bar>
              <Bar dataKey="Out" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={26} onClick={(_: unknown, idx: number) => setMonth(idx + 1)} className="cursor-pointer">
                {chartData.map((_, i) => <Cell key={i} fillOpacity={month === i + 1 ? 1 : 0.55} />)}
              </Bar>
              <Line type="monotone" dataKey="Profit" stroke="#7b68ee" strokeWidth={2.5} dot={{ r: 2.5 }} />
              {/* dot ensures a single-month budget is still visible (a 1-point Line draws no segment) */}
              <Line type="monotone" dataKey="Budget" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#f59e0b", strokeWidth: 0 }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* month chips */}
        <div className="mt-2 flex items-center gap-1 overflow-x-auto pb-1">
          {MONTHS.map((m, i) => (
            <button key={m} onClick={() => setMonth(month === i + 1 ? null : i + 1)}
              className={cn("shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition", month === i + 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* budget strip for selected month — keyed so edit state never leaks across month switches */}
      {month && (
        <BudgetStrip
          key={`${year}-${month}`}
          projectId={projectId}
          year={year}
          month={month}
          budget={selBudget}
          actual={selExpense}
          pct={budgetPct}
          onSaved={invalidate}
        />
      )}

      {/* category breakdown + pipeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryBreakdown d={d} month={month} onManage={() => setShowCategories(true)} />
        <PipelineBoard d={d} onAddIncome={() => setIncomeModal({ open: true })} onEditIncome={(inc) => setIncomeModal({ open: true, editId: inc.id })} onAddPayment={(inc) => setPaymentForId(inc.id)} onManageStages={() => setShowStages(true)} />
      </div>

      {/* month drill-down */}
      {month && d.monthDetail && (
        <MonthDetail
          d={d}
          year={year}
          month={month}
          onAddExpense={() => setExpenseModal({ open: true })}
          onEditExpense={(e) => setExpenseModal({ open: true, edit: e })}
          onChanged={invalidate}
        />
      )}

      {/* modals */}
      {expenseModal?.open && (
        <ExpenseComposer projectId={projectId} year={year} month={month} categories={d.categories} edit={expenseModal.edit} onClose={() => setExpenseModal(null)} onSaved={invalidate} />
      )}
      {incomeModal?.open && (!incomeModal.editId || editIncome) && (
        <IncomeComposer projectId={projectId} stages={d.stages} edit={editIncome} onClose={() => setIncomeModal(null)} onSaved={invalidate} />
      )}
      {paymentIncome && <PaymentComposer income={paymentIncome} onClose={() => setPaymentForId(null)} onSaved={invalidate} />}
      {showCategories && <CategoryManager projectId={projectId} categories={d.categories} onClose={() => setShowCategories(false)} onChanged={invalidate} />}
      {showStages && <StageManager projectId={projectId} stages={d.stages} onClose={() => setShowStages(false)} onChanged={invalidate} />}
      {showRecurring && <RecurringManager projectId={projectId} recurring={d.recurring} categories={d.categories} onClose={() => setShowRecurring(false)} onChanged={invalidate} />}
    </div>
  );
}

// ───────────────────────── budget strip ─────────────────────────

function BudgetStrip({ projectId, year, month, budget, actual, pct, onSaved }: { projectId: string; year: number; month: number; budget: number | null; actual: number; pct: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(budget ?? 0);
  const save = useMutation({
    mutationFn: () => nexusApi.pnlSetBudget({ projectId, year, month, amount: val }),
    onSuccess: () => { setEditing(false); onSaved(); },
  });
  const over = budget !== null && actual > budget;
  const warn = budget !== null && !over && actual > budget * 0.85;
  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Banknote className="h-4 w-4 text-amber-500" /> {MONTHS_FULL[month - 1]} budget
          {budget !== null && (
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide", over ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400" : warn ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400")}>
              {over ? "OVER BUDGET" : warn ? "CUTTING IT CLOSE" : "ON TRACK"}
            </span>
          )}
        </div>
        {!editing ? (
          <button onClick={() => { setVal(budget ?? 0); setEditing(true); }} className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition hover:underline">
            <Pencil className="h-3 w-3" /> {budget === null ? "Set budget" : "Edit"}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="w-36"><RpInput defaultValue={budget ?? 0} onValue={setVal} autoFocus /></div>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50">{save.isPending ? "…" : "OK"}</button>
            <button onClick={() => setEditing(false)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent">Cancel</button>
          </div>
        )}
      </div>
      {budget !== null ? (
        <>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={false}
              animate={{ width: `${Math.min(100, pct ?? 0)}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
              className={cn("h-full rounded-full", over ? "bg-red-500" : warn ? "bg-amber-500" : "bg-emerald-500")}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
            <span>Spent {rp(actual)}{over && <span className="ml-1 text-red-600">(+{rp(actual - budget)} over)</span>}</span>
            <span>Target {rp(budget)}</span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No budget target for this month yet — set one so you can see if you're on track or over.</p>
      )}
    </div>
  );
}

// ───────────────────────── category breakdown ─────────────────────────

function CategoryBreakdown({ d, month, onManage }: { d: PnlDashboard; month: number | null; onManage: () => void }) {
  const rows = d.categories
    .map((c) => ({ ...c, value: month ? c.byMonth[month - 1] : c.total }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const max = rows[0]?.value ?? 0;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-display text-sm font-extrabold">Expenses by category <span className="font-semibold text-muted-foreground">· {month ? MONTHS_FULL[month - 1] : `all of ${d.year}`}</span></div>
        <button onClick={onManage} className="text-xs font-semibold text-primary transition hover:underline">Manage</button>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No expenses {month ? `in ${MONTHS_FULL[month - 1]}` : "this year"} yet.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((c) => (
            <div key={c.id || c.name}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.name}</span>
                <span className="font-bold tabular-nums">{rp(c.value)} <span className="font-medium text-muted-foreground">({total ? Math.round((c.value / total) * 100) : 0}%)</span></span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <motion.div initial={false} animate={{ width: `${max ? (c.value / max) * 100 : 0}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} className="h-full rounded-full" style={{ background: c.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── pipeline board ─────────────────────────

function PipelineBoard({ d, onAddIncome, onEditIncome, onAddPayment, onManageStages }: { d: PnlDashboard; onAddIncome: () => void; onEditIncome: (i: PnlIncome) => void; onAddPayment: (i: PnlIncome) => void; onManageStages: () => void }) {
  const stageOf = (id: string | null | undefined): PnlStage | undefined => d.stages.find((s) => s.id === id);
  const groups: { stage: PnlStage | null; incomes: PnlIncome[] }[] = [
    ...d.stages.map((s) => ({ stage: s as PnlStage | null, incomes: d.incomes.filter((i) => i.stageId === s.id) })),
    ...(d.incomes.some((i) => !i.stageId || !stageOf(i.stageId)) ? [{ stage: null, incomes: d.incomes.filter((i) => !i.stageId || !stageOf(i.stageId)) }] : []),
  ];
  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-sm font-extrabold">Income pipeline</div>
        <div className="flex items-center gap-2">
          <button onClick={onManageStages} className="text-xs font-semibold text-primary transition hover:underline">Manage stages</button>
          <button onClick={onAddIncome} className="inline-flex items-center gap-1 rounded-xl bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" />Deal</button>
        </div>
      </div>
      {d.incomes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No deals yet — add your first deal/invoice. Actual money in gets logged per payment (deposit, installment, final).</p>
      ) : (
        <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
          {groups.filter((g) => g.incomes.length > 0 || g.stage).map((g) => (
            <div key={g.stage?.id ?? "none"}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: g.stage?.color ?? "#94a3b8" }}>
                <span className="h-2 w-2 rounded-full" style={{ background: g.stage?.color ?? "#94a3b8" }} />
                {g.stage?.name ?? "No stage"} <span className="font-bold text-muted-foreground">({g.incomes.length})</span>
              </div>
              {g.incomes.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">Empty</p>}
              <div className="space-y-1.5">
                {g.incomes.map((inc) => {
                  const paidPct = inc.totalAmount ? Math.min(100, Math.round((inc.paid / inc.totalAmount) * 100)) : 0;
                  return (
                    <div key={inc.id} className="rounded-2xl border border-border bg-background p-3 transition hover:border-primary/40">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => onEditIncome(inc)} className="min-w-0 text-left">
                          <div className="truncate text-sm font-bold hover:text-primary">{inc.title}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {rp(inc.totalAmount)}{inc.expectedDate && <> · due ~{new Date(inc.expectedDate).toLocaleDateString("en-US", { day: "numeric", month: "short" })}</>}
                          </div>
                        </button>
                        <button onClick={() => onAddPayment(inc)} className="shrink-0 rounded-lg bg-emerald-100 px-2 py-1 text-[10px] font-extrabold text-emerald-700 transition hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-emerald-500/25">+ PAYMENT</button>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                        <span className="text-emerald-600 dark:text-emerald-400">In {rpShort(inc.paid)} ({paidPct}%)</span>
                        {inc.outstanding > 0 ? <span>Left {rpShort(inc.outstanding)}</span> : <span className="text-emerald-600 dark:text-emerald-400">PAID ✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── month drill-down ─────────────────────────

function MonthDetail({ d, year, month, onAddExpense, onEditExpense, onChanged }: { d: PnlDashboard; year: number; month: number; onAddExpense: () => void; onEditExpense: (e: PnlExpense) => void; onChanged: () => void }) {
  const md = d.monthDetail!;
  const catOf = (id: string | null | undefined) => d.categories.find((c) => c.id === id);
  const dailyData = md.days.map((day) => ({ name: String(day.day), In: day.income, Out: day.expense }));
  const hasAny = md.expenses.length > 0 || md.payments.length > 0;

  // group transactions per day (descending)
  const byDay = new Map<number, { expenses: PnlExpense[]; payments: typeof md.payments }>();
  for (const e of md.expenses) {
    const day = new Date(e.date).getUTCDate();
    if (!byDay.has(day)) byDay.set(day, { expenses: [], payments: [] });
    byDay.get(day)!.expenses.push(e);
  }
  for (const p of md.payments) {
    const day = new Date(p.date).getUTCDate();
    if (!byDay.has(day)) byDay.set(day, { expenses: [], payments: [] });
    byDay.get(day)!.payments.push(p);
  }
  const days = [...byDay.keys()].sort((a, b) => b - a);

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-sm font-extrabold">{MONTHS_FULL[month - 1]} {year} detail</div>
        <button onClick={onAddExpense} className="inline-flex items-center gap-1 rounded-xl bg-rose-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-600 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" />Log expense</button>
      </div>

      {/* daily bars */}
      <div className="h-36 md:h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dailyData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap={2}>
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v: number) => rpShort(v)} tick={{ fontSize: 9 }} width={42} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: number | string, n: string) => [rp(Number(v)), n]} labelFormatter={(l) => `Day ${l}`} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }} />
            <Bar dataKey="In" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Out" fill="#f43f5e" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* transaction list */}
      {!hasAny ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No transactions this month yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {days.map((day) => {
            const g = byDay.get(day)!;
            const dayExpense = g.expenses.reduce((s, e) => s + e.amount, 0);
            const dayIncome = g.payments.reduce((s, p) => s + p.amount, 0);
            return (
              <div key={day}>
                <div className="mb-1 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  <span className="flex items-center gap-1.5"><CalendarDays className="h-3 w-3" />{day} {MONTHS_FULL[month - 1]}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {dayIncome > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{rpShort(dayIncome)}</span>}
                    {dayExpense > 0 && <span className="text-rose-600 dark:text-rose-400">-{rpShort(dayExpense)}</span>}
                  </span>
                </div>
                <div className="space-y-1">
                  {g.payments.map((p) => (
                    <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-emerald-200/60 bg-emerald-50/60 px-3 py-2 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                      <ArrowUpCircle className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{p.incomeTitle}</div>
                        {p.note && <div className="truncate text-[11px] text-muted-foreground">{p.note}</div>}
                      </div>
                      <div className="text-sm font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">+{rp(p.amount)}</div>
                    </div>
                  ))}
                  {g.expenses.map((e) => (
                    <ExpenseRow key={e.id} expense={e} category={catOf(e.categoryId)} onEdit={() => onEditExpense(e)} onChanged={onChanged} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExpenseRow({ expense, category, onEdit, onChanged }: { expense: PnlExpense; category?: { name: string; color: string }; onEdit: () => void; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => nexusApi.pnlUploadExpenseAttachment(expense.id, file),
    onSuccess: onChanged,
  });
  const delAttachment = useMutation({ mutationFn: (id: string) => nexusApi.pnlDeleteAttachment(id), onSuccess: onChanged });
  const del = useMutation({ mutationFn: () => nexusApi.pnlDeleteExpense(expense.id), onSuccess: onChanged });
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2.5">
        <ArrowDownCircle className="h-4 w-4 shrink-0 text-rose-500" />
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold hover:text-primary">{expense.description || "Expense"}</span>
            {expense.recurringId && <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />}
          </div>
          {category && <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: category.color }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: category.color }} />{category.name}</span>}
        </button>
        <div className="text-sm font-extrabold tabular-nums text-rose-600 dark:text-rose-400">-{rp(expense.amount)}</div>
        <button onClick={() => fileRef.current?.click()} disabled={upload.isPending} title="Attach receipt/photo" className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50">
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => { if (confirm("Delete this expense?")) del.mutate(); }} disabled={del.isPending} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
      </div>
      {expense.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
          {expense.attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 text-[10px] font-semibold">
              <a href={`${a.url}?download=${encodeURIComponent(a.filename)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary"><Paperclip className="h-2.5 w-2.5" />{a.filename.length > 22 ? a.filename.slice(0, 20) + "…" : a.filename}</a>
              <button onClick={() => delAttachment.mutate(a.id)} className="text-muted-foreground hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
            </span>
          ))}
        </div>
      )}
      {(upload.isError || del.isError) && <p className="mt-1 pl-6 text-[11px] font-semibold text-destructive">{((upload.error || del.error) as Error)?.message ?? "Something went wrong."}</p>}
    </div>
  );
}

// ───────────────────────── composers ─────────────────────────

function ExpenseComposer({ projectId, year, month, categories, edit, onClose, onSaved }: { projectId: string; year: number; month: number | null; categories: PnlCategory[]; edit?: PnlExpense; onClose: () => void; onSaved: () => void }) {
  const today = new Date();
  const defaultDate = edit
    ? isoDay(edit.date)
    : month && (month !== today.getMonth() + 1 || year !== today.getFullYear())
      ? `${year}-${String(month).padStart(2, "0")}-01`
      : ymdLocal(today);
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState(edit?.amount ?? 0);
  const [categoryId, setCategoryId] = useState(edit?.categoryId ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Once the expense row exists, a retry (e.g. after a failed nota upload) must UPDATE it —
  // re-running create would silently double-book the money.
  const savedIdRef = useRef<string | null>(edit?.id ?? null);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { date, amount, categoryId: categoryId || null, description: description || null };
      let id = savedIdRef.current;
      if (id) {
        await nexusApi.pnlUpdateExpense(id, payload);
      } else {
        const created = await nexusApi.pnlCreateExpense({ projectId, ...payload });
        id = created.id;
        savedIdRef.current = id;
      }
      if (pendingFile) {
        try {
          await nexusApi.pnlUploadExpenseAttachment(id, pendingFile);
        } catch {
          throw new Error("Expense SAVED, but the receipt upload failed — hit the button again to retry the upload.");
        }
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    // The row may already exist even when the mutation "failed" (upload step) — refresh the list.
    onError: () => { if (savedIdRef.current && !edit) onSaved(); },
  });

  const realCats = categories.filter((c) => c.id);
  return (
    <Modal title={edit ? "Edit expense" : "Log expense"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Amount (Rp)"><RpInput defaultValue={edit?.amount} onValue={setAmount} autoFocus={!edit} /></Field>
        </div>
        <Field label="Category">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
            <option value="">No category</option>
            {realCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Studio rental, shoot catering…" className={inputCls} /></Field>
        <Field label="Receipt / photo (optional)">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold transition hover:bg-accent"><Camera className="h-3.5 w-3.5" />{pendingFile ? "Change file" : "Choose file"}</button>
            {pendingFile && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{pendingFile.name}</span>}
            {pendingFile && <button type="button" onClick={() => setPendingFile(null)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)} />
          </div>
        </Field>
        {save.isError && <p className="text-xs font-semibold text-destructive">{(save.error as Error)?.message ?? "Couldn't save."}</p>}
        <button onClick={() => save.mutate()} disabled={save.isPending || !date || amount <= 0} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-600 active:scale-[0.99] disabled:opacity-50">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {edit ? "Save changes" : "Log expense"}
        </button>
      </div>
    </Modal>
  );
}

function IncomeComposer({ projectId, stages, edit, onClose, onSaved }: { projectId: string; stages: PnlStage[]; edit?: PnlIncome; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(edit?.title ?? "");
  const [totalAmount, setTotalAmount] = useState(edit?.totalAmount ?? 0);
  // Editing must preserve "Tanpa stage" — only NEW deals default to the first stage.
  const [stageId, setStageId] = useState(edit ? (edit.stageId ?? "") : (stages[0]?.id ?? ""));
  const [expectedDate, setExpectedDate] = useState(edit?.expectedDate ? isoDay(edit.expectedDate) : "");
  const [notes, setNotes] = useState(edit?.notes ?? "");

  const save = useMutation({
    mutationFn: () => {
      const payload = { title, totalAmount, stageId: stageId || null, expectedDate: expectedDate || null, notes: notes || null };
      return edit ? nexusApi.pnlUpdateIncome(edit.id, payload) : nexusApi.pnlCreateIncome({ projectId, ...payload });
    },
    onSuccess: () => { onSaved(); onClose(); },
  });
  const del = useMutation({
    mutationFn: () => nexusApi.pnlDeleteIncome(edit!.id),
    onSuccess: () => { onSaved(); onClose(); },
  });
  const delPayment = useMutation({ mutationFn: (id: string) => nexusApi.pnlDeletePayment(id), onSuccess: onSaved });

  return (
    <Modal title={edit ? "Edit deal" : "Add deal / invoice"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Deal / client name"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wedding A&B — platinum package" className={inputCls} autoFocus={!edit} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total value (Rp)"><RpInput defaultValue={edit?.totalAmount} onValue={setTotalAmount} /></Field>
          <Field label="Expected payout"><input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Stage">
          <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputCls}>
            <option value="">No stage</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" className={inputCls} /></Field>

        {edit && edit.payments.length > 0 && (
          <div className="rounded-2xl border border-border bg-muted/30 p-2.5">
            <div className="px-0.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payments received · {rp(edit.paid)}</div>
            <div className="space-y-1">
              {edit.payments.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg bg-background px-2.5 py-1.5 text-xs">
                  <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+{rp(p.amount)}</span>
                  <span className="flex-1 truncate text-muted-foreground">{new Date(p.date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}{p.note ? ` · ${p.note}` : ""}</span>
                  <button onClick={() => { if (confirm("Delete this payment?")) delPayment.mutate(p.id); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {(save.isError || del.isError) && <p className="text-xs font-semibold text-destructive">{((save.error || del.error) as Error)?.message ?? "Something went wrong."}</p>}
        <div className="flex items-center gap-2">
          {edit && <button onClick={() => { if (confirm("Delete this deal and all its payment records?")) del.mutate(); }} disabled={del.isPending} className="rounded-xl px-3 py-2.5 text-sm font-bold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>}
          <button onClick={() => save.mutate()} disabled={save.isPending || !title.trim() || totalAmount <= 0} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0091ff] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#0080e0] active:scale-[0.99] disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {edit ? "Save changes" : "Add deal"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentComposer({ income, onClose, onSaved }: { income: PnlIncome; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(ymdLocal(new Date()));
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => nexusApi.pnlCreatePayment(income.id, { date, amount, note: note || null }),
    onSuccess: () => { onSaved(); onClose(); },
  });
  return (
    <Modal title={`Log money in — ${income.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
          Total {rp(income.totalAmount)} · received {rp(income.paid)} · remaining <span className="text-foreground">{rp(income.outstanding)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date received"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Amount (Rp)"><RpInput value={amount} onValue={setAmount} autoFocus /></Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {income.outstanding > 0 && (
            <button type="button" onClick={() => setAmount(income.outstanding)} className="rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 transition hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400">PAY IN FULL ({rpShort(income.outstanding)})</button>
          )}
          {[0.3, 0.5].map((f) => (
            <button key={f} type="button" onClick={() => setAmount(Math.round(income.totalAmount * f))} className="rounded-lg bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground transition hover:bg-accent hover:text-foreground">{f * 100}% ({rpShort(income.totalAmount * f)})</button>
          ))}
        </div>
        <Field label="Notes"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 50% deposit, installment 2…" className={inputCls} /></Field>
        {save.isError && <p className="text-xs font-semibold text-destructive">{(save.error as Error)?.message ?? "Something went wrong."}</p>}
        <button onClick={() => save.mutate()} disabled={save.isPending || !date || amount <= 0} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Log payment
        </button>
      </div>
    </Modal>
  );
}

// ───────────────────────── managers ─────────────────────────

function CategoryManager({ projectId, categories, onClose, onChanged }: { projectId: string; categories: PnlCategory[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const create = useMutation({ mutationFn: () => nexusApi.pnlCreateCategory({ projectId, name, color }), onSuccess: () => { setName(""); onChanged(); } });
  const update = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: { name?: string; color?: string } }) => nexusApi.pnlUpdateCategory(id, payload), onSuccess: onChanged });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.pnlDeleteCategory(id), onSuccess: onChanged });
  const realCats = categories.filter((c) => c.id);
  return (
    <Modal title="Expense categories" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          {realCats.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
              <ColorSwatchButton color={c.color} onPick={(col) => update.mutate({ id: c.id, payload: { color: col } })} />
              <input defaultValue={c.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) update.mutate({ id: c.id, payload: { name: v } }); }} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
              <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{rpShort(c.total)}</span>
              <button onClick={() => { if (confirm(`Delete the "${c.name}" category? Its transactions stay (they just become uncategorized).`)) del.mutate(c.id); }} className="text-muted-foreground transition hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {realCats.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No categories yet.</p>}
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <Field label="New category"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marketing" className={inputCls} /></Field>
          <ColorDots value={color} onChange={setColor} />
          <button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} <Plus className="h-3.5 w-3.5" /> Add category
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ColorSwatchButton({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="h-5 w-5 shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-foreground/30" style={{ background: color }} />
      {open && (
        <div className="absolute left-0 top-7 z-10 flex w-44 flex-wrap gap-1.5 rounded-xl border border-border bg-card p-2 shadow-pop">
          {PALETTE.map((c) => (
            <button key={c} onClick={() => { onPick(c); setOpen(false); }} className={cn("h-6 w-6 rounded-full ring-2 transition", color === c ? "ring-foreground" : "ring-transparent")} style={{ background: c }} />
          ))}
        </div>
      )}
    </div>
  );
}

function StageManager({ projectId, stages, onClose, onChanged }: { projectId: string; stages: PnlStage[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[1]);
  const create = useMutation({ mutationFn: () => nexusApi.pnlCreateStage({ projectId, name, color }), onSuccess: () => { setName(""); onChanged(); } });
  const update = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: { name?: string; color?: string; order?: number } }) => nexusApi.pnlUpdateStage(id, payload), onSuccess: onChanged });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.pnlDeleteStage(id), onSuccess: onChanged });
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  return (
    <Modal title="Pipeline stages" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Stage order = your deal flow (top → bottom). Tweak them however you like — these are just for this project.</p>
        <div className="space-y-1.5">
          {sorted.map((s, idx) => (
            <div key={s.id} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
              <div className="flex flex-col">
                <button disabled={idx === 0} onClick={() => { update.mutate({ id: s.id, payload: { order: sorted[idx - 1].order } }); update.mutate({ id: sorted[idx - 1].id, payload: { order: s.order } }); }} className="text-muted-foreground transition hover:text-foreground disabled:opacity-20"><ChevronLeft className="h-3 w-3 rotate-90" /></button>
                <button disabled={idx === sorted.length - 1} onClick={() => { update.mutate({ id: s.id, payload: { order: sorted[idx + 1].order } }); update.mutate({ id: sorted[idx + 1].id, payload: { order: s.order } }); }} className="text-muted-foreground transition hover:text-foreground disabled:opacity-20"><ChevronRight className="h-3 w-3 rotate-90" /></button>
              </div>
              <ColorSwatchButton color={s.color} onPick={(col) => update.mutate({ id: s.id, payload: { color: col } })} />
              <input defaultValue={s.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) update.mutate({ id: s.id, payload: { name: v } }); }} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
              <span className="text-[10px] font-bold text-muted-foreground">{s.count} {s.count === 1 ? "deal" : "deals"}</span>
              <button onClick={() => { if (confirm(`Delete the "${s.name}" stage? Deals in it become stage-less.`)) del.mutate(s.id); }} className="text-muted-foreground transition hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <Field label="New stage"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Contract signed" className={inputCls} /></Field>
          <ColorDots value={color} onChange={setColor} />
          <button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} <Plus className="h-3.5 w-3.5" /> Add stage
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RecurringManager({ projectId, recurring, categories, onClose, onChanged }: { projectId: string; recurring: PnlRecurring[]; categories: PnlCategory[]; onClose: () => void; onChanged: () => void }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const create = useMutation({
    mutationFn: () => nexusApi.pnlCreateRecurring({ projectId, description, amount, categoryId: categoryId || null, dayOfMonth }),
    onSuccess: () => { setDescription(""); setAmount(0); onChanged(); },
  });
  const update = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: { active?: boolean } }) => nexusApi.pnlUpdateRecurring(id, payload), onSuccess: onChanged });
  const del = useMutation({ mutationFn: (id: string) => nexusApi.pnlDeleteRecurring(id), onSuccess: onChanged });
  const realCats = categories.filter((c) => c.id);
  const catName = (id?: string | null) => realCats.find((c) => c.id === id)?.name;
  return (
    <Modal title="Monthly recurring expenses" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Logged automatically every month on the day you set (payroll, rent, subscriptions). Kicks in the month after you create it.</p>
        <div className="space-y-1.5">
          {recurring.map((r) => (
            <div key={r.id} className={cn("flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2", !r.active && "opacity-50")}>
              <Repeat className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.description}</div>
                <div className="text-[11px] text-muted-foreground">{rp(r.amount)} · every month on the {r.dayOfMonth}{catName(r.categoryId) ? ` · ${catName(r.categoryId)}` : ""}</div>
              </div>
              <button onClick={() => update.mutate({ id: r.id, payload: { active: !r.active } })}
                className={cn("rounded-lg px-2 py-1 text-[10px] font-extrabold uppercase transition", r.active ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-muted text-muted-foreground hover:bg-accent")}>
                {r.active ? "Active" : "Paused"}
              </button>
              <button onClick={() => { if (confirm(`Delete the "${r.description}" recurring expense? Entries already logged stay put.`)) del.mutate(r.id); }} className="text-muted-foreground transition hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {recurring.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No recurring expenses yet.</p>}
        </div>
        <div className="space-y-3 border-t border-border pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Team payroll" className={inputCls} /></Field>
            <Field label="Amount (Rp)"><RpInput onValue={setAmount} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
                <option value="">No category</option>
                {realCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Posting day each month">
              <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className={inputCls}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((dd) => <option key={dd} value={dd}>Day {dd}</option>)}
              </select>
            </Field>
          </div>
          {create.isError && <p className="text-xs font-semibold text-destructive">{(create.error as Error)?.message ?? "Something went wrong."}</p>}
          <button onClick={() => create.mutate()} disabled={create.isPending || !description.trim() || amount <= 0} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} <Plus className="h-3.5 w-3.5" /> Add recurring
          </button>
        </div>
      </div>
    </Modal>
  );
}

"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ArrowLeft,
  EyeOff,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import type { FinanceDashboardData } from "@/lib/finance-dashboard-data"
import { ProjectIcon } from "@/components/projects/project-icon"
import { cn } from "@/lib/utils"

interface FinanceDashboardClientProps {
  project: {
    id: string
    name: string
    color: string
    icon: string
    description: string | null
  }
  initialUnlocked: boolean
  passwordConfigured: boolean
}

function formatRpMillion(value: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 1,
    minimumFractionDigits: Math.abs(value % 1) > 0 ? 1 : 0,
  }).format(value)} M`
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value)}%`
}

function formatSignedMillion(value: number) {
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 1,
  }).format(value)} M`
}

function formatGrowth(value: number | null, fallback: string) {
  if (value === null) return fallback
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(value)}% vs tahun lalu`
}

function StatCard({
  label,
  value,
  caption,
  tone = "positive",
}: {
  label: string
  value: string
  caption: string
  tone?: "positive" | "negative" | "neutral"
}) {
  return (
    <div className="rounded-[1.35rem] border border-on-surface-variant/10 bg-surface-container-low p-5 shadow-sm">
      <p className="text-xs font-medium text-on-surface-variant">{label}</p>
      <p className="mt-3 text-2xl font-black tracking-tight text-on-surface md:text-3xl">
        {value}
      </p>
      <span
        className={cn(
          "mt-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold",
          tone === "positive" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          tone === "negative" && "bg-red-500/10 text-red-700 dark:text-red-300",
          tone === "neutral" && "bg-primary/10 text-primary"
        )}
      >
        {caption}
      </span>
    </div>
  )
}

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container-lowest p-5 shadow-sm", className)}>
      <div className="mb-4">
        <h2 className="text-lg font-black tracking-tight text-on-surface">{title}</h2>
        <p className="mt-1 text-sm text-on-surface-variant">{description}</p>
      </div>
      <div className="h-72 min-w-0">{children}</div>
    </section>
  )
}

function LoadingPanel() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest">
      <div className="flex items-center gap-3 text-sm font-semibold text-on-surface-variant">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading finance dashboard...
      </div>
    </div>
  )
}

function LockedPanel({
  projectId,
  passwordConfigured,
  onUnlocked,
}: {
  projectId: string
  passwordConfigured: boolean
  onUnlocked: () => void
}) {
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/finance-dashboard/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, password }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? "Password verification failed")
      }

      setPassword("")
      onUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password verification failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[58vh] max-w-xl items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-full rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-6 shadow-xl shadow-primary/10"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-on-primary">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-black tracking-tight text-on-surface">
          Finance dashboard locked
        </h1>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          Masukkan password dashboard Finance yang diset manual di environment production.
        </p>

        {!passwordConfigured && (
          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            Password belum dikonfigurasi. Isi `FINANCE_DASHBOARD_PASSWORD` atau
            `FINANCE_DASHBOARD_PASSWORD_HASH` di env production.
          </div>
        )}

        <label className="mt-6 block text-xs font-bold uppercase tracking-[0.22em] text-on-surface-variant">
          Dashboard password
        </label>
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          autoComplete="current-password"
          disabled={!passwordConfigured || submitting}
          className="mt-2 h-12 w-full rounded-2xl border border-on-surface-variant/10 bg-surface-container px-4 text-sm font-semibold text-on-surface outline-none transition focus:border-primary"
          placeholder="Enter password..."
        />

        {error && (
          <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!passwordConfigured || submitting || !password}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black uppercase tracking-[0.16em] text-on-primary shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Unlock dashboard
        </button>
      </form>
    </div>
  )
}

export function FinanceDashboardClient({
  project,
  initialUnlocked,
  passwordConfigured,
}: FinanceDashboardClientProps) {
  const [unlocked, setUnlocked] = useState(initialUnlocked)
  const [data, setData] = useState<FinanceDashboardData | null>(null)
  const [loading, setLoading] = useState(initialUnlocked)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async (quiet = false) => {
    if (!unlocked) return
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/finance-dashboard?projectId=${project.id}`, {
        cache: "no-store",
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? "Failed to load finance dashboard")
      }

      setData(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load finance dashboard")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [project.id, unlocked])

  useEffect(() => {
    if (!unlocked) return
    loadData()
    const interval = window.setInterval(() => loadData(true), 15000)
    return () => window.clearInterval(interval)
  }, [loadData, unlocked])

  const latestPositiveCashflow = useMemo(
    () => data?.monthly.filter((row) => row.cashflow >= 0).length ?? 0,
    [data]
  )

  async function lockDashboard() {
    await fetch("/api/finance-dashboard/auth", { method: "DELETE" }).catch(() => {})
    setUnlocked(false)
    setData(null)
  }

  return (
    <main className="min-h-full bg-background px-4 py-5 text-on-surface sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex items-center gap-2 rounded-full bg-surface-container px-4 py-2 text-sm font-semibold text-on-surface-variant transition hover:text-on-surface"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to {project.name}
          </Link>

          {unlocked && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadData(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-full bg-surface-container px-4 py-2 text-sm font-bold text-on-surface transition hover:bg-surface-container-high disabled:opacity-60"
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                Refresh
              </button>
              <button
                onClick={lockDashboard}
                className="inline-flex items-center gap-2 rounded-full bg-surface-container px-4 py-2 text-sm font-bold text-on-surface-variant transition hover:text-on-surface"
              >
                <EyeOff className="h-4 w-4" />
                Lock
              </button>
            </div>
          )}
        </div>

        <header className="mb-7 rounded-[2rem] border border-on-surface-variant/10 bg-surface-container-lowest p-6 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: `${project.color}24`, color: project.color }}
                >
                  <ProjectIcon icon={project.icon} color={project.color} size="md" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-on-surface-variant">
                    Finance Command Center
                  </p>
                  <h1 className="mt-1 text-3xl font-black tracking-tight text-on-surface md:text-5xl">
                    Dashboard Laba Rugi
                  </h1>
                </div>
              </div>
              <p className="mt-4 max-w-3xl text-sm text-on-surface-variant md:text-base">
                Periode Januari - Desember 2025. Semua angka dalam juta Rupiah (Rp M).
                Data otomatis sync dari Google Sheets saat konfigurasi sudah diisi.
              </p>
            </div>

            {data && (
              <div className="rounded-2xl bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
                <p className="font-black uppercase tracking-[0.18em]">Live source</p>
                <p className="mt-1 font-semibold text-on-surface">
                  {data.sourceLabel} · {new Date(data.lastUpdated).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            )}
          </div>
        </header>

        {!unlocked ? (
          <LockedPanel
            projectId={project.id}
            passwordConfigured={passwordConfigured}
            onUnlocked={() => setUnlocked(true)}
          />
        ) : loading ? (
          <LoadingPanel />
        ) : error ? (
          <div className="rounded-[2rem] border border-red-500/20 bg-red-500/10 p-6 text-red-700 dark:text-red-300">
            <p className="font-black">Finance dashboard gagal dimuat.</p>
            <p className="mt-2 text-sm">{error}</p>
          </div>
        ) : data ? (
          <div className="space-y-6">
            {data.source === "sample" && (
              <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/10 p-4 text-sm font-semibold text-amber-800 dark:text-amber-200">
                Google Sheets belum dikonfigurasi, jadi dashboard sementara memakai sample dari PDF.
              </div>
            )}

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total Pendapatan"
                value={formatRpMillion(data.totals.revenue)}
                caption={formatGrowth(data.totals.revenueGrowth, "Live from Sheets")}
              />
              <StatCard
                label="Total Beban"
                value={formatRpMillion(data.totals.expense)}
                caption={formatGrowth(data.totals.expenseGrowth, "Live from Sheets")}
                tone="negative"
              />
              <StatCard
                label="Laba Bersih"
                value={formatRpMillion(data.totals.profit)}
                caption={formatGrowth(data.totals.profitGrowth, "Live from Sheets")}
              />
              <StatCard
                label="Net Margin"
                value={formatPercent(data.totals.netMargin)}
                caption={`Target ${formatPercent(data.targetMargin)}`}
              />
            </section>

            <ChartCard
              title="Pendapatan vs Beban - Bulanan"
              description="Perbandingan pendapatan dan beban setiap bulan. Selisih antara dua batang adalah laba bulan tersebut."
              className="xl:col-span-2"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => `Rp ${value}M`} tickLine={false} axisLine={false} width={64} />
                  <Tooltip formatter={(value) => formatRpMillion(Number(value))} />
                  <Legend />
                  <Bar dataKey="revenue" name="Pendapatan" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="expense" name="Beban" fill="#e4572e" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="grid gap-6 xl:grid-cols-2">
              <ChartCard
                title="Laba Bersih - Tren Bulanan"
                description="Garis naik menandakan kinerja membaik dari bulan ke bulan."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.monthly}>
                    <defs>
                      <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => `${value}M`} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => formatRpMillion(Number(value))} />
                    <Area type="monotone" dataKey="profit" name="Laba Bersih" stroke="#10b981" fill="url(#profitFill)" strokeWidth={3} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Target vs Aktual - Pendapatan"
                description="Batang biru = realisasi. Batang abu = target yang ditetapkan."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => `${value}M`} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => formatRpMillion(Number(value))} />
                    <Legend />
                    <Bar dataKey="revenue" name="Aktual" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="target" name="Target" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <ChartCard
              title="Cashflow Bersih - Arus Kas Bulanan"
              description={`Hijau = kas masuk lebih besar dari kas keluar. ${latestPositiveCashflow} bulan positif.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => `${value}M`} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => formatRpMillion(Number(value))} />
                  <Bar dataKey="cashflow" name="Cashflow" radius={[8, 8, 0, 0]}>
                    {data.monthly.map((row) => (
                      <Cell key={row.month} fill={row.cashflow >= 0 ? "#1f9d72" : "#e4572e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <section className="overflow-hidden rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container-lowest shadow-sm">
              <div className="border-b border-on-surface-variant/10 p-5">
                <h2 className="text-lg font-black tracking-tight text-on-surface">Ringkasan Bulanan</h2>
                <p className="mt-1 text-sm text-on-surface-variant">Tabel operasional dari Google Sheets.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-left text-sm">
                  <thead className="bg-blue-500 text-white">
                    <tr>
                      <th className="px-4 py-3 font-black">Bulan</th>
                      <th className="px-4 py-3 font-black">Pendapatan</th>
                      <th className="px-4 py-3 font-black">Beban</th>
                      <th className="px-4 py-3 font-black">Laba Bersih</th>
                      <th className="px-4 py-3 font-black">Margin</th>
                      <th className="px-4 py-3 font-black">vs Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthly.map((row, index) => (
                      <tr
                        key={row.month}
                        className={index % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container-lowest"}
                      >
                        <td className="px-4 py-3 font-bold">{row.month}</td>
                        <td className="px-4 py-3">{formatRpMillion(row.revenue)}</td>
                        <td className="px-4 py-3">{formatRpMillion(row.expense)}</td>
                        <td className="px-4 py-3 font-black text-emerald-700 dark:text-emerald-300">{formatRpMillion(row.profit)}</td>
                        <td className="px-4 py-3">{formatPercent(row.margin)}</td>
                        <td className={cn("px-4 py-3 font-black", row.vsTarget >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")}>
                          {formatSignedMillion(row.vsTarget)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  )
}

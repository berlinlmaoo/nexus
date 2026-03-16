"use client"

import { Activity, CheckCircle2, Flame, Timer } from "lucide-react"
import { cn } from "@/lib/utils"

interface MetricsDashWidgetProps {
  data?: {
    completedToday?: number
    completedThisWeek?: number
    currentStreak?: number
    avgCompletionTime?: number
    completedTodayTrend?: number
    completedThisWeekTrend?: number
    currentStreakTrend?: number
    avgCompletionTimeTrend?: number
  }
}

interface Metric {
  key: string
  label: string
  icon: typeof Activity
  value: number
  trend: number
  suffix?: string
}

export function MetricsDashWidget({ data }: MetricsDashWidgetProps) {
  const metrics: Metric[] = [
    {
      key: "today",
      label: "Done Today",
      icon: CheckCircle2,
      value: data?.completedToday ?? 0,
      trend: data?.completedTodayTrend ?? 0,
    },
    {
      key: "week",
      label: "This Week",
      icon: Activity,
      value: data?.completedThisWeek ?? 0,
      trend: data?.completedThisWeekTrend ?? 0,
    },
    {
      key: "streak",
      label: "Streak",
      icon: Flame,
      value: data?.currentStreak ?? 0,
      trend: data?.currentStreakTrend ?? 0,
      suffix: "d",
    },
    {
      key: "avg",
      label: "Avg Time",
      icon: Timer,
      value: data?.avgCompletionTime ?? 0,
      trend: data?.avgCompletionTimeTrend ?? 0,
      suffix: "h",
    },
  ]

  return (
    <div className="grid h-full grid-cols-2 gap-3">
      {metrics.map((metric) => {
        const Icon = metric.icon
        const trendUp = metric.trend > 0
        const trendDown = metric.trend < 0
        const trendNeutral = metric.trend === 0

        return (
          <div
            key={metric.key}
            className="flex flex-col justify-center rounded-lg border border-border/50 bg-muted/30 p-3"
          >
            <div className="mb-1 flex items-center gap-1.5">
              <Icon className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[11px] text-muted-foreground">{metric.label}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {metric.value}
              </span>
              {metric.suffix && (
                <span className="text-xs text-muted-foreground/60">{metric.suffix}</span>
              )}
              {!trendNeutral && (
                <span
                  className={cn(
                    "ml-auto text-[10px] font-medium",
                    trendUp && "text-emerald-600",
                    trendDown && "text-red-500"
                  )}
                >
                  {trendUp ? "+" : ""}
                  {metric.trend}%
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

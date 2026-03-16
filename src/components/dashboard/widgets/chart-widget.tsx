"use client"

import { useState } from "react"
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { BarChart3, PieChart as PieIcon, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

type ChartType = "bar" | "pie" | "line"

interface ChartDashWidgetProps {
  data?: {
    tasksByStatus?: { name: string; value: number }[]
    tasksByPriority?: { name: string; value: number }[]
    completionTrend?: { date: string; completed: number }[]
  }
}

const MONO_COLORS = ["#27272a", "#52525b", "#a1a1aa", "#d4d4d8"]

const defaultData = [
  { name: "To Do", value: 0 },
  { name: "In Progress", value: 0 },
  { name: "In Review", value: 0 },
  { name: "Done", value: 0 },
]

export function ChartDashWidget({ data }: ChartDashWidgetProps) {
  const [chartType, setChartType] = useState<ChartType>("bar")

  const chartData = data?.tasksByStatus ?? defaultData
  const trendData = data?.completionTrend ?? []
  const hasData = chartData.some((d) => d.value > 0) || trendData.length > 0

  const chartButtons: { type: ChartType; icon: typeof BarChart3; label: string }[] = [
    { type: "bar", icon: BarChart3, label: "Bar" },
    { type: "pie", icon: PieIcon, label: "Pie" },
    { type: "line", icon: TrendingUp, label: "Trend" },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Tasks Overview</h3>
        <div className="flex gap-1">
          {chartButtons.map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              title={label}
              className={cn(
                "rounded p-1 transition-colors",
                chartType === type
                  ? "bg-foreground text-background"
                  : "text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
          No chart data available
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "bar" ? (
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={{ stroke: "#d4d4d8" }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "none",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {chartData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={MONO_COLORS[index % MONO_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : chartType === "pie" ? (
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius="40%"
                  outerRadius="70%"
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  stroke="none"
                >
                  {chartData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={MONO_COLORS[index % MONO_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "none",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            ) : (
              <LineChart
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data={(trendData.length > 0 ? trendData : chartData) as any[]}
                margin={{ top: 4, right: 4, bottom: 4, left: -20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis
                  dataKey={trendData.length > 0 ? "date" : "name"}
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={{ stroke: "#d4d4d8" }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "none",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey={trendData.length > 0 ? "completed" : "value"}
                  stroke="#27272a"
                  strokeWidth={2}
                  dot={{ fill: "#27272a", r: 3 }}
                  activeDot={{ r: 4, fill: "#52525b" }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

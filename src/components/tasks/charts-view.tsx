"use client"

import { useState, useMemo } from "react"
import type { TaskCardData } from "./task-card"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts"
import { CalendarDays } from "lucide-react"

interface ChartsViewProps {
  tasks: TaskCardData[]
  members?: { id: string; name: string; avatar: string | null }[]
}

const STATUS_COLORS: Record<string, string> = {
  TODO: "#a1a1aa",
  IN_PROGRESS: "#3b82f6",
  IN_REVIEW: "#71717a",
  DONE: "#22c55e",
  CANCELLED: "#ef4444",
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "#ef4444",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#3b82f6",
  NONE: "#a1a1aa",
}

export function ChartsView({ tasks, members = [] }: ChartsViewProps) {
  const [dateRange, setDateRange] = useState(30)

  // Tasks by status
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {}
    tasks.forEach((t) => {
      counts[t.status] = (counts[t.status] || 0) + 1
    })
    return Object.entries(counts).map(([status, count]) => ({
      name: status.replace("_", " "),
      value: count,
      fill: STATUS_COLORS[status] || "#a1a1aa",
    }))
  }, [tasks])

  // Tasks by priority
  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {}
    tasks.forEach((t) => {
      counts[t.priority] = (counts[t.priority] || 0) + 1
    })
    return Object.entries(counts).map(([priority, count]) => ({
      name: priority,
      value: count,
      fill: PRIORITY_COLORS[priority] || "#a1a1aa",
    }))
  }, [tasks])

  // Tasks completed over time (last N days)
  const completionData = useMemo(() => {
    const now = new Date()
    const days: { date: string; completed: number; created: number }[] = []

    for (let i = dateRange - 1; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split("T")[0]
      const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" })

      const completed = tasks.filter(
        (t) => t.status === "DONE" && t.dueDate && t.dueDate.startsWith(dateStr)
      ).length

      days.push({ date: label, completed, created: 0 })
    }

    return days
  }, [tasks, dateRange])

  // Tasks by assignee
  const assigneeData = useMemo(() => {
    const counts: Record<string, number> = {}
    tasks.forEach((t) => {
      if (t.assignees.length === 0) {
        counts["Unassigned"] = (counts["Unassigned"] || 0) + 1
      } else {
        t.assignees.forEach((a) => {
          counts[a.name] = (counts[a.name] || 0) + 1
        })
      }
    })
    return Object.entries(counts)
      .map(([name, count]) => ({ name, tasks: count }))
      .sort((a, b) => b.tasks - a.tasks)
  }, [tasks])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-lg border bg-background px-3 py-2 shadow-lg">
        <p className="text-xs font-medium">{label}</p>
        {payload.map((entry: any, i: number) => (
          <p key={i} className="text-xs text-muted-foreground">
            {entry.name}: <span className="font-medium text-foreground">{entry.value}</span>
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Period:</span>
        {[7, 14, 30, 90].map((days) => (
          <button
            key={days}
            onClick={() => setDateRange(days)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-all",
              dateRange === days
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {days}d
          </button>
        ))}
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Tasks by Status - Bar chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border bg-background p-5"
        >
          <h3 className="text-sm font-semibold mb-4">Tasks by Status</h3>
          <div className="h-[220px] sm:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Tasks">
                  {statusData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Tasks by Priority - Pie chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border bg-background p-5"
        >
          <h3 className="text-sm font-semibold mb-4">Tasks by Priority</h3>
          <div className="h-[220px] sm:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  dataKey="value"
                  nameKey="name"
                  strokeWidth={2}
                  stroke="#fff"
                >
                  {priorityData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(value) => <span className="text-xs">{value}</span>}
                  iconSize={8}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Completion over time - Line chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border bg-background p-5"
        >
          <h3 className="text-sm font-semibold mb-4">Tasks Completed Over Time</h3>
          <div className="h-[220px] sm:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={completionData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  stroke="#a1a1aa"
                  interval={Math.max(0, Math.floor(completionData.length / 7) - 1)}
                />
                <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="completed"
                  stroke="#18181b"
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#18181b" }}
                  activeDot={{ r: 4 }}
                  name="Completed"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Tasks by Assignee - Bar chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-xl border bg-background p-5"
        >
          <h3 className="text-sm font-semibold mb-4">Tasks by Assignee</h3>
          <div className="h-[220px] sm:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={assigneeData}
                layout="vertical"
                margin={{ top: 5, right: 5, bottom: 5, left: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#a1a1aa" allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  stroke="#a1a1aa"
                  width={55}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="tasks" fill="#18181b" radius={[0, 4, 4, 0]} name="Tasks" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Summary stats row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
        {[
          { label: "Total", value: tasks.length, color: "text-foreground" },
          { label: "Done", value: tasks.filter((t) => t.status === "DONE").length, color: "text-green-600" },
          { label: "In Progress", value: tasks.filter((t) => t.status === "IN_PROGRESS").length, color: "text-blue-600" },
          { label: "Overdue", value: tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "DONE").length, color: "text-red-600" },
          { label: "Unassigned", value: tasks.filter((t) => t.assignees.length === 0).length, color: "text-muted-foreground" },
        ].map((stat) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-lg border bg-muted/30 p-3 text-center"
          >
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={cn("text-xl font-bold", stat.color)}>{stat.value}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

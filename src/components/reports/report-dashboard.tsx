"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetricCard } from "./metric-card"
import { ReportFilters } from "./report-filters"
import {
  BarChart3,
  CheckCircle2,
  Clock,
  TrendingUp,
  Timer,
  Target,
} from "lucide-react"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"

interface ReportData {
  metrics: {
    totalTasks: number
    completedTasks: number
    overdueTasks: number
    completionRate: number
    completionTrend: number
    avgCompletionDays: number
  }
  tasksByStatus: { status: string; count: number }[]
  tasksByPriority: { priority: string; count: number }[]
  completionTimeline: { date: string; completed: number }[]
  tasksByAssignee: {
    id: string
    name: string
    avatar: string | null
    total: number
    completed: number
    completionRate: number
  }[]
  overdueTrend: { week: string; count: number }[]
  sprintBurndowns: {
    id: string
    name: string
    project: string
    totalTasks: number
    data: { date: string; remaining: number; ideal: number }[]
  }[]
  workloadHeatmap: {
    userId: string
    name: string
    days: { date: string; count: number }[]
  }[]
  projectHealth: {
    id: string
    name: string
    color: string
    total: number
    done: number
    overdue: number
    progress: number
    health: "green" | "yellow" | "red"
  }[]
  projects: { id: string; name: string; color: string }[]
}

const STATUS_COLORS: Record<string, string> = {
  TODO: "#71717A",
  IN_PROGRESS: "#3B82F6",
  IN_REVIEW: "#F59E0B",
  DONE: "#22C55E",
  CANCELLED: "#EF4444",
}

const STATUS_LABELS: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  DONE: "Done",
  CANCELLED: "Cancelled",
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "#EF4444",
  HIGH: "#F97316",
  MEDIUM: "#F59E0B",
  LOW: "#3B82F6",
  NONE: "#71717A",
}

const HEALTH_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  green: { bg: "bg-green-500/10", text: "text-green-600 dark:text-green-400", label: "Healthy" },
  yellow: { bg: "bg-yellow-500/10", text: "text-yellow-600 dark:text-yellow-400", label: "At Risk" },
  red: { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", label: "Critical" },
}

export function ReportDashboard() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [dateRange, setDateRange] = useState("30")
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("days", dateRange)
      if (selectedProjects.length > 0) params.set("projectIds", selectedProjects.join(","))
      if (selectedMembers.length > 0) params.set("memberIds", selectedMembers.join(","))

      const res = await fetch(`/api/reports?${params.toString()}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (error) {
      console.error("Failed to fetch reports:", error)
    } finally {
      setLoading(false)
    }
  }, [dateRange, selectedProjects, selectedMembers])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setMembers(data.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })))
        }
      })
      .catch(console.error)
  }, [])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 dark:border-zinc-100" />
      </div>
    )
  }

  if (!data) return null

  const statusData = data.tasksByStatus.map((s) => ({
    name: STATUS_LABELS[s.status] || s.status,
    value: s.count,
    color: STATUS_COLORS[s.status] || "#71717A",
  }))

  const priorityData = data.tasksByPriority.map((p) => ({
    name: p.priority,
    count: p.count,
    fill: PRIORITY_COLORS[p.priority] || "#71717A",
  }))

  // Aggregate completion timeline by week for cleaner display
  const weeklyTimeline = data.completionTimeline.reduce<{ week: string; completed: number }[]>(
    (acc, item) => {
      const d = new Date(item.date)
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay())
      const key = weekStart.toISOString().split("T")[0]
      const existing = acc.find((a) => a.week === key)
      if (existing) {
        existing.completed += item.completed
      } else {
        acc.push({ week: key, completed: item.completed })
      }
      return acc
    },
    []
  )

  return (
    <div className="space-y-6">
      {/* Filters */}
      <ReportFilters
        projects={data.projects}
        members={members}
        selectedProjects={selectedProjects}
        selectedMembers={selectedMembers}
        dateRange={dateRange}
        onProjectsChange={setSelectedProjects}
        onMembersChange={setSelectedMembers}
        onDateRangeChange={setDateRange}
      />

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          icon={BarChart3}
          label="Total Tasks"
          value={data.metrics.totalTasks}
          iconBg="bg-zinc-100 dark:bg-zinc-800"
          iconColor="text-zinc-700 dark:text-zinc-300"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Completed"
          value={data.metrics.completedTasks}
          trend={data.metrics.completionTrend}
          iconBg="bg-green-100 dark:bg-green-900/30"
          iconColor="text-green-600 dark:text-green-400"
        />
        <MetricCard
          icon={Clock}
          label="Overdue"
          value={data.metrics.overdueTasks}
          iconBg="bg-red-100 dark:bg-red-900/30"
          iconColor="text-red-600 dark:text-red-400"
        />
        <MetricCard
          icon={TrendingUp}
          label="Completion Rate"
          value={`${data.metrics.completionRate}%`}
          iconBg="bg-blue-100 dark:bg-blue-900/30"
          iconColor="text-blue-600 dark:text-blue-400"
        />
        <MetricCard
          icon={Timer}
          label="Avg. Completion"
          value={`${data.metrics.avgCompletionDays}d`}
          iconBg="bg-orange-100 dark:bg-orange-900/30"
          iconColor="text-orange-600 dark:text-orange-400"
        />
        <MetricCard
          icon={Target}
          label="Projects"
          value={data.projects.length}
          iconBg="bg-cyan-100 dark:bg-cyan-900/30"
          iconColor="text-cyan-600 dark:text-cyan-400"
        />
      </div>

      {/* Row 1: Completion Timeline + Tasks by Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Task Completion Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyTimeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                  <XAxis
                    dataKey="week"
                    tickFormatter={(v) => {
                      const d = new Date(v)
                      return `${d.getMonth() + 1}/${d.getDate()}`
                    }}
                    stroke="#71717A"
                    fontSize={12}
                  />
                  <YAxis stroke="#71717A" fontSize={12} allowDecimals={false} tickFormatter={(v: number) => Math.round(v).toString()} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181B", border: "1px solid #3F3F46", borderRadius: "8px" }}
                    labelStyle={{ color: "#A1A1AA" }}
                    itemStyle={{ color: "#FAFAFA" }}
                    labelFormatter={(v) => `Week of ${new Date(v).toLocaleDateString()}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="completed"
                    stroke="#18181B"
                    strokeWidth={2}
                    dot={{ fill: "#18181B", r: 3 }}
                    name="Completed"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181B", border: "1px solid #3F3F46", borderRadius: "8px" }}
                    itemStyle={{ color: "#FAFAFA" }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => <span className="text-xs">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Priority + Assignee */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks by Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={priorityData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                  <XAxis type="number" stroke="#71717A" fontSize={12} allowDecimals={false} tickFormatter={(v: number) => Math.round(v).toString()} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#71717A"
                    fontSize={12}
                    width={70}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181B", border: "1px solid #3F3F46", borderRadius: "8px" }}
                    itemStyle={{ color: "#FAFAFA" }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {priorityData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks by Assignee</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.tasksByAssignee.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                  <XAxis
                    dataKey="name"
                    stroke="#71717A"
                    fontSize={11}
                    tickFormatter={(v) => v.split(" ")[0]}
                  />
                  <YAxis stroke="#71717A" fontSize={12} allowDecimals={false} tickFormatter={(v: number) => Math.round(v).toString()} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181B", border: "1px solid #3F3F46", borderRadius: "8px" }}
                    itemStyle={{ color: "#FAFAFA" }}
                    formatter={(value, name) => {
                      const v = typeof value === 'number' ? value : 0
                      if (name === "completionRate") return [`${v}%`, "Completion %"]
                      return [v, name === "completed" ? "Completed" : "Total"]
                    }}
                  />
                  <Legend />
                  <Bar dataKey="total" fill="#3F3F46" radius={[4, 4, 0, 0]} name="Total" />
                  <Bar dataKey="completed" fill="#22C55E" radius={[4, 4, 0, 0]} name="Completed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Overdue Trend + Sprint Burndown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overdue Tasks Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {data.overdueTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.overdueTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                    <XAxis
                      dataKey="week"
                      stroke="#71717A"
                      fontSize={12}
                      tickFormatter={(v) => {
                        const d = new Date(v)
                        return `${d.getMonth() + 1}/${d.getDate()}`
                      }}
                    />
                    <YAxis stroke="#71717A" fontSize={12} allowDecimals={false} tickFormatter={(v: number) => Math.round(v).toString()} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#18181B", border: "1px solid #3F3F46", borderRadius: "8px" }}
                      itemStyle={{ color: "#FAFAFA" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#EF4444"
                      fill="#EF4444"
                      fillOpacity={0.1}
                      name="Overdue"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  No overdue tasks
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sprint Burndown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {data.sprintBurndowns.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.sprintBurndowns[0].data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                    <XAxis
                      dataKey="date"
                      stroke="#71717A"
                      fontSize={12}
                      tickFormatter={(v) => {
                        const d = new Date(v)
                        return `${d.getMonth() + 1}/${d.getDate()}`
                      }}
                    />
                    <YAxis stroke="#71717A" fontSize={12} allowDecimals={false} tickFormatter={(v: number) => Math.round(v).toString()} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#18181B", border: "1px solid #3F3F46", borderRadius: "8px" }}
                      itemStyle={{ color: "#FAFAFA" }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="remaining"
                      stroke="#18181B"
                      strokeWidth={2}
                      dot={{ fill: "#18181B", r: 3 }}
                      name="Remaining"
                    />
                    <Line
                      type="monotone"
                      dataKey="ideal"
                      stroke="#71717A"
                      strokeWidth={1}
                      strokeDasharray="5 5"
                      dot={false}
                      name="Ideal"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  No active sprints
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Workload Heatmap */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team Workload Heatmap (Last 7 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.workloadHeatmap.length > 0 ? (
            <div className="mobile-horizontal-scroll overflow-x-auto">
              <table className="min-w-[620px] w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground w-32">Member</th>
                    {data.workloadHeatmap[0]?.days.map((d) => (
                      <th key={d.date} className="text-center py-2 px-2 font-medium text-muted-foreground text-xs">
                        {new Date(d.date).toLocaleDateString("en-US", { weekday: "short" })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.workloadHeatmap.map((row) => (
                    <tr key={row.userId} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 px-3 font-medium truncate max-w-[120px]">{row.name}</td>
                      {row.days.map((d) => {
                        const intensity = Math.min(d.count / 5, 1)
                        const bg = d.count === 0
                          ? "bg-zinc-100 dark:bg-zinc-800"
                          : intensity < 0.3
                          ? "bg-zinc-300 dark:bg-zinc-600"
                          : intensity < 0.6
                          ? "bg-zinc-500 dark:bg-zinc-400"
                          : "bg-zinc-800 dark:bg-zinc-200"
                        return (
                          <td key={d.date} className="py-2 px-2 text-center">
                            <div
                              className={`mx-auto w-8 h-8 rounded flex items-center justify-center text-xs font-medium ${bg} ${
                                intensity >= 0.6 ? "text-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300"
                              }`}
                              title={`${d.count} task updates`}
                            >
                              {d.count || ""}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No workload data for the last 7 days
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 5: Project Health Scorecard */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Health Scorecard</CardTitle>
        </CardHeader>
        <CardContent>
          {data.projectHealth.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.projectHealth.map((project) => {
                const style = HEALTH_STYLES[project.health]
                return (
                  <div
                    key={project.id}
                    className={`p-4 rounded-lg border ${style.bg}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium truncate">{project.name}</h4>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
                        {style.label}
                      </span>
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Progress</span>
                        <span className="font-medium text-foreground">{project.progress}%</span>
                      </div>
                      <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-zinc-800 dark:bg-zinc-200 transition-all"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs pt-1">
                        <span>{project.done}/{project.total} done</span>
                        {project.overdue > 0 && (
                          <span className="text-red-500">{project.overdue} overdue</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No projects to display
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Filter,
  FolderKanban,
  LayoutDashboard,
  Search,
  Users,
} from "lucide-react"
import type { OpsDashboardData, OpsDashboardTask } from "@/lib/ops-dashboard/tasks"
import { cn } from "@/lib/utils"

type Props = {
  data: OpsDashboardData
  viewerName: string
}

const STATUS_LABELS: Record<OpsDashboardTask["status"], string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
  CANCELLED: "Cancelled",
}

const PRIORITY_LABELS: Record<OpsDashboardTask["priority"], string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  NONE: "None",
}

const priorityStyles: Record<OpsDashboardTask["priority"], string> = {
  URGENT: "bg-red-500 text-white",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-200",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200",
  LOW: "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-200",
  NONE: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
}

function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

function endOfToday() {
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  return today
}

function isOverdue(task: OpsDashboardTask) {
  return Boolean(task.dueDate && new Date(task.dueDate) < startOfToday())
}

function isDueToday(task: OpsDashboardTask) {
  if (!task.dueDate) return false
  const due = new Date(task.dueDate)
  return due >= startOfToday() && due <= endOfToday()
}

function formatDate(value: string | null) {
  if (!value) return "No due date"
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function overdueDays(value: string | null) {
  if (!value) return 0
  const diff = startOfToday().getTime() - new Date(value).getTime()
  return Math.max(0, Math.ceil(diff / 86_400_000))
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function OpsDashboardClient({ data, viewerName }: Props) {
  const [search, setSearch] = useState("")
  const [division, setDivision] = useState("ALL")
  const [project, setProject] = useState("ALL")
  const [status, setStatus] = useState("ALL")
  const [priority, setPriority] = useState("ALL")
  const [dueMode, setDueMode] = useState<"ALL" | "OVERDUE" | "TODAY" | "NO_DUE">("ALL")

  const tasks = data.tasks
  const divisions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.project.division))).sort(),
    [tasks]
  )
  const projects = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.project.name))).sort(),
    [tasks]
  )

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()

    return tasks.filter((task) => {
      if (division !== "ALL" && task.project.division !== division) return false
      if (project !== "ALL" && task.project.name !== project) return false
      if (status !== "ALL" && task.status !== status) return false
      if (priority !== "ALL" && task.priority !== priority) return false
      if (dueMode === "OVERDUE" && !isOverdue(task)) return false
      if (dueMode === "TODAY" && !isDueToday(task)) return false
      if (dueMode === "NO_DUE" && task.dueDate) return false
      if (!query) return true

      const haystack = [
        task.title,
        task.project.name,
        task.project.division,
        task.taskListName,
        task.status,
        task.priority,
        ...task.assignees.map((assignee) => `${assignee.name} ${assignee.email}`),
      ]
        .join(" ")
        .toLowerCase()

      return haystack.includes(query)
    })
  }, [division, dueMode, priority, project, search, status, tasks])

  const stats = useMemo(() => {
    const overdue = tasks.filter(isOverdue).length
    const dueToday = tasks.filter(isDueToday).length
    const unassigned = tasks.filter((task) => task.assignees.length === 0).length
    const activeProjects = new Set(tasks.map((task) => task.project.id)).size

    return {
      total: tasks.length,
      overdue,
      dueToday,
      unassigned,
      activeProjects,
    }
  }, [tasks])

  const divisionSummary = useMemo(() => {
    return divisions
      .map((name) => {
        const divisionTasks = tasks.filter((task) => task.project.division === name)
        return {
          name,
          total: divisionTasks.length,
          overdue: divisionTasks.filter(isOverdue).length,
          projects: new Set(divisionTasks.map((task) => task.project.id)).size,
        }
      })
      .sort((a, b) => b.overdue - a.overdue || b.total - a.total)
  }, [divisions, tasks])

  const projectSummary = useMemo(() => {
    const map = new Map<string, { name: string; color: string; division: string; total: number; overdue: number }>()
    for (const task of tasks) {
      const current =
        map.get(task.project.id) ??
        {
          name: task.project.name,
          color: task.project.color,
          division: task.project.division,
          total: 0,
          overdue: 0,
        }
      current.total += 1
      if (isOverdue(task)) current.overdue += 1
      map.set(task.project.id, current)
    }

    return Array.from(map.values()).sort((a, b) => b.overdue - a.overdue || b.total - a.total)
  }, [tasks])

  return (
    <main className="min-h-screen bg-[#eef2f5] text-slate-950 dark:bg-[#090b10] dark:text-white">
      <section className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[34px] border border-white/70 bg-white/90 p-5 shadow-2xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-white/[0.06] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.24em] text-white dark:bg-white dark:text-slate-950">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Nexus command dashboard
              </div>
              <h1 className="font-headline text-4xl font-black tracking-[-0.06em] sm:text-6xl">
                All ongoing tasks, one clean control room.
              </h1>
              <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-white/55">
                Semua project aktif digabung di satu dashboard. Overdue langsung kebaca, owner task keliatan,
                dan tiap divisi bisa difilter tanpa masuk project satu-satu.
              </p>
            </div>
            <div className="rounded-[26px] bg-slate-100 p-4 text-xs font-bold text-slate-500 dark:bg-white/10 dark:text-white/55">
              <p className="uppercase tracking-[0.18em]">Viewer</p>
              <p className="mt-1 text-lg font-black text-slate-950 dark:text-white">{viewerName}</p>
              <p className="mt-3">Updated {formatDate(data.generatedAt)}</p>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={FolderKanban} label="Ongoing tasks" value={stats.total} />
          <MetricCard icon={AlertTriangle} label="Overdue" value={stats.overdue} tone="danger" />
          <MetricCard icon={CalendarClock} label="Due today" value={stats.dueToday} tone="warning" />
          <MetricCard icon={Users} label="Unassigned" value={stats.unassigned} />
          <MetricCard icon={CheckCircle2} label="Active projects" value={stats.activeProjects} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-[30px] bg-white p-5 shadow-xl shadow-slate-900/5 dark:bg-white/[0.06]">
            <div className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-400">
              <Filter className="h-4 w-4" />
              Filters
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="relative sm:col-span-2">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-12 w-full rounded-2xl border-0 bg-slate-100 pl-11 pr-4 text-sm font-bold outline-none ring-1 ring-transparent transition focus:ring-slate-950 dark:bg-white/10 dark:focus:ring-white"
                  placeholder="Search task, project, divisi, assignee..."
                />
              </label>
              <FilterSelect label="Division" value={division} onChange={setDivision} options={divisions} />
              <FilterSelect label="Project" value={project} onChange={setProject} options={projects} />
              <FilterSelect
                label="Status"
                value={status}
                onChange={setStatus}
                options={Object.keys(STATUS_LABELS)}
                labelFor={(value) => STATUS_LABELS[value as OpsDashboardTask["status"]]}
              />
              <FilterSelect
                label="Priority"
                value={priority}
                onChange={setPriority}
                options={Object.keys(PRIORITY_LABELS)}
                labelFor={(value) => PRIORITY_LABELS[value as OpsDashboardTask["priority"]]}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["ALL", "All"],
                ["OVERDUE", "Overdue"],
                ["TODAY", "Today"],
                ["NO_DUE", "No due"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDueMode(value as typeof dueMode)}
                  className={cn(
                    "h-11 rounded-2xl text-xs font-black uppercase tracking-[0.16em] transition",
                    dueMode === value
                      ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/10 dark:text-white/55"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryPanel title="Breakdown by division">
              {divisionSummary.slice(0, 8).map((item) => (
                <SummaryRow
                  key={item.name}
                  title={item.name}
                  meta={`${item.projects} project${item.projects === 1 ? "" : "s"}`}
                  value={`${item.total} tasks`}
                  warning={item.overdue > 0 ? `${item.overdue} overdue` : "clear"}
                />
              ))}
            </SummaryPanel>
            <SummaryPanel title="Top project pressure">
              {projectSummary.slice(0, 8).map((item) => (
                <SummaryRow
                  key={item.name}
                  title={item.name}
                  meta={item.division}
                  value={`${item.total} tasks`}
                  warning={item.overdue > 0 ? `${item.overdue} overdue` : "clear"}
                  color={item.color}
                />
              ))}
            </SummaryPanel>
          </div>
        </section>

        <section className="overflow-hidden rounded-[34px] bg-white shadow-2xl shadow-slate-900/5 dark:bg-white/[0.06]">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Task detail list</p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.04em]">
                {filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"} visible
              </h2>
            </div>
            <p className="max-w-xl text-xs font-semibold leading-5 text-slate-500 dark:text-white/50">
              Sorting default: due date terdekat dulu, lalu update terbaru. Klik project untuk buka detail di Nexus.
            </p>
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1100px] border-collapse text-left">
              <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:bg-white/[0.04]">
                <tr>
                  <th className="px-5 py-4">Task</th>
                  <th className="px-5 py-4">Division / Project</th>
                  <th className="px-5 py-4">Section</th>
                  <th className="px-5 py-4">Assignee</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Priority</th>
                  <th className="px-5 py-4">Due date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                {filteredTasks.map((task) => (
                  <TaskTableRow key={task.id} task={task} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 p-4 lg:hidden">
            {filteredTasks.map((task) => (
              <TaskMobileCard key={task.id} task={task} />
            ))}
          </div>

          {filteredTasks.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-lg font-black">No task matched this filter.</p>
              <p className="mt-2 text-sm font-semibold text-slate-500">Coba clear filter atau search keyword lain.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: typeof LayoutDashboard
  label: string
  value: number
  tone?: "neutral" | "danger" | "warning"
}) {
  return (
    <div
      className={cn(
        "rounded-[28px] p-5 shadow-xl shadow-slate-900/5",
        tone === "danger"
          ? "bg-red-500 text-white"
          : tone === "warning"
            ? "bg-amber-300 text-slate-950"
            : "bg-white text-slate-950 dark:bg-white/[0.06] dark:text-white"
      )}
    >
      <Icon className="h-5 w-5" />
      <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] opacity-60">{label}</p>
      <p className="mt-1 text-4xl font-black tracking-[-0.06em]">{value}</p>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  labelFor = (option: string) => option,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  labelFor?: (option: string) => string
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-2xl border-0 bg-slate-100 px-3 text-xs font-black outline-none ring-1 ring-transparent transition focus:ring-slate-950 dark:bg-white/10 dark:focus:ring-white"
      >
        <option value="ALL">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labelFor(option)}
          </option>
        ))}
      </select>
    </label>
  )
}

function SummaryPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[30px] bg-white p-5 shadow-xl shadow-slate-900/5 dark:bg-white/[0.06]">
      <p className="mb-4 text-xs font-black uppercase tracking-[0.22em] text-slate-400">{title}</p>
      <div className="grid gap-2">{children}</div>
    </div>
  )
}

function SummaryRow({
  title,
  meta,
  value,
  warning,
  color,
}: {
  title: string
  meta: string
  value: string
  warning: string
  color?: string
}) {
  return (
    <div className="rounded-2xl bg-slate-100 p-3 dark:bg-white/10">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black">
            {color && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />}
            {title}
          </p>
          <p className="mt-1 truncate text-[11px] font-semibold text-slate-500 dark:text-white/45">{meta}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-black">{value}</p>
          <p className={cn("text-[10px] font-black uppercase tracking-[0.12em]", warning === "clear" ? "text-emerald-600" : "text-red-500")}>
            {warning}
          </p>
        </div>
      </div>
    </div>
  )
}

function TaskTableRow({ task }: { task: OpsDashboardTask }) {
  const overdue = isOverdue(task)
  return (
    <tr className={cn("text-sm font-semibold", overdue && "bg-red-50/80 dark:bg-red-950/20")}>
      <td className="max-w-[360px] px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: task.project.color }} />
          <div className="min-w-0">
            <p className="truncate font-black">{task.title}</p>
            <p className="mt-1 text-[11px] font-bold text-slate-400">Updated {formatDate(task.updatedAt)}</p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <p className="text-xs font-black text-slate-400">{task.project.division}</p>
        <Link
          href={`/projects/${task.project.id}`}
          className="inline-flex items-center gap-1 font-black hover:underline"
        >
          {task.project.name}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </td>
      <td className="px-5 py-4 text-slate-500 dark:text-white/55">{task.taskListName}</td>
      <td className="px-5 py-4">
        <AssigneeStack assignees={task.assignees} />
      </td>
      <td className="px-5 py-4">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] dark:bg-white/10">
          {STATUS_LABELS[task.status]}
        </span>
      </td>
      <td className="px-5 py-4">
        <span className={cn("rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em]", priorityStyles[task.priority])}>
          {PRIORITY_LABELS[task.priority]}
        </span>
      </td>
      <td className="px-5 py-4">
        <div className={cn("inline-flex items-center gap-2 rounded-2xl px-3 py-2", overdue ? "bg-red-500 text-white" : "bg-slate-100 dark:bg-white/10")}>
          <Clock3 className="h-3.5 w-3.5" />
          <div>
            <p className="text-xs font-black">{formatDate(task.dueDate)}</p>
            {overdue && <p className="text-[10px] font-black uppercase tracking-[0.12em]">{overdueDays(task.dueDate)} days late</p>}
          </div>
        </div>
      </td>
    </tr>
  )
}

function TaskMobileCard({ task }: { task: OpsDashboardTask }) {
  const overdue = isOverdue(task)
  return (
    <article className={cn("rounded-[26px] p-4", overdue ? "bg-red-50 dark:bg-red-950/25" : "bg-slate-100 dark:bg-white/10")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{task.project.division}</p>
          <h3 className="mt-1 text-lg font-black leading-tight">{task.title}</h3>
          <Link href={`/projects/${task.project.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-black text-slate-500">
            {task.project.name}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: task.project.color }} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600 dark:bg-white/10 dark:text-white">
          {STATUS_LABELS[task.status]}
        </span>
        <span className={cn("rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em]", priorityStyles[task.priority])}>
          {PRIORITY_LABELS[task.priority]}
        </span>
        <span className={cn("rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em]", overdue ? "bg-red-500 text-white" : "bg-white text-slate-600 dark:bg-white/10 dark:text-white")}>
          {overdue ? `${overdueDays(task.dueDate)} days late` : formatDate(task.dueDate)}
        </span>
      </div>
      <div className="mt-4">
        <AssigneeStack assignees={task.assignees} />
      </div>
    </article>
  )
}

function AssigneeStack({ assignees }: { assignees: OpsDashboardTask["assignees"] }) {
  if (assignees.length === 0) {
    return <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Unassigned</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {assignees.slice(0, 3).map((assignee) => (
        <span key={assignee.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-1 pr-3 text-xs font-black dark:bg-white/10">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-950 text-[10px] text-white dark:bg-white dark:text-slate-950">
            {initials(assignee.name)}
          </span>
          {assignee.name}
        </span>
      ))}
      {assignees.length > 3 && (
        <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black dark:bg-white/10">+{assignees.length - 3}</span>
      )}
    </div>
  )
}

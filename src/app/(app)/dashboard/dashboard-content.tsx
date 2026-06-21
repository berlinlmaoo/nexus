"use client"

import { useEffect, useState, useCallback } from "react"
import { DashboardSkeleton } from "@/components/ui/skeleton"
import {
  Plus,
  Loader2,
  ArrowRight,
  CheckCircle2,
  Circle,
  CheckCircle,
  Flame,
  Sparkles,
  Target,
  Trophy,
  ShieldCheck,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { UserAvatar } from "@/components/ui/user-avatar"

interface DashboardData {
  tasks: Array<{
    id: string
    title: string
    status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
    dueDate: string | null
    project: { id: string; name: string; color: string }
  }>
  projects: Array<{
    id: string
    name: string
    color: string
    progress: number
  }>
  activity: Array<{
    id: string
    action: string
    details: string | null
    createdAt: string
    user: { name: string; avatar: string | null }
    task?: { title: string }
    project?: { name: string }
  }>
}

interface ProjectOption {
  id: string
  name: string
  color: string
}

const getGreeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

const statusTone: Record<DashboardData["tasks"][number]["status"], string> = {
  TODO: "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200",
  IN_PROGRESS: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200",
  IN_REVIEW: "bg-blue-100 text-blue-800 dark:bg-blue-400/15 dark:text-blue-200",
  DONE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  CANCELLED: "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200",
}

const statusLabel: Record<DashboardData["tasks"][number]["status"], string> = {
  TODO: "Pending",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "Review",
  DONE: "Done",
  CANCELLED: "Cancelled",
}

function getDevelopmentDashboardData(): DashboardData {
  const now = new Date()
  return {
    tasks: [
      {
        id: "demo-task-1",
        title: "Finalize Q2 roadmap",
        status: "DONE",
        dueDate: now.toISOString(),
        project: { id: "demo-project-1", name: "Strategy", color: "#059669" },
      },
      {
        id: "demo-task-2",
        title: "Review campaign performance",
        status: "IN_PROGRESS",
        dueDate: now.toISOString(),
        project: { id: "demo-project-2", name: "Growth", color: "#f59e0b" },
      },
      {
        id: "demo-task-3",
        title: "Align team on OKRs",
        status: "TODO",
        dueDate: null,
        project: { id: "demo-project-3", name: "Operations", color: "#2563eb" },
      },
      {
        id: "demo-task-4",
        title: "Update investor deck",
        status: "DONE",
        dueDate: null,
        project: { id: "demo-project-4", name: "Finance", color: "#10b981" },
      },
      {
        id: "demo-task-5",
        title: "Customer feedback analysis",
        status: "IN_PROGRESS",
        dueDate: null,
        project: { id: "demo-project-5", name: "Product", color: "#7c3aed" },
      },
    ],
    projects: [
      { id: "demo-project-1", name: "Growth", color: "#059669", progress: 75 },
      { id: "demo-project-2", name: "Product", color: "#2563eb", progress: 60 },
      { id: "demo-project-3", name: "Operations", color: "#64748b", progress: 65 },
      { id: "demo-project-4", name: "Finance", color: "#f59e0b", progress: 70 },
    ],
    activity: [
      {
        id: "demo-activity-1",
        action: "completed",
        details: null,
        createdAt: now.toISOString(),
        user: { name: "Jamie Lee", avatar: null },
        task: { title: "Finalize Q2 roadmap" },
      },
      {
        id: "demo-activity-2",
        action: "commented on",
        details: null,
        createdAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        user: { name: "Sam Carter", avatar: null },
        task: { title: "Campaign Performance Update" },
      },
      {
        id: "demo-activity-3",
        action: "updated project",
        details: null,
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        user: { name: "Taylor Kim", avatar: null },
        project: { name: "Mobile App Redesign" },
      },
    ],
  }
}

export function DashboardContent({ userName }: { userName: string }) {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState("")
  const [selectedProject, setSelectedProject] = useState("")
  const [selectedTaskList, setSelectedTaskList] = useState("")
  const [taskPriority, setTaskPriority] = useState("MEDIUM")
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectTaskLists, setProjectTaskLists] = useState<Record<string, Array<{ id: string; name: string }>>>({})
  const [taskListsLoading, setTaskListsLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())
  const isDemoId = (id: string) => id.startsWith("demo-")

  useEffect(() => {
    fetch("/api/dashboard", { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) {
          window.location.assign("/login")
          return null
        }
        if (!res.ok) throw new Error("Failed to fetch")
        return res.json()
      })
      .then((json) => {
        if (json) setData(json)
      })
      .catch((err) => {
        console.error("Dashboard fetch error:", err)
        if (process.env.NODE_ENV !== "production") {
          setData(getDevelopmentDashboardData())
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const openQuickCreate = useCallback(async () => {
    setQuickCreateOpen(true)
    setTaskTitle("")
    setSelectedProject("")
    setSelectedTaskList("")
    setTaskPriority("MEDIUM")

    if (projects.length > 0) {
      return
    }

    try {
      const res = await fetch("/api/projects")
      if (res.ok) {
        const data = await res.json()
        const projectList = Array.isArray(data) ? data : data.projects ?? []
        setProjects(projectList.slice(0, 20))
      }
    } catch {
      setProjects([])
    }
  }, [projects.length])

  useEffect(() => {
    if (!quickCreateOpen || !selectedProject || projectTaskLists[selectedProject]) return

    const controller = new AbortController()
    let cancelled = false

    setTaskListsLoading(true)

    fetch(`/api/projects/${selectedProject}/task-lists`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((taskLists) => {
        if (cancelled) return

        setProjectTaskLists((prev) => ({
          ...prev,
          [selectedProject]: Array.isArray(taskLists) ? taskLists : [],
        }))
      })
      .catch((error) => {
        if (cancelled || error instanceof DOMException) return

        setProjectTaskLists((prev) => ({
          ...prev,
          [selectedProject]: [],
        }))
      })
      .finally(() => {
        if (!cancelled) {
          setTaskListsLoading(false)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [projectTaskLists, quickCreateOpen, selectedProject])

  const createTask = useCallback(async () => {
    if (!taskTitle.trim() || !selectedTaskList) return
    setCreating(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle.trim(),
          taskListId: selectedTaskList,
          priority: taskPriority,
          status: "TODO",
        }),
      })
      if (res.ok) {
        setQuickCreateOpen(false)
        const dashRes = await fetch("/api/dashboard")
        if (dashRes.ok) {
          const json = await dashRes.json()
          setData(json)
        }
      }
    } catch (err) {
      console.error("Failed to create task:", err)
    } finally {
      setCreating(false)
    }
  }, [taskTitle, selectedTaskList, taskPriority])

  const markProjectDirty = useCallback((projectId: string) => {
    if (typeof window === "undefined") return

    const key = `nexus-project-dirty:${projectId}`
    const value = String(Date.now())

    try {
      localStorage.setItem(key, value)
      window.dispatchEvent(new CustomEvent("nexus:project-dirty", { detail: { projectId, value } }))
    } catch {}
  }, [])

  const completeDashboardTask = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const task = data?.tasks.find((entry) => entry.id === taskId)
    if (!task) return

    setCompletingIds((prev) => new Set(prev).add(taskId))

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      })

      if (!res.ok) {
        throw new Error("Failed to complete task")
      }

      markProjectDirty(task.project.id)
      router.refresh()

      setTimeout(() => {
        setData((prev) => {
          if (!prev) return prev

          return {
            ...prev,
            tasks: prev.tasks.filter((task) => task.id !== taskId),
          }
        })

        setCompletingIds((prev) => {
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }, 450)
    } catch (error) {
      console.error("Failed to complete dashboard task:", error)
      setCompletingIds((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }, [data?.tasks, markProjectDirty, router])

  const selectedProjectTaskLists = selectedProject ? (projectTaskLists[selectedProject] ?? []) : []
  const greeting = getGreeting()
  const tasks = data?.tasks ?? []
  const projectsData = data?.projects ?? []
  const activity = data?.activity ?? []
  const activeTasks = tasks.filter((task) => task.status !== "DONE" && task.status !== "CANCELLED")
  const reviewTasks = tasks.filter((task) => task.status === "IN_REVIEW").length
  const averageProgress = projectsData.length
    ? Math.round(projectsData.reduce((sum, project) => sum + project.progress, 0) / projectsData.length)
    : 0
  const focusScore = Math.min(100, Math.max(12, 100 - activeTasks.length * 7 + reviewTasks * 3))
  const completedTasks = tasks.filter((task) => task.status === "DONE").length
  const missionTotal = Math.max(tasks.length, 10)
  const missionProgress = Math.round((completedTasks / missionTotal) * 100)
  const weeklyTarget = Math.min(100, Math.max(25, averageProgress || focusScore))

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="mx-auto max-w-6xl animate-fade-in space-y-5 pb-24 [content-visibility:auto] sm:space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-3xl font-black leading-tight tracking-tight text-primary sm:text-4xl">
            {greeting}, {userName}.
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-on-surface-variant/75">
            Let&apos;s complete your missions and move the strategy forward.
          </p>
        </div>
        <Button
          onClick={openQuickCreate}
          className="h-12 w-full rounded-md bg-emerald-600 px-5 text-xs font-black tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-emerald-700 sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          Create Task
        </Button>
      </div>

      <section className="rounded-lg border border-on-surface-variant/10 bg-surface-container-lowest shadow-sm">
        <div className="grid divide-y divide-on-surface-variant/10 md:grid-cols-4 md:divide-x md:divide-y-0">
          {[
            {
              icon: ShieldCheck,
              label: "Mission status",
              value: `${completedTasks} / ${missionTotal}`,
              detail: "Completed",
              tone: "text-emerald-600",
              bar: missionProgress,
            },
            {
              icon: Zap,
              label: "XP earned",
              value: focusScore * 32,
              detail: `+${Math.max(25, activeTasks.length * 15)} XP today`,
              tone: "text-emerald-600",
              bar: null,
            },
            {
              icon: Flame,
              label: "Current streak",
              value: Math.max(1, reviewTasks + 3),
              detail: "days",
              tone: "text-amber-500",
              bar: null,
            },
            {
              icon: Target,
              label: "Weekly target",
              value: `${weeklyTarget}%`,
              detail: weeklyTarget > 70 ? "On track" : "Needs focus",
              tone: "text-primary",
              bar: null,
            },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-4 p-4 sm:p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-on-surface-variant/10 bg-surface-container-low text-primary">
                <item.icon className={cn("h-6 w-6", item.tone)} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-on-surface-variant/65">{item.label}</p>
                <div className="mt-1 flex items-end gap-2">
                  <p className="text-xl font-black leading-none text-primary">{item.value}</p>
                  <p className={cn("text-xs font-bold", item.tone)}>{item.detail}</p>
                </div>
                {item.bar !== null && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-high">
                    <div className="h-full rounded-full bg-emerald-600" style={{ width: `${item.bar}%` }} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-12 gap-5">
        <section className="col-span-12 rounded-lg border border-on-surface-variant/10 bg-surface-container-lowest p-4 shadow-sm sm:p-5 lg:col-span-5">
          <div className="mb-4 flex items-center justify-between border-b border-on-surface-variant/10 pb-4">
            <div>
              <h3 className="text-base font-black uppercase tracking-tight text-primary">Daily objectives</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-black text-primary">{completedTasks} / {Math.max(tasks.length, 6)}</span>
              <Link href="/my-tasks" className="hidden text-xs font-black text-emerald-700 hover:text-emerald-800 sm:inline-flex">
                View all tasks <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="divide-y divide-on-surface-variant/10">
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-on-surface-variant/20 bg-surface-container-low/40 px-4 py-12 text-center">
                <Sparkles className="mx-auto mb-3 h-6 w-6 text-emerald-500" />
                <p className="text-sm font-black text-primary">Mission board is clear.</p>
                <p className="mt-1 text-xs font-medium text-on-surface-variant/60">Create a new objective when you are ready to move.</p>
              </div>
            ) : (
              tasks.slice(0, 5).map((task) => {
                const isCompleting = completingIds.has(task.id)

                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "group py-4 transition-colors sm:px-1",
                      isDemoId(task.id) || isDemoId(task.project.id)
                        ? "cursor-default"
                        : "cursor-pointer hover:bg-surface-container-low/50",
                      isCompleting && "opacity-60"
                    )}
                    onClick={() => {
                      if (!isDemoId(task.id) && !isDemoId(task.project.id)) {
                        router.push(`/projects/${task.project.id}?task=${task.id}`)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        if (!isDemoId(task.id) && !isDemoId(task.project.id)) {
                          router.push(`/projects/${task.project.id}?task=${task.id}`)
                        }
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => completeDashboardTask(task.id, e)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-on-surface-variant/25 bg-surface-container-lowest text-on-surface-variant/60 transition-all hover:border-emerald-600 hover:text-emerald-600"
                        aria-label={isCompleting ? "Task completed" : `Mark ${task.title} as done`}
                      >
                        {isCompleting ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className={cn("truncate text-sm font-bold leading-snug text-on-surface", isCompleting && "line-through text-on-surface-variant/50")}>
                              {task.title}
                            </h4>
                            <div className="mt-1 flex min-w-0 items-center gap-1.5">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.project.color }} />
                              <span className="truncate text-xs font-medium text-on-surface-variant">{task.project.name}</span>
                            </div>
                          </div>
                          <span className={cn("rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]", statusTone[task.status])}>
                            {statusLabel[task.status]}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <Link href="/my-tasks" className="mt-4 inline-flex items-center text-xs font-black text-emerald-700 hover:text-emerald-800 sm:hidden">
            View all tasks <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </section>

        <section className="col-span-12 flex flex-col gap-5 lg:col-span-7">
          <div className="rounded-lg border border-on-surface-variant/10 bg-surface-container-lowest p-4 shadow-sm sm:p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-black uppercase tracking-tight text-primary">Strategy map</h3>
                <p className="mt-1 text-xs font-medium text-on-surface-variant">Overall progress</p>
              </div>
              <Link href="/projects" className="hidden text-xs font-black text-emerald-700 hover:text-emerald-800 sm:inline-flex">
                View full map <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="mb-5 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${averageProgress}%` }} />
              </div>
              <span className="text-lg font-black text-emerald-700">{averageProgress}%</span>
            </div>
            <div className="relative h-40 overflow-hidden rounded-lg border border-on-surface-variant/10 bg-[linear-gradient(135deg,rgba(16,185,129,0.06),rgba(14,165,233,0.04))] sm:h-52">
              <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.12)_1px,transparent_0)] [background-size:22px_22px]" />
              <div className="absolute left-[8%] top-[58%] h-px w-[84%] border-t-2 border-dashed border-primary/25" />
              {[
                ["left-[12%] top-[60%]", true],
                ["left-[28%] top-[44%]", true],
                ["left-[46%] top-[28%]", averageProgress > 45],
                ["left-[66%] top-[50%]", averageProgress > 65],
                ["left-[84%] top-[36%]", averageProgress > 85],
              ].map(([position, reached], index) => (
                <div
                  key={index}
                  className={cn(
                    "absolute flex h-9 w-9 items-center justify-center rounded-full border-4 border-surface-container-lowest shadow-sm",
                    position,
                    reached ? "bg-emerald-600 text-white" : "bg-amber-400 text-primary"
                  )}
                >
                  {reached ? <CheckCircle2 className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {projectsData.slice(0, 4).map((project) => {
                const content = (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase text-on-surface-variant">{project.name}</span>
                    <span className="text-sm font-black text-primary">{Math.round(project.progress)}%</span>
                  </>
                )

                return isDemoId(project.id) ? (
                  <div key={project.id} className="flex items-center gap-2 border-r border-on-surface-variant/10 last:border-r-0">
                    {content}
                  </div>
                ) : (
                  <Link key={project.id} href={`/projects/${project.id}`} className="group flex items-center gap-2 border-r border-on-surface-variant/10 last:border-r-0">
                    {content}
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-on-surface-variant/10 bg-surface-container-lowest p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-black uppercase tracking-tight text-primary">AI Intel</h3>
              <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-700">Insight</span>
            </div>
            <h4 className="text-sm font-black text-primary">Opportunity identified in today&apos;s planning</h4>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-on-surface-variant">
              Start with the objective closest to its due date, then clear review items while context is still warm.
            </p>
            <Link href="/my-tasks" className="mt-4 inline-flex items-center text-xs font-black text-emerald-700 hover:text-emerald-800">
              View full insight <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </div>
        </section>

        <section className="col-span-12 rounded-lg border border-on-surface-variant/10 bg-surface-container-lowest p-4 shadow-sm sm:p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black uppercase tracking-tight text-primary">Activity stream</h3>
            </div>
            <div className="hidden -space-x-2 sm:flex">
              {activity.slice(0, 4).map((item, i) => (
                <div key={`${item.id}-${i}`} className="rounded-full ring-4 ring-surface-container-lowest">
                  <UserAvatar user={{ name: item.user.name, image: item.user.avatar }} size="sm" />
                </div>
              ))}
            </div>
          </div>

          <div className="divide-y divide-on-surface-variant/10">
            {activity.slice(0, 6).map((act) => (
              <div key={act.id} className="py-3">
                <div className="flex gap-3">
                  <UserAvatar user={{ name: act.user.name, image: act.user.avatar }} size="sm" className="shrink-0" />
                  <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[140px_1fr_auto] sm:items-center">
                    <span className="text-sm font-black text-primary">{act.user.name}</span>
                    <p className="text-sm leading-5 text-on-surface">
                      <span className="font-medium text-on-surface-variant/70">{act.action}</span>{" "}
                      <span className="font-black text-emerald-700">{act.task?.title || act.project?.name}</span>
                    </p>
                    <p className="text-[10px] font-bold text-on-surface-variant/55">
                      {new Date(act.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Quick Create Task Dialog */}
      <Dialog open={quickCreateOpen} onOpenChange={setQuickCreateOpen}>
        <DialogContent className="max-w-md rounded-[28px] border-none bg-surface-container-lowest p-5 shadow-2xl sm:rounded-[32px] sm:p-8">
          <DialogHeader>
            <DialogTitle className="font-headline font-black text-2xl text-primary tracking-tight">Initiate Objective</DialogTitle>
            <p className="text-xs font-medium text-on-surface-variant/60">Define a new protocol for the workspace.</p>
          </DialogHeader>
          <div className="space-y-6 pt-4 sm:space-y-8 sm:pt-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 block ml-1">Objective Designation</label>
              <Input
                placeholder="Designate task title..."
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && taskTitle.trim() && selectedTaskList) createTask() }}
                className="bg-surface-container-low border-none rounded-2xl focus:ring-2 focus:ring-primary/5 transition-all h-14 px-5 text-sm font-bold text-on-surface placeholder:text-on-surface-variant/20"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 block ml-1">Project Node</label>
                <select
                  value={selectedProject}
                  onChange={(e) => {
                    setSelectedProject(e.target.value)
                    setSelectedTaskList("")
                  }}
                  className="w-full h-14 rounded-2xl bg-surface-container-low border-none px-4 text-sm font-bold text-on-surface focus:ring-2 focus:ring-primary/5 outline-none appearance-none cursor-pointer"
                >
                  <option value="" className="bg-surface-container-lowest text-on-surface">Select node...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-surface-container-lowest text-on-surface">{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 block ml-1">Sector/List</label>
                <select
                  value={selectedTaskList}
                  onChange={(e) => setSelectedTaskList(e.target.value)}
                  disabled={!selectedProject || taskListsLoading}
                  className="w-full h-14 rounded-2xl bg-surface-container-low border-none px-4 text-sm font-bold text-on-surface focus:ring-2 focus:ring-primary/5 outline-none appearance-none disabled:opacity-30 cursor-pointer"
                >
                  <option value="" className="bg-surface-container-lowest text-on-surface">
                    {taskListsLoading ? "Loading sectors..." : "Select sector..."}
                  </option>
                  {selectedProjectTaskLists.map((tl) => (
                    <option key={tl.id} value={tl.id} className="bg-surface-container-lowest text-on-surface">{tl.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 block ml-1">Priority Protocol</label>
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-container-low p-1.5 sm:flex">
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setTaskPriority(p)}
                    className={cn(
                      "rounded-xl py-2.5 text-[9px] font-black uppercase tracking-widest transition-all duration-300 sm:flex-1",
                      taskPriority === p
                        ? "bg-primary text-primary-foreground shadow-xl shadow-primary/20 scale-105"
                        : "text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-high"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <Button
              onClick={createTask}
              disabled={creating || !taskTitle.trim() || !selectedTaskList}
              className="w-full bg-primary text-primary-foreground h-16 rounded-[24px] font-black uppercase tracking-[0.2em] text-xs hover:shadow-2xl hover:shadow-primary/30 transition-all group"
            >
              {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <span className="flex items-center gap-2">
                  Synchronize Task
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

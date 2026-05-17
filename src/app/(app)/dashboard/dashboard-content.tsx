"use client"

import { useEffect, useState, useCallback } from "react"
import { DashboardSkeleton } from "@/components/ui/skeleton"
import { Plus, X, Loader2, ArrowRight, CheckCircle2, Calendar, Circle, CheckCircle } from "lucide-react"
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
import { StatusBadge } from "@/components/tasks/status-badge"
import { format } from "date-fns"

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
      .catch((err) => console.error("Dashboard fetch error:", err))
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

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 animate-fade-in pb-24 [content-visibility:auto] sm:space-y-12">
      {/* Header Section */}
      <div className="flex flex-col justify-between gap-4 sm:gap-6 md:flex-row md:items-end">
        <div className="space-y-2">
          <h2 className="text-3xl font-headline font-black leading-none tracking-tight text-primary sm:text-4xl">
            {greeting}, <span className="text-primary/40">{userName}.</span>
          </h2>
          <p className="text-sm font-medium leading-relaxed text-on-surface-variant/60 sm:text-lg">
            Operational status: <span className="text-green-600 font-bold uppercase tracking-wider text-xs">Active</span> • 4 critical nodes requiring attention.
          </p>
        </div>
        <Button
          onClick={openQuickCreate}
          className="group h-12 w-full rounded-xl bg-primary px-5 text-[11px] font-black uppercase tracking-widest text-primary-foreground shadow-lg transition-all duration-300 hover:translate-y-[-2px] hover:opacity-90 hover:shadow-2xl sm:h-14 sm:w-auto sm:rounded-2xl sm:px-8 sm:text-xs"
        >
          <Plus className="h-4 w-4 mr-2 transition-transform group-hover:rotate-90" />
          Initiate Task
        </Button>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-12 gap-4 sm:gap-8">
        {/* Today's Tasks */}
        <section className="col-span-12 rounded-[28px] border border-on-surface-variant/5 bg-surface-container-lowest p-4 shadow-2xl shadow-primary/5 sm:rounded-[32px] sm:p-8 lg:col-span-7">
          <div className="mb-6 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-tertiary-new/5 text-tertiary-new sm:h-12 sm:w-12">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-headline font-black tracking-tight text-primary sm:text-xl">Active Protocol</h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">Today's Objectives</p>
              </div>
            </div>
            <Link href="/my-tasks" className="inline-flex w-full items-center justify-center rounded-full bg-surface-container-low px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary/40 transition-colors hover:text-primary sm:w-auto">View All</Link>
          </div>
          
          <div className="space-y-2">
            {data?.tasks.length === 0 ? (
              <div className="py-12 text-center text-on-surface-variant/40 italic font-medium text-sm">System clear. No pending objectives for this cycle.</div>
            ) : (
              data?.tasks.slice(0, 5).map((task) => {
                const isCompleting = completingIds.has(task.id)

                return (
                <div 
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group block cursor-pointer rounded-2xl border border-transparent bg-surface-container-low/30 p-4 transition-all duration-300 hover:border-on-surface-variant/5 hover:bg-surface-container-low sm:px-6 sm:py-4",
                    isCompleting && "opacity-60"
                  )}
                  onClick={() => {
                    router.push(`/projects/${task.project.id}?task=${task.id}`)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      router.push(`/projects/${task.project.id}?task=${task.id}`)
                    }
                  }}
                >
                  <div className="flex items-start gap-3 sm:items-center">
                    <button
                      onClick={(e) => completeDashboardTask(task.id, e)}
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 border-on-surface-variant/20 bg-surface-container-lowest text-on-surface-variant/60 shadow-sm transition-all hover:border-emerald-500 hover:text-emerald-500 sm:mt-0"
                      aria-label={isCompleting ? "Task completed" : `Mark ${task.title} as done`}
                    >
                      {isCompleting ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <span className={cn(
                        "mb-0.5 block truncate text-sm font-bold text-on-surface transition-all",
                        isCompleting && "line-through text-on-surface-variant/50"
                      )}>{task.title}</span>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: task.project.color }} />
                          <span className="truncate text-[10px] font-black uppercase tracking-wider text-on-surface-variant/60">{task.project.name}</span>
                        </div>
                        {task.dueDate && (
                          <div className="flex items-center gap-1 text-on-surface-variant/30">
                            <span className="text-[10px] font-black tracking-widest">•</span>
                            <Calendar className="h-3 w-3" />
                            <span className="text-[10px] font-bold uppercase tracking-wider">{format(new Date(task.dueDate), "MMM d")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between sm:mt-4">
                    <StatusBadge status={task.status} className="border-none bg-surface-container-high" />
                    <ArrowRight className="h-4 w-4 text-on-surface-variant/20 transition-all group-hover:translate-x-1 group-hover:opacity-100 sm:opacity-0" />
                  </div>
                </div>
              )})
            )}
          </div>
        </section>

        {/* Projects / Recent Docs Style */}
        <section className="col-span-12 lg:col-span-5 flex flex-col gap-6">
          <div className="group relative overflow-hidden rounded-[28px] bg-primary p-5 text-primary-foreground shadow-xl sm:rounded-[32px] sm:p-8">
            <div className="absolute top-[-20%] right-[-10%] w-48 h-48 rounded-full bg-primary-foreground/10 blur-[60px] group-hover:scale-125 transition-transform duration-700" />
            <div className="relative z-10">
              <h3 className="mb-2 text-xl font-headline font-black tracking-tight sm:text-2xl">Strategy Map</h3>
              <p className="mb-6 text-sm font-medium text-primary-foreground/60 sm:mb-8">Synchronized project infrastructure.</p>
              
              <div className="space-y-4">
                {data?.projects.slice(0, 3).map((project) => (
                  <Link 
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="block group/item"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold tracking-tight group-hover/item:translate-x-1 transition-transform">{project.name}</span>
                      <span className="text-[10px] font-black opacity-40">{Math.round(project.progress)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-primary-foreground/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary-foreground transition-all duration-1000 ease-out"
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
              
              <Button variant="outline" className="mt-8 h-11 w-full rounded-xl border-none bg-primary-foreground text-[10px] font-black uppercase tracking-widest text-primary shadow-sm hover:bg-primary-foreground/90 sm:h-10">
                Nexus Overview
              </Button>
            </div>
          </div>

          <div className="flex-1 rounded-[28px] border border-on-surface-variant/5 bg-surface-container-low p-5 sm:rounded-[32px] sm:p-8">
             <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Gideon Intel</h3>
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
             </div>
             <div className="rounded-2xl border border-on-surface-variant/5 bg-surface-container-highest/50 p-4">
                <p className="text-xs text-primary font-medium leading-relaxed italic">
                  "Operative, I've noticed a pattern in your late-night executions. Consider front-loading 'Strategy' tasks for 15% better efficiency."
                </p>
                <p className="mt-3 text-[10px] font-black text-primary/40 uppercase tracking-widest">— Gideon AI</p>
             </div>
          </div>
        </section>

        {/* Activity Feed */}
        <section className="col-span-12 rounded-[28px] border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-2xl shadow-primary/5 sm:rounded-[32px] sm:p-10">
          <div className="mb-8 flex flex-col gap-4 sm:mb-12 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-headline font-black tracking-tight text-primary sm:text-2xl">Intelligence Stream</h3>
              <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">Real-time collaboration node</p>
            </div>
            <div className="hidden -space-x-3 sm:flex">
              {data?.activity.slice(0, 4).map((a, i) => (
                <div key={i} className="ring-4 ring-surface-container-lowest rounded-full transition-transform hover:translate-y-[-4px] hover:z-10 cursor-pointer">
                  <UserAvatar 
                    user={{ name: a.user.name, image: a.user.avatar }}
                    size="sm"
                  />
                </div>
              ))}
              <div className="w-8 h-8 rounded-full ring-4 ring-surface-container-lowest bg-surface-container-low flex items-center justify-center text-[10px] font-black text-primary/40">
                +{data?.activity.length ?? 0}
              </div>
            </div>
          </div>
          
          <div className="relative space-y-6 sm:space-y-12 sm:pl-10">
            <div className="absolute bottom-2 left-[15px] top-2 hidden w-[2px] bg-gradient-to-b from-primary/20 via-primary/5 to-transparent sm:block" />
            
            {data?.activity.slice(0, 5).map((act) => (
              <div key={act.id} className="relative group">
                <div className="absolute -left-[32px] top-1.5 z-10 hidden h-4 w-4 rounded-full border-2 border-primary bg-surface-container-lowest shadow-sm transition-transform group-hover:scale-125 sm:block"></div>
                <div className="flex gap-3 sm:gap-6">
                  <UserAvatar user={{ name: act.user.name, image: act.user.avatar }} size="sm" className="shadow-lg shadow-primary/5" />
                  <div className="space-y-2 flex-1">
                    <p className="text-sm leading-tight text-on-surface">
                      <span className="font-black text-primary uppercase tracking-tight mr-1">{act.user.name}</span>{" "}
                      <span className="text-on-surface-variant/60 font-medium">{act.action}</span>{" "}
                      <span className="inline-flex rounded-md bg-surface-container-low px-2 py-0.5 font-bold text-primary">{act.task?.title || act.project?.name}</span>
                    </p>
                    {act.details && (
                      <div className="mt-2 max-w-2xl rounded-xl border border-on-surface-variant/5 bg-surface-container-low/50 p-3 transition-colors group-hover:bg-surface-container-low sm:mt-3 sm:rounded-2xl sm:p-4">
                        <p className="text-xs text-on-surface-variant font-medium leading-relaxed italic opacity-80">{act.details}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-on-surface-variant/40 font-black uppercase tracking-widest">
                        {new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[9px] text-on-surface-variant/20">•</span>
                      <span className="text-[9px] text-on-surface-variant/40 font-black uppercase tracking-widest">Encrypted Signal</span>
                    </div>
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

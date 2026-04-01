"use client"

import { useEffect, useState, useCallback } from "react"
import { WidgetGrid } from "@/components/dashboard/widget-grid"
import { DashboardSkeleton } from "@/components/ui/skeleton"
import { Plus, X, Loader2, ArrowRight, CheckCircle2, Calendar } from "lucide-react"
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
import { UserAvatar } from "@/components/ui/user-avatar"
import { StatusBadge } from "@/components/tasks/status-badge"
import { format } from "date-fns"

interface DashboardData {
  tasks: Array<{
    id: string
    title: string
    status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
    dueDate: string | null
    project: { name: string; color: string }
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
  taskLists: Array<{ id: string; name: string }>
}

const getGreeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

export function DashboardContent({ userName }: { userName: string }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState("")
  const [selectedProject, setSelectedProject] = useState("")
  const [selectedTaskList, setSelectedTaskList] = useState("")
  const [taskPriority, setTaskPriority] = useState("MEDIUM")
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [creating, setCreating] = useState(false)

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
    try {
      const res = await fetch("/api/projects")
      if (res.ok) {
        const data = await res.json()
        const projectList = Array.isArray(data) ? data : data.projects ?? []
        const withTaskLists = await Promise.all(
          projectList.slice(0, 20).map(async (p: { id: string; name: string; color: string }) => {
            try {
              const tlRes = await fetch(`/api/projects/${p.id}/task-lists`)
              const tls = tlRes.ok ? await tlRes.json() : []
              return { ...p, taskLists: Array.isArray(tls) ? tls : [] }
            } catch {
              return { ...p, taskLists: [] }
            }
          })
        )
        setProjects(withTaskLists)
      }
    } catch {
      setProjects([])
    }
  }, [])

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

  const selectedProjectData = projects.find((p) => p.id === selectedProject)
  const greeting = getGreeting()

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="max-w-7xl mx-auto space-y-12 animate-fade-in pb-20 [content-visibility:auto]">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h2 className="text-4xl font-headline font-black text-primary tracking-tight leading-none">
            {greeting}, <span className="text-primary/40">{userName}.</span>
          </h2>
          <p className="text-on-surface-variant/60 font-medium text-lg">
            Operational status: <span className="text-green-600 font-bold uppercase tracking-wider text-xs">Active</span> • 4 critical nodes requiring attention.
          </p>
        </div>
        <Button
          onClick={openQuickCreate}
          className="bg-primary text-primary-foreground hover:opacity-90 hover:shadow-2xl hover:translate-y-[-2px] transition-all duration-300 h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-xs group shadow-lg"
        >
          <Plus className="h-4 w-4 mr-2 transition-transform group-hover:rotate-90" />
          Initiate Task
        </Button>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-12 gap-8">
        {/* Today's Tasks */}
        <section className="col-span-12 lg:col-span-7 bg-surface-container-lowest p-8 rounded-[32px] shadow-2xl shadow-primary/5 border border-on-surface-variant/5">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-tertiary-new/5 flex items-center justify-center text-tertiary-new">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-headline font-black text-primary tracking-tight">Active Protocol</h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">Today's Objectives</p>
              </div>
            </div>
            <Link href="/my-tasks" className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/40 hover:text-primary transition-colors bg-surface-container-low px-4 py-2 rounded-full">View All</Link>
          </div>
          
          <div className="space-y-2">
            {data?.tasks.length === 0 ? (
              <div className="py-12 text-center text-on-surface-variant/40 italic font-medium text-sm">System clear. No pending objectives for this cycle.</div>
            ) : (
              data?.tasks.slice(0, 5).map((task) => (
                <div 
                  key={task.id}
                  className="flex items-center group py-4 px-6 bg-surface-container-low/30 hover:bg-surface-container-low transition-all duration-300 cursor-pointer rounded-2xl border border-transparent hover:border-on-surface-variant/5"
                >
                  <button className="w-6 h-6 rounded-lg border-2 border-on-surface-variant/20 mr-5 group-hover:border-primary transition-all flex items-center justify-center bg-surface-container-lowest shadow-sm">
                    <div className="w-2.5 h-2.5 rounded-sm bg-primary opacity-0 group-hover:opacity-100 transition-all scale-50 group-hover:scale-100" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-on-surface block truncate mb-0.5">{task.title}</span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: task.project.color }} />
                        <span className="text-[10px] text-on-surface-variant/60 font-black uppercase tracking-wider">{task.project.name}</span>
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
                  <div className="flex items-center gap-6 shrink-0">
                    <StatusBadge status={task.status} className="bg-surface-container-high border-none" />
                    <ArrowRight className="h-4 w-4 text-on-surface-variant/20 opacity-0 group-hover:opacity-100 transition-all group-hover:translate-x-1" />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Projects / Recent Docs Style */}
        <section className="col-span-12 lg:col-span-5 flex flex-col gap-6">
          <div className="bg-primary p-8 rounded-[32px] text-primary-foreground relative overflow-hidden group shadow-xl">
            <div className="absolute top-[-20%] right-[-10%] w-48 h-48 rounded-full bg-primary-foreground/10 blur-[60px] group-hover:scale-125 transition-transform duration-700" />
            <div className="relative z-10">
              <h3 className="text-2xl font-headline font-black tracking-tight mb-2">Strategy Map</h3>
              <p className="text-primary-foreground/60 text-sm font-medium mb-8">Synchronized project infrastructure.</p>
              
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
              
              <Button variant="outline" className="w-full mt-8 bg-primary-foreground text-primary border-none hover:bg-primary-foreground/90 rounded-xl font-black uppercase tracking-widest text-[10px] h-10 shadow-sm">
                Nexus Overview
              </Button>
            </div>
          </div>

          <div className="bg-surface-container-low p-8 rounded-[32px] border border-on-surface-variant/5 flex-1">
             <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Gideon Intel</h3>
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
             </div>
             <div className="p-4 rounded-2xl bg-surface-container-highest/50 border border-on-surface-variant/5">
                <p className="text-xs text-primary font-medium leading-relaxed italic">
                  "Operative, I've noticed a pattern in your late-night executions. Consider front-loading 'Strategy' tasks for 15% better efficiency."
                </p>
                <p className="mt-3 text-[10px] font-black text-primary/40 uppercase tracking-widest">— Gideon AI</p>
             </div>
          </div>
        </section>

        {/* Activity Feed */}
        <section className="col-span-12 bg-surface-container-lowest rounded-[32px] p-10 border border-on-surface-variant/5 shadow-2xl shadow-primary/5">
          <div className="flex items-center justify-between mb-12">
            <div>
              <h3 className="text-2xl font-headline font-black text-primary tracking-tight">Intelligence Stream</h3>
              <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">Real-time collaboration node</p>
            </div>
            <div className="flex -space-x-3">
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
          
          <div className="relative pl-10 space-y-12">
            <div className="absolute left-[15px] top-2 bottom-2 w-[2px] bg-gradient-to-b from-primary/20 via-primary/5 to-transparent" />
            
            {data?.activity.slice(0, 5).map((act) => (
              <div key={act.id} className="relative group">
                <div className="absolute -left-[32px] top-1.5 w-4 h-4 rounded-full bg-white border-2 border-primary shadow-sm z-10 transition-transform group-hover:scale-125"></div>
                <div className="flex gap-6">
                  <UserAvatar user={{ name: act.user.name, image: act.user.avatar }} size="sm" className="shadow-lg shadow-primary/5" />
                  <div className="space-y-2 flex-1">
                    <p className="text-sm text-on-surface leading-tight">
                      <span className="font-black text-primary uppercase tracking-tight mr-1">{act.user.name}</span>{" "}
                      <span className="text-on-surface-variant/60 font-medium">{act.action}</span>{" "}
                      <span className="font-bold text-primary bg-surface-container-low px-2 py-0.5 rounded-md">{act.task?.title || act.project?.name}</span>
                    </p>
                    {act.details && (
                      <div className="mt-3 bg-surface-container-low/50 p-4 rounded-2xl border border-on-surface-variant/5 max-w-2xl group-hover:bg-surface-container-low transition-colors">
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
        <DialogContent className="max-w-md rounded-[32px] border-none shadow-2xl p-8 bg-surface-container-lowest">
          <DialogHeader>
            <DialogTitle className="font-headline font-black text-2xl text-primary tracking-tight">Initiate Objective</DialogTitle>
            <p className="text-xs font-medium text-on-surface-variant/60">Define a new protocol for the workspace.</p>
          </DialogHeader>
          <div className="space-y-8 pt-6">
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
            <div className="grid grid-cols-2 gap-4">
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
                  disabled={!selectedProjectData}
                  className="w-full h-14 rounded-2xl bg-surface-container-low border-none px-4 text-sm font-bold text-on-surface focus:ring-2 focus:ring-primary/5 outline-none appearance-none disabled:opacity-30 cursor-pointer"
                >
                  <option value="" className="bg-surface-container-lowest text-on-surface">Select sector...</option>
                  {selectedProjectData?.taskLists.map((tl) => (
                    <option key={tl.id} value={tl.id} className="bg-surface-container-lowest text-on-surface">{tl.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 block ml-1">Priority Protocol</label>
              <div className="flex gap-2 p-1.5 bg-surface-container-low rounded-2xl">
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setTaskPriority(p)}
                    className={cn(
                      "flex-1 rounded-xl py-2.5 text-[9px] font-black uppercase tracking-widest transition-all duration-300",
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

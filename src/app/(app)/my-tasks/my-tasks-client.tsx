"use client"

import { useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { PriorityBadge } from "@/components/tasks/priority-badge"
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Plus,
  Loader2,
  Filter,
  ArrowUpDown,
} from "lucide-react"
import { format, isPast, isToday, isAfter, addDays, subDays } from "date-fns"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Button } from "@/components/ui/button"

interface Task {
  id: string
  title: string
  description: string | null
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
  dueDate: string | null
  createdAt: string
  tags: string[]
  position: number
  taskListId: string
  project: { id: string; name: string; color: string }
  assignees: { id: string; name: string; avatar: string | null }[]
}

interface ProjectInfo {
  id: string
  name: string
  color: string
  defaultTaskListId: string | null
}

type SortBy = "dueDate" | "priority" | "project" | "dateAdded"

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 }

function getSectionForTask(task: Task): string {
  const now = new Date()
  const sevenDaysFromNow = addDays(now, 7)
  if (!task.dueDate) return "No Due Date"
  const due = new Date(task.dueDate)
  if (isToday(due)) return "Today"
  if (isPast(due)) return "Overdue"
  if (isAfter(due, now) && !isAfter(due, sevenDaysFromNow)) return "Upcoming"
  return "Later"
}

function getRecentlyAssigned(task: Task): boolean {
  const sevenDaysAgo = subDays(new Date(), 7)
  return new Date(task.createdAt) > sevenDaysAgo
}

const SECTION_ORDER = ["Overdue", "Today", "Recently Assigned", "Upcoming", "Later", "No Due Date"]

export function MyTasksClient({ tasks, projects = [] }: { tasks: any[]; projects?: ProjectInfo[] }) {
  const router = useRouter()
  const [sortBy, setSortBy] = useState<SortBy>("dueDate")
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [completingTasks, setCompletingTasks] = useState<Set<string>>(new Set())
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(new Set())
  const [inlineAdding, setInlineAdding] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [newTaskProject, setNewTaskProject] = useState(projects[0]?.id || "")
  const [addingTask, setAddingTask] = useState(false)

  const typedTasks = tasks as Task[]
  const visibleTasks = useMemo(() => typedTasks.filter(t => !hiddenTasks.has(t.id)), [typedTasks, hiddenTasks])

  const sections = useMemo(() => {
    const grouped: Record<string, Task[]> = {}
    visibleTasks.forEach(task => {
      const section = getSectionForTask(task)
      if (!grouped[section]) grouped[section] = []
      grouped[section].push(task)
      if (getRecentlyAssigned(task) && section !== "Today" && section !== "Overdue") {
        if (!grouped["Recently Assigned"]) grouped["Recently Assigned"] = []
        grouped["Recently Assigned"].push(task)
      }
    })

    Object.values(grouped).forEach(sectionTasks => {
      sectionTasks.sort((a, b) => {
        switch (sortBy) {
          case "dueDate": {
            if (!a.dueDate && !b.dueDate) return 0
            if (!a.dueDate) return 1
            if (!b.dueDate) return -1
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
          }
          case "priority":
            return (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4)
          case "project":
            return a.project.name.localeCompare(b.project.name)
          case "dateAdded":
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          default:
            return 0
        }
      })
    })

    return SECTION_ORDER
      .filter(name => grouped[name] && grouped[name].length > 0)
      .map(name => ({ name, tasks: grouped[name] }))
  }, [visibleTasks, sortBy])

  const quickComplete = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCompletingTasks(prev => new Set(prev).add(taskId))
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      })
      if (res.ok) {
        setHiddenTasks(prev => new Set(prev).add(taskId))
        toast.success("Intelligence Synchronized")
      }
    } catch (e) { console.error(e) } finally {
      setCompletingTasks(prev => { const n = new Set(prev); n.delete(taskId); return n; })
    }
  }

  const handleTaskClick = useCallback((task: Task) => {
    router.push(`/projects/${task.project.id}?task=${task.id}`)
  }, [router])

  const handleInlineAdd = async (section: string) => {
    if (!newTaskTitle.trim() || !newTaskProject || addingTask) return
    const project = projects.find(p => p.id === newTaskProject)
    if (!project?.defaultTaskListId) return
    setAddingTask(true)
    try {
      const dueDate = section === "Today" ? new Date().toISOString() : undefined
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          taskListId: project.defaultTaskListId,
          ...(dueDate && { dueDate }),
        }),
      })
      if (res.ok) {
        setNewTaskTitle(""); setInlineAdding(null); router.refresh();
      }
    } catch (e) { console.error(e) } finally { setAddingTask(false) }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-fade-in pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-headline font-black tracking-tighter text-primary">
            Personal Protocols
          </h1>
          <p className="text-on-surface-variant/60 font-medium text-lg flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Managing {typedTasks.length} tactical tasks
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-surface-container-low p-1.5 rounded-2xl">
          <div className="flex items-center px-3 gap-2">
            <ArrowUpDown className="h-3.5 w-3.5 text-on-surface-variant/40" />
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="bg-transparent border-none text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 focus:ring-0 cursor-pointer"
            >
              <option value="dueDate">Timeline</option>
              <option value="priority">Priority</option>
              <option value="project">Initiative</option>
              <option value="dateAdded">Recency</option>
            </select>
          </div>
          <div className="h-6 w-[1px] bg-on-surface-variant/10" />
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-primary hover:bg-surface-container transition-all">
            <Filter className="h-3.5 w-3.5" /> Filter
          </button>
        </div>
      </div>

      <div className="space-y-16">
        {sections.map((section) => (
          <div key={section.name} className="space-y-6">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-4 group cursor-pointer" onClick={() => {
                const next = new Set(collapsedSections);
                next.has(section.name) ? next.delete(section.name) : next.add(section.name);
                setCollapsedSections(next);
              }}>
                <div className="h-8 w-8 rounded-xl bg-surface-container flex items-center justify-center text-primary transition-all group-hover:bg-primary group-hover:text-primary-foreground">
                  {collapsedSections.has(section.name) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
                <h3 className="font-headline font-black text-xs uppercase tracking-[0.25em] text-primary">
                  {section.name}
                </h3>
                <span className="bg-surface-container-high px-2.5 py-0.5 rounded-full text-[10px] font-black text-on-surface-variant/60">
                  {section.tasks.length}
                </span>
              </div>
              <button 
                onClick={() => setInlineAdding(section.name)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-low transition-all"
              >
                <Plus className="h-4 w-4" /> New Tactical
              </button>
            </div>

            {!collapsedSections.has(section.name) && (
              <div className="space-y-1">
                {section.tasks.map((task) => {
                  const isDone = task.status === "DONE"
                  const isOverdue = task.dueDate && isPast(new Date(task.dueDate)) && !isToday(new Date(task.dueDate)) && !isDone
                  return (
                    <div
                      key={task.id}
                      onClick={() => handleTaskClick(task)}
                      className="group grid grid-cols-[40px_1fr_140px_100px_120px] gap-0 items-center h-14 cursor-pointer transition-all duration-200 text-[13px] rounded-2xl mb-1 hover:bg-surface-container-low"
                    >
                      <div className="flex items-center justify-center h-full">
                        <button
                          className={cn(
                            "h-5 w-5 rounded-full border-2 transition-all duration-300 flex items-center justify-center",
                            completingTasks.has(task.id) ? "border-primary/20" : "border-on-surface-variant/20 hover:border-primary"
                          )}
                          onClick={(e) => quickComplete(task.id, e)}
                        >
                          {completingTasks.has(task.id) ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : <div className="w-2 h-2 rounded-full bg-primary opacity-0 group-hover:opacity-20" />}
                        </button>
                      </div>

                      <div className="flex items-center gap-3 px-4 min-w-0">
                        <span className={cn("text-sm font-bold truncate transition-all duration-300", isDone ? "text-on-surface-variant/30 line-through" : "text-primary")}>
                          {task.title}
                        </span>
                      </div>

                      <div className="flex items-center px-4 gap-2">
                        <div className="h-2 w-2 rounded-full shadow-sm" style={{ backgroundColor: task.project.color }} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40 truncate">{task.project.name}</span>
                      </div>

                      <div className="flex items-center justify-center px-4">
                        <PriorityBadge priority={task.priority} className="text-[9px] uppercase font-black tracking-widest border-none bg-transparent" />
                      </div>

                      <div className="flex items-center justify-center px-4 pr-8">
                        {task.dueDate ? (
                          <div className={cn("flex items-center gap-1.5 text-[11px] font-black uppercase tracking-tighter", isOverdue ? "text-error" : "text-on-surface-variant/30")}>
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{format(new Date(task.dueDate), "MMM d")}</span>
                          </div>
                        ) : (
                          <span className="text-on-surface-variant/10 text-[11px] font-black">---</span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {inlineAdding === section.name && (
                  <div className="p-4 bg-surface-container-lowest rounded-3xl shadow-xl shadow-primary/5 ring-2 ring-primary/5 animate-scale-in">
                    <input
                      autoFocus
                      placeholder="Protocol Designation..."
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleInlineAdd(section.name)
                        if (e.key === "Escape") setInlineAdding(null)
                      }}
                      className="w-full bg-transparent border-none p-0 text-lg font-bold text-primary placeholder:text-on-surface-variant/10 focus:ring-0"
                    />
                    <div className="flex items-center justify-between mt-4">
                      <select 
                        value={newTaskProject}
                        onChange={(e) => setNewTaskProject(e.target.value)}
                        className="bg-surface-container-low border-none rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/60 focus:ring-2 focus:ring-primary/5"
                      >
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" className="font-bold text-[10px] uppercase tracking-widest" onClick={() => setInlineAdding(null)}>Cancel</Button>
                        <Button size="sm" className="bg-primary text-primary-foreground font-bold text-[10px] uppercase tracking-widest px-4" onClick={() => handleInlineAdd(section.name)} disabled={addingTask}>
                          {addingTask ? <Loader2 className="h-3 w-3 animate-spin" /> : "Deploy"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

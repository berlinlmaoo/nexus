"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PriorityBadge } from "@/components/tasks/priority-badge"
import { StatusBadge } from "@/components/tasks/status-badge"
import {
  CheckSquare,
  Calendar,
  FolderKanban,
  ChevronDown,
  ChevronRight,
  Plus,
  Loader2,
  Check,
  Circle,
} from "lucide-react"
import { format, isPast, isToday, isAfter, addDays, subDays } from "date-fns"
import { cn } from "@/lib/utils"

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
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
  const sevenDaysAgo = subDays(now, 7)
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

export function MyTasksClient({ tasks, projects = [] }: { tasks: Task[]; projects?: ProjectInfo[] }) {
  const router = useRouter()
  const [sortBy, setSortBy] = useState<SortBy>("dueDate")
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [completingTasks, setCompletingTasks] = useState<Set<string>>(new Set())
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(new Set())
  const [inlineAdding, setInlineAdding] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [newTaskProject, setNewTaskProject] = useState(projects[0]?.id || "")
  const [addingTask, setAddingTask] = useState(false)

  const visibleTasks = useMemo(() => tasks.filter(t => !hiddenTasks.has(t.id)), [tasks, hiddenTasks])

  const sections = useMemo(() => {
    const grouped: Record<string, Task[]> = {}

    visibleTasks.forEach(task => {
      const section = getSectionForTask(task)
      if (!grouped[section]) grouped[section] = []
      grouped[section].push(task)

      // Also add to Recently Assigned if applicable and not already in Today/Overdue
      if (getRecentlyAssigned(task) && section !== "Today" && section !== "Overdue") {
        if (!grouped["Recently Assigned"]) grouped["Recently Assigned"] = []
        grouped["Recently Assigned"].push(task)
      }
    })

    // Sort within each section
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

  const toggleSection = (name: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

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
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCompletingTasks(prev => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }

  const handleTaskClick = (task: Task) => {
    router.push(`/projects/${task.project.id}?task=${task.id}`)
  }

  const handleInlineAdd = async (section: string) => {
    if (!newTaskTitle.trim() || !newTaskProject || addingTask) return
    const project = projects.find(p => p.id === newTaskProject)
    if (!project?.defaultTaskListId) return

    setAddingTask(true)
    try {
      const dueDate = section === "Today" ? new Date().toISOString()
        : section === "Upcoming" ? addDays(new Date(), 3).toISOString()
        : section === "Later" ? addDays(new Date(), 14).toISOString()
        : undefined

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
        setNewTaskTitle("")
        setInlineAdding(null)
        router.refresh()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setAddingTask(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CheckSquare className="h-6 w-6 text-zinc-800" />
            My Tasks
          </h1>
          <p className="text-muted-foreground mt-1">
            {visibleTasks.length} tasks assigned to you
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort by:</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-3 text-xs"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="dueDate">Due Date</option>
            <option value="priority">Priority</option>
            <option value="project">Project</option>
            <option value="dateAdded">Date Added</option>
          </select>
        </div>
      </div>

      {visibleTasks.length === 0 ? (
        <Card className="p-12 text-center">
          <CheckSquare className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <h3 className="mt-4 text-lg font-medium">No tasks assigned</h3>
          <p className="text-muted-foreground mt-1">
            You&apos;re all caught up!
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {sections.map(({ name, tasks: sectionTasks }) => {
            const isCollapsed = collapsedSections.has(name)
            const isOverdue = name === "Overdue"

            return (
              <div key={name}>
                <button
                  onClick={() => toggleSection(name)}
                  className="flex items-center gap-2 mb-2 w-full text-left group"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                  <h2 className={cn(
                    "font-semibold text-sm",
                    isOverdue && "text-red-600"
                  )}>
                    {name}
                  </h2>
                  <span className={cn(
                    "text-xs rounded-full px-2 py-0.5",
                    isOverdue ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"
                  )}>
                    {sectionTasks.length}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="space-y-1 ml-6">
                    {sectionTasks.map((task) => {
                      const isCompleting = completingTasks.has(task.id)
                      return (
                        <div
                          key={task.id}
                          className="flex items-center gap-3 py-2.5 px-3 rounded-md border hover:shadow-sm transition-shadow cursor-pointer group"
                          onClick={() => handleTaskClick(task)}
                        >
                          {/* Quick complete checkbox */}
                          <button
                            onClick={(e) => quickComplete(task.id, e)}
                            disabled={isCompleting}
                            className={cn(
                              "shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors",
                              task.status === "DONE"
                                ? "bg-green-500 border-green-500 text-white"
                                : "border-muted-foreground/30 hover:border-green-500 hover:bg-green-50"
                            )}
                          >
                            {isCompleting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : task.status === "DONE" ? (
                              <Check className="h-3 w-3" />
                            ) : null}
                          </button>

                          <div className="flex-1 min-w-0">
                            <span className={cn(
                              "text-sm font-medium",
                              task.status === "DONE" && "line-through text-muted-foreground"
                            )}>
                              {task.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <FolderKanban className="h-3 w-3" />
                              <span
                                className="h-2 w-2 rounded-full inline-block"
                                style={{ backgroundColor: task.project.color }}
                              />
                              {task.project.name}
                            </span>
                            {task.dueDate && (
                              <span
                                className={cn(
                                  "flex items-center gap-1 text-xs",
                                  isPast(new Date(task.dueDate)) &&
                                    !isToday(new Date(task.dueDate))
                                    ? "text-red-600"
                                    : isToday(new Date(task.dueDate))
                                    ? "text-orange-600"
                                    : "text-muted-foreground"
                                )}
                              >
                                <Calendar className="h-3 w-3" />
                                {format(new Date(task.dueDate), "MMM d")}
                              </span>
                            )}
                            <PriorityBadge priority={task.priority as "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE"} />
                            <StatusBadge status={task.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"} />
                          </div>
                        </div>
                      )
                    })}

                    {/* Inline task creation */}
                    {inlineAdding === name ? (
                      <div className="flex items-center gap-2 py-2 px-3 rounded-md border border-dashed">
                        <Circle className="h-5 w-5 text-muted-foreground/30 shrink-0" />
                        <Input
                          placeholder="Task name..."
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") handleInlineAdd(name)
                            if (e.key === "Escape") { setInlineAdding(null); setNewTaskTitle("") }
                          }}
                          className="h-7 border-0 p-0 text-sm focus-visible:ring-0 shadow-none"
                          autoFocus
                        />
                        {projects.length > 1 && (
                          <select
                            className="h-7 rounded border text-xs bg-background px-2"
                            value={newTaskProject}
                            onChange={e => setNewTaskProject(e.target.value)}
                          >
                            {projects.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => handleInlineAdd(name)}
                          disabled={addingTask || !newTaskTitle.trim()}
                          className="text-xs text-foreground font-medium hover:text-foreground/80 disabled:opacity-40"
                        >
                          {addingTask ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setInlineAdding(name); setNewTaskTitle("") }}
                        className="flex items-center gap-2 py-1.5 px-3 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add task
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

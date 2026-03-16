"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import { format, isPast, isToday } from "date-fns"
import { CheckCircle2, Clock, AlertTriangle, Circle, CheckCircle, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Task {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  project: {
    id: string
    name: string
    color: string
  }
}

interface MyTasksDashWidgetProps {
  data?: {
    tasks?: Task[]
  }
}

const priorityConfig: Record<string, { label: string; class: string }> = {
  URGENT: { label: "Urgent", class: "bg-red-100 text-red-700 border-red-200" },
  HIGH: { label: "High", class: "bg-orange-100 text-orange-700 border-orange-200" },
  MEDIUM: { label: "Medium", class: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  LOW: { label: "Low", class: "bg-green-100 text-green-700 border-green-200" },
  NONE: { label: "None", class: "bg-muted text-muted-foreground border-border" },
}

interface QuickProject {
  id: string
  name: string
  color: string
  taskListId: string
}

export function MyTasksDashWidget({ data }: MyTasksDashWidgetProps) {
  const initialTasks = data?.tasks ?? []
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const [quickProjects, setQuickProjects] = useState<QuickProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const createInputRef = useRef<HTMLInputElement>(null)

  // Sync tasks when data changes
  if (data?.tasks && data.tasks !== initialTasks && tasks === initialTasks) {
    setTasks(data.tasks)
  }

  // Fetch projects with their default task list for quick-create
  useEffect(() => {
    if (!showCreate || quickProjects.length > 0) return
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then(async (rawData) => {
        const projects = Array.isArray(rawData) ? rawData : rawData.projects ?? []
        const withLists: QuickProject[] = []
        // Fetch first task list for each project (parallel, max 10)
        await Promise.all(
          projects.slice(0, 10).map(async (p: { id: string; name: string; color: string }) => {
            try {
              const r = await fetch(`/api/projects/${p.id}`)
              if (r.ok) {
                const detail = await r.json()
                const lists = detail.taskLists ?? []
                if (lists.length > 0) {
                  withLists.push({ id: p.id, name: p.name, color: p.color, taskListId: lists[0].id })
                }
              }
            } catch {}
          })
        )
        setQuickProjects(withLists)
        if (withLists.length > 0 && !selectedProjectId) {
          setSelectedProjectId(withLists[0].id)
        }
      })
      .catch(() => {})
  }, [showCreate, quickProjects.length, selectedProjectId])

  useEffect(() => {
    if (showCreate) setTimeout(() => createInputRef.current?.focus(), 50)
  }, [showCreate])

  const handleQuickCreate = useCallback(async () => {
    if (!newTitle.trim() || !selectedProjectId) return
    const project = quickProjects.find((p) => p.id === selectedProjectId)
    if (!project) return
    setCreating(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), taskListId: project.taskListId }),
      })
      if (res.ok) {
        const task = await res.json()
        setTasks((prev) => [
          { id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate, project: { id: project.id, name: project.name, color: project.color } },
          ...prev,
        ])
        setNewTitle("")
      }
    } catch {}
    setCreating(false)
  }, [newTitle, selectedProjectId, quickProjects])

  const completeTask = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    setCompletingIds((prev) => new Set(prev).add(taskId))

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      })

      if (res.ok) {
        // Show strikethrough animation, then remove after delay
        setTimeout(() => {
          setTasks((prev) => prev.filter((t) => t.id !== taskId))
          setCompletingIds((prev) => {
            const next = new Set(prev)
            next.delete(taskId)
            return next
          })
        }, 600)
      } else {
        setCompletingIds((prev) => {
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }
    } catch {
      setCompletingIds((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }, [])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{tasks.length} tasks</span>
        </div>
        <Link
          href="/my-tasks"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No tasks due soon
        </p>
      ) : (
        tasks.map((task) => {
          const priority = priorityConfig[task.priority] ?? priorityConfig.NONE
          const dueDate = task.dueDate ? new Date(task.dueDate) : null
          const overdue = dueDate && !isToday(dueDate) && isPast(dueDate)
          const isCompleting = completingIds.has(task.id)

          return (
            <Link
              key={task.id}
              href={`/projects/${task.project.id}?task=${task.id}`}
              className={cn(
                "flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-muted/50 transition-all group",
                overdue && "bg-red-50/50",
                isCompleting && "opacity-50"
              )}
            >
              {/* Checkbox */}
              <button
                onClick={(e) => completeTask(task.id, e)}
                className="flex-shrink-0 text-muted-foreground hover:text-emerald-500 transition-colors"
              >
                {isCompleting ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
              </button>

              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: task.project.color }}
              />
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "truncate text-sm font-medium group-hover:text-muted-foreground transition-all",
                  isCompleting && "line-through text-muted-foreground"
                )}>
                  {task.title}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {task.project.name}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Badge
                  variant="outline"
                  className={cn("text-[10px] px-1.5 py-0", priority.class)}
                >
                  {priority.label}
                </Badge>
                {dueDate && (
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs whitespace-nowrap",
                      overdue
                        ? "text-red-500 font-medium"
                        : "text-muted-foreground"
                    )}
                  >
                    {overdue ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : (
                      <Clock className="h-3 w-3" />
                    )}
                    {format(dueDate, "MMM d")}
                  </span>
                )}
              </div>
            </Link>
          )
        })
      )}

      {/* Quick-create task */}
      {showCreate ? (
        <div className="mt-2 rounded-md border p-2 space-y-2 animate-fade-in">
          <input
            ref={createInputRef}
            type="text"
            placeholder="Task name..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleQuickCreate(); if (e.key === "Escape") { setShowCreate(false); setNewTitle("") } }}
            className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            disabled={creating}
          />
          <div className="flex items-center gap-2">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="h-7 flex-1 rounded border bg-background px-2 text-xs"
              disabled={creating}
            >
              {quickProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={handleQuickCreate}
              disabled={creating || !newTitle.trim() || !selectedProjectId}
              className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {creating ? "..." : "Add"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewTitle("") }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Quick add task
        </button>
      )}
    </div>
  )
}

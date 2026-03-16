"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  List,
  LayoutGrid,
  CalendarDays,
  Table2,
  Image,
  Plus,
  ChevronDown,
  ChevronRight,
  Filter,
  ArrowUpDown,
  GripVertical,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import type { TaskCardData } from "@/components/tasks/task-card"
import { StatusBadge } from "@/components/tasks/status-badge"
import { PriorityBadge } from "@/components/tasks/priority-badge"
import { UserAvatar } from "@/components/ui/user-avatar"
import { format } from "date-fns"
import { DatabaseGalleryView } from "./database-gallery-view"

type DatabaseType = "tasks" | "docs" | "calendar" | "custom"
type ViewType = "table" | "board" | "calendar" | "list" | "gallery"

interface InlineDatabaseProps {
  type: DatabaseType
  projectId: string
  title?: string
  filters?: Record<string, string>
  viewType?: ViewType
  maxHeight?: number
  className?: string
}

interface DocItem {
  id: string
  title: string
  updatedAt: string
  author?: { name: string; avatar: string | null }
}

export function InlineDatabase({
  type,
  projectId,
  title,
  filters,
  viewType: initialViewType = "list",
  maxHeight = 400,
  className,
}: InlineDatabaseProps) {
  const [viewType, setViewType] = useState<ViewType>(initialViewType)
  const [collapsed, setCollapsed] = useState(false)
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [docs, setDocs] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(true)
  const [resizeHeight, setResizeHeight] = useState(maxHeight)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      if (type === "tasks" || type === "calendar") {
        const params = new URLSearchParams({ projectId })
        if (filters?.status) params.set("status", filters.status)
        if (filters?.priority) params.set("priority", filters.priority)
        const res = await fetch(`/api/tasks?${params}`)
        if (res.ok) {
          const data = await res.json()
          setTasks(Array.isArray(data) ? data : data.tasks || [])
        }
      } else if (type === "docs") {
        const res = await fetch(`/api/docs?projectId=${projectId}`)
        if (res.ok) {
          const data = await res.json()
          setDocs(Array.isArray(data) ? data : data.docs || [])
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [type, projectId, filters])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const databaseTitle = title || (type === "tasks" ? "Tasks" : type === "docs" ? "Documents" : type === "calendar" ? "Calendar" : "Database")

  const viewIcons: { id: ViewType; icon: typeof List; label: string }[] = [
    { id: "table", icon: Table2, label: "Table" },
    { id: "list", icon: List, label: "List" },
    { id: "board", icon: LayoutGrid, label: "Board" },
    { id: "gallery", icon: Image, label: "Gallery" },
    { id: "calendar", icon: CalendarDays, label: "Calendar" },
  ]

  return (
    <div className={cn("rounded-lg border bg-background", className)}>
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <h3 className="text-sm font-semibold">{databaseTitle}</h3>
          <span className="text-xs text-muted-foreground">
            {type === "docs" ? docs.length : tasks.length} items
          </span>
        </div>

        <div className="flex items-center gap-1">
          {viewIcons.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setViewType(id)}
              className={cn(
                "p-1.5 rounded transition-colors",
                viewType === id
                  ? "bg-zinc-900 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={label}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="overflow-y-auto"
              style={{ maxHeight: resizeHeight }}
            >
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {type === "tasks" || type === "calendar" ? (
                    <TasksView tasks={tasks} viewType={viewType} />
                  ) : type === "docs" ? (
                    <DocsView docs={docs} viewType={viewType} />
                  ) : null}
                </>
              )}
            </div>

            {/* Footer with + New */}
            <div className="px-4 py-2 border-t">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground w-full justify-start">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New
              </Button>
            </div>

            {/* Resize handle */}
            <div
              className="h-1.5 cursor-ns-resize hover:bg-zinc-200 transition-colors flex items-center justify-center"
              onMouseDown={(e) => {
                const startY = e.clientY
                const startH = resizeHeight
                const onMove = (ev: MouseEvent) => {
                  setResizeHeight(Math.max(150, startH + ev.clientY - startY))
                }
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove)
                  window.removeEventListener("mouseup", onUp)
                }
                window.addEventListener("mousemove", onMove)
                window.addEventListener("mouseup", onUp)
              }}
            >
              <GripVertical className="h-3 w-3 text-muted-foreground/50 rotate-90" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TasksView({ tasks, viewType }: { tasks: TaskCardData[]; viewType: ViewType }) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-muted-foreground">No tasks found</p>
      </div>
    )
  }

  if (viewType === "gallery") {
    return <DatabaseGalleryView items={tasks.map(t => ({
      id: t.id,
      title: t.title,
      subtitle: t.status.replace("_", " "),
      coverColor: t.priority === "URGENT" ? "from-red-100 to-red-50" : t.priority === "HIGH" ? "from-orange-100 to-orange-50" : t.priority === "MEDIUM" ? "from-yellow-100 to-yellow-50" : "from-zinc-100 to-zinc-50",
      properties: [
        { label: "Status", value: t.status.replace("_", " ") },
        { label: "Priority", value: t.priority },
      ],
      assignees: t.assignees,
    }))} />
  }

  if (viewType === "table") {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Assignee</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Due</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{task.title}</td>
                <td className="px-4 py-2.5"><StatusBadge status={task.status} /></td>
                <td className="px-4 py-2.5"><PriorityBadge priority={task.priority} /></td>
                <td className="px-4 py-2.5">
                  <div className="flex -space-x-1">
                    {task.assignees.slice(0, 2).map((a) => (
                      <UserAvatar key={a.id} user={{ name: a.name, avatar: a.avatar }} size="xs" />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {task.dueDate ? format(new Date(task.dueDate), "MMM d") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (viewType === "board") {
    const grouped = tasks.reduce<Record<string, TaskCardData[]>>((acc, t) => {
      if (!acc[t.status]) acc[t.status] = []
      acc[t.status].push(t)
      return acc
    }, {})

    return (
      <div className="flex gap-3 p-4 overflow-x-auto">
        {["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"].map((status) => (
          <div key={status} className="min-w-[200px] flex-1">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {status.replace("_", " ")} ({grouped[status]?.length || 0})
            </div>
            <div className="space-y-2">
              {(grouped[status] || []).map((t) => (
                <div key={t.id} className="rounded-md border bg-background p-2.5 text-sm hover:shadow-sm transition-shadow">
                  <p className="font-medium text-xs">{t.title}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <PriorityBadge priority={t.priority} showLabel={false} />
                    {t.dueDate && (
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(t.dueDate), "MMM d")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Default: list view
  return (
    <div className="divide-y">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
          <StatusBadge status={task.status} showLabel={false} />
          <span className="text-sm font-medium flex-1 truncate">{task.title}</span>
          <PriorityBadge priority={task.priority} showLabel={false} />
          {task.dueDate && (
            <span className="text-xs text-muted-foreground">
              {format(new Date(task.dueDate), "MMM d")}
            </span>
          )}
          <div className="flex -space-x-1">
            {task.assignees.slice(0, 2).map((a) => (
              <UserAvatar key={a.id} user={{ name: a.name, avatar: a.avatar }} size="xs" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DocsView({ docs, viewType }: { docs: DocItem[]; viewType: ViewType }) {
  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-muted-foreground">No documents found</p>
      </div>
    )
  }

  if (viewType === "gallery") {
    return <DatabaseGalleryView items={docs.map(d => ({
      id: d.id,
      title: d.title,
      subtitle: d.updatedAt ? `Updated ${format(new Date(d.updatedAt), "MMM d")}` : undefined,
      coverColor: "from-zinc-100 to-zinc-50",
      properties: [],
    }))} />
  }

  if (viewType === "table") {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Updated</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{doc.title}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {doc.updatedAt ? format(new Date(doc.updatedAt), "MMM d, yyyy") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {docs.map((doc) => (
        <div key={doc.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
          <div className="h-8 w-8 rounded bg-zinc-100 flex items-center justify-center text-xs font-medium text-zinc-500">
            D
          </div>
          <span className="text-sm font-medium flex-1 truncate">{doc.title}</span>
          <span className="text-xs text-muted-foreground">
            {doc.updatedAt ? format(new Date(doc.updatedAt), "MMM d") : ""}
          </span>
        </div>
      ))}
    </div>
  )
}

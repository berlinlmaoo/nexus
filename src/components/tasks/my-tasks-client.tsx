"use client"

import dynamic from "next/dynamic"
import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Button } from "@/components/ui/button"
import { PriorityBadge } from "./priority-badge"
import { StatusBadge } from "./status-badge"
import type { TaskCardData } from "./task-card"
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Calendar,
  ListTodo,
  Filter,
} from "lucide-react"
import { format, isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"

const TaskDetailPanel = dynamic(
  () => import("./task-detail-panel").then((mod) => mod.TaskDetailPanel),
  { ssr: false }
)

interface ProjectGroup {
  id: string
  name: string
  color: string
  tasks: TaskCardData[]
}

interface MyTasksClientProps {
  projectGroups: ProjectGroup[]
}

const STATUS_FILTERS = ["ALL", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const
const PRIORITY_FILTERS = ["ALL", "URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const

export function MyTasksClient({ projectGroups }: MyTasksClientProps) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [selectedTask, setSelectedTask] = useState<TaskCardData | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL")
  const [showFilters, setShowFilters] = useState(false)

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const filteredGroups = useMemo(() => {
    return projectGroups
      .map((group) => ({
        ...group,
        tasks: group.tasks.filter((t) => {
          if (statusFilter !== "ALL" && t.status !== statusFilter) return false
          if (priorityFilter !== "ALL" && t.priority !== priorityFilter)
            return false
          return true
        }),
      }))
      .filter((g) => g.tasks.length > 0)
  }, [projectGroups, statusFilter, priorityFilter])

  const totalTasks = filteredGroups.reduce((sum, g) => sum + g.tasks.length, 0)

  const handleToggleStatus = async (taskId: string, done: boolean) => {
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: done ? "DONE" : "TODO" }),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to update task:", error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
          <p className="text-muted-foreground mt-1">
            {totalTasks} task{totalTasks !== 1 ? "s" : ""} assigned to you
          </p>
        </div>
        <Button
          variant={showFilters ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-4 w-4 mr-1" />
          Filters
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-muted/50 border animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Status:
            </span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? "All" : s.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Priority:
            </span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              {PRIORITY_FILTERS.map((p) => (
                <option key={p} value={p}>
                  {p === "ALL" ? "All" : p}
                </option>
              ))}
            </select>
          </div>

          {(statusFilter !== "ALL" || priorityFilter !== "ALL") && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                setStatusFilter("ALL")
                setPriorityFilter("ALL")
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Task groups by project */}
      {filteredGroups.length > 0 ? (
        <div className="space-y-4">
          {filteredGroups.map((group) => {
            const isCollapsed = collapsed[group.id]
            return (
              <div key={group.id} className="space-y-1">
                {/* Project header */}
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-4 py-2 hover:bg-accent transition-colors"
                  onClick={() => toggleCollapse(group.id)}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="font-semibold text-sm">{group.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({group.tasks.length})
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {group.tasks.map((task) => {
                      const isDone = task.status === "DONE"
                      const isOverdue =
                        task.dueDate &&
                        isPast(new Date(task.dueDate)) &&
                        !isToday(new Date(task.dueDate)) &&
                        !isDone

                      return (
                        <div
                          key={task.id}
                          className="group grid grid-cols-1 sm:grid-cols-[auto_1fr_100px_100px_100px_80px] gap-2 sm:gap-3 items-center rounded-lg px-4 py-2 hover:bg-accent/50 cursor-pointer transition-colors"
                          onClick={() => setSelectedTask(task)}
                        >
                          {/* Checkbox */}
                          <button
                            className="flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleToggleStatus(task.id, !isDone)
                            }}
                          >
                            {isDone ? (
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground group-hover:text-[#18181B] transition-colors" />
                            )}
                          </button>

                          {/* Title */}
                          <span
                            className={cn(
                              "text-sm truncate",
                              isDone &&
                                "line-through text-muted-foreground"
                            )}
                          >
                            {task.title}
                          </span>

                          {/* Status */}
                          <div className="hidden sm:block">
                            <StatusBadge status={task.status} />
                          </div>

                          {/* Priority */}
                          <div className="hidden sm:block">
                            <PriorityBadge priority={task.priority} />
                          </div>

                          {/* Due date */}
                          <div className="hidden sm:block">
                            {task.dueDate ? (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 text-xs",
                                  isOverdue
                                    ? "text-red-600 font-medium"
                                    : "text-muted-foreground"
                                )}
                              >
                                <Calendar className="h-3 w-3" />
                                {format(new Date(task.dueDate), "MMM d")}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                --
                              </span>
                            )}
                          </div>

                          {/* Assignees */}
                          <div className="hidden sm:flex -space-x-1.5">
                            {task.assignees.slice(0, 2).map((a) => (
                              <UserAvatar
                                key={a.id}
                                user={{ name: a.name, avatar: a.avatar }}
                                size="xs"
                                className="h-6 w-6 border border-background"
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ListTodo className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">No tasks found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {statusFilter !== "ALL" || priorityFilter !== "ALL"
              ? "Try adjusting your filters"
              : "You don't have any tasks assigned to you yet"}
          </p>
        </div>
      )}

      {/* Task detail panel */}
      {selectedTask && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setSelectedTask(null)}
          />
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onUpdate={() => router.refresh()}
          />
        </>
      )}
    </div>
  )
}

"use client"

import { useState, useCallback, useRef } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd"
import { UserAvatar } from "@/components/ui/user-avatar"
import type { TaskCardData } from "./task-card"
import { cn } from "@/lib/utils"
import { Plus, Loader2, Calendar } from "lucide-react"
import { useRouter } from "next/navigation"
import { format, isPast, isToday } from "date-fns"

const COLUMNS: {
  id: TaskCardData["status"]
  label: string
}[] = [
  { id: "TODO", label: "To Do" },
  { id: "IN_PROGRESS", label: "In Progress" },
  { id: "IN_REVIEW", label: "In Review" },
  { id: "DONE", label: "Done" },
]

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-yellow-500",
  LOW: "bg-blue-400",
  NONE: "",
}

interface BoardViewProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
  onStatusChange: (taskId: string, newStatus: TaskCardData["status"]) => void
  projectId?: string
  defaultTaskListId?: string
}

export function BoardView({
  tasks,
  onTaskClick,
  onStatusChange,
  projectId,
  defaultTaskListId,
}: BoardViewProps) {
  const router = useRouter()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const getColumnTasks = useCallback(
    (status: TaskCardData["status"]) =>
      tasks
        .filter((t) => t.status === status)
        .sort((a, b) => a.position - b.position),
    [tasks]
  )

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId && destination.index === source.index) return

      const newStatus = destination.droppableId as TaskCardData["status"]
      onStatusChange(draggableId, newStatus)
    },
    [onStatusChange]
  )

  const handleQuickAdd = async (status: string) => {
    if (!newTitle.trim() || !projectId || !defaultTaskListId) return
    setCreating(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          status,
          taskListId: defaultTaskListId,
          projectId,
        }),
      })
      if (res.ok) {
        setNewTitle("")
        setAddingTo(null)
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create task:", error)
    } finally {
      setCreating(false)
    }
  }

  const startAdding = (columnId: string) => {
    setAddingTo(columnId)
    setNewTitle("")
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((column) => {
          const columnTasks = getColumnTasks(column.id)
          return (
            <div
              key={column.id}
              className="flex-shrink-0 w-72 flex flex-col"
            >
              {/* Column header */}
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-foreground">{column.label}</h3>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {columnTasks.length}
                  </span>
                </div>
              </div>

              {/* Droppable area */}
              <Droppable droppableId={column.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      "flex-1 space-y-2 rounded-lg p-1.5 min-h-[120px] transition-colors duration-150",
                      snapshot.isDraggingOver
                        ? "bg-muted/60"
                        : "bg-transparent"
                    )}
                  >
                    {columnTasks.map((task, index) => {
                      const isOverdue =
                        task.dueDate &&
                        isPast(new Date(task.dueDate)) &&
                        !isToday(new Date(task.dueDate)) &&
                        task.status !== "DONE"

                      return (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                            >
                              <div
                                className={cn(
                                  "rounded-lg border bg-white dark:bg-zinc-900 p-3 cursor-pointer transition-all duration-150",
                                  "hover:shadow-md",
                                  snapshot.isDragging && "shadow-xl ring-1 ring-border"
                                )}
                                onClick={() => onTaskClick(task)}
                              >
                                {/* Task name */}
                                <p className="text-[13px] font-medium text-foreground leading-snug line-clamp-2">
                                  {task.title}
                                </p>

                                {/* Bottom: date + priority pill + avatar */}
                                <div className="flex items-center justify-between mt-3">
                                  <div className="flex items-center gap-2">
                                    {task.dueDate && (
                                      <span
                                        className={cn(
                                          "inline-flex items-center gap-1 text-[11px]",
                                          isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"
                                        )}
                                      >
                                        <Calendar className="h-3 w-3" />
                                        {format(new Date(task.dueDate), "MMM d")}
                                      </span>
                                    )}
                                    {task.priority !== "NONE" && PRIORITY_COLORS[task.priority] && (
                                      <span className={cn("h-2 w-2 rounded-full", PRIORITY_COLORS[task.priority])} />
                                    )}
                                  </div>

                                  {task.assignees.length > 0 && (
                                    <div className="flex -space-x-1">
                                      {task.assignees.slice(0, 1).map((a) => (
                                        <UserAvatar
                                          key={a.id}
                                          user={{ name: a.name, avatar: a.avatar }}
                                          size="xs"
                                          className="h-6 w-6 border border-white dark:border-zinc-900"
                                        />
                                      ))}
                                      {task.assignees.length > 1 && (
                                        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white dark:border-zinc-900 bg-muted text-[8px] font-medium text-muted-foreground">
                                          +{task.assignees.length - 1}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      )
                    })}
                    {provided.placeholder}

                    {/* Empty state */}
                    {columnTasks.length === 0 && !snapshot.isDraggingOver && addingTo !== column.id && (
                      <div className="flex items-center justify-center py-8">
                        <p className="text-xs text-muted-foreground/40">No tasks</p>
                      </div>
                    )}

                    {/* Inline quick-add */}
                    {addingTo === column.id && (
                      <div className="rounded-lg border bg-white dark:bg-zinc-900 p-2.5">
                        <input
                          ref={inputRef}
                          type="text"
                          placeholder="Task name..."
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newTitle.trim()) handleQuickAdd(column.id)
                            if (e.key === "Escape") { setAddingTo(null); setNewTitle("") }
                          }}
                          onBlur={() => { if (!newTitle.trim()) setAddingTo(null) }}
                          disabled={creating}
                          className="w-full text-[13px] bg-transparent outline-none placeholder:text-muted-foreground/50"
                        />
                        {creating && (
                          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Creating...
                          </div>
                        )}
                      </div>
                    )}

                    {/* Add button */}
                    {addingTo !== column.id && projectId && defaultTaskListId && (
                      <button
                        onClick={() => startAdding(column.id)}
                        className="flex items-center gap-1.5 w-full rounded-lg px-2 py-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add task
                      </button>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          )
        })}
      </div>
    </DragDropContext>
  )
}

"use client"

import { memo, useState, useCallback, useRef, useMemo, useEffect, useTransition } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd"
import { TaskCard, type TaskCardData } from "./task-card"
import { cn } from "@/lib/utils"
import { Plus, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"

const COLUMNS: {
  id: TaskCardData["status"]
  label: string
  color: string
}[] = [
  { id: "TODO", label: "To Do", color: "bg-surface-container-high" },
  { id: "IN_PROGRESS", label: "In Progress", color: "bg-on-surface-variant" },
  { id: "IN_REVIEW", label: "In Review", color: "bg-foreground" },
  { id: "DONE", label: "Done", color: "bg-green-500" },
]

interface KanbanBoardProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
  onStatusChange: (taskId: string, newStatus: TaskCardData["status"]) => void
  projectId?: string
  defaultTaskListId?: string
}

interface KanbanBoardTaskCardProps {
  task: TaskCardData
  index: number
  isDragging: boolean
  onOpenTask: (task: TaskCardData) => void
}

const KanbanBoardTaskCard = memo(function KanbanBoardTaskCard({
  task,
  index,
  isDragging,
  onOpenTask,
}: KanbanBoardTaskCardProps) {
  const handleOpen = useCallback(() => {
    onOpenTask(task)
  }, [onOpenTask, task])

  return (
    <TaskCard
      task={task}
      onClick={handleOpen}
      isDragging={isDragging}
      index={index}
    />
  )
})

export function KanbanBoard({
  tasks,
  onTaskClick,
  onStatusChange,
  projectId,
  defaultTaskListId,
}: KanbanBoardProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [localTasks, setLocalTasks] = useState<TaskCardData[]>(tasks)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSyncedSignatureRef = useRef("")

  const tasksSignature = useMemo(
    () =>
      tasks
        .map((task) => `${task.id}:${task.status}:${task.position}:${task.taskListId}:${task.title}:${task.dueDate ?? ""}`)
        .join("|"),
    [tasks]
  )

  useEffect(() => {
    if (lastSyncedSignatureRef.current === tasksSignature) return
    lastSyncedSignatureRef.current = tasksSignature
    setLocalTasks(tasks)
  }, [tasks, tasksSignature])

  const columnEntries = useMemo(
    () =>
      COLUMNS.map((column, index) => ({
        ...column,
        index,
        tasks: localTasks
          .filter((task) => task.status === column.id)
          .sort((a, b) => a.position - b.position),
      })),
    [localTasks]
  )

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result
      if (!destination) return
      if (
        destination.droppableId === source.droppableId &&
        destination.index === source.index
      )
        return

      const newStatus = destination.droppableId as TaskCardData["status"]

      // Optimistic update
      setLocalTasks((prev) =>
        prev.map((t) =>
          t.id === draggableId ? { ...t, status: newStatus } : t
        )
      )

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
        startTransition(() => {
          router.refresh()
        })
      }
    } catch (error) {
      console.error("Failed to create task:", error)
    } finally {
      setCreating(false)
    }
  }

  const startAdding = useCallback((columnId: string) => {
    setAddingTo(columnId)
    setNewTitle("")
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="mobile-horizontal-scroll flex gap-4 overflow-x-auto pb-4">
        {columnEntries.map((column) => {
          const columnTasks = column.tasks
          return (
            <div
              key={column.id}
              className="flex w-[min(82vw,18rem)] flex-shrink-0 flex-col animate-fade-in-up sm:w-72"
              style={{ animationDelay: `${column.index * 75}ms` }}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={cn("h-2.5 w-2.5 rounded-full transition-colors duration-200", column.color)} />
                <h3 className="text-sm font-semibold">{column.label}</h3>
                <span className="ml-auto text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 transition-all duration-200">
                  {columnTasks.length}
                </span>
              </div>

              {/* Droppable area */}
              <Droppable droppableId={column.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      "min-h-[160px] flex-1 space-y-2 rounded-lg p-2 transition-all duration-300 sm:min-h-[200px]",
                      snapshot.isDraggingOver
                        ? "bg-muted border-2 border-dashed border-muted-foreground/40 shadow-inner"
                        : "bg-muted/30 border-2 border-transparent"
                    )}
                  >
                    {columnTasks.map((task, index) => (
                      <Draggable
                        key={task.id}
                        draggableId={task.id}
                        index={index}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className="transition-transform duration-150"
                          >
                            <KanbanBoardTaskCard
                              task={task}
                              isDragging={snapshot.isDragging}
                              index={index}
                              onOpenTask={onTaskClick}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}

                    {/* Empty state */}
                    {columnTasks.length === 0 && !snapshot.isDraggingOver && addingTo !== column.id && (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground border-2 border-dashed border-muted rounded-lg">
                        <p className="text-xs">No tasks</p>
                      </div>
                    )}

                    {/* Inline quick-add */}
                    {addingTo === column.id && (
                      <div className="overflow-hidden animate-fade-in">
                        <div className="rounded-lg border bg-background p-2 shadow-sm">
                          <input
                            ref={inputRef}
                            type="text"
                            placeholder="Task title..."
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && newTitle.trim()) {
                                handleQuickAdd(column.id)
                              }
                              if (e.key === "Escape") {
                                setAddingTo(null)
                                setNewTitle("")
                              }
                            }}
                            onBlur={() => {
                              if (!newTitle.trim()) {
                                setAddingTo(null)
                              }
                            }}
                            disabled={creating}
                            className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                          />
                          {creating && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Creating...
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Add button */}
                    {addingTo !== column.id && projectId && defaultTaskListId && (
                      <button
                        onClick={() => startAdding(column.id)}
                        className="flex items-center gap-1.5 w-full rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
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

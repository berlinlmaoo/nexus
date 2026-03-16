"use client"

import { useState, useCallback, useRef } from "react"
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
import { motion, AnimatePresence } from "framer-motion"

const COLUMNS: {
  id: TaskCardData["status"]
  label: string
  color: string
}[] = [
  { id: "TODO", label: "To Do", color: "bg-zinc-400" },
  { id: "IN_PROGRESS", label: "In Progress", color: "bg-zinc-600" },
  { id: "IN_REVIEW", label: "In Review", color: "bg-zinc-800" },
  { id: "DONE", label: "Done", color: "bg-green-500" },
]

interface KanbanBoardProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
  onStatusChange: (taskId: string, newStatus: TaskCardData["status"]) => void
  projectId?: string
  defaultTaskListId?: string
}

export function KanbanBoard({
  tasks,
  onTaskClick,
  onStatusChange,
  projectId,
  defaultTaskListId,
}: KanbanBoardProps) {
  const router = useRouter()
  const [localTasks, setLocalTasks] = useState<TaskCardData[]>(tasks)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync when tasks prop changes
  if (tasks !== localTasks && JSON.stringify(tasks) !== JSON.stringify(localTasks)) {
    setLocalTasks(tasks)
  }

  const getColumnTasks = useCallback(
    (status: TaskCardData["status"]) =>
      localTasks
        .filter((t) => t.status === status)
        .sort((a, b) => a.position - b.position),
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
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((column, colIndex) => {
          const columnTasks = getColumnTasks(column.id)
          return (
            <div
              key={column.id}
              className="flex-shrink-0 w-72 flex flex-col animate-fade-in-up"
              style={{ animationDelay: `${colIndex * 75}ms` }}
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
                      "flex-1 space-y-2 rounded-lg p-2 min-h-[200px] transition-all duration-300",
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
                            <TaskCard
                              task={task}
                              onClick={() => onTaskClick(task)}
                              isDragging={snapshot.isDragging}
                              index={index}
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
                    <AnimatePresence>
                      {addingTo === column.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
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
                        </motion.div>
                      )}
                    </AnimatePresence>

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

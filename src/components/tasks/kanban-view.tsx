"use client"

import { useState, useCallback, useRef, useMemo } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Button } from "@/components/ui/button"
import type { TaskCardData } from "./task-card"
import { cn } from "@/lib/utils"
import {
  Plus,
  Loader2,
  Calendar,
  MessageSquare,
  ListTree,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Tag,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { format, isPast, isToday } from "date-fns"

const COLUMNS: {
  id: TaskCardData["status"]
  label: string
  dot: string
}[] = [
  { id: "TODO", label: "To Do", dot: "bg-zinc-400" },
  { id: "IN_PROGRESS", label: "In Progress", dot: "bg-zinc-600" },
  { id: "IN_REVIEW", label: "In Review", dot: "bg-zinc-800" },
  { id: "DONE", label: "Done", dot: "bg-zinc-950" },
]

const PRIORITY_BADGES: Record<string, { label: string; cls: string }> = {
  URGENT: { label: "Urgent", cls: "bg-red-100 text-red-700 border-red-200" },
  HIGH: { label: "High", cls: "bg-orange-100 text-orange-700 border-orange-200" },
  MEDIUM: { label: "Medium", cls: "bg-muted text-muted-foreground border-border" },
  LOW: { label: "Low", cls: "bg-muted/50 text-muted-foreground border-border" },
  NONE: { label: "None", cls: "bg-muted/50 text-muted-foreground/60 border-border/50" },
}

type SwimLaneMode = "none" | "assignee" | "priority"

interface KanbanViewProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
  onStatusChange: (taskId: string, newStatus: TaskCardData["status"]) => void
  projectId?: string
  defaultTaskListId?: string
}

export function KanbanView({
  tasks,
  onTaskClick,
  onStatusChange,
  projectId,
  defaultTaskListId,
}: KanbanViewProps) {
  const router = useRouter()
  const [localTasks, setLocalTasks] = useState<TaskCardData[]>(tasks)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const [swimLaneMode, setSwimLaneMode] = useState<SwimLaneMode>("none")
  const [wipLimits, setWipLimits] = useState<Record<string, number>>({
    TODO: 0, IN_PROGRESS: 5, IN_REVIEW: 3, DONE: 0,
  })
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set())
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set())
  const [showWipConfig, setShowWipConfig] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  if (tasks !== localTasks && JSON.stringify(tasks) !== JSON.stringify(localTasks)) {
    setLocalTasks(tasks)
  }

  const swimLanes = useMemo(() => {
    if (swimLaneMode === "none") return [{ id: "__all__", label: "All Tasks" }]
    if (swimLaneMode === "assignee") {
      const assigneeMap = new Map<string, string>()
      localTasks.forEach((t) => {
        if (t.assignees.length === 0) {
          assigneeMap.set("__unassigned__", "Unassigned")
        } else {
          t.assignees.forEach((a) => assigneeMap.set(a.id, a.name))
        }
      })
      return Array.from(assigneeMap.entries()).map(([id, label]) => ({ id, label }))
    }
    // priority
    return ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => ({
      id: p,
      label: PRIORITY_BADGES[p].label,
    }))
  }, [swimLaneMode, localTasks])

  const getTasksForLaneAndStatus = useCallback(
    (laneId: string, status: TaskCardData["status"]) => {
      return localTasks
        .filter((t) => {
          if (t.status !== status) return false
          if (swimLaneMode === "none") return true
          if (swimLaneMode === "assignee") {
            if (laneId === "__unassigned__") return t.assignees.length === 0
            return t.assignees.some((a) => a.id === laneId)
          }
          return t.priority === laneId
        })
        .sort((a, b) => a.position - b.position)
    },
    [localTasks, swimLaneMode]
  )

  const getColumnCount = useCallback(
    (status: TaskCardData["status"]) => localTasks.filter((t) => t.status === status).length,
    [localTasks]
  )

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId && destination.index === source.index) return

      // droppableId format: "status__laneId"
      const newStatus = destination.droppableId.split("__")[0] as TaskCardData["status"]
      setLocalTasks((prev) =>
        prev.map((t) => (t.id === draggableId ? { ...t, status: newStatus } : t))
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

  const toggleColumn = (colId: string) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev)
      if (next.has(colId)) next.delete(colId)
      else next.add(colId)
      return next
    })
  }

  const toggleLane = (laneId: string) => {
    setCollapsedLanes((prev) => {
      const next = new Set(prev)
      if (next.has(laneId)) next.delete(laneId)
      else next.add(laneId)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Swimlanes:</span>
          <div className="flex rounded-lg border overflow-hidden">
            {(["none", "assignee", "priority"] as const).map((mode) => (
              <button
                key={mode}
                className={cn(
                  "px-3 py-1 text-xs font-medium transition-colors",
                  swimLaneMode === mode ? "bg-foreground text-background" : "hover:bg-accent text-muted-foreground"
                )}
                onClick={() => setSwimLaneMode(mode)}
              >
                {mode === "none" ? "None" : mode === "assignee" ? "Assignee" : "Priority"}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <Button
            variant={showWipConfig ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowWipConfig(!showWipConfig)}
            className="text-xs"
          >
            WIP Limits
          </Button>
          {showWipConfig && (
            <div className="absolute left-0 top-full mt-1 z-20 rounded-lg border bg-background p-3 shadow-lg min-w-[200px]">
              <p className="text-xs font-medium text-muted-foreground mb-2">WIP Limits per Column</p>
              {COLUMNS.map((col) => (
                <div key={col.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-xs text-muted-foreground">{col.label}</span>
                  <input
                    type="number"
                    min={0}
                    value={wipLimits[col.id] || 0}
                    onChange={(e) =>
                      setWipLimits((prev) => ({ ...prev, [col.id]: parseInt(e.target.value) || 0 }))
                    }
                    className="w-14 h-6 rounded border text-xs text-center outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground/60 mt-2">0 = no limit</p>
            </div>
          )}
        </div>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        {swimLanes.map((lane) => {
          const isLaneCollapsed = collapsedLanes.has(lane.id)

          return (
            <div key={lane.id}>
              {/* Swimlane header */}
              {swimLaneMode !== "none" && (
                <button
                  className="flex items-center gap-2 w-full py-2 px-1 text-left group"
                  onClick={() => toggleLane(lane.id)}
                >
                  {isLaneCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                  )}
                  <span className="text-xs font-semibold text-muted-foreground">{lane.label}</span>
                  <div className="flex-1 border-t border-border ml-2" />
                </button>
              )}

              {!isLaneCollapsed && (
                <div className="flex gap-3 overflow-x-auto pb-4">
                  {COLUMNS.map((column, colIndex) => {
                    const isCollapsed = collapsedColumns.has(column.id)
                    const colTasks = getTasksForLaneAndStatus(lane.id, column.id)
                    const totalColCount = getColumnCount(column.id)
                    const wipLimit = wipLimits[column.id] || 0
                    const isOverWip = wipLimit > 0 && totalColCount > wipLimit

                    if (isCollapsed) {
                      return (
                        <motion.div
                          key={column.id}
                          initial={{ width: 0, opacity: 0 }}
                          animate={{ width: 40, opacity: 1 }}
                          className="flex-shrink-0 w-10 flex flex-col items-center bg-muted/50 rounded-lg border cursor-pointer py-3"
                          onClick={() => toggleColumn(column.id)}
                        >
                          <div className={cn("h-2.5 w-2.5 rounded-full mb-2", column.dot)} />
                          <span className="text-xs font-medium text-muted-foreground [writing-mode:vertical-lr] rotate-180">
                            {column.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60 mt-2 tabular-nums">{totalColCount}</span>
                        </motion.div>
                      )
                    }

                    return (
                      <motion.div
                        key={column.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: colIndex * 0.04, duration: 0.2 }}
                        className="flex-shrink-0 w-80 flex flex-col"
                      >
                        {/* Column header */}
                        <div
                          className={cn(
                            "flex items-center gap-2 mb-3 px-1 cursor-pointer group",
                            isOverWip && "text-red-600"
                          )}
                          onClick={() => toggleColumn(column.id)}
                        >
                          <div className={cn("h-2.5 w-2.5 rounded-full", column.dot)} />
                          <h3 className="text-sm font-semibold">{column.label}</h3>
                          <span className="text-[10px] text-muted-foreground/60 hidden group-hover:inline" title="Kanban view groups tasks by status">by status</span>
                          <span
                            className={cn(
                              "text-xs rounded-full px-2 py-0.5 tabular-nums",
                              isOverWip
                                ? "bg-red-100 text-red-700 font-medium"
                                : "text-muted-foreground bg-muted"
                            )}
                          >
                            {totalColCount}
                            {wipLimit > 0 && `/${wipLimit}`}
                          </span>
                          {isOverWip && (
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500 ml-auto" />
                          )}
                        </div>

                        {/* Droppable area */}
                        <Droppable droppableId={`${column.id}__${lane.id}`}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              className={cn(
                                "flex-1 space-y-2 rounded-lg p-2 min-h-[120px] transition-all duration-200",
                                snapshot.isDraggingOver
                                  ? "bg-muted border-2 border-dashed border-border"
                                  : "bg-muted/50 border-2 border-transparent",
                                isOverWip && !snapshot.isDraggingOver && "border-red-200 bg-red-50/30"
                              )}
                            >
                              {colTasks.map((task, index) => {
                                const isOverdue =
                                  task.dueDate &&
                                  isPast(new Date(task.dueDate)) &&
                                  !isToday(new Date(task.dueDate)) &&
                                  task.status !== "DONE"
                                const pb = PRIORITY_BADGES[task.priority]

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
                                            "rounded-lg border bg-card p-3 cursor-pointer transition-all duration-150 space-y-2",
                                            "hover:shadow-sm hover:-translate-y-0.5",
                                            snapshot.isDragging && "shadow-lg rotate-1 scale-[1.02] ring-1 ring-border"
                                          )}
                                          onClick={() => onTaskClick(task)}
                                        >
                                          {/* Title */}
                                          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
                                            {task.title}
                                          </p>

                                          {/* Description preview */}
                                          {task.description && (
                                            <p className="text-xs text-muted-foreground line-clamp-1">
                                              {task.description}
                                            </p>
                                          )}

                                          {/* Tags */}
                                          {task.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1">
                                              {task.tags.slice(0, 3).map((tag) => (
                                                <span
                                                  key={tag}
                                                  className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                                >
                                                  <Tag className="h-2.5 w-2.5" />
                                                  {tag}
                                                </span>
                                              ))}
                                              {task.tags.length > 3 && (
                                                <span className="text-[10px] text-muted-foreground/60">+{task.tags.length - 3}</span>
                                              )}
                                            </div>
                                          )}

                                          {/* Meta row */}
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", pb.cls)}>
                                                {pb.label}
                                              </span>
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
                                            </div>

                                            <div className="flex items-center gap-2">
                                              {(task.subtaskCount ?? 0) > 0 && (
                                                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                                                  <ListTree className="h-3 w-3" />
                                                  {task.subtaskDoneCount ?? 0}/{task.subtaskCount}
                                                </span>
                                              )}
                                            </div>
                                          </div>

                                          {/* Assignee row */}
                                          {task.assignees.length > 0 && (
                                            <div className="flex items-center gap-1.5 pt-0.5">
                                              {task.assignees.slice(0, 3).map((a) => (
                                                <div key={a.id} className="flex items-center gap-1">
                                                  <UserAvatar user={{ name: a.name, avatar: a.avatar }} size="xs" className="h-4 w-4 border border-background" />
                                                  <span className="text-[10px] text-muted-foreground">{a.name.split(" ")[0]}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </Draggable>
                                )
                              })}
                              {provided.placeholder}

                              {colTasks.length === 0 && !snapshot.isDraggingOver && addingTo !== column.id && (
                                <div className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-border rounded-lg">
                                  <p className="text-xs text-muted-foreground/60">No tasks</p>
                                </div>
                              )}

                              {/* Quick-add */}
                              <AnimatePresence>
                                {addingTo === column.id && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="rounded-lg border bg-card p-2.5 shadow-sm">
                                      <input
                                        ref={inputRef}
                                        type="text"
                                        placeholder="Task title..."
                                        value={newTitle}
                                        onChange={(e) => setNewTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && newTitle.trim()) handleQuickAdd(column.id)
                                          if (e.key === "Escape") { setAddingTo(null); setNewTitle("") }
                                        }}
                                        onBlur={() => { if (!newTitle.trim()) setAddingTo(null) }}
                                        disabled={creating}
                                        className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground/60"
                                      />
                                      {creating && (
                                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                          <Loader2 className="h-3 w-3 animate-spin" /> Creating...
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>

                              {addingTo !== column.id && projectId && defaultTaskListId && (
                                <button
                                  onClick={() => {
                                    setAddingTo(column.id)
                                    setNewTitle("")
                                    setTimeout(() => inputRef.current?.focus(), 50)
                                  }}
                                  className="flex items-center gap-1.5 w-full rounded-lg px-2 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent transition-colors"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Add task
                                </button>
                              )}
                            </div>
                          )}
                        </Droppable>
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </DragDropContext>
    </div>
  )
}

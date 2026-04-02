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
import {
  Plus,
  Calendar,
  ListTree,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  Tag,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import { format, isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { ProjectIcon, isUploadedIcon } from "@/components/projects/project-icon"
import { type TaskCardData } from "./task-card"

const COLUMNS: {
  id: TaskCardData["status"]
  label: string
  color: string
}[] = [
  { id: "TODO", label: "To Do", color: "bg-on-surface-variant/20" },
  { id: "IN_PROGRESS", label: "In Progress", color: "bg-tertiary-new" },
  { id: "IN_REVIEW", label: "In Review", color: "bg-secondary-new" },
  { id: "DONE", label: "Done", color: "bg-green-600" },
]

const PRIORITY_BADGES: Record<string, { label: string; cls: string }> = {
  URGENT: { label: "Urgent", cls: "bg-red-50 text-red-600 border-none" },
  HIGH: { label: "High", cls: "bg-orange-50 text-orange-600 border-none" },
  MEDIUM: { label: "Medium", cls: "bg-surface-container text-on-surface-variant border-none" },
  LOW: { label: "Low", cls: "bg-surface-container/50 text-on-surface-variant/70 border-none" },
  NONE: { label: "None", cls: "bg-transparent text-on-surface-variant/40 border-none" },
}

type SwimLaneMode = "none" | "assignee" | "priority"
type GroupByMode = "status" | "section"

interface KanbanViewProps {
  tasks: TaskCardData[]
  sections?: Array<{ id: string; name: string; tasks: TaskCardData[] }>
  onTaskClick: (task: TaskCardData) => void
  onStatusChange: (taskId: string, newStatus: TaskCardData["status"]) => void
  onSectionChange?: (taskId: string, newSectionId: string) => void
  projectId?: string
  defaultTaskListId?: string
}

export function KanbanView({
  tasks,
  sections = [],
  onTaskClick,
  onStatusChange,
  onSectionChange,
  projectId,
  defaultTaskListId,
}: KanbanViewProps) {
  const router = useRouter()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const [swimLaneMode, setSwimLaneMode] = useState<SwimLaneMode>("none")
  const [groupBy, setGroupBy] = useState<GroupByMode>(sections.length > 0 ? "section" : "status")
  const [wipLimits, setWipLimits] = useState<Record<string, number>>({
    TODO: 0, IN_PROGRESS: 5, IN_REVIEW: 3, DONE: 0,
  })
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set())
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set())
  const [showWipConfig, setShowWipConfig] = useState(false)
  const [showAddSection, setShowAddSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState("")
  const [creatingSection, setCreatingSection] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sectionInputRef = useRef<HTMLInputElement>(null)

  const columns = useMemo(() => {
    if (groupBy === "status") {
      return COLUMNS.map(col => ({
        id: col.id,
        label: col.label,
        color: col.color,
        type: "status" as const
      }))
    }
    return sections.map(sec => ({
      id: sec.id,
      label: sec.name,
      color: "bg-primary/20",
      type: "section" as const
    }))
  }, [groupBy, sections])

  const swimLanes = useMemo(() => {
    if (swimLaneMode === "none") return [{ id: "__all__", label: "All Tasks" }]
    if (swimLaneMode === "assignee") {
      const assigneeMap = new Map<string, string>()
      tasks.forEach((t) => {
        if (t.assignees.length === 0) {
          assigneeMap.set("__unassigned__", "Unassigned")
        } else {
          t.assignees.forEach((a) => assigneeMap.set(a.id, a.name))
        }
      })
      return Array.from(assigneeMap.entries()).map(([id, label]) => ({ id, label }))
    }
    return ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => ({
      id: p,
      label: PRIORITY_BADGES[p].label,
    }))
  }, [swimLaneMode, tasks])

  const getTasksForLaneAndColumn = useCallback(
    (laneId: string, columnId: string) => {
      return tasks
        .filter((t) => {
          // Filter by Column (either status or section)
          if (groupBy === "status") {
            if (t.status !== columnId) return false
          } else {
            if (t.taskListId !== columnId) return false
          }

          // Filter by Swimlane
          if (swimLaneMode === "none") return true
          if (swimLaneMode === "assignee") {
            if (laneId === "__unassigned__") return t.assignees.length === 0
            return t.assignees.some((a) => a.id === laneId)
          }
          return t.priority === laneId
        })
        .sort((a, b) => a.position - b.position)
    },
    [tasks, swimLaneMode, groupBy]
  )

  const getColumnCount = useCallback(
    (columnId: string) => {
      if (groupBy === "status") {
        return tasks.filter((t) => t.status === columnId).length
      }
      return tasks.filter((t) => t.taskListId === columnId).length
    },
    [tasks, groupBy]
  )

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId && destination.index === source.index) return

      const targetId = destination.droppableId.split("__")[0]
      
      if (groupBy === "status") {
        onStatusChange(draggableId, targetId as TaskCardData["status"])
      } else {
        if (onSectionChange) {
          onSectionChange(draggableId, targetId)
        }
      }
    },
    [onStatusChange, onSectionChange, groupBy]
  )

  const handleQuickAdd = async (columnId: string) => {
    if (!newTitle.trim() || !projectId) return
    setCreating(true)
    try {
      const body: any = {
        title: newTitle.trim(),
        projectId,
      }
      
      if (groupBy === "status") {
        body.status = columnId
        body.taskListId = defaultTaskListId
      } else {
        body.taskListId = columnId
      }

      if (!body.taskListId) return

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const handleCreateSection = async () => {
    if (!newSectionName.trim() || !projectId) return
    setCreatingSection(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSectionName.trim() }),
      })
      if (res.ok) {
        setNewSectionName("")
        setShowAddSection(false)
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create section:", error)
    } finally {
      setCreatingSection(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6 flex-wrap">
          {/* Group By Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">Group By</span>
            <div className="flex items-center gap-1 p-1 bg-surface-container-low rounded-xl">
              {([
                { id: "section", label: "Sections" },
                { id: "status", label: "Status" },
              ] as const).map((mode) => (
                <button
                  key={mode.id}
                  className={cn(
                    "px-3 py-1 text-[10px] font-black rounded-lg transition-all duration-200 uppercase tracking-wider",
                    groupBy === mode.id
                      ? "bg-surface-container-lowest text-primary shadow-sm" 
                      : "text-on-surface-variant/40 hover:text-primary"
                  )}
                  onClick={() => setGroupBy(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {groupBy === "section" && projectId && (
            <>
              <div className="h-6 w-[1px] bg-on-surface-variant/10" />
              {showAddSection ? (
                <div className="flex items-center gap-2 rounded-xl bg-surface-container-low p-1.5">
                  <input
                    ref={sectionInputRef}
                    type="text"
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSectionName.trim()) handleCreateSection()
                      if (e.key === "Escape") {
                        setShowAddSection(false)
                        setNewSectionName("")
                      }
                    }}
                    placeholder="New section..."
                    disabled={creatingSection}
                    className="h-8 rounded-lg bg-surface-container-lowest px-3 text-xs font-bold text-on-surface outline-none placeholder:text-on-surface-variant/30"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={handleCreateSection}
                    disabled={creatingSection || !newSectionName.trim()}
                    className="h-8 rounded-lg bg-primary px-3 text-[10px] font-black uppercase tracking-widest text-primary-foreground"
                  >
                    {creatingSection ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAddSection(true)
                    setTimeout(() => sectionInputRef.current?.focus(), 50)
                  }}
                  className="font-black text-[10px] uppercase tracking-widest text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-high transition-all"
                >
                  <Plus className="h-3.5 w-3.5 mr-2" />
                  Add Section
                </Button>
              )}
            </>
          )}

          <div className="h-6 w-[1px] bg-on-surface-variant/10" />

          {/* Swimlanes Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">Swimlanes</span>
            <div className="flex items-center gap-1 p-1 bg-surface-container-low rounded-xl">
              {(["none", "assignee", "priority"] as const).map((mode) => (
                <button
                  key={mode}
                  className={cn(
                    "px-3 py-1 text-[10px] font-black rounded-lg transition-all duration-200 uppercase tracking-wider",
                    swimLaneMode === mode 
                      ? "bg-surface-container-lowest text-primary shadow-sm" 
                      : "text-on-surface-variant/40 hover:text-primary"
                  )}
                  onClick={() => setSwimLaneMode(mode)}
                >
                  {mode === "none" ? "Off" : mode}
                </button>
              ))}
            </div>
          </div>
          
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowWipConfig(!showWipConfig)}
              className="font-black text-[10px] uppercase tracking-widest text-on-surface-variant/40 hover:text-primary hover:bg-surface-container-high transition-all"
            >
              <AlertTriangle className="h-3 w-3 mr-2" /> WIP
            </Button>
            {showWipConfig && (
              <div className="absolute left-0 top-full mt-2 z-50 rounded-xl bg-surface-container-lowest p-4 shadow-2xl shadow-primary/10 border border-on-surface-variant/5 min-w-[220px] animate-scale-in">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant/40 mb-4">WIP Configuration</p>
                <div className="space-y-3">
                  {columns.map((col) => (
                    <div key={col.id} className="flex items-center justify-between gap-4">
                      <span className="text-xs font-bold text-primary truncate flex-1">{col.label}</span>
                      <input
                        type="number"
                        min={0}
                        value={wipLimits[col.id] || 0}
                        onChange={(e) =>
                          setWipLimits((prev) => ({ ...prev, [col.id]: parseInt(e.target.value) || 0 }))
                        }
                        className="w-16 h-8 rounded-lg bg-surface-container-low border-none text-xs font-bold text-center focus:ring-2 focus:ring-primary/5 outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="font-black text-[10px] uppercase tracking-widest text-on-surface-variant/40">
            <Tag className="h-3.5 w-3.5 mr-2" /> Tags
          </Button>
          <Button variant="ghost" size="sm" className="font-black text-[10px] uppercase tracking-widest text-on-surface-variant/40">
            <ListTree className="h-3.5 w-3.5 mr-2" /> Subtasks
          </Button>
        </div>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex flex-col gap-8">
          {swimLanes.map((lane) => {
            const isLaneCollapsed = collapsedLanes.has(lane.id)

            return (
              <div key={lane.id} className="space-y-4">
                {swimLaneMode !== "none" && (
                  <button
                    className="flex items-center gap-3 w-full py-2 group"
                    onClick={() => toggleLane(lane.id)}
                  >
                    <div className="h-6 w-6 rounded-lg bg-surface-container-low flex items-center justify-center text-on-surface-variant/40 group-hover:text-primary transition-all">
                      {isLaneCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                    <span className="text-sm font-headline font-black uppercase tracking-widest text-primary">{lane.label}</span>
                    <div className="flex-1 h-[1px] bg-on-surface-variant/5" />
                  </button>
                )}

                {!isLaneCollapsed && (
                  <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-hide min-h-[400px]">
                    {columns.map((column, colIndex) => {
                      const isCollapsed = collapsedColumns.has(column.id)
                      const colTasks = getTasksForLaneAndColumn(lane.id, column.id)
                      const totalColCount = getColumnCount(column.id)
                      const wipLimit = wipLimits[column.id] || 0
                      const isOverWip = wipLimit > 0 && totalColCount > wipLimit

                      if (isCollapsed) {
                        return (
                          <div
                            key={column.id}
                            className="flex-shrink-0 w-12 flex flex-col items-center bg-surface-container-low/40 rounded-2xl cursor-pointer py-6 hover:bg-surface-container-low transition-colors"
                            onClick={() => toggleColumn(column.id)}
                          >
                            <div className={cn("h-2 w-2 rounded-full mb-4", column.color)} />
                            <span className="text-[10px] font-headline font-black uppercase tracking-widest text-on-surface-variant/40 [writing-mode:vertical-lr] rotate-180">
                              {column.label}
                            </span>
                            <span className="mt-4 bg-surface-container-high px-2 py-0.5 rounded-full text-[10px] font-black text-on-surface-variant/60">{totalColCount}</span>
                          </div>
                        )
                      }

                      return (
                        <div
                          key={column.id}
                          className="flex-shrink-0 w-80 flex flex-col h-full bg-surface-container-low/30 rounded-2xl p-4"
                        >
                          <div
                            className={cn("flex items-center justify-between mb-5 px-1 cursor-pointer group", isOverWip && "text-error")}
                            onClick={() => toggleColumn(column.id)}
                          >
                            <div className="flex items-center gap-2">
                              <div className={cn("w-2 h-2 rounded-full", column.color)} />
                              <h3 className="font-headline font-black text-xs uppercase tracking-widest text-primary truncate max-w-[180px]">{column.label}</h3>
                              <span className={cn("text-[10px] font-black rounded-full px-2 py-0.5", isOverWip ? "bg-error/10 text-error" : "bg-surface-container-high text-on-surface-variant/60")}>
                                {totalColCount}{wipLimit > 0 && `/${wipLimit}`}
                              </span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setAddingTo(column.id) }} className="p-1 hover:bg-surface-container-high rounded-lg text-on-surface-variant/30 hover:text-primary">
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>

                          <Droppable droppableId={`${column.id}__${lane.id}`}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className={cn("flex-1 space-y-3 min-h-[120px] transition-all duration-200 rounded-xl", snapshot.isDraggingOver && "bg-surface-container-high/40")}
                              >
                                {colTasks.map((task, index) => (
                                  <Draggable key={task.id} draggableId={task.id} index={index}>
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        onClick={() => onTaskClick(task)}
                                        className={cn(
                                          "bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-transparent hover:ring-2 hover:ring-primary/5 transition-all duration-200 group cursor-grab active:cursor-grabbing",
                                          snapshot.isDragging && "shadow-2xl shadow-primary/20 ring-2 ring-primary/10 rotate-2 scale-105"
                                        )}
                                      >
                                        <div className="space-y-4">
                                          <h4 className="text-sm font-bold text-primary leading-snug group-hover:text-tertiary-new transition-colors line-clamp-2">{task.title}</h4>
                                          <div className="flex flex-wrap gap-2">
                                            {task.priority !== "NONE" && <span className={cn("px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md", PRIORITY_BADGES[task.priority].cls)}>{task.priority}</span>}
                                          </div>
                                          <div className="flex items-center justify-between pt-1">
                                            <div className="flex items-center gap-3 text-on-surface-variant/40">
                                              {task.dueDate && <div className="flex items-center gap-1 text-[10px] font-bold"><Calendar className="h-3.5 w-3.5" /><span>{format(new Date(task.dueDate), "MMM d")}</span></div>}
                                              {(task.subtaskCount ?? 0) > 0 && <div className="flex items-center gap-1 text-[10px] font-bold"><ListTree className="h-3.5 w-3.5" /><span>{task.subtaskDoneCount}/{task.subtaskCount}</span></div>}
                                            </div>
                                            <div className="flex -space-x-2">
                                              {task.assignees.map((a) => <UserAvatar key={a.id} user={{ name: a.name, image: a.avatar }} size="xs" className="h-6 w-6 border-2 border-surface-container-lowest ring-1 ring-on-surface-variant/5" />)}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {provided.placeholder}

                                <AnimatePresence>
                                  {addingTo === column.id && (
                                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-surface-container-lowest p-4 rounded-xl shadow-xl shadow-primary/10 ring-2 ring-primary/5">
                                      <textarea
                                        ref={inputRef}
                                        placeholder="Task title..."
                                        value={newTitle}
                                        onChange={(e) => setNewTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.shiftKey && newTitle.trim()) { e.preventDefault(); handleQuickAdd(column.id); }
                                          if (e.key === "Escape") { setAddingTo(null); setNewTitle(""); }
                                        }}
                                        disabled={creating}
                                        className="w-full text-sm font-bold bg-transparent border-none p-0 focus:ring-0 placeholder:text-on-surface-variant/30 resize-none h-20"
                                        autoFocus
                                      />
                                      <div className="flex justify-end gap-2 mt-2">
                                        <Button size="sm" variant="ghost" className="font-bold text-on-surface-variant/60" onClick={() => { setAddingTo(null); setNewTitle(""); }}>Cancel</Button>
                                        <Button size="sm" onClick={() => handleQuickAdd(column.id)} disabled={creating || !newTitle.trim()} className="bg-primary text-primary-foreground font-bold">
                                          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
                                        </Button>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>

                                {addingTo !== column.id && (
                                  <button onClick={() => setAddingTo(column.id)} className="w-full py-3 flex items-center justify-center gap-2 text-[11px] font-black uppercase tracking-widest text-on-surface-variant/20 hover:text-primary hover:bg-surface-container-high/50 rounded-xl transition-all duration-300">
                                    <Plus className="h-4 w-4" /><span>Add Task</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </Droppable>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </DragDropContext>
    </div>
  )
}

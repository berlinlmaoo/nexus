"use client"

import { useState, useMemo, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useDroppable } from "@dnd-kit/core"
import { UserAvatar } from "@/components/ui/user-avatar"
import { PriorityBadge } from "./priority-badge"
import { StatusBadge } from "./status-badge"
import type { TaskCardData } from "./task-card"
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Plus,
  Calendar,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Tag,
  Loader2,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { format, isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"
import { BatchActionsBar } from "./batch-actions"

interface TaskListSection {
  id: string
  name: string
  tasks: TaskCardData[]
}

interface TaskListViewProps {
  sections: TaskListSection[]
  onTaskClick: (task: TaskCardData) => void
  onToggleStatus: (taskId: string, done: boolean) => void
  onAddTask: (taskListId: string) => void
  projectId?: string
}

type SortField = "title" | "priority" | "dueDate" | "status"
type SortDir = "asc" | "desc"

const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 }
const statusOrder = { TODO: 0, IN_PROGRESS: 1, IN_REVIEW: 2, DONE: 3, CANCELLED: 4 }

function SortableTaskRow({
  task,
  isRowSelected,
  onTaskClick,
  onToggleStatus,
  toggleRowSelect,
}: {
  task: TaskCardData
  isRowSelected: boolean
  onTaskClick: (task: TaskCardData) => void
  onToggleStatus: (taskId: string, done: boolean) => void
  toggleRowSelect: (taskId: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task, sectionId: task.taskListId } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const isDone = task.status === "DONE"
  const isOverdue =
    task.dueDate &&
    isPast(new Date(task.dueDate)) &&
    !isToday(new Date(task.dueDate)) &&
    !isDone

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-0 h-10 mx-2 px-2 rounded-md cursor-pointer transition-colors text-sm",
        isDragging && "z-50 shadow-lg bg-white",
        isRowSelected ? "bg-blue-50" : "hover:bg-slate-50"
      )}
      onClick={() => onTaskClick(task)}
    >
      {/* Drag handle */}
      <div className="flex items-center justify-center w-5 shrink-0">
        <button
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing touch-none text-neutral-300 hover:text-neutral-500 transition-opacity"
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Select checkbox */}
      <div className="flex items-center justify-center w-5 shrink-0">
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            toggleRowSelect(task.id)
          }}
        >
          <div
            className={cn(
              "h-3.5 w-3.5 rounded-sm border transition-colors",
              isRowSelected
                ? "bg-blue-600 border-blue-600"
                : "border-neutral-300"
            )}
          >
            {isRowSelected && (
              <svg viewBox="0 0 16 16" fill="white" className="h-3.5 w-3.5">
                <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z" />
              </svg>
            )}
          </div>
        </button>
      </div>

      {/* Status circle */}
      <div className="flex items-center justify-center w-6 shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleStatus(task.id, !isDone)
          }}
        >
          {isDone ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <Circle className="h-4 w-4 text-neutral-300 group-hover:text-neutral-400 transition-colors" />
          )}
        </button>
      </div>

      {/* Task ID / index placeholder */}
      <div className="w-16 shrink-0 text-xs text-neutral-400 font-mono px-1">
        {task.taskListId?.slice(-4)?.toUpperCase() || "TASK"}
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0 px-1">
        <span
          className={cn(
            "text-sm truncate block",
            isDone ? "line-through text-neutral-400" : "text-neutral-700"
          )}
        >
          {task.title}
        </span>
      </div>

      {/* Right side: assignees | labels | due date */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Assignees */}
        {task.assignees.length > 0 && (
          <div className="flex -space-x-1.5">
            {task.assignees.slice(0, 2).map((a) => (
              <UserAvatar
                key={a.id}
                user={{ name: a.name, avatar: a.avatar }}
                size="xs"
                className="h-6 w-6 border-2 border-white"
              />
            ))}
            {task.assignees.length > 2 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-neutral-100 text-[8px] font-medium text-neutral-500">
                +{task.assignees.length - 2}
              </div>
            )}
          </div>
        )}

        {/* Label pills */}
        {task.tags.length > 0 && (
          <div className="hidden lg:flex gap-1">
            {task.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 border border-neutral-200 rounded-full px-2 py-0.5 text-xs text-neutral-600"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Due date */}
        {task.dueDate && (
          <span
            className={cn(
              "flex items-center gap-1 text-xs",
              isOverdue ? "text-red-600 font-medium" : "text-neutral-500"
            )}
          >
            <Calendar className="h-3 w-3" />
            {format(new Date(task.dueDate), "dd MMM")}
          </span>
        )}

        {/* Priority indicator */}
        <PriorityBadge priority={task.priority} />
      </div>
    </div>
  )
}

function DragOverlayRow({ task }: { task: TaskCardData }) {
  const isDone = task.status === "DONE"
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 bg-background border shadow-xl opacity-90 text-[13px]">
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      {isDone ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={cn("truncate", isDone && "line-through text-muted-foreground")}>
        {task.title}
      </span>
    </div>
  )
}

function DroppableSection({
  section,
  isOver,
  children,
}: {
  section: TaskListSection
  isOver: boolean
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({ id: `section-${section.id}`, data: { sectionId: section.id } })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[32px] transition-colors duration-150",
        isOver && "bg-muted/20"
      )}
    >
      {children}
    </div>
  )
}

export function TaskListView({
  sections: initialSections,
  onTaskClick,
  onToggleStatus,
  onAddTask,
  projectId,
}: TaskListViewProps) {
  const router = useRouter()
  const [sections, setSections] = useState(initialSections)
  // Always sync from props — this is the key fix
  useEffect(() => { setSections(initialSections) }, [initialSections])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [sortField, setSortField] = useState<SortField>("priority")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [activeTask, setActiveTask] = useState<TaskCardData | null>(null)
  const [overSectionId, setOverSectionId] = useState<string | null>(null)
  const [renamingSection, setRenamingSection] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [addingSectionName, setAddingSectionName] = useState("")
  const [showAddSection, setShowAddSection] = useState(false)
  const [creatingSec, setCreatingSec] = useState(false)
  const [deletingSection, setDeletingSection] = useState<string | null>(null)
  const sectionInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  const sortTasks = useMemo(() => {
    return (tasks: TaskCardData[]) => {
      return [...tasks].sort((a, b) => {
        let cmp = 0
        switch (sortField) {
          case "title":
            cmp = a.title.localeCompare(b.title)
            break
          case "priority":
            cmp = priorityOrder[a.priority] - priorityOrder[b.priority]
            break
          case "dueDate": {
            const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
            const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
            cmp = da - db
            break
          }
          case "status":
            cmp = statusOrder[a.status] - statusOrder[b.status]
            break
        }
        return sortDir === "desc" ? -cmp : cmp
      })
    }
  }, [sortField, sortDir])

  const toggleRowSelect = (taskId: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const handleInlineCreate = async (taskListId: string) => {
    if (!newTitle.trim() || !projectId) return
    setCreating(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          taskListId,
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

  const startAdding = (sectionId: string) => {
    setAddingTo(sectionId)
    setNewTitle("")
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleCreateSection = async () => {
    if (!addingSectionName.trim() || !projectId) return
    setCreatingSec(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addingSectionName.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        // Optimistic: add new section to local state immediately
        setSections((prev) => [...prev, { id: data.id, name: data.name, tasks: [] }])
        setAddingSectionName("")
        setShowAddSection(false)
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create section:", error)
    } finally {
      setCreatingSec(false)
    }
  }

  const handleRenameSection = async (sectionId: string) => {
    if (!renameValue.trim() || !projectId) return
    // Optimistic rename
    setSections((prev) => prev.map((s) => s.id === sectionId ? { ...s, name: renameValue.trim() } : s))
    setRenamingSection(null)
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sectionId, name: renameValue.trim() }),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to rename section:", error)
    }
  }

  const handleDeleteSection = async (sectionId: string) => {
    if (!projectId || sections.length <= 1) return
    // Optimistic delete — move tasks to first remaining section
    const firstRemaining = sections.find((s) => s.id !== sectionId)
    if (!firstRemaining) return
    const deletedSection = sections.find((s) => s.id === sectionId)
    setSections((prev) => prev
      .filter((s) => s.id !== sectionId)
      .map((s) => s.id === firstRemaining.id
        ? { ...s, tasks: [...s.tasks, ...(deletedSection?.tasks || [])] }
        : s
      )
    )
    setDeletingSection(sectionId)
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sectionId }),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to delete section:", error)
    } finally {
      setDeletingSection(null)
    }
  }

  const handleReorderSection = async (sectionId: string, newPosition: number) => {
    if (!projectId) return
    // Optimistic update
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === sectionId)
      if (idx === -1) return prev
      const reordered = [...prev]
      const [moved] = reordered.splice(idx, 1)
      reordered.splice(newPosition, 0, moved)
      return reordered
    })
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sectionId, position: newPosition }),
      })
      router.refresh()
    } catch {
      setSections(initialSections)
    }
  }

  const findTaskAndSection = useCallback(
    (taskId: string) => {
      for (const section of sections) {
        const task = section.tasks.find((t) => t.id === taskId)
        if (task) return { task, section }
      }
      return null
    },
    [sections]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const result = findTaskAndSection(event.active.id as string)
      if (result) setActiveTask(result.task)
    },
    [findTaskAndSection]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event
      if (!over) {
        setOverSectionId(null)
        return
      }

      const overId = over.id as string
      if (overId.startsWith("section-")) {
        setOverSectionId(overId.replace("section-", ""))
      } else {
        const result = findTaskAndSection(overId)
        if (result) setOverSectionId(result.section.id)
      }
    },
    [findTaskAndSection]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      setActiveTask(null)
      setOverSectionId(null)

      if (!over) return

      const activeId = active.id as string
      const overId = over.id as string

      const activeResult = findTaskAndSection(activeId)
      if (!activeResult) return

      let targetSectionId: string
      if (overId.startsWith("section-")) {
        targetSectionId = overId.replace("section-", "")
      } else {
        const overResult = findTaskAndSection(overId)
        if (!overResult) return
        targetSectionId = overResult.section.id
      }

      const fromSectionId = activeResult.section.id

      if (fromSectionId === targetSectionId) {
        const section = sections.find((s) => s.id === fromSectionId)
        if (!section) return

        const sorted = sortTasks(section.tasks)
        const oldIndex = sorted.findIndex((t) => t.id === activeId)
        const newIndex = overId.startsWith("section-")
          ? sorted.length - 1
          : sorted.findIndex((t) => t.id === overId)

        if (oldIndex === newIndex) return

        const reordered = [...sorted]
        const [moved] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, moved)

        setSections((prev) =>
          prev.map((s) =>
            s.id === fromSectionId ? { ...s, tasks: reordered } : s
          )
        )

        fetch(`/api/tasks/${activeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: newIndex }),
        }).catch(() => {})
      } else {
        const task = activeResult.task
        const updatedTask = { ...task, taskListId: targetSectionId }

        setSections((prev) =>
          prev.map((s) => {
            if (s.id === fromSectionId) {
              return { ...s, tasks: s.tasks.filter((t) => t.id !== activeId) }
            }
            if (s.id === targetSectionId) {
              return { ...s, tasks: [...s.tasks, updatedTask] }
            }
            return s
          })
        )

        try {
          await fetch(`/api/tasks/${activeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskListId: targetSectionId }),
          })
        } catch {
          setSections((prev) =>
            prev.map((s) => {
              if (s.id === targetSectionId) {
                return { ...s, tasks: s.tasks.filter((t) => t.id !== activeId) }
              }
              if (s.id === fromSectionId) {
                return { ...s, tasks: [...s.tasks, task] }
              }
              return s
            })
          )
        }
      }
    },
    [findTaskAndSection, sections, sortTasks]
  )

  const SortHeader = ({
    label,
    field,
    className,
  }: {
    label: string
    field: SortField
    className?: string
  }) => (
    <button
      className={cn(
        "flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors",
        sortField === field && "text-foreground",
        className
      )}
      onClick={() => handleSort(field)}
    >
      {label}
      {sortField === field ? (
        sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-50" />
      )}
    </button>
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div>
        {/* Minimal sort controls — Plane style has no heavy column headers */}
        <div className="flex items-center gap-2 px-4 py-1.5 sticky top-0 z-10 bg-white">
          <SortHeader label="Name" field="title" />
          <SortHeader label="Due" field="dueDate" />
          <SortHeader label="Status" field="status" />
          <SortHeader label="Priority" field="priority" />
        </div>

        {sections.map((section, sectionIndex) => {
          const isCollapsed = collapsed[section.id]
          const sorted = sortTasks(section.tasks)
          const isOver = overSectionId === section.id

          return (
            <div key={section.id}>
              {/* Section header row — Plane style: status circle + name, no background */}
              <div
                className="group/section flex w-full items-center gap-2 h-9 px-3 hover:bg-slate-50 rounded-md mx-1 transition-colors"
              >
                {/* Drag handle for section reorder */}
                {projectId && sections.length > 1 && (
                  <div className="flex items-center gap-0.5">
                    {sectionIndex > 0 && (
                      <button
                        className="opacity-0 group-hover/section:opacity-100 text-muted-foreground/40 hover:text-muted-foreground transition-opacity p-0.5"
                        onClick={() => handleReorderSection(section.id, sectionIndex - 1)}
                        title="Move section up"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                    )}
                    {sectionIndex < sections.length - 1 && (
                      <button
                        className="opacity-0 group-hover/section:opacity-100 text-muted-foreground/40 hover:text-muted-foreground transition-opacity p-0.5"
                        onClick={() => handleReorderSection(section.id, sectionIndex + 1)}
                        title="Move section down"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                <button onClick={() => toggleCollapse(section.id)} className="flex items-center">
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>

                {renamingSection === section.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSection(section.id)
                      if (e.key === "Escape") setRenamingSection(null)
                    }}
                    onBlur={() => {
                      if (renameValue.trim()) handleRenameSection(section.id)
                      else setRenamingSection(null)
                    }}
                    className="font-semibold text-[13px] bg-transparent outline-none border-b border-foreground/30 px-0.5"
                    autoFocus
                  />
                ) : (
                  <button onClick={() => toggleCollapse(section.id)} className="flex items-center gap-2">
                    <Circle className="h-3 w-3 text-neutral-400" />
                    <span className="font-medium text-sm text-neutral-800">{section.name}</span>
                    <span className="text-xs text-neutral-400 tabular-nums">
                      {section.tasks.length}
                    </span>
                  </button>
                )}

                {/* Section context menu */}
                {projectId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="ml-auto opacity-0 group-hover/section:opacity-100 p-1 rounded hover:bg-muted/60 transition-opacity text-muted-foreground">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenamingSection(section.id)
                          setRenameValue(section.name)
                          setTimeout(() => renameInputRef.current?.focus(), 50)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Rename Section
                      </DropdownMenuItem>
                      {sections.length > 1 && (
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600"
                          disabled={deletingSection === section.id}
                          onClick={() => {
                            if (confirm(`Delete "${section.name}"? Tasks will be moved to the first remaining section.`)) {
                              handleDeleteSection(section.id)
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Delete Section
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Tasks */}
              {!isCollapsed && (
                <DroppableSection section={section} isOver={isOver && !!activeTask}>
                  <SortableContext
                    items={sorted.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sorted.map((task) => (
                      <SortableTaskRow
                        key={task.id}
                        task={task}
                        isRowSelected={selectedRows.has(task.id)}
                        onTaskClick={onTaskClick}
                        onToggleStatus={onToggleStatus}
                        toggleRowSelect={toggleRowSelect}
                      />
                    ))}
                  </SortableContext>

                  {/* Inline quick-add row */}
                  {addingTo === section.id ? (
                    <div className="flex items-center gap-2 h-10 mx-2 px-2 rounded-md bg-slate-50">
                      <Plus className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                      <input
                        ref={inputRef}
                        type="text"
                        placeholder="Write a task name, press Enter to save"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newTitle.trim()) {
                            handleInlineCreate(section.id)
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
                        className="flex-1 text-sm bg-transparent outline-none placeholder:text-neutral-400"
                      />
                      {creating && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                      )}
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-2 w-full h-8 mx-2 px-2 text-sm text-neutral-400 hover:text-neutral-600 hover:bg-slate-50 rounded-md transition-colors"
                      onClick={() => {
                        if (projectId) {
                          startAdding(section.id)
                        } else {
                          onAddTask(section.id)
                        }
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add task...</span>
                    </button>
                  )}
                </DroppableSection>
              )}
            </div>
          )
        })}

        {/* Add Section */}
        {projectId && (
          showAddSection ? (
            <div className="flex items-center gap-2 h-9 px-2 bg-muted/10 border-b border-border/50">
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={sectionInputRef}
                type="text"
                placeholder="Section name..."
                value={addingSectionName}
                onChange={(e) => setAddingSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && addingSectionName.trim()) handleCreateSection()
                  if (e.key === "Escape") { setShowAddSection(false); setAddingSectionName("") }
                }}
                onBlur={() => { if (!addingSectionName.trim()) setShowAddSection(false) }}
                disabled={creatingSec}
                className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-muted-foreground/50 font-semibold"
                autoFocus
              />
              {creatingSec && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
          ) : (
            <button
              className="flex items-center gap-2 w-full h-8 px-2 text-[13px] text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/20 transition-colors"
              onClick={() => {
                setShowAddSection(true)
                setAddingSectionName("")
                setTimeout(() => sectionInputRef.current?.focus(), 50)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Section</span>
            </button>
          )
        )}

        {/* Bulk actions bar */}
        <BatchActionsBar
          selectedIds={selectedRows}
          onClear={() => setSelectedRows(new Set())}
          onAction={async (action) => {
            const ids = Array.from(selectedRows)
            if (action.type === "delete") {
              for (let i = 0; i < ids.length; i++) {
                await fetch(`/api/tasks/${ids[i]}`, { method: "DELETE" })
              }
            } else if (action.type === "status") {
              for (let i = 0; i < ids.length; i++) {
                await fetch(`/api/tasks/${ids[i]}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: action.value }),
                })
              }
            } else if (action.type === "priority") {
              for (let i = 0; i < ids.length; i++) {
                await fetch(`/api/tasks/${ids[i]}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ priority: action.value }),
                })
              }
            }
            setSelectedRows(new Set())
            window.location.reload()
          }}
        />
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
        {activeTask ? <DragOverlayRow task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

"use client"

import { memo, useState, useCallback, useRef, useEffect, useMemo, type MouseEvent } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd"
import { UserAvatar } from "@/components/ui/user-avatar"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Button } from "@/components/ui/button"
import type { TaskCardData } from "./task-card"
import { cn } from "@/lib/utils"
import { Plus, Loader2, Calendar, MoreHorizontal, Pencil, Trash2, GripVertical, Copy, CheckCircle2, Circle, Palette, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useRouter } from "next/navigation"
import { isPast, isToday } from "date-fns"
import { toast } from "sonner"
import { formatTaskDueDate } from "@/lib/task-date-format"
import { TaskCustomFieldChip } from "./task-custom-field-chip"

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-yellow-500",
  LOW: "bg-blue-400",
  NONE: "",
}

type BoardColorSource = "status" | "priority" | "assignee" | "task_list" | "custom_field"

type BoardColorRule = {
  id: string
  source: BoardColorSource
  customFieldId?: string
  value: string
  color: string
}

type BoardColorPreset = {
  name: string
  value: string
  border: string
  text: string
}

const BOARD_COLOR_PRESETS: BoardColorPreset[] = [
  { name: "Sky", value: "#dbeafe", border: "#60a5fa", text: "#1e3a8a" },
  { name: "Emerald", value: "#dcfce7", border: "#34d399", text: "#14532d" },
  { name: "Amber", value: "#fef3c7", border: "#f59e0b", text: "#78350f" },
  { name: "Rose", value: "#ffe4e6", border: "#fb7185", text: "#881337" },
  { name: "Violet", value: "#ede9fe", border: "#8b5cf6", text: "#4c1d95" },
  { name: "Slate", value: "#e2e8f0", border: "#94a3b8", text: "#0f172a" },
]

function generateRuleId() {
  return Math.random().toString(36).slice(2, 10)
}

function getBoardColorStorageKey(projectId?: string) {
  return `nexus:calendar-color-rules:${projectId ?? "global"}`
}

function getRuleValueForTask(task: TaskCardData, rule: BoardColorRule) {
  switch (rule.source) {
    case "status":
      return [task.status]
    case "priority":
      return [task.priority]
    case "assignee":
      return task.assignees.map((assignee) => assignee.id)
    case "task_list":
      return [task.taskListId]
    case "custom_field":
      return (task.customFieldChips ?? [])
        .filter((chip) => chip.fieldId === rule.customFieldId)
        .flatMap((chip) => [chip.value ?? "", chip.label])
        .filter(Boolean)
    default:
      return []
  }
}

function getRuleOptionLabel(task: TaskCardData, source: BoardColorSource, value: string, customFieldId?: string) {
  if (source === "assignee") {
    return task.assignees.find((assignee) => assignee.id === value)?.name ?? value
  }
  if (source === "custom_field") {
    return task.customFieldChips?.find((chip) => chip.fieldId === customFieldId && (chip.value === value || chip.label === value))?.label ?? value
  }
  if (source === "task_list") {
    return task.taskListId === value ? (task.taskListName ?? value) : value
  }
  return value.replace(/_/g, " ")
}

interface Section {
  id: string
  name: string
  tasks: TaskCardData[]
  isTemporary?: boolean
}

interface BoardViewProps {
  tasks: TaskCardData[]
  sections?: Section[]
  onTaskClick: (task: TaskCardData) => void
  onStatusChange: (taskId: string, newStatus: TaskCardData["status"]) => void
  onSectionChange?: (taskId: string, newSectionId: string) => void
  projectId?: string
  defaultTaskListId?: string
  enableTaskBatchDuplicate?: boolean
}

function sortTasksDoneLast(tasks: TaskCardData[]) {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === "DONE"
    const bDone = b.status === "DONE"
    if (aDone !== bDone) return aDone ? 1 : -1
    return a.position - b.position
  })
}

interface BoardTaskCardProps {
  task: TaskCardData
  hydrated: boolean
  isSelected: boolean
  isDragging: boolean
  isDuplicating: boolean
  isDeleting: boolean
  enableTaskBatchDuplicate: boolean
  colorPreset?: BoardColorPreset | null
  onOpenTask: (task: TaskCardData) => void
  onToggleSelection: (taskId: string) => void
  onToggleStatus: (taskId: string, newStatus: TaskCardData["status"]) => void
  onDuplicateTask: (task: TaskCardData) => void
  onRequestDeleteTask: (task: TaskCardData) => void
}

const BoardTaskCard = memo(function BoardTaskCard({
  task,
  hydrated,
  isSelected,
  isDragging,
  isDuplicating,
  isDeleting,
  enableTaskBatchDuplicate,
  colorPreset,
  onOpenTask,
  onToggleSelection,
  onToggleStatus,
  onDuplicateTask,
  onRequestDeleteTask,
}: BoardTaskCardProps) {
  const isOverdue =
    hydrated &&
    task.dueDate &&
    isPast(new Date(task.dueDate)) &&
    !isToday(new Date(task.dueDate)) &&
    task.status !== "DONE"
  const isDone = task.status === "DONE"

  const handleOpen = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (enableTaskBatchDuplicate && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onToggleSelection(task.id)
      return
    }

    onOpenTask(task)
  }, [enableTaskBatchDuplicate, onOpenTask, onToggleSelection, task])

  const handleToggleDone = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggleStatus(task.id, isDone ? "TODO" : "DONE")
  }, [isDone, onToggleStatus, task.id])

  const handleDuplicate = useCallback(() => {
    onDuplicateTask(task)
  }, [onDuplicateTask, task])

  const handleDelete = useCallback(() => {
    onRequestDeleteTask(task)
  }, [onRequestDeleteTask, task])

  return (
    <div
      className={cn(
        "group/task relative rounded-lg border bg-card p-3 cursor-pointer transition-all duration-150",
        "hover:shadow-md",
        isSelected && "border-primary/30 bg-primary/5 ring-2 ring-primary/20 shadow-md",
        isDragging && "shadow-xl ring-1 ring-border"
      )}
      style={colorPreset ? {
        backgroundColor: colorPreset.value,
        borderColor: colorPreset.border,
        color: colorPreset.text,
      } : undefined}
      onClick={handleOpen}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(event) => event.stopPropagation()}
            className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-100 transition-opacity hover:bg-muted/60 hover:text-foreground"
            style={colorPreset ? { color: colorPreset.text } : undefined}
            aria-label="Task actions"
          >
            {isDuplicating || isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoreHorizontal className="h-3.5 w-3.5" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem onClick={handleDuplicate}>
            <Copy className="mr-2 h-3.5 w-3.5" />
            Duplicate task
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleDelete}
            className="text-red-600 focus:text-red-600"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="px-0">
        {task.isCrossProject && task.primaryProjectName && (
          <p className="mb-1 text-[10px] font-medium text-muted-foreground/80">
            From {task.primaryProjectName}
          </p>
        )}
        <div className="flex items-start gap-2">
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleToggleDone}
            className="mt-0.5 shrink-0 rounded-full text-muted-foreground transition-colors hover:text-foreground"
            aria-label={isDone ? "Mark task as not done" : "Mark task as done"}
            title={isDone ? "Mark as not done" : "Mark as done"}
          >
            {isDone ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <Circle className="h-4 w-4 opacity-70" />
            )}
          </button>
          <p
            className={cn(
              "pr-8 text-[13px] font-medium leading-snug line-clamp-2",
              colorPreset && "text-inherit",
              isDone ? "text-muted-foreground/70 line-through" : !colorPreset && "text-foreground"
            )}
          >
            {task.title}
          </p>
        </div>
      </div>

      {task.customFieldChips && task.customFieldChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
          {task.customFieldChips.slice(0, 3).map((chip) => (
            <TaskCustomFieldChip key={chip.id} chip={chip} className="max-w-[150px]" />
          ))}
          {task.customFieldChips.length > 3 && (
            <span
              className="inline-flex items-center rounded-full bg-muted/50 px-2 py-1 text-[10px] font-semibold text-muted-foreground/80"
              title={task.customFieldChips.slice(3).map((chip) => `${chip.fieldName}: ${chip.label}`).join(", ")}
            >
              +{task.customFieldChips.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          {hydrated && task.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px]",
                colorPreset && "text-inherit",
                isOverdue ? "text-red-600 font-medium" : !colorPreset && "text-muted-foreground"
              )}
            >
              <Calendar className="h-3 w-3" />
              {formatTaskDueDate(task.dueDate)}
            </span>
          )}
          {task.priority !== "NONE" && PRIORITY_COLORS[task.priority] && (
            <span className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-full", PRIORITY_COLORS[task.priority])} />
              <span className="text-[10px] text-muted-foreground capitalize">{task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}</span>
            </span>
          )}
        </div>

        {task.assignees.length > 0 && (
          <div className="flex -space-x-1">
            {task.assignees.slice(0, 2).map((a) => (
              <UserAvatar
                key={a.id}
                user={{ name: a.name, avatar: a.avatar }}
                size="xs"
                className="h-6 w-6 border border-background"
              />
            ))}
            {task.assignees.length > 2 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-[8px] font-medium text-muted-foreground">
                +{task.assignees.length - 2}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export function BoardView({
  sections,
  onTaskClick,
  onStatusChange,
  onSectionChange,
  projectId,
  enableTaskBatchDuplicate = false,
}: BoardViewProps) {
  const router = useRouter()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const quickAddInFlightRef = useRef(false)
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [showAddSection, setShowAddSection] = useState(false)
  const [addingSectionName, setAddingSectionName] = useState("")
  const [creatingSec, setCreatingSec] = useState(false)
  const [deletingColumn, setDeletingColumn] = useState<string | null>(null)
  const [duplicatingTaskId, setDuplicatingTaskId] = useState<string | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [showBulkDuplicateDialog, setShowBulkDuplicateDialog] = useState(false)
  const [bulkDuplicateDueDate, setBulkDuplicateDueDate] = useState<string | null>(null)
  const [bulkDuplicating, setBulkDuplicating] = useState(false)
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState<{ id: string; name: string } | null>(null)
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<{ id: string; title: string } | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [colorPanelOpen, setColorPanelOpen] = useState(false)
  const [colorRules, setColorRules] = useState<BoardColorRule[]>([])
  const sectionInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Use sections as columns (Asana-style)
  const columns = useMemo(() => sections ?? [], [sections])
  const columnEntries = useMemo(
    () =>
      columns.map((column, index) => ({
        ...column,
        index,
        sortedTasks: sortTasksDoneLast(column.tasks),
      })),
    [columns]
  )
  const selectedTasks = columns.flatMap((column) =>
    column.tasks.filter((task) => selectedTaskIds.has(task.id))
  )

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(getBoardColorStorageKey(projectId))
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setColorRules(parsed.filter((rule) => rule?.id && rule?.source && rule?.color))
      }
    } catch (error) {
      console.error("Failed to load board color rules:", error)
    }
  }, [projectId])

  useEffect(() => {
    try {
      window.localStorage.setItem(getBoardColorStorageKey(projectId), JSON.stringify(colorRules))
    } catch (error) {
      console.error("Failed to save board color rules:", error)
    }
  }, [colorRules, projectId])

  const customColorFields = useMemo(() => {
    const fields = new Map<string, { fieldId: string; fieldName: string }>()
    for (const column of columns) {
      for (const task of column.tasks) {
        for (const chip of task.customFieldChips ?? []) {
          if (chip.fieldType === "SELECT" || chip.fieldType === "MULTI_SELECT" || chip.fieldType === "STATUS" || chip.fieldType === "PLACE") {
            fields.set(chip.fieldId, { fieldId: chip.fieldId, fieldName: chip.fieldName })
          }
        }
      }
    }
    return Array.from(fields.values())
  }, [columns])

  const allBoardTasks = useMemo(
    () => columns.flatMap((column) => column.tasks),
    [columns]
  )

  const getRuleValues = useCallback((rule: BoardColorRule) => {
    const values = new Map<string, string>()

    for (const task of allBoardTasks) {
      for (const value of getRuleValueForTask(task, rule)) {
        if (!value) continue
        values.set(value, getRuleOptionLabel(task, rule.source, value, rule.customFieldId))
      }
    }

    if (rule.source === "status") {
      return [
        { value: "TODO", label: "To do" },
        { value: "IN_PROGRESS", label: "In progress" },
        { value: "IN_REVIEW", label: "In review" },
        { value: "DONE", label: "Done" },
        { value: "CANCELLED", label: "Cancelled" },
      ]
    }

    if (rule.source === "priority") {
      return [
        { value: "URGENT", label: "Urgent" },
        { value: "HIGH", label: "High" },
        { value: "MEDIUM", label: "Medium" },
        { value: "LOW", label: "Low" },
        { value: "NONE", label: "None" },
      ]
    }

    return Array.from(values.entries()).map(([value, label]) => ({ value, label }))
  }, [allBoardTasks])

  const getTaskColorRule = useCallback((task: TaskCardData) => {
    return colorRules.find((rule) => {
      if (!rule.value) return false
      return getRuleValueForTask(task, rule).includes(rule.value)
    })
  }, [colorRules])

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId && destination.index === source.index) return

      const newSectionId = destination.droppableId
      const destinationSection = columns.find((column) => column.id === newSectionId)
      const draggedTask = columns.flatMap((column) => column.tasks).find((task) => task.id === draggableId)

      if (destinationSection?.isTemporary || draggedTask?.isCrossProject) return

      if (onSectionChange) {
        onSectionChange(draggableId, newSectionId)
      }
    },
    [columns, onSectionChange]
  )

  const handleAddColorRule = () => {
    setColorRules((prev) => [
      ...prev,
      {
        id: generateRuleId(),
        source: "status",
        value: "TODO",
        color: BOARD_COLOR_PRESETS[0].value,
      },
    ])
  }

  const updateColorRule = (ruleId: string, patch: Partial<BoardColorRule>) => {
    setColorRules((prev) =>
      prev.map((rule) => {
        if (rule.id !== ruleId) return rule

        const nextRule = { ...rule, ...patch }
        if (patch.source && patch.source !== "custom_field") {
          delete nextRule.customFieldId
        }
        if (patch.source || patch.customFieldId) {
          nextRule.value = ""
        }
        return nextRule
      })
    )
  }

  const removeColorRule = (ruleId: string) => {
    setColorRules((prev) => prev.filter((rule) => rule.id !== ruleId))
  }

  const handleQuickAdd = async (sectionId: string) => {
    if (!newTitle.trim() || !projectId || quickAddInFlightRef.current) return
    quickAddInFlightRef.current = true
    setCreating(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          taskListId: sectionId,
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
      quickAddInFlightRef.current = false
      setCreating(false)
    }
  }

  const startAdding = (columnId: string) => {
    setAddingTo(columnId)
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

  const handleRenameColumn = async (columnId: string) => {
    if (!renameValue.trim() || !projectId) return
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: columnId, name: renameValue.trim() }),
      })
      setRenamingColumn(null)
      router.refresh()
    } catch (error) {
      console.error("Failed to rename section:", error)
    }
  }

  const handleDeleteColumn = async (columnId: string) => {
    if (!projectId) return
    setDeletingColumn(columnId)
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: columnId }),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to delete section:", error)
    } finally {
      setDeletingColumn(null)
    }
  }

  const handleReorderColumn = async (columnId: string, newPosition: number) => {
    if (!projectId) return
    try {
      await fetch(`/api/projects/${projectId}/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: columnId, position: newPosition }),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to reorder section:", error)
    }
  }

  const handleDuplicateTask = useCallback(async (task: TaskCardData) => {
    if (!enableTaskBatchDuplicate) {
      setDuplicatingTaskId(task.id)
      try {
        const res = await fetch(`/api/tasks/${task.id}/duplicate`, {
          method: "POST",
        })

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error || `Failed to duplicate ${task.title}`)
        }

        toast.success("Task duplicated")
        router.refresh()
      } catch (error) {
        console.error("Failed to duplicate task:", error)
        toast.error(error instanceof Error ? error.message : "Failed to duplicate task")
      } finally {
        setDuplicatingTaskId(null)
      }
      return
    }

    setSelectedTaskIds(new Set([task.id]))
    setBulkDuplicateDueDate(task.dueDate ?? null)
    setShowBulkDuplicateDialog(true)
  }, [enableTaskBatchDuplicate, router])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    setDeletingTaskId(taskId)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to delete task")
      }

      toast.success("Task deleted")
      router.refresh()
    } catch (error) {
      console.error("Failed to delete task:", error)
      toast.error(error instanceof Error ? error.message : "Failed to delete task")
    } finally {
      setDeletingTaskId(null)
    }
  }, [router])

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  const clearSelectedTasks = () => {
    setSelectedTaskIds(new Set())
  }

  const openBulkDuplicateDialog = () => {
    if (selectedTasks.length === 0) return
    setBulkDuplicateDueDate(selectedTasks[0]?.dueDate ?? null)
    setShowBulkDuplicateDialog(true)
  }

  const handleBulkDuplicate = async () => {
    if (selectedTasks.length === 0) return
    if (!bulkDuplicateDueDate) {
      toast.error("Pick a new due date first")
      return
    }

    setBulkDuplicating(true)
    setDuplicatingTaskId(selectedTasks.length === 1 ? selectedTasks[0].id : null)
    try {
      const results = await Promise.all(
        selectedTasks.map(async (task) => {
          const res = await fetch(`/api/tasks/${task.id}/duplicate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dueDate: bulkDuplicateDueDate }),
          })

          if (!res.ok) {
            const data = await res.json().catch(() => null)
            throw new Error(data?.error || `Failed to duplicate ${task.title}`)
          }

          return res.json()
        })
      )

      toast.success(
        results.length === 1
          ? "Task duplicated"
          : `${results.length} tasks duplicated`
      )
      setShowBulkDuplicateDialog(false)
      setBulkDuplicateDueDate(null)
      setSelectedTaskIds(new Set())
      router.refresh()
    } catch (error) {
      console.error("Failed to duplicate selected tasks:", error)
      toast.error(error instanceof Error ? error.message : "Failed to duplicate selected tasks")
    } finally {
      setBulkDuplicating(false)
      setDuplicatingTaskId(null)
    }
  }

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!renamingColumn) return

    const focusTimer = window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)

    return () => window.clearTimeout(focusTimer)
  }, [renamingColumn])

  useEffect(() => {
    if (enableTaskBatchDuplicate) return
    setSelectedTaskIds(new Set())
    setShowBulkDuplicateDialog(false)
    setBulkDuplicateDueDate(null)
  }, [enableTaskBatchDuplicate])

  return (
    <>
      {enableTaskBatchDuplicate && (
        selectedTasks.length > 0 ? (
          <div className="sticky top-0 z-20 mb-3 flex items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-background/90 px-4 py-3 shadow-lg backdrop-blur">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-foreground">
                  {selectedTasks.length} task{selectedTasks.length === 1 ? "" : "s"} selected
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Use Cmd/Ctrl + click to add or remove tasks from this selection.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSelectedTasks}
                className="rounded-xl"
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={openBulkDuplicateDialog}
                className="rounded-xl bg-primary text-primary-foreground"
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                Duplicate selected
              </Button>
            </div>
          </div>
        ) : (
          <div className="mb-3 px-4 text-[11px] font-medium text-muted-foreground/75">
            Cmd/Ctrl + click a task card to multi-select it for duplicate.
          </div>
        )
      )}

      <div className="mb-3 flex items-center justify-end px-3">
        <button
          type="button"
          onClick={() => setColorPanelOpen((open) => !open)}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest transition-colors",
            colorPanelOpen
              ? "bg-primary text-primary-foreground"
              : "bg-surface-container-low text-on-surface-variant/60 hover:bg-surface-container"
          )}
        >
          <Palette className="h-3.5 w-3.5" />
          Colors
        </button>
      </div>

      {colorPanelOpen && (
        <div className="mx-3 mb-4 rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container-lowest p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/35">
                Conditional color
              </p>
              <h3 className="mt-1 text-lg font-headline font-black text-primary">
                Board card colors
              </h3>
              <p className="mt-1 max-w-2xl text-xs font-medium text-on-surface-variant/50">
                Rule ini shared dengan Calendar view, jadi kategori warna tetap konsisten antar view.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddColorRule}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-[10px] font-black uppercase tracking-widest text-primary-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                New color setting
              </button>
              <button
                type="button"
                onClick={() => setColorPanelOpen(false)}
                className="rounded-2xl p-2 text-on-surface-variant/40 transition-colors hover:bg-surface-container hover:text-primary"
                aria-label="Close color settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {colorRules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-on-surface-variant/10 px-4 py-5 text-sm font-medium text-on-surface-variant/45">
                Belum ada rule warna. Tambah rule untuk highlight card berdasarkan status, priority, assignee, section, atau custom field.
              </div>
            ) : (
              colorRules.map((rule) => {
                const sourceOptions: { value: BoardColorSource; label: string }[] = [
                  { value: "status", label: "Status" },
                  { value: "priority", label: "Priority" },
                  { value: "assignee", label: "Assignee" },
                  { value: "task_list", label: "Section" },
                  { value: "custom_field", label: "Custom field" },
                ]
                const valueOptions = getRuleValues(rule)

                return (
                  <div key={rule.id} className="grid gap-3 rounded-2xl bg-surface-container-low p-3 lg:grid-cols-[150px_180px_minmax(180px,1fr)_minmax(180px,1fr)_auto] lg:items-center">
                    <select
                      value={rule.source}
                      onChange={(event) => updateColorRule(rule.id, { source: event.target.value as BoardColorSource })}
                      className="h-10 rounded-xl border-none bg-surface-container-lowest px-3 text-xs font-bold text-on-surface"
                    >
                      {sourceOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    {rule.source === "custom_field" ? (
                      <select
                        value={rule.customFieldId || ""}
                        onChange={(event) => updateColorRule(rule.id, { customFieldId: event.target.value })}
                        className="h-10 rounded-xl border-none bg-surface-container-lowest px-3 text-xs font-bold text-on-surface"
                      >
                        <option value="">Select field</option>
                        {customColorFields.map((field) => (
                          <option key={field.fieldId} value={field.fieldId}>
                            {field.fieldName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="hidden lg:block" />
                    )}

                    <select
                      value={rule.value}
                      onChange={(event) => updateColorRule(rule.id, { value: event.target.value })}
                      disabled={rule.source === "custom_field" && !rule.customFieldId}
                      className="h-10 rounded-xl border-none bg-surface-container-lowest px-3 text-xs font-bold text-on-surface disabled:opacity-50"
                    >
                      <option value="">Select value</option>
                      {valueOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <div className="flex flex-wrap items-center gap-2">
                      {BOARD_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => updateColorRule(rule.id, { color: preset.value })}
                          className={cn(
                            "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
                            rule.color === preset.value ? "border-primary" : "border-transparent"
                          )}
                          style={{ backgroundColor: preset.value }}
                          aria-label={`Use ${preset.name}`}
                          title={preset.name}
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeColorRule(rule.id)}
                      className="inline-flex h-10 items-center justify-center rounded-xl px-3 text-red-500 transition-colors hover:bg-red-50"
                      aria-label="Remove color rule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 pb-4 overflow-x-auto min-w-0 w-full h-full px-3 pt-3">
        {columnEntries.map((column) => (
          <div
            key={column.id}
            className="flex-1 min-w-[250px] flex flex-col"
          >
            {/* Column header */}
            <div className="group/col flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Reorder arrows */}
                {projectId && columnEntries.length > 1 && (
                  <div className="flex flex-col opacity-0 group-hover/col:opacity-100 transition-opacity">
                    {column.index > 0 && (
                      <button
                        className="text-muted-foreground/40 hover:text-muted-foreground p-0"
                        onClick={() => handleReorderColumn(column.id, column.index - 1)}
                        title="Move left"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {renamingColumn === column.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameColumn(column.id)
                      if (e.key === "Escape") setRenamingColumn(null)
                    }}
                    className="text-[13px] font-semibold bg-transparent outline-none border-b border-foreground/30 px-0.5 min-w-0"
                  />
                ) : (
                  <>
                    <h3 className="text-[13px] font-semibold text-foreground truncate">{column.name}</h3>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {column.tasks.length}
                    </span>
                    {column.isTemporary && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-primary">
                        Linked
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 hidden group-hover/col:inline" title="Board view groups tasks by project sections">by section</span>
                  </>
                )}
              </div>

              {/* Column context menu */}
              {projectId && !column.isTemporary && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="opacity-0 group-hover/col:opacity-100 p-1 rounded hover:bg-muted/60 transition-opacity text-muted-foreground shrink-0">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() => {
                        setRenamingColumn(column.id)
                        setRenameValue(column.name)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-2" />
                      Rename Section
                    </DropdownMenuItem>
                    {column.index > 0 && (
                      <DropdownMenuItem
                        onClick={() => handleReorderColumn(column.id, column.index - 1)}
                      >
                        Move Left
                      </DropdownMenuItem>
                    )}
                    {column.index < columnEntries.length - 1 && (
                      <DropdownMenuItem
                        onClick={() => handleReorderColumn(column.id, column.index + 1)}
                      >
                        Move Right
                      </DropdownMenuItem>
                    )}
                    {columnEntries.length > 1 && (
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        disabled={deletingColumn === column.id}
                        onClick={() => setConfirmDeleteColumn({ id: column.id, name: column.name })}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete Section
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
                  {column.sortedTasks.map((task, index) => {
                    const colorRule = getTaskColorRule(task)
                    const colorPreset = colorRule
                      ? BOARD_COLOR_PRESETS.find((preset) => preset.value === colorRule.color)
                      : null

                    return (
                      <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={Boolean(column.isTemporary || task.isCrossProject)}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                          >
                            <BoardTaskCard
                              task={task}
                              hydrated={hydrated}
                            isSelected={selectedTaskIds.has(task.id)}
                            isDragging={snapshot.isDragging}
                            isDuplicating={duplicatingTaskId === task.id}
                            isDeleting={deletingTaskId === task.id}
                            enableTaskBatchDuplicate={enableTaskBatchDuplicate}
                            colorPreset={colorPreset}
                            onOpenTask={onTaskClick}
                            onToggleSelection={toggleTaskSelection}
                            onToggleStatus={onStatusChange}
                            onDuplicateTask={handleDuplicateTask}
                            onRequestDeleteTask={(taskToDelete) => {
                              setConfirmDeleteTask({ id: taskToDelete.id, title: taskToDelete.title })
                            }}
                          />
                          </div>
                        )}
                      </Draggable>
                    )
                  })}
                  {provided.placeholder}

                  {/* Empty state */}
                  {column.tasks.length === 0 && !snapshot.isDraggingOver && addingTo !== column.id && (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-xs text-muted-foreground/40">No tasks</p>
                    </div>
                  )}

                  {/* Inline quick-add */}
                  {addingTo === column.id && (
                    <div className="rounded-lg border bg-card p-2.5">
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
                        onBlur={() => {
                          if (creating || quickAddInFlightRef.current) return
                          if (newTitle.trim()) {
                            void handleQuickAdd(column.id)
                            return
                          }

                          setAddingTo(null)
                        }}
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
                  {addingTo !== column.id && projectId && !column.isTemporary && (
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
        ))}
        {/* Add Section column */}
        {projectId && (
          <div className="flex-shrink-0 w-72 flex flex-col">
            {showAddSection ? (
              <div className="rounded-lg border bg-card p-2.5">
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
                  className="w-full text-[13px] font-semibold bg-transparent outline-none placeholder:text-muted-foreground/50"
                  autoFocus
                />
                {creatingSec && (
                  <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Creating...
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => {
                  setShowAddSection(true)
                  setAddingSectionName("")
                  setTimeout(() => sectionInputRef.current?.focus(), 50)
                }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 transition-colors border border-dashed border-border/50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Section
              </button>
            )}
          </div>
        )}
      </div>
      </DragDropContext>

      <ConfirmDialog
        open={!!confirmDeleteColumn}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteColumn(null)
        }}
        title="Delete section?"
        description={
          confirmDeleteColumn
            ? `Delete "${confirmDeleteColumn.name}"? Tasks in this section will be moved to the first remaining section.`
            : ""
        }
        confirmLabel="Delete section"
        icon={<Trash2 className="h-5 w-5" />}
        isLoading={deletingColumn === confirmDeleteColumn?.id}
        onConfirm={async () => {
          if (!confirmDeleteColumn) return
          await handleDeleteColumn(confirmDeleteColumn.id)
          setConfirmDeleteColumn(null)
        }}
      />

      <ConfirmDialog
        open={!!confirmDeleteTask}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteTask(null)
        }}
        title="Delete task?"
        description={
          confirmDeleteTask
            ? `Delete "${confirmDeleteTask.title}" permanently? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete task"
        icon={<Trash2 className="h-5 w-5" />}
        isLoading={deletingTaskId === confirmDeleteTask?.id}
        onConfirm={async () => {
          if (!confirmDeleteTask) return
          await handleDeleteTask(confirmDeleteTask.id)
          setConfirmDeleteTask(null)
        }}
      />

      <Dialog
        open={enableTaskBatchDuplicate && showBulkDuplicateDialog}
        onOpenChange={setShowBulkDuplicateDialog}
      >
        <DialogContent className="sm:max-w-md rounded-[2rem] border-none p-6 shadow-2xl">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-xl font-black tracking-tight text-primary">
              Duplicate {selectedTasks.length} Task{selectedTasks.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Pick the new due date for the duplicated task set. This is handy when the task structure stays the same and only the schedule moves.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <DateTimePicker
              value={bulkDuplicateDueDate}
              onChange={setBulkDuplicateDueDate}
              variant="inline"
            />

            <div className="rounded-2xl bg-surface-container-low px-4 py-3 text-xs text-on-surface-variant/60">
              {selectedTasks.slice(0, 3).map((task) => task.title).join(", ")}
              {selectedTasks.length > 3 ? `, +${selectedTasks.length - 3} more` : ""}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowBulkDuplicateDialog(false)}
              disabled={bulkDuplicating}
              className="rounded-2xl"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleBulkDuplicate}
              disabled={bulkDuplicating || !bulkDuplicateDueDate}
              className="rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {bulkDuplicating ? "Duplicating..." : "Duplicate tasks"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

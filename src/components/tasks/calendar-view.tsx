"use client"

import { useEffect, useState, useMemo, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/ui/user-avatar"
import type { TaskCardData } from "./task-card"
import {
  addQuarters,
  addWeeks,
  startOfMonth,
  startOfQuarter,
  endOfMonth,
  endOfQuarter,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subQuarters,
  subWeeks,
  subMonths,
} from "date-fns"
import { ChevronLeft, ChevronRight, Plus, Loader2, Clock3, GripVertical, Move, Palette, Copy, X, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"

interface CalendarViewProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
  onTaskDateChange?: (taskId: string, dueDate: string) => Promise<void> | void
  projectId?: string
  defaultTaskListId?: string
  customDateSources?: {
    fieldId: string
    fieldName: string
  }[]
}

type CalendarDisplayMode = "week" | "month" | "quarter"
type CalendarColorSource = "status" | "priority" | "assignee" | "task_list" | "custom_field"
type CalendarTaskOccurrence = {
  id: string
  task: TaskCardData
  dateValue: string
  isDueDate: boolean
  sourceName?: string
}
type CalendarColorRule = {
  id: string
  source: CalendarColorSource
  customFieldId?: string
  value: string
  color: string
}

const CALENDAR_COLOR_PRESETS = [
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

function getTaskTimeLabel(dueDate: string | null) {
  if (!dueDate) return null

  const date = new Date(dueDate)
  const hasExplicitTime = date.getHours() !== 0 || date.getMinutes() !== 0
  return hasExplicitTime ? format(date, "HH:mm") : null
}

function getCalendarColorStorageKey(projectId?: string) {
  return `nexus:calendar-color-rules:${projectId ?? "global"}`
}

function getRuleValueForTask(task: TaskCardData, rule: CalendarColorRule) {
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

function getRuleOptionLabel(task: TaskCardData, source: CalendarColorSource, value: string, customFieldId?: string) {
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

function buildDueDateForDay(targetDay: Date, existingDueDate: string | null) {
  if (!existingDueDate) {
    return format(targetDay, "yyyy-MM-dd")
  }

  const sourceDate = new Date(existingDueDate)
  const nextDate = new Date(sourceDate)
  nextDate.setFullYear(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate())

  const hasExplicitTime = sourceDate.getHours() !== 0 || sourceDate.getMinutes() !== 0
  if (!hasExplicitTime) {
    nextDate.setHours(0, 0, 0, 0)
  }

  return nextDate.toISOString()
}

function getTaskOccurrences(
  task: TaskCardData,
  customDateSources: NonNullable<CalendarViewProps["customDateSources"]>
): CalendarTaskOccurrence[] {
  const occurrences: CalendarTaskOccurrence[] = []

  if (task.dueDate) {
    occurrences.push({
      id: `${task.id}:due-date`,
      task,
      dateValue: task.dueDate,
      isDueDate: true,
    })
  }

  for (const source of customDateSources) {
    const matchingChips = (task.customFieldChips ?? []).filter(
      (chip) =>
        chip.fieldId === source.fieldId &&
        (chip.fieldType === "DATE" || chip.fieldType === "CREATED")
    )

    for (const chip of matchingChips) {
      const value = chip.value || chip.label
      if (!value || Number.isNaN(new Date(value).getTime())) continue

      occurrences.push({
        id: `${task.id}:custom-date:${source.fieldId}:${value}`,
        task,
        dateValue: value,
        isDueDate: false,
        sourceName: source.fieldName,
      })
    }
  }

  return occurrences
}

export function CalendarView({
  tasks,
  onTaskClick,
  onTaskDateChange,
  projectId,
  defaultTaskListId,
  customDateSources = [],
}: CalendarViewProps) {
  const router = useRouter()
  const [displayMode, setDisplayMode] = useState<CalendarDisplayMode>("month")
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [creatingOnDate, setCreatingOnDate] = useState<string | null>(null)
  const [expandedDateKey, setExpandedDateKey] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null)
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null)
  const [duplicatingTaskId, setDuplicatingTaskId] = useState<string | null>(null)
  const [colorPanelOpen, setColorPanelOpen] = useState(false)
  const [colorRules, setColorRules] = useState<CalendarColorRule[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(getCalendarColorStorageKey(projectId))
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setColorRules(parsed.filter((rule) => rule?.id && rule?.source && rule?.color))
      }
    } catch (error) {
      console.error("Failed to load calendar color rules:", error)
    }
  }, [projectId])

  useEffect(() => {
    try {
      window.localStorage.setItem(getCalendarColorStorageKey(projectId), JSON.stringify(colorRules))
    } catch (error) {
      console.error("Failed to save calendar color rules:", error)
    }
  }, [colorRules, projectId])

  const visibleRange = useMemo(() => {
    try {
      if (displayMode === "week") {
        return {
          start: startOfWeek(currentDate),
          end: endOfWeek(currentDate),
        }
      }

      if (displayMode === "quarter") {
        return {
          start: startOfWeek(startOfQuarter(currentDate)),
          end: endOfWeek(endOfQuarter(currentDate)),
        }
      }

      return {
        start: startOfWeek(startOfMonth(currentDate)),
        end: endOfWeek(endOfMonth(currentDate)),
      }
    } catch (err) {
      console.error("Error generating calendar range:", err)
      return { start: startOfWeek(new Date()), end: endOfWeek(new Date()) }
    }
  }, [currentDate, displayMode])

  const calendarDays = useMemo(() => {
    try {
      return eachDayOfInterval(visibleRange)
    } catch (err) {
      console.error("Error generating calendar days:", err)
      return []
    }
  }, [visibleRange])

  const tasksByDate = useMemo(() => {
    const map: Record<string, CalendarTaskOccurrence[]> = {}
    if (!tasks) return map
    tasks.forEach((task) => {
      for (const occurrence of getTaskOccurrences(task, customDateSources)) {
        try {
          const key = format(new Date(occurrence.dateValue), "yyyy-MM-dd")
          if (!map[key]) map[key] = []
          map[key].push(occurrence)
        } catch (err) {
          console.error("Error formatting task date:", task.id, occurrence.dateValue, err)
        }
      }
    })
    Object.values(map).forEach((dayOccurrences) => {
      dayOccurrences.sort((a, b) => {
        const dateDiff = new Date(a.dateValue).getTime() - new Date(b.dateValue).getTime()
        if (dateDiff !== 0) return dateDiff
        return a.task.position - b.task.position
      })
    })
    return map
  }, [customDateSources, tasks])

  const customColorFields = useMemo(() => {
    const fields = new Map<string, { fieldId: string; fieldName: string }>()
    for (const task of tasks) {
      for (const chip of task.customFieldChips ?? []) {
        if (chip.fieldType === "SELECT" || chip.fieldType === "MULTI_SELECT" || chip.fieldType === "STATUS" || chip.fieldType === "PLACE") {
          fields.set(chip.fieldId, { fieldId: chip.fieldId, fieldName: chip.fieldName })
        }
      }
    }
    return Array.from(fields.values())
  }, [tasks])

  const getRuleValues = useCallback((rule: CalendarColorRule) => {
    const values = new Map<string, string>()

    for (const task of tasks) {
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
  }, [tasks])

  const getTaskColorRule = useCallback((task: TaskCardData) => {
    return colorRules.find((rule) => {
      if (!rule.value) return false
      return getRuleValueForTask(task, rule).includes(rule.value)
    })
  }, [colorRules])

  const activeMilestones = useMemo(() => {
    if (!tasks) return 0
    return tasks.reduce((count, task) => {
      const visibleOccurrences = getTaskOccurrences(task, customDateSources).filter((occurrence) => {
        try {
          const taskDate = new Date(occurrence.dateValue)
          return taskDate >= visibleRange.start && taskDate <= visibleRange.end
        } catch {
          return false
        }
      })

      return count + visibleOccurrences.length
    }, 0)
  }, [customDateSources, tasks, visibleRange])

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  const headerLabel = useMemo(() => {
    if (displayMode === "week") {
      const startLabel = format(visibleRange.start, "MMM d")
      const endLabel =
        format(visibleRange.start, "MMM") === format(visibleRange.end, "MMM")
          ? format(visibleRange.end, "d, yyyy")
          : format(visibleRange.end, "MMM d, yyyy")
      return `${startLabel} - ${endLabel}`
    }

    if (displayMode === "quarter") {
      const quarter = Math.floor(currentDate.getMonth() / 3) + 1
      return `Q${quarter} ${format(currentDate, "yyyy")}`
    }

    return format(currentDate, "MMMM yyyy")
  }, [currentDate, displayMode, visibleRange.end, visibleRange.start])

  const handleModeChange = (mode: CalendarDisplayMode) => {
    setDisplayMode(mode)
    setCreatingOnDate(null)
    setExpandedDateKey(null)
    setSelectedDate(null)
  }

  const handleNavigatePrevious = () => {
    if (displayMode === "week") {
      setCurrentDate(subWeeks(currentDate, 1))
      return
    }
    if (displayMode === "quarter") {
      setCurrentDate(subQuarters(currentDate, 1))
      return
    }
    setCurrentDate(subMonths(currentDate, 1))
  }

  const handleNavigateNext = () => {
    if (displayMode === "week") {
      setCurrentDate(addWeeks(currentDate, 1))
      return
    }
    if (displayMode === "quarter") {
      setCurrentDate(addQuarters(currentDate, 1))
      return
    }
    setCurrentDate(addMonths(currentDate, 1))
  }

  const isInActivePeriod = (day: Date) => {
    if (displayMode === "month") return isSameMonth(day, currentDate)
    if (displayMode === "quarter") {
      const quarterStart = startOfQuarter(currentDate)
      const quarterEnd = endOfQuarter(currentDate)
      return day >= quarterStart && day <= quarterEnd
    }
    return true
  }

  const handleDateClick = (day: Date) => {
    const key = format(day, "yyyy-MM-dd")
    if (selectedDate && isSameDay(day, selectedDate)) {
      if (projectId && defaultTaskListId) {
        setCreatingOnDate(key)
        setNewTitle("")
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    } else {
      setSelectedDate(day)
      setCreatingOnDate(null)
    }
  }

  const handleQuickCreate = async (dateKey: string) => {
    if (!newTitle.trim() || !projectId || !defaultTaskListId) return
    setCreating(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          taskListId: defaultTaskListId,
          projectId,
          dueDate: dateKey,
        }),
      })
      if (res.ok) {
        setNewTitle("")
        setCreatingOnDate(null)
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create task:", error)
    } finally {
      setCreating(false)
    }
  }

  const handleAddColorRule = () => {
    setColorRules((prev) => [
      ...prev,
      {
        id: generateRuleId(),
        source: "status",
        value: "IN_PROGRESS",
        color: CALENDAR_COLOR_PRESETS[0].value,
      },
    ])
    setColorPanelOpen(true)
  }

  const updateColorRule = (ruleId: string, updates: Partial<CalendarColorRule>) => {
    setColorRules((prev) =>
      prev.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              ...updates,
              ...(updates.source ? { customFieldId: undefined, value: "" } : {}),
              ...(updates.customFieldId ? { value: "" } : {}),
            }
          : rule
      )
    )
  }

  const removeColorRule = (ruleId: string) => {
    setColorRules((prev) => prev.filter((rule) => rule.id !== ruleId))
  }

  const handleDuplicateTask = async (event: React.MouseEvent, task: TaskCardData) => {
    event.stopPropagation()
    if (duplicatingTaskId) return

    setDuplicatingTaskId(task.id)
    try {
      const res = await fetch(`/api/tasks/${task.id}/duplicate`, { method: "POST" })
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
  }

  const handleTaskDrop = async (task: TaskCardData, targetDay: Date) => {
    if (!onTaskDateChange || movingTaskId === task.id) return

    const currentDateKey = task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : null
    const nextDateKey = format(targetDay, "yyyy-MM-dd")
    if (currentDateKey === nextDateKey) {
      setDraggedTaskId(null)
      setDropTargetDate(null)
      return
    }

    try {
      setMovingTaskId(task.id)
      await onTaskDateChange(task.id, buildDueDateForDay(targetDay, task.dueDate))
    } finally {
      setDraggedTaskId(null)
      setDropTargetDate(null)
      setMovingTaskId(null)
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto w-full space-y-10 animate-fade-in">
      {/* Calendar Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h2 className="text-5xl font-headline font-black tracking-tighter text-primary lowercase first-letter:uppercase">
            {headerLabel}
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 bg-tertiary-new/5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-tertiary-new animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-tertiary-new">
                {activeMilestones} active tasks this {displayMode}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-10 rounded-xl px-4 text-[11px] font-black uppercase tracking-widest",
              colorPanelOpen
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                : "hover:bg-surface-container-low text-on-surface-variant/60"
            )}
            onClick={() => setColorPanelOpen((prev) => !prev)}
          >
            <Palette className="mr-2 h-4 w-4" />
            Colors
          </Button>
          <div className="flex items-center p-1 bg-surface-container-low rounded-xl">
            {[
              { id: "week" as const, label: "Week" },
              { id: "month" as const, label: "Month" },
              { id: "quarter" as const, label: "Quarter" },
            ].map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => handleModeChange(view.id)}
                className={cn(
                  "px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all duration-200",
                  displayMode === view.id
                    ? "bg-surface-container-lowest text-primary shadow-sm shadow-primary/5"
                    : "text-on-surface-variant/40 hover:text-primary"
                )}
              >
                {view.label}
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-xl hover:bg-surface-container-low text-on-surface-variant/60"
              onClick={handleNavigatePrevious}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              className="h-10 px-4 font-black text-[11px] uppercase tracking-widest rounded-xl hover:bg-surface-container-low text-on-surface-variant/60"
              onClick={() => setCurrentDate(new Date())}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-xl hover:bg-surface-container-low text-on-surface-variant/60"
              onClick={handleNavigateNext}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {colorPanelOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-[28px] border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-2xl shadow-primary/5"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-black uppercase tracking-[0.18em] text-primary">Conditional color</h3>
                </div>
                <p className="mt-1 max-w-2xl text-sm font-medium text-on-surface-variant/55">
                  Color calendar cards by status, priority, assignee, section, or custom field value.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  className="h-10 rounded-xl bg-primary px-4 text-xs font-black uppercase tracking-widest text-primary-foreground"
                  onClick={handleAddColorRule}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New color setting
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-xl text-on-surface-variant/50"
                  onClick={() => setColorPanelOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {colorRules.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-on-surface-variant/10 bg-surface-container-low/40 px-4 py-6 text-sm font-medium text-on-surface-variant/45">
                  No color rule yet. Add one to make this calendar easier to scan.
                </div>
              ) : (
                colorRules.map((rule) => {
                  const values = getRuleValues(rule)

                  return (
                    <div
                      key={rule.id}
                      className="grid gap-3 rounded-2xl bg-surface-container-low/50 p-3 md:grid-cols-[1fr_1fr_1fr_auto]"
                    >
                      <select
                        value={rule.source}
                        onChange={(event) => updateColorRule(rule.id, { source: event.target.value as CalendarColorSource })}
                        className="h-11 rounded-2xl border-none bg-surface-container-lowest px-4 text-sm font-bold text-primary"
                      >
                        <option value="status">Status</option>
                        <option value="priority">Priority</option>
                        <option value="assignee">Assignee</option>
                        <option value="task_list">Section</option>
                        <option value="custom_field">Custom field</option>
                      </select>

                      {rule.source === "custom_field" ? (
                        <select
                          value={rule.customFieldId ?? ""}
                          onChange={(event) => updateColorRule(rule.id, { customFieldId: event.target.value || undefined })}
                          className="h-11 rounded-2xl border-none bg-surface-container-lowest px-4 text-sm font-bold text-primary"
                        >
                          <option value="">Select field...</option>
                          {customColorFields.map((field) => (
                            <option key={field.fieldId} value={field.fieldId}>
                              {field.fieldName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex h-11 items-center rounded-2xl bg-surface-container-lowest px-4 text-sm font-bold text-on-surface-variant/45">
                          is
                        </div>
                      )}

                      <select
                        value={rule.value}
                        onChange={(event) => updateColorRule(rule.id, { value: event.target.value })}
                        className="h-11 rounded-2xl border-none bg-surface-container-lowest px-4 text-sm font-bold text-primary"
                      >
                        <option value="">Select value...</option>
                        {values.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {CALENDAR_COLOR_PRESETS.map((preset) => (
                            <button
                              key={preset.value}
                              type="button"
                              onClick={() => updateColorRule(rule.id, { color: preset.value })}
                              className={cn(
                                "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                                rule.color === preset.value ? "border-primary" : "border-transparent"
                              )}
                              style={{ backgroundColor: preset.value }}
                              title={preset.name}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeColorRule(rule.id)}
                          className="rounded-xl p-2 text-on-surface-variant/35 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label="Delete color rule"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Calendar Grid Container */}
      <div className="bg-surface-container-lowest rounded-[32px] shadow-2xl shadow-primary/5 border border-on-surface-variant/5 overflow-hidden">
        {/* Week Day Headers */}
        <div className="grid grid-cols-7 border-b border-on-surface-variant/5 bg-surface-container-low/30">
          {weekDays.map((day) => (
            <div
              key={day}
              className="py-6 text-center text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 divide-x divide-y divide-on-surface-variant/5 border-on-surface-variant/5">
          {calendarDays.map((day, idx) => {
            const key = format(day, "yyyy-MM-dd")
            const dayOccurrences = tasksByDate[key] || []
            const isExpanded = expandedDateKey === key
            const visibleOccurrences = isExpanded ? dayOccurrences : dayOccurrences.slice(0, 3)
            const inMonth = isInActivePeriod(day)
            const today = isToday(day)
            const isSelected = selectedDate && isSameDay(day, selectedDate)
            const isCreating = creatingOnDate === key

            return (
              <div
                key={key}
                className={cn(
                  "min-h-[160px] p-4 cursor-pointer transition-all duration-300 group/cell relative",
                  !inMonth && "bg-surface-container-low/20 opacity-30",
                  isSelected && "bg-primary/[0.02]",
                  dropTargetDate === key && "bg-primary/[0.06] ring-2 ring-inset ring-primary/15",
                  "hover:bg-primary/[0.01]"
                )}
                onClick={() => handleDateClick(day)}
                onDragOver={(e) => {
                  if (!draggedTaskId || !inMonth) return
                  e.preventDefault()
                  setDropTargetDate(key)
                }}
                onDragLeave={() => {
                  if (dropTargetDate === key) {
                    setDropTargetDate(null)
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const droppedTaskId = e.dataTransfer.getData("text/task-id")
                  const droppedTask = tasks.find((task) => task.id === droppedTaskId)
                  if (!droppedTask || !inMonth) {
                    setDraggedTaskId(null)
                    setDropTargetDate(null)
                    return
                  }
                  void handleTaskDrop(droppedTask, day)
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <span
                    className={cn(
                      "text-sm font-headline font-black tracking-tight",
                      !inMonth ? "text-on-surface-variant/20" : "text-primary/40",
                      today && "flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xs shadow-lg shadow-primary/20 !text-primary-foreground opacity-100"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  
                  {inMonth && dayOccurrences.length > 0 && (
                    <div className="flex -space-x-1.5 opacity-40 group-hover/cell:opacity-100 transition-opacity">
                      {dayOccurrences.slice(0, 3).map((occurrence, i) => (
                        <div key={`${occurrence.id}:${i}`} className="w-1.5 h-1.5 rounded-full bg-primary ring-2 ring-surface-container-lowest" />
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  {visibleOccurrences.map((occurrence) => {
                    const task = occurrence.task
                    const taskTimeLabel = getTaskTimeLabel(occurrence.dateValue)
                    const colorRule = getTaskColorRule(task)
                    const colorPreset = colorRule
                      ? CALENDAR_COLOR_PRESETS.find((preset) => preset.value === colorRule.color)
                      : null

                    return (
                    <div
                      key={occurrence.id}
                      draggable={occurrence.isDueDate}
                      onDragStart={(e) => {
                        if (!occurrence.isDueDate) {
                          e.preventDefault()
                          return
                        }
                        e.stopPropagation()
                        e.dataTransfer.setData("text/task-id", task.id)
                        e.dataTransfer.effectAllowed = "move"
                        setDraggedTaskId(task.id)
                      }}
                      onDragEnd={() => {
                        setDraggedTaskId(null)
                        setDropTargetDate(null)
                      }}
                      onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
                      className={cn(
                        "rounded-xl bg-surface-container-low px-3 py-2.5 hover:bg-surface-container-high transition-colors group/task",
                        "border border-transparent",
                        draggedTaskId === task.id && "opacity-50 border-primary/15",
                        movingTaskId === task.id && "pointer-events-none opacity-60"
                      )}
                      style={colorPreset ? {
                        backgroundColor: colorPreset.value,
                        borderColor: colorPreset.border,
                        color: colorPreset.text,
                      } : undefined}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 text-on-surface-variant/25 transition-colors group-hover/task:text-on-surface-variant/45">
                          {occurrence.isDueDate ? (
                            <GripVertical className="h-3 w-3" />
                          ) : (
                            <Clock3 className="h-3 w-3" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn(
                            "text-[11px] font-black truncate leading-tight",
                            colorPreset ? "text-inherit" : "text-primary group-hover/task:text-tertiary-new"
                          )}>
                            {task.title}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {taskTimeLabel ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 text-[9px] font-black uppercase tracking-wide text-on-surface-variant/70">
                                <Clock3 className="h-2.5 w-2.5" />
                                {taskTimeLabel}
                              </span>
                            ) : occurrence.isDueDate ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-on-surface-variant/45">
                                <Move className="h-2.5 w-2.5" />
                                Drag to reschedule
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-on-surface-variant/45">
                                {occurrence.sourceName}
                              </span>
                            )}
                            <span className="truncate rounded-full bg-surface-container-high px-2 py-1 text-[9px] font-semibold text-on-surface-variant/70">
                              {task.assignees.length > 0
                                ? `${task.assignees[0].name}${task.assignees.length > 1 ? ` +${task.assignees.length - 1}` : ""}`
                                : "Unassigned"}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 -space-x-1.5">
                          {task.assignees.slice(0, 2).map((assignee) => (
                            <UserAvatar
                              key={assignee.id}
                              user={{ name: assignee.name, avatar: assignee.avatar }}
                              size="xs"
                              className="h-5 w-5 border border-surface-container-lowest"
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={(event) => handleDuplicateTask(event, task)}
                          disabled={duplicatingTaskId === task.id}
                          draggable={false}
                          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-container-lowest/70 text-on-surface-variant/45 opacity-0 transition-all hover:bg-surface-container-lowest hover:text-primary group-hover/task:opacity-100 disabled:opacity-60"
                          title="Duplicate task"
                        >
                          {duplicatingTaskId === task.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>
                    )
                  })}
                  {dayOccurrences.length > 3 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedDateKey((prev) => (prev === key ? null : key))
                      }}
                      className="px-2 text-left text-[9px] font-black uppercase tracking-widest text-on-surface-variant/40 transition-colors hover:text-primary"
                    >
                      {isExpanded ? "Show less" : `+ ${dayOccurrences.length - 3} more`}
                    </button>
                  )}
                </div>

                {/* Quick Add Overlay */}
                <AnimatePresence>
                  {isCreating && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="absolute inset-2 z-20 bg-surface-container-lowest rounded-2xl shadow-2xl p-3 border-none ring-2 ring-primary/5 flex flex-col"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <textarea
                        ref={inputRef}
                        placeholder="Task title..."
                        className="flex-1 bg-transparent border-none p-0 text-xs font-bold focus:ring-0 placeholder:text-on-surface-variant/20 resize-none"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            handleQuickCreate(key)
                          }
                          if (e.key === "Escape") setCreatingOnDate(null)
                        }}
                      />
                      <div className="flex justify-end gap-1 mt-2">
                        <Button size="sm" variant="ghost" className="h-6 text-[9px] font-black uppercase tracking-widest" onClick={() => setCreatingOnDate(null)}>Cancel</Button>
                        <Button size="sm" className="h-6 bg-primary text-primary-foreground text-[9px] font-black uppercase tracking-widest" onClick={() => handleQuickCreate(key)} disabled={creating || !newTitle.trim()}>
                          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {inMonth && !isCreating && (
                  <button
                    className="absolute bottom-2 right-2 opacity-0 group-hover/cell:opacity-100 transition-all h-6 w-6 flex items-center justify-center rounded-lg bg-surface-container hover:bg-primary hover:text-primary-foreground text-on-surface-variant/40"
                    onClick={(e) => {
                      e.stopPropagation()
                      setCreatingOnDate(key)
                      setNewTitle("")
                      setTimeout(() => inputRef.current?.focus(), 50)
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

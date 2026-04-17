"use client"

import { useState, useMemo, useRef } from "react"
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
import { ChevronLeft, ChevronRight, Plus, Loader2, Clock3, GripVertical, Move } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"

interface CalendarViewProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
  onTaskDateChange?: (taskId: string, dueDate: string) => Promise<void> | void
  projectId?: string
  defaultTaskListId?: string
}

type CalendarDisplayMode = "week" | "month" | "quarter"

function getTaskTimeLabel(dueDate: string | null) {
  if (!dueDate) return null

  const date = new Date(dueDate)
  const hasExplicitTime = date.getHours() !== 0 || date.getMinutes() !== 0
  return hasExplicitTime ? format(date, "HH:mm") : null
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

export function CalendarView({
  tasks,
  onTaskClick,
  onTaskDateChange,
  projectId,
  defaultTaskListId,
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
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
    const map: Record<string, TaskCardData[]> = {}
    if (!tasks) return map
    tasks.forEach((task) => {
      if (task.dueDate) {
        try {
          const key = format(new Date(task.dueDate), "yyyy-MM-dd")
          if (!map[key]) map[key] = []
          map[key].push(task)
        } catch (err) {
          console.error("Error formatting task date:", task.id, task.dueDate, err)
        }
      }
    })
    Object.values(map).forEach((dayTasks) => {
      dayTasks.sort((a, b) => {
        if (!a.dueDate || !b.dueDate) return a.position - b.position
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      })
    })
    return map
  }, [tasks])

  const activeMilestones = useMemo(() => {
    if (!tasks) return 0
    return tasks.filter(t => {
      try {
        if (!t.dueDate) return false
        const taskDate = new Date(t.dueDate)
        return taskDate >= visibleRange.start && taskDate <= visibleRange.end
      } catch { return false }
    }).length
  }, [tasks, visibleRange])

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
            const dayTasks = tasksByDate[key] || []
            const isExpanded = expandedDateKey === key
            const visibleTasks = isExpanded ? dayTasks : dayTasks.slice(0, 3)
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
                  
                  {inMonth && dayTasks.length > 0 && (
                    <div className="flex -space-x-1.5 opacity-40 group-hover/cell:opacity-100 transition-opacity">
                      {dayTasks.slice(0, 3).map((t, i) => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary ring-2 ring-surface-container-lowest" />
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  {visibleTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => {
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
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 text-on-surface-variant/25 transition-colors group-hover/task:text-on-surface-variant/45">
                          <GripVertical className="h-3 w-3" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-black text-primary truncate leading-tight group-hover/task:text-tertiary-new">
                            {task.title}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {getTaskTimeLabel(task.dueDate) ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 text-[9px] font-black uppercase tracking-wide text-on-surface-variant/70">
                                <Clock3 className="h-2.5 w-2.5" />
                                {getTaskTimeLabel(task.dueDate)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-on-surface-variant/45">
                                <Move className="h-2.5 w-2.5" />
                                Drag to reschedule
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
                      </div>
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedDateKey((prev) => (prev === key ? null : key))
                      }}
                      className="px-2 text-left text-[9px] font-black uppercase tracking-widest text-on-surface-variant/40 transition-colors hover:text-primary"
                    >
                      {isExpanded ? "Show less" : `+ ${dayTasks.length - 3} more`}
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

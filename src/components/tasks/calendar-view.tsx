"use client"

import { useState, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import type { TaskCardData } from "./task-card"
import { PriorityBadge } from "./priority-badge"
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from "date-fns"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"

interface CalendarViewProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
  projectId?: string
  defaultTaskListId?: string
}

export function CalendarView({ tasks, onTaskClick, projectId, defaultTaskListId }: CalendarViewProps) {
  const router = useRouter()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [creatingOnDate, setCreatingOnDate] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const calStart = startOfWeek(monthStart)
    const calEnd = endOfWeek(monthEnd)
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [currentMonth])

  const tasksByDate = useMemo(() => {
    const map: Record<string, TaskCardData[]> = {}
    tasks.forEach((task) => {
      if (task.dueDate) {
        const key = format(new Date(task.dueDate), "yyyy-MM-dd")
        if (!map[key]) map[key] = []
        map[key].push(task)
      }
    })
    return map
  }, [tasks])

  const selectedDateTasks = useMemo(() => {
    if (!selectedDate) return []
    const key = format(selectedDate, "yyyy-MM-dd")
    return tasksByDate[key] || []
  }, [selectedDate, tasksByDate])

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  const handleDateClick = (day: Date) => {
    const key = format(day, "yyyy-MM-dd")
    if (selectedDate && isSameDay(day, selectedDate)) {
      // Double-click same date = start creating
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

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setCurrentMonth(new Date())}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border rounded-lg overflow-hidden">
        {/* Week day headers */}
        <div className="grid grid-cols-7 border-b bg-muted/50">
          {weekDays.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day) => {
            const key = format(day, "yyyy-MM-dd")
            const dayTasks = tasksByDate[key] || []
            const inMonth = isSameMonth(day, currentMonth)
            const today = isToday(day)
            const isSelected = selectedDate && isSameDay(day, selectedDate)
            const isCreating = creatingOnDate === key

            return (
              <div
                key={key}
                className={cn(
                  "min-h-[100px] border-b border-r p-1 cursor-pointer transition-colors group/cell",
                  !inMonth && "bg-muted/30",
                  isSelected && "bg-accent ring-1 ring-inset ring-border",
                  "hover:bg-accent/50"
                )}
                onClick={() => handleDateClick(day)}
              >
                <div className="flex items-center justify-between px-1">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      !inMonth && "text-muted-foreground/50",
                      today &&
                        "flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  <div className="flex items-center gap-1">
                    {dayTasks.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {dayTasks.length}
                      </span>
                    )}
                    {projectId && defaultTaskListId && inMonth && (
                      <button
                        className="opacity-0 group-hover/cell:opacity-100 transition-opacity h-4 w-4 flex items-center justify-center rounded hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedDate(day)
                          setCreatingOnDate(key)
                          setNewTitle("")
                          setTimeout(() => inputRef.current?.focus(), 50)
                        }}
                      >
                        <Plus className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Task pills */}
                <div className="mt-1 space-y-0.5">
                  {dayTasks.slice(0, 2).map((task) => (
                    <div
                      key={task.id}
                      className="rounded px-1 py-0.5 text-[10px] leading-tight truncate cursor-pointer hover:opacity-80 bg-foreground/10 text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        onTaskClick(task)
                      }}
                    >
                      {task.title}
                    </div>
                  ))}
                  {dayTasks.length > 2 && (
                    <div className="text-[10px] text-muted-foreground px-1">
                      +{dayTasks.length - 2} more
                    </div>
                  )}
                </div>

                {/* Inline create on this date */}
                {isCreating && (
                  <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder="Task title..."
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newTitle.trim()) {
                          handleQuickCreate(key)
                        }
                        if (e.key === "Escape") {
                          setCreatingOnDate(null)
                          setNewTitle("")
                        }
                      }}
                      onBlur={() => {
                        if (!newTitle.trim()) {
                          setCreatingOnDate(null)
                        }
                      }}
                      disabled={creating}
                      className="w-full text-[10px] bg-background border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Empty state hint */}
      {Object.keys(tasksByDate).length === 0 && tasks.length > 0 && (
        <div className="text-center py-3 text-xs text-muted-foreground">
          {tasks.length} {tasks.length === 1 ? "task has" : "tasks have"} no due date set — assign dates to see them on the calendar
        </div>
      )}

      {/* Selected date tasks panel */}
      <AnimatePresence>
        {selectedDate && selectedDateTasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="border rounded-lg p-4 space-y-3"
          >
            <h3 className="text-sm font-semibold">
              Tasks for {format(selectedDate, "MMMM d, yyyy")}
            </h3>
            <div className="space-y-2">
              {selectedDateTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 rounded-lg p-2 hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => onTaskClick(task)}
                >
                  <PriorityBadge priority={task.priority} showLabel={false} />
                  <span className="text-sm flex-1 truncate">{task.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {task.status.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

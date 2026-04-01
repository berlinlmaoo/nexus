"use client"

import { useState, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import type { TaskCardData } from "./task-card"
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
import { ChevronLeft, ChevronRight, Plus, Loader2, Calendar as CalendarIcon, MoreHorizontal } from "lucide-react"
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
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const calendarDays = useMemo(() => {
    try {
      const monthStart = startOfMonth(currentMonth)
      const monthEnd = endOfMonth(currentMonth)
      const calStart = startOfWeek(monthStart)
      const calEnd = endOfWeek(monthEnd)
      const days = eachDayOfInterval({ start: calStart, end: calEnd })
      console.log("Calendar days generated:", days.length)
      return days
    } catch (err) {
      console.error("Error generating calendar days:", err)
      return []
    }
  }, [currentMonth])

  const tasksByDate = useMemo(() => {
    console.log("Processing tasks for calendar:", tasks?.length)
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
    return map
  }, [tasks])

  const activeMilestones = useMemo(() => {
    if (!tasks) return 0
    return tasks.filter(t => {
      try {
        return t.dueDate && isSameMonth(new Date(t.dueDate), currentMonth)
      } catch { return false }
    }).length
  }, [tasks, currentMonth])

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

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

  return (
    <div className="max-w-[1400px] mx-auto w-full space-y-10 animate-fade-in">
      {/* Calendar Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h2 className="text-5xl font-headline font-black tracking-tighter text-primary lowercase first-letter:uppercase">
            {format(currentMonth, "MMMM yyyy")}
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 bg-tertiary-new/5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-tertiary-new animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-tertiary-new">
                {activeMilestones} active tasks this month
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center p-1 bg-surface-container-low rounded-xl">
            {["Week", "Month", "Quarter"].map((v) => (
              <button
                key={v}
                className={cn(
                  "px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all duration-200",
                  v === "Month" ? "bg-surface-container-lowest text-primary shadow-sm shadow-primary/5" : "text-on-surface-variant/40 hover:text-primary"
                )}
              >
                {v}
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-xl hover:bg-surface-container-low text-on-surface-variant/60"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              className="h-10 px-4 font-black text-[11px] uppercase tracking-widest rounded-xl hover:bg-surface-container-low text-on-surface-variant/60"
              onClick={() => setCurrentMonth(new Date())}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-xl hover:bg-surface-container-low text-on-surface-variant/60"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
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
            const inMonth = isSameMonth(day, currentMonth)
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
                  "hover:bg-primary/[0.01]"
                )}
                onClick={() => handleDateClick(day)}
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
                  {dayTasks.slice(0, 3).map((task) => (
                    <div
                      key={task.id}
                      onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
                      className="px-2 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container-high transition-colors group/task"
                    >
                      <p className="text-[10px] font-bold text-primary truncate leading-tight group-hover/task:text-tertiary-new">
                        {task.title}
                      </p>
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <p className="text-[9px] font-black text-on-surface-variant/40 px-2 uppercase tracking-widest">
                      + {dayTasks.length - 3} more
                    </p>
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

"use client"

import { useMemo, useState, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react"
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  differenceInDays,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  isWithinInterval,
  startOfDay,
  isToday,
  getDay,
} from "date-fns"
import { cn } from "@/lib/utils"
import type { TaskCardData } from "./task-card"

interface GanttViewProps {
  tasks: TaskCardData[]
  onTaskClick?: (task: TaskCardData) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-foreground",
  LOW: "bg-blue-500",
  NONE: "bg-muted-foreground/40",
}

type TimeScale = "week" | "month"

export function GanttView({ tasks, onTaskClick }: GanttViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [timeScale, setTimeScale] = useState<TimeScale>("month")
  const scrollRef = useRef<HTMLDivElement>(null)

  const { days, rangeStart, rangeEnd } = useMemo(() => {
    if (timeScale === "month") {
      const start = startOfMonth(currentDate)
      const end = endOfMonth(currentDate)
      return { days: eachDayOfInterval({ start, end }), rangeStart: start, rangeEnd: end }
    } else {
      const start = startOfWeek(currentDate)
      const end = endOfWeek(addWeeks(currentDate, 1))
      return { days: eachDayOfInterval({ start, end }), rangeStart: start, rangeEnd: end }
    }
  }, [currentDate, timeScale])

  const todayIndex = useMemo(() => {
    return days.findIndex((d) => isToday(d))
  }, [days])

  const tasksWithDates = useMemo(() => {
    return tasks
      .filter((t) => t.dueDate)
      .map((t) => {
        const due = new Date(t.dueDate!)
        const start = startOfDay(subWeeks(due, 1))
        return { ...t, startDate: start, endDate: startOfDay(due) }
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  }, [tasks])

  const tasksWithoutDates = useMemo(() => {
    return tasks.filter((t) => !t.dueDate)
  }, [tasks])

  const getBarStyle = (task: { startDate: Date; endDate: Date }) => {
    const totalDays = days.length
    const taskStart = differenceInDays(task.startDate, rangeStart)
    const taskEnd = differenceInDays(task.endDate, rangeStart)
    const clampedStart = Math.max(0, taskStart)
    const clampedEnd = Math.min(totalDays - 1, taskEnd)
    if (clampedStart > totalDays - 1 || clampedEnd < 0) return null
    const left = (clampedStart / totalDays) * 100
    const width = ((clampedEnd - clampedStart + 1) / totalDays) * 100
    return { left: `${left}%`, width: `${Math.max(width, 2)}%` }
  }

  const isTaskInRange = (task: { startDate: Date; endDate: Date }) => {
    return (
      isWithinInterval(rangeStart, { start: task.startDate, end: task.endDate }) ||
      isWithinInterval(task.startDate, { start: rangeStart, end: rangeEnd }) ||
      isWithinInterval(task.endDate, { start: rangeStart, end: rangeEnd })
    )
  }

  const visibleTasks = tasksWithDates.filter(isTaskInRange)

  const navigate = (dir: 1 | -1) => {
    if (timeScale === "month") {
      setCurrentDate(dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1))
    } else {
      setCurrentDate(dir === 1 ? addWeeks(currentDate, 2) : subWeeks(currentDate, 2))
    }
  }

  const headerLabel = timeScale === "month"
    ? format(currentDate, "MMMM yyyy")
    : `${format(rangeStart, "MMM d")} - ${format(rangeEnd, "MMM d, yyyy")}`

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Timeline</h3>
        <div className="flex items-center gap-3">
          {/* Time scale toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <button
              className={cn(
                "px-3 py-1 text-xs font-medium transition-colors",
                timeScale === "week" ? "bg-foreground text-background" : "hover:bg-muted"
              )}
              onClick={() => setTimeScale("week")}
            >
              Week
            </button>
            <button
              className={cn(
                "px-3 py-1 text-xs font-medium transition-colors",
                timeScale === "month" ? "bg-foreground text-background" : "hover:bg-muted"
              )}
              onClick={() => setTimeScale("month")}
            >
              Month
            </button>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">{headerLabel}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setCurrentDate(new Date())}
          >
            Today
          </Button>
        </div>
      </div>

      {/* Timeline header (day numbers) */}
      <div className="relative mb-2" ref={scrollRef}>
        <div className="flex">
          <div className="w-44 shrink-0" />
          <div className="flex-1 flex">
            {days.map((day, i) => {
              const isWeekend = getDay(day) === 0 || getDay(day) === 6
              const today = isToday(day)
              return (
                <div
                  key={i}
                  className={cn(
                    "flex-1 text-center text-[10px] py-1 border-r last:border-r-0",
                    isWeekend ? "bg-muted/30 text-muted-foreground" : "text-muted-foreground",
                    today && "font-bold text-foreground"
                  )}
                >
                  <div>{format(day, "d")}</div>
                  {timeScale === "week" && (
                    <div className="text-[8px] uppercase">{format(day, "EEE")}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Task rows */}
      {visibleTasks.length === 0 && tasksWithoutDates.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No tasks to display in this period
        </div>
      ) : (
        <div className="space-y-0.5">
          {visibleTasks.map((task) => {
            const barStyle = getBarStyle(task)
            return (
              <div key={task.id} className="flex items-center gap-0 h-9 group">
                <div
                  className="w-44 shrink-0 truncate text-xs font-medium pr-2 cursor-pointer hover:text-muted-foreground transition-colors"
                  onClick={() => onTaskClick?.(task)}
                >
                  {task.title}
                </div>
                <div className="flex-1 relative h-7 bg-muted/30 rounded">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex">
                    {days.map((day, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 border-r border-muted/50 last:border-r-0",
                          (getDay(day) === 0 || getDay(day) === 6) && "bg-muted/20"
                        )}
                      />
                    ))}
                  </div>

                  {/* Today line */}
                  {todayIndex >= 0 && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                      style={{ left: `${((todayIndex + 0.5) / days.length) * 100}%` }}
                    />
                  )}

                  {/* Bar */}
                  {barStyle && (
                    <div
                      className={cn(
                        "absolute top-1 h-5 rounded-md cursor-pointer transition-all hover:opacity-80 hover:shadow-md",
                        PRIORITY_COLORS[task.priority] || "bg-muted-foreground"
                      )}
                      style={barStyle}
                      onClick={() => onTaskClick?.(task)}
                      title={`${task.title} - Due: ${format(task.endDate, "MMM d")}`}
                    >
                      <span className="absolute inset-0 flex items-center px-1.5 text-[10px] text-white font-medium truncate">
                        {task.title}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Tasks without due date */}
          {tasksWithoutDates.length > 0 && (
            <>
              <div className="border-t my-3" />
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                No date ({tasksWithoutDates.length})
              </div>
              {tasksWithoutDates.map((task) => (
                <div key={task.id} className="flex items-center gap-0 h-9 group">
                  <div
                    className="w-44 shrink-0 truncate text-xs font-medium pr-2 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => onTaskClick?.(task)}
                  >
                    {task.title}
                  </div>
                  <div className="flex-1 relative h-7 bg-muted/20 rounded border border-dashed border-muted">
                    {todayIndex >= 0 && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500/30 z-10"
                        style={{ left: `${((todayIndex + 0.5) / days.length) * 100}%` }}
                      />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground italic">
                      No due date
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 pt-4 mt-3 border-t text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Urgent</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-orange-500" /> High</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-foreground" /> Medium</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> Low</span>
        <span className="flex items-center gap-1 ml-4"><span className="h-3 w-0.5 bg-red-500" /> Today</span>
      </div>
    </Card>
  )
}

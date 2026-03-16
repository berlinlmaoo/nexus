"use client"

import { useMemo, useState, useCallback, useRef } from "react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
} from "lucide-react"
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  eachWeekOfInterval,
  differenceInDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfDay,
  isToday,
  getDay,
  isWithinInterval,
} from "date-fns"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import type { TaskCardData } from "./task-card"

type ZoomLevel = "day" | "week" | "month"

interface TimelineViewProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
}

// Assign colors to assignees based on zinc shades
const ASSIGNEE_COLORS = [
  "bg-zinc-900",
  "bg-zinc-700",
  "bg-zinc-500",
  "bg-zinc-800",
  "bg-zinc-600",
  "bg-zinc-400",
  "bg-zinc-950",
  "bg-zinc-300",
]

export function TimelineView({ tasks, onTaskClick }: TimelineViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("week")
  const scrollRef = useRef<HTMLDivElement>(null)

  // Compute visible range
  const { days, rangeStart, rangeEnd, headerWeeks } = useMemo(() => {
    let start: Date, end: Date
    if (zoomLevel === "day") {
      start = startOfWeek(currentDate)
      end = endOfWeek(currentDate)
    } else if (zoomLevel === "week") {
      start = startOfWeek(subWeeks(currentDate, 1))
      end = endOfWeek(addWeeks(currentDate, 2))
    } else {
      start = startOfMonth(currentDate)
      end = endOfMonth(addMonths(currentDate, 1))
    }
    const allDays = eachDayOfInterval({ start, end })
    const weeks = eachWeekOfInterval({ start, end })
    return {
      days: allDays,
      rangeStart: start,
      rangeEnd: end,
      headerWeeks: weeks,
    }
  }, [currentDate, zoomLevel])

  const todayIndex = useMemo(() => days.findIndex((d) => isToday(d)), [days])

  // Build assignee color map
  const assigneeColorMap = useMemo(() => {
    const map = new Map<string, string>()
    const uniqueAssignees = new Set<string>()
    tasks.forEach((t) => t.assignees.forEach((a) => uniqueAssignees.add(a.id)))
    let i = 0
    uniqueAssignees.forEach((id) => {
      map.set(id, ASSIGNEE_COLORS[i % ASSIGNEE_COLORS.length])
      i++
    })
    return map
  }, [tasks])

  // Tasks with computed dates
  const { scheduledTasks, unscheduledTasks } = useMemo(() => {
    const scheduled: (TaskCardData & { startDate: Date; endDate: Date })[] = []
    const unscheduled: TaskCardData[] = []

    tasks.forEach((t) => {
      if (t.dueDate) {
        const endDate = startOfDay(new Date(t.dueDate))
        // Estimate start date: 7 days before due date (or use due date if no start concept)
        const startDate = startOfDay(subWeeks(endDate, 1))
        scheduled.push({ ...t, startDate, endDate })
      } else {
        unscheduled.push(t)
      }
    })

    scheduled.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    return { scheduledTasks: scheduled, unscheduledTasks: unscheduled }
  }, [tasks])

  // Filter to visible
  const visibleTasks = useMemo(() => {
    return scheduledTasks.filter((t) => {
      return (
        isWithinInterval(t.startDate, { start: rangeStart, end: rangeEnd }) ||
        isWithinInterval(t.endDate, { start: rangeStart, end: rangeEnd }) ||
        isWithinInterval(rangeStart, { start: t.startDate, end: t.endDate })
      )
    })
  }, [scheduledTasks, rangeStart, rangeEnd])

  const getBarStyle = (task: { startDate: Date; endDate: Date }) => {
    const totalDays = days.length
    const taskStart = differenceInDays(task.startDate, rangeStart)
    const taskEnd = differenceInDays(task.endDate, rangeStart)
    const clampedStart = Math.max(0, taskStart)
    const clampedEnd = Math.min(totalDays - 1, taskEnd)
    if (clampedStart > totalDays - 1 || clampedEnd < 0) return null
    const left = (clampedStart / totalDays) * 100
    const width = ((clampedEnd - clampedStart + 1) / totalDays) * 100
    return { left: `${left}%`, width: `${Math.max(width, 1.5)}%` }
  }

  const getBarColor = (task: TaskCardData) => {
    if (task.assignees.length > 0) {
      return assigneeColorMap.get(task.assignees[0].id) || "bg-zinc-700"
    }
    return "bg-zinc-400"
  }

  const navigate = (dir: 1 | -1) => {
    if (zoomLevel === "day") {
      setCurrentDate(dir === 1 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1))
    } else if (zoomLevel === "week") {
      setCurrentDate(dir === 1 ? addWeeks(currentDate, 2) : subWeeks(currentDate, 2))
    } else {
      setCurrentDate(dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1))
    }
  }

  const headerLabel =
    zoomLevel === "month"
      ? `${format(rangeStart, "MMM yyyy")} - ${format(rangeEnd, "MMM yyyy")}`
      : `${format(rangeStart, "MMM d")} - ${format(rangeEnd, "MMM d, yyyy")}`

  return (
    <Card className="p-4">
      {/* Header controls */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">Timeline</h3>
        <div className="flex items-center gap-3">
          {/* Zoom toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            {(["day", "week", "month"] as const).map((level) => (
              <button
                key={level}
                className={cn(
                  "px-3 py-1 text-xs font-medium transition-colors capitalize",
                  zoomLevel === level ? "bg-foreground text-background" : "hover:bg-accent text-muted-foreground"
                )}
                onClick={() => setZoomLevel(level)}
              >
                {level}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[180px] text-center">{headerLabel}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button variant="outline" size="sm" className="h-8" onClick={() => setCurrentDate(new Date())}>
            Today
          </Button>
        </div>
      </div>

      {/* Week headers */}
      <div className="relative mb-1" ref={scrollRef}>
        <div className="flex">
          <div className="w-52 shrink-0" />
          <div className="flex-1">
            {/* Week row */}
            <div className="flex">
              {days.map((day, i) => {
                const isWeekend = getDay(day) === 0 || getDay(day) === 6
                const today = isToday(day)
                const showWeekLabel = getDay(day) === 1 || i === 0
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex-1 text-center text-[9px] py-1 border-r border-b last:border-r-0",
                      isWeekend ? "bg-muted/50 text-muted-foreground/60" : "text-muted-foreground",
                      today && "font-bold text-foreground"
                    )}
                  >
                    <div>{format(day, "d")}</div>
                    <div className="text-[8px] uppercase">{format(day, "EEE")}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Task rows */}
      {visibleTasks.length === 0 && unscheduledTasks.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No tasks to display in this period
        </div>
      ) : (
        <div className="space-y-0">
          {visibleTasks.map((task) => {
            const barStyle = getBarStyle(task)
            const barColor = getBarColor(task)

            return (
              <div key={task.id} className="flex items-center h-10 group hover:bg-accent/50 transition-colors">
                {/* Left panel: task info */}
                <div className="w-52 shrink-0 flex items-center gap-2 pr-3 border-r">
                  <span
                    className="text-xs font-medium text-foreground truncate flex-1 cursor-pointer hover:text-muted-foreground transition-colors"
                    onClick={() => onTaskClick(task)}
                  >
                    {task.title}
                  </span>
                  {task.assignees.length > 0 && (
                    <UserAvatar user={{ name: task.assignees[0].name, avatar: task.assignees[0].avatar }} size="xs" className="shrink-0 border border-background" />
                  )}
                </div>

                {/* Right panel: timeline bar */}
                <div className="flex-1 relative h-8">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex">
                    {days.map((day, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 border-r border-border/50 last:border-r-0",
                          (getDay(day) === 0 || getDay(day) === 6) && "bg-muted/50"
                        )}
                      />
                    ))}
                  </div>

                  {/* Today marker */}
                  {todayIndex >= 0 && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                      style={{ left: `${((todayIndex + 0.5) / days.length) * 100}%` }}
                    />
                  )}

                  {/* Task bar */}
                  {barStyle && (
                    <div
                      className={cn(
                        "absolute top-1.5 h-5 rounded cursor-pointer transition-all hover:opacity-80 hover:shadow-md z-[5]",
                        barColor
                      )}
                      style={barStyle}
                      onClick={() => onTaskClick(task)}
                      title={`${task.title} — Due: ${format(task.endDate, "MMM d")}`}
                    >
                      <span className="absolute inset-0 flex items-center px-1.5 text-[9px] text-white font-medium truncate">
                        {task.title}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Unscheduled section */}
          {unscheduledTasks.length > 0 && (
            <>
              <div className="border-t my-3" />
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5 px-1">
                <Calendar className="h-3 w-3" />
                Unscheduled ({unscheduledTasks.length})
              </div>
              {unscheduledTasks.map((task) => (
                <div key={task.id} className="flex items-center h-10 group hover:bg-accent/50 transition-colors">
                  <div className="w-52 shrink-0 flex items-center gap-2 pr-3 border-r">
                    <span
                      className="text-xs font-medium text-foreground truncate flex-1 cursor-pointer hover:text-muted-foreground transition-colors"
                      onClick={() => onTaskClick(task)}
                    >
                      {task.title}
                    </span>
                    {task.assignees.length > 0 && (
                      <UserAvatar user={{ name: task.assignees[0].name, avatar: task.assignees[0].avatar }} size="xs" className="shrink-0 border border-background" />
                    )}
                  </div>
                  <div className="flex-1 relative h-8">
                    <div className="absolute inset-0 flex">
                      {days.map((_, i) => (
                        <div key={i} className="flex-1 border-r border-border/30 last:border-r-0" />
                      ))}
                    </div>
                    {todayIndex >= 0 && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500/20 z-10"
                        style={{ left: `${((todayIndex + 0.5) / days.length) * 100}%` }}
                      />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/60 italic">
                      No dates set
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
        <span className="flex items-center gap-1">
          <span className="h-3 w-0.5 bg-red-500" /> Today
        </span>
        <span className="text-muted-foreground/60">Bars colored by assignee</span>
      </div>
    </Card>
  )
}

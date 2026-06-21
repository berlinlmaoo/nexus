"use client"

import { memo, useCallback, useMemo, useState } from "react"
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
import type { TaskCardData } from "./task-card"

type ZoomLevel = "day" | "week" | "month"

interface TimelineViewProps {
  tasks: TaskCardData[]
  onTaskClick: (task: TaskCardData) => void
}

// Assign colors to assignees based on zinc shades
const ASSIGNEE_COLORS = [
  "bg-foreground",
  "bg-foreground",
  "bg-on-surface-variant",
  "bg-foreground",
  "bg-on-surface-variant",
  "bg-surface-container-high",
  "bg-foreground",
  "bg-surface-container-high",
]

interface TimelineScheduledTask extends TaskCardData {
  startDate: Date
  endDate: Date
}

interface TimelineDayMeta {
  key: string
  dayLabel: string
  weekdayLabel: string
  isWeekend: boolean
  isToday: boolean
}

interface TimelineGridBackgroundProps {
  days: TimelineDayMeta[]
  subtle?: boolean
}

const TimelineGridBackground = memo(function TimelineGridBackground({
  days,
  subtle = false,
}: TimelineGridBackgroundProps) {
  return (
    <div className="absolute inset-0 flex">
      {days.map((day) => (
        <div
          key={day.key}
          className={cn(
            "flex-1 border-r last:border-r-0",
            subtle ? "border-border/30" : "border-border/50",
            day.isWeekend && "bg-muted/50"
          )}
        />
      ))}
    </div>
  )
})

interface TimelineTaskRowProps {
  task: TimelineScheduledTask
  days: TimelineDayMeta[]
  barColor: string
  barStyle: { left: string; width: string } | null
  todayMarkerLeft: string | null
  onTaskClick: (task: TaskCardData) => void
}

const TimelineTaskRow = memo(function TimelineTaskRow({
  task,
  days,
  barColor,
  barStyle,
  todayMarkerLeft,
  onTaskClick,
}: TimelineTaskRowProps) {
  const handleOpen = useCallback(() => {
    onTaskClick(task)
  }, [onTaskClick, task])

  return (
    <div className="flex items-center h-10 group hover:bg-accent/50 transition-colors">
      <div className="w-52 shrink-0 flex items-center gap-2 pr-3 border-r">
        <span
          className="text-xs font-medium text-foreground truncate flex-1 cursor-pointer hover:text-muted-foreground transition-colors"
          onClick={handleOpen}
        >
          {task.title}
        </span>
        {task.assignees.length > 0 && (
          <UserAvatar user={{ name: task.assignees[0].name, avatar: task.assignees[0].avatar }} size="xs" className="shrink-0 border border-background" />
        )}
      </div>

      <div className="flex-1 relative h-8">
        <TimelineGridBackground days={days} />
        {todayMarkerLeft && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
            style={{ left: todayMarkerLeft }}
          />
        )}
        {barStyle && (
          <div
            className={cn(
              "absolute top-1.5 h-5 rounded cursor-pointer transition-all hover:opacity-80 hover:shadow-md z-[5]",
              barColor
            )}
            style={barStyle}
            onClick={handleOpen}
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
})

interface TimelineUnscheduledRowProps {
  task: TaskCardData
  days: TimelineDayMeta[]
  todayMarkerLeft: string | null
  onTaskClick: (task: TaskCardData) => void
}

const TimelineUnscheduledRow = memo(function TimelineUnscheduledRow({
  task,
  days,
  todayMarkerLeft,
  onTaskClick,
}: TimelineUnscheduledRowProps) {
  const handleOpen = useCallback(() => {
    onTaskClick(task)
  }, [onTaskClick, task])

  return (
    <div className="flex items-center h-10 group hover:bg-accent/50 transition-colors">
      <div className="w-52 shrink-0 flex items-center gap-2 pr-3 border-r">
        <span
          className="text-xs font-medium text-foreground truncate flex-1 cursor-pointer hover:text-muted-foreground transition-colors"
          onClick={handleOpen}
        >
          {task.title}
        </span>
        {task.assignees.length > 0 && (
          <UserAvatar user={{ name: task.assignees[0].name, avatar: task.assignees[0].avatar }} size="xs" className="shrink-0 border border-background" />
        )}
      </div>
      <div className="flex-1 relative h-8">
        <TimelineGridBackground days={days} subtle />
        {todayMarkerLeft && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/20 z-10"
            style={{ left: todayMarkerLeft }}
          />
        )}
        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/60 italic">
          No dates set
        </span>
      </div>
    </div>
  )
})

export function TimelineView({ tasks, onTaskClick }: TimelineViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("week")

  // Compute visible range
  const { days, rangeStart, rangeEnd } = useMemo(() => {
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
    return {
      days: allDays,
      rangeStart: start,
      rangeEnd: end,
    }
  }, [currentDate, zoomLevel])

  const timelineDays = useMemo<TimelineDayMeta[]>(
    () =>
      days.map((day) => ({
        key: day.toISOString(),
        dayLabel: format(day, "d"),
        weekdayLabel: format(day, "EEE"),
        isWeekend: getDay(day) === 0 || getDay(day) === 6,
        isToday: isToday(day),
      })),
    [days]
  )

  const todayIndex = useMemo(() => timelineDays.findIndex((day) => day.isToday), [timelineDays])
  const todayMarkerLeft = todayIndex >= 0 ? `${((todayIndex + 0.5) / timelineDays.length) * 100}%` : null

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
    const scheduled: TimelineScheduledTask[] = []
    const unscheduled: TaskCardData[] = []

    tasks.forEach((t) => {
      if (t.dueDate) {
        const endDate = startOfDay(new Date(t.dueDate))
        // Default to a 3-day bar ending at the due date for visibility, 
        // or 1-day if it's strictly a deadline. Let's use 2 days for better UI presence.
        const adjustedStart = new Date(endDate)
        adjustedStart.setDate(endDate.getDate() - 1) 

        scheduled.push({ ...t, startDate: adjustedStart, endDate })
      } else {
        unscheduled.push(t)
      }
    })

    scheduled.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    return { scheduledTasks: scheduled, unscheduledTasks: unscheduled }
  }, [tasks])

  // Filter to visible
  const visibleScheduledRows = useMemo(() => {
    return scheduledTasks
      .filter((task) => (
        isWithinInterval(task.startDate, { start: rangeStart, end: rangeEnd }) ||
        isWithinInterval(task.endDate, { start: rangeStart, end: rangeEnd }) ||
        isWithinInterval(rangeStart, { start: task.startDate, end: task.endDate })
      ))
      .map((task) => {
        const totalDays = days.length
        const taskStart = differenceInDays(task.startDate, rangeStart)
        const taskEnd = differenceInDays(task.endDate, rangeStart)
        const clampedStart = Math.max(0, taskStart)
        const clampedEnd = Math.min(totalDays - 1, taskEnd)
        const barStyle =
          clampedStart > totalDays - 1 || clampedEnd < 0
            ? null
            : {
                left: `${(clampedStart / totalDays) * 100}%`,
                width: `${Math.max(((clampedEnd - clampedStart + 1) / totalDays) * 100, 1.5)}%`,
              }

        return {
          task,
          barStyle,
          barColor: task.assignees.length > 0
            ? assigneeColorMap.get(task.assignees[0].id) || "bg-foreground"
            : "bg-surface-container-high",
        }
      })
  }, [assigneeColorMap, days.length, rangeEnd, rangeStart, scheduledTasks])

  const navigate = useCallback((dir: 1 | -1) => {
    if (zoomLevel === "day") {
      setCurrentDate(dir === 1 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1))
    } else if (zoomLevel === "week") {
      setCurrentDate(dir === 1 ? addWeeks(currentDate, 2) : subWeeks(currentDate, 2))
    } else {
      setCurrentDate(dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1))
    }
  }, [currentDate, zoomLevel])

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
      <div className="relative mb-1">
        <div className="flex">
          <div className="w-52 shrink-0" />
          <div className="flex-1">
            {/* Week row */}
            <div className="flex">
              {timelineDays.map((day) => {
                return (
                  <div
                    key={day.key}
                    className={cn(
                      "flex-1 text-center text-[9px] py-1 border-r border-b last:border-r-0",
                      day.isWeekend ? "bg-muted/50 text-muted-foreground/60" : "text-muted-foreground",
                      day.isToday && "font-bold text-foreground"
                    )}
                  >
                    <div>{day.dayLabel}</div>
                    <div className="text-[8px] uppercase">{day.weekdayLabel}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Task rows */}
      {visibleScheduledRows.length === 0 && unscheduledTasks.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No tasks to display in this period
        </div>
      ) : (
        <div className="space-y-0">
          {visibleScheduledRows.map(({ task, barStyle, barColor }) => (
            <TimelineTaskRow
              key={task.id}
              task={task}
              days={timelineDays}
              barColor={barColor}
              barStyle={barStyle}
              todayMarkerLeft={todayMarkerLeft}
              onTaskClick={onTaskClick}
            />
          ))}

          {/* Unscheduled section */}
          {unscheduledTasks.length > 0 && (
            <>
              <div className="border-t my-3" />
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5 px-1">
                <Calendar className="h-3 w-3" />
                Unscheduled ({unscheduledTasks.length})
              </div>
              {unscheduledTasks.map((task) => (
                <TimelineUnscheduledRow
                  key={task.id}
                  task={task}
                  days={timelineDays}
                  todayMarkerLeft={todayMarkerLeft}
                  onTaskClick={onTaskClick}
                />
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

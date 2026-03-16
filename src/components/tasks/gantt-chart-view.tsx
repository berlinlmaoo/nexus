"use client"

import { useMemo, useState, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
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
  addQuarters,
  subQuarters,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfDay,
  isToday,
  getDay,
  isWithinInterval,
} from "date-fns"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"
import type { TaskCardData } from "./task-card"

type ZoomLevel = "day" | "week" | "month" | "quarter"

interface GanttChartViewProps {
  tasks: TaskCardData[]
  onTaskClick?: (task: TaskCardData) => void
}

export function GanttChartView({ tasks, onTaskClick }: GanttChartViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("month")
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Compute visible range
  const { days, rangeStart, rangeEnd } = useMemo(() => {
    let start: Date, end: Date
    if (zoomLevel === "day") {
      start = startOfWeek(currentDate)
      end = endOfWeek(addWeeks(currentDate, 1))
    } else if (zoomLevel === "week") {
      start = startOfWeek(subWeeks(currentDate, 1))
      end = endOfWeek(addWeeks(currentDate, 2))
    } else if (zoomLevel === "month") {
      start = startOfMonth(currentDate)
      end = endOfMonth(addMonths(currentDate, 1))
    } else {
      start = startOfQuarter(currentDate)
      end = endOfQuarter(addQuarters(currentDate, 0))
    }
    const allDays = eachDayOfInterval({ start, end })
    return { days: allDays, rangeStart: start, rangeEnd: end }
  }, [currentDate, zoomLevel])

  const todayIndex = useMemo(() => days.findIndex((d) => isToday(d)), [days])

  // Build task hierarchy (parent tasks with subtasks)
  const taskHierarchy = useMemo(() => {
    // For simplicity, treat tasks with subtaskCount > 0 as parent tasks
    // Group tasks - parent tasks first, then their children
    const parentTasks = tasks.filter((t) => (t.subtaskCount ?? 0) > 0)
    const standaloneTasks = tasks.filter((t) => (t.subtaskCount ?? 0) === 0)

    interface HierarchyItem {
      task: TaskCardData & { startDate: Date; endDate: Date }
      depth: number
      isParent: boolean
      progress: number
      isMilestone: boolean
    }

    const items: HierarchyItem[] = []
    const unscheduled: TaskCardData[] = []

    // Add parent tasks with their subtask info
    parentTasks.forEach((t) => {
      const endDate = t.dueDate ? startOfDay(new Date(t.dueDate)) : startOfDay(new Date())
      const startDate = startOfDay(subWeeks(endDate, 2))
      const progress = t.subtaskCount ? ((t.subtaskDoneCount ?? 0) / t.subtaskCount) * 100 : 0

      items.push({
        task: { ...t, startDate, endDate },
        depth: 0,
        isParent: true,
        progress,
        isMilestone: false,
      })
    })

    // Add standalone tasks
    standaloneTasks.forEach((t) => {
      if (!t.dueDate) {
        unscheduled.push(t)
        return
      }

      const endDate = startOfDay(new Date(t.dueDate))
      const startDate = startOfDay(subWeeks(endDate, 1))

      // Milestone: if start == end (same day)
      const isMilestone = differenceInDays(endDate, startDate) === 0

      items.push({
        task: { ...t, startDate, endDate },
        depth: 0,
        isParent: false,
        progress: t.status === "DONE" ? 100 : t.status === "IN_REVIEW" ? 75 : t.status === "IN_PROGRESS" ? 40 : 0,
        isMilestone,
      })
    })

    return { items, unscheduled }
  }, [tasks])

  const { items: hierarchyItems, unscheduled: unscheduledTasks } = taskHierarchy

  // Filter visible tasks
  const visibleItems = useMemo(() => {
    return hierarchyItems.filter((item) => {
      const t = item.task
      return (
        isWithinInterval(t.startDate, { start: rangeStart, end: rangeEnd }) ||
        isWithinInterval(t.endDate, { start: rangeStart, end: rangeEnd }) ||
        isWithinInterval(rangeStart, { start: t.startDate, end: t.endDate })
      )
    })
  }, [hierarchyItems, rangeStart, rangeEnd])

  // Find critical path (longest chain - simplified: tasks with URGENT/HIGH priority)
  const criticalTaskIds = useMemo(() => {
    const ids = new Set<string>()
    tasks
      .filter((t) => t.priority === "URGENT" || t.priority === "HIGH")
      .forEach((t) => ids.add(t.id))
    return ids
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
    return { left: `${left}%`, width: `${Math.max(width, 3)}%` }
  }

  const navigate = (dir: 1 | -1) => {
    if (zoomLevel === "day") {
      setCurrentDate(dir === 1 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1))
    } else if (zoomLevel === "week") {
      setCurrentDate(dir === 1 ? addWeeks(currentDate, 2) : subWeeks(currentDate, 2))
    } else if (zoomLevel === "month") {
      setCurrentDate(dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1))
    } else {
      setCurrentDate(dir === 1 ? addQuarters(currentDate, 1) : subQuarters(currentDate, 1))
    }
  }

  const headerLabel =
    zoomLevel === "quarter"
      ? `Q${Math.ceil((rangeStart.getMonth() + 1) / 3)} ${format(rangeStart, "yyyy")}`
      : zoomLevel === "month"
      ? format(currentDate, "MMMM yyyy")
      : `${format(rangeStart, "MMM d")} - ${format(rangeEnd, "MMM d, yyyy")}`

  const toggleParent = (taskId: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">Gantt Chart</h3>
        <div className="flex items-center gap-3">
          {/* Zoom toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            {(["day", "week", "month", "quarter"] as const).map((level) => (
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
            <span className="text-sm font-medium min-w-[160px] text-center">{headerLabel}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button variant="outline" size="sm" className="h-8" onClick={() => setCurrentDate(new Date())}>
            Today
          </Button>
        </div>
      </div>

      {/* Timeline header */}
      <div className="relative mb-1" ref={scrollRef}>
        <div className="flex">
          <div className="w-56 shrink-0 text-[10px] font-medium text-muted-foreground py-1 px-2 border-b border-r">
            Task
          </div>
          <div className="flex-1 flex">
            {days.map((day, i) => {
              const isWeekend = getDay(day) === 0 || getDay(day) === 6
              const today = isToday(day)
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
                  {(zoomLevel === "day" || zoomLevel === "week") && (
                    <div className="text-[8px] uppercase">{format(day, "EEE")}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Task rows */}
      {visibleItems.length === 0 && unscheduledTasks.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No tasks to display in this period
        </div>
      ) : (
        <div className="space-y-0">
          {visibleItems.map((item) => {
            const barStyle = getBarStyle(item.task)
            const isCritical = criticalTaskIds.has(item.task.id)
            const isHovered = hoveredRow === item.task.id

            return (
              <motion.div
                key={item.task.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={cn(
                  "flex items-center h-10 transition-colors",
                  isHovered && "bg-accent"
                )}
                onMouseEnter={() => setHoveredRow(item.task.id)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                {/* Left panel: task hierarchy */}
                <div
                  className="w-56 shrink-0 flex items-center gap-1.5 pr-2 border-r cursor-pointer"
                  style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
                  onClick={() => {
                    if (item.isParent) toggleParent(item.task.id)
                    else onTaskClick?.(item.task)
                  }}
                >
                  {item.isParent && (
                    <span className="shrink-0 text-muted-foreground/60">
                      {collapsedParents.has(item.task.id) ? (
                        <ChevronRightIcon className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-xs truncate flex-1",
                      item.isParent ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
                      !item.isParent && "ml-3.5"
                    )}
                  >
                    {item.task.title}
                  </span>
                </div>

                {/* Right panel: gantt bars */}
                <div className="flex-1 relative h-8">
                  {/* Grid with weekend shading */}
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

                  {/* Today line (red) */}
                  {todayIndex >= 0 && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                      style={{ left: `${((todayIndex + 0.5) / days.length) * 100}%` }}
                    />
                  )}

                  {/* Milestone or Bar */}
                  {item.isMilestone ? (
                    // Milestone diamond
                    barStyle && (
                      <div
                        className="absolute z-[5] cursor-pointer"
                        style={{ left: barStyle.left, top: "50%", transform: "translateY(-50%)" }}
                        onClick={() => onTaskClick?.(item.task)}
                        title={`${item.task.title} (Milestone)`}
                      >
                        <div
                          className={cn(
                            "h-4 w-4 rotate-45 border-2",
                            isCritical
                              ? "bg-red-500 border-red-600"
                              : "bg-zinc-800 border-zinc-900"
                          )}
                        />
                      </div>
                    )
                  ) : (
                    barStyle && (
                      <div
                        className={cn(
                          "absolute top-1.5 h-5 rounded cursor-pointer transition-all hover:opacity-80 hover:shadow-md z-[5] overflow-hidden",
                          isCritical ? "bg-red-400" : item.isParent ? "bg-zinc-800" : "bg-zinc-600"
                        )}
                        style={barStyle}
                        onClick={() => onTaskClick?.(item.task)}
                        title={`${item.task.title} — ${Math.round(item.progress)}% complete`}
                      >
                        {/* Progress fill */}
                        {item.progress > 0 && (
                          <div
                            className={cn(
                              "absolute inset-y-0 left-0 rounded-l",
                              isCritical ? "bg-red-600" : item.isParent ? "bg-zinc-950" : "bg-zinc-800"
                            )}
                            style={{ width: `${item.progress}%` }}
                          />
                        )}
                        <span className="absolute inset-0 flex items-center px-1.5 text-[9px] text-white font-medium truncate z-10">
                          {item.task.title}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </motion.div>
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
                  <div className="w-56 shrink-0 flex items-center gap-2 pr-3 border-r pl-2">
                    <span className="text-xs font-medium text-foreground truncate flex-1 cursor-pointer hover:text-muted-foreground transition-colors" onClick={() => onTaskClick?.(task)}>
                      {task.title}
                    </span>
                  </div>
                  <div className="flex-1 relative h-8">
                    <div className="absolute inset-0 flex">
                      {days.map((_, i) => (<div key={i} className="flex-1 border-r border-border/30 last:border-r-0" />))}
                    </div>
                    {todayIndex >= 0 && (<div className="absolute top-0 bottom-0 w-0.5 bg-red-500/20 z-10" style={{ left: `${((todayIndex + 0.5) / days.length) * 100}%` }} />)}
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/60 italic">No dates set</span>
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
          <span className="h-2.5 w-4 rounded-sm bg-zinc-800" /> Parent task
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm bg-zinc-600" /> Task
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm bg-red-400" /> Critical path
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rotate-45 bg-zinc-800" />
          <span className="ml-0.5">Milestone</span>
        </span>
        <span className="flex items-center gap-1 ml-2">
          <span className="h-3 w-0.5 bg-red-500" /> Today
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 bg-muted/50 border border-border rounded-sm" /> Weekend
        </span>
      </div>
    </Card>
  )
}

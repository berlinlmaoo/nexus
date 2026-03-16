"use client"

import { useState, useMemo } from "react"
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
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface CalendarTask {
  id: string
  title: string
  dueDate: string
  project?: {
    color: string
  }
}

interface CalendarWidgetProps {
  data?: {
    tasks?: CalendarTask[]
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function CalendarWidget({ data }: CalendarWidgetProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const tasks = data?.tasks ?? []

  const tasksByDate = useMemo(() => {
    const map = new Map<string, CalendarTask[]>()
    for (const task of tasks) {
      if (!task.dueDate) continue
      const key = format(new Date(task.dueDate), "yyyy-MM-dd")
      const existing = map.get(key) ?? []
      existing.push(task)
      map.set(key, existing)
    }
    return map
  }, [tasks])

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const calStart = startOfWeek(monthStart)
    const calEnd = endOfWeek(monthEnd)
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [currentMonth])

  return (
    <div className="flex flex-col h-full w-full overflow-hidden px-1">
      {/* Header with nav */}
      <div className="flex items-center justify-between flex-shrink-0 mb-2">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">
            {format(currentMonth, "MMMM yyyy")}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCurrentMonth(new Date())}
          >
            <span className="text-[10px] font-medium">Today</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0 flex-shrink-0">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="text-center text-[10px] font-medium text-muted-foreground py-1"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day grid — fills remaining space */}
      <div className="grid grid-cols-7 flex-1 auto-rows-fr">
        {calendarDays.map((day) => {
          const dateKey = format(day, "yyyy-MM-dd")
          const dayTasks = tasksByDate.get(dateKey) ?? []
          const inCurrentMonth = isSameMonth(day, currentMonth)
          const today = isToday(day)

          return (
            <div
              key={dateKey}
              className={cn(
                "relative flex flex-col items-center justify-center p-0.5",
                !inCurrentMonth && "opacity-20"
              )}
            >
              <span
                className={cn(
                  "text-xs leading-none w-6 h-6 flex items-center justify-center rounded-full",
                  today && "bg-foreground text-background font-bold",
                  !today && "text-muted-foreground"
                )}
              >
                {format(day, "d")}
              </span>
              {/* Task dots */}
              {dayTasks.length > 0 && (
                <div className="flex items-center gap-0.5 mt-0.5">
                  {dayTasks.slice(0, 3).map((task, i) => (
                    <span
                      key={task.id ?? i}
                      className="h-1 w-1 rounded-full"
                      style={{
                        backgroundColor: task.project?.color ?? "#71717a",
                      }}
                    />
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

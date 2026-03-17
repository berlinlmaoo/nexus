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
  isToday,
  addMonths,
  subMonths,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
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

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]

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
    <div className="flex flex-col h-full w-full pr-0.5">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-1.5">
        <span className="text-xs font-semibold">
          {format(currentMonth, "MMM yyyy")}
        </span>
        <div className="flex items-center">
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            className="h-5 px-1 flex items-center justify-center rounded hover:bg-muted transition-colors text-[9px] font-medium text-muted-foreground"
            onClick={() => setCurrentMonth(new Date())}
          >
            Today
          </button>
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Weekday headers — single letters */}
      <div className="grid grid-cols-7 flex-shrink-0">
        {WEEKDAY_LETTERS.map((letter, i) => (
          <div
            key={i}
            className="text-center text-[9px] font-medium text-muted-foreground/70 py-0.5"
          >
            {letter}
          </div>
        ))}
      </div>

      {/* Day grid */}
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
                "flex flex-col items-center justify-center",
                !inCurrentMonth && "opacity-20"
              )}
            >
              <span
                className={cn(
                  "text-[11px] leading-none w-5 h-5 flex items-center justify-center rounded-full",
                  today && "bg-foreground text-background font-bold",
                  !today && "text-muted-foreground"
                )}
              >
                {format(day, "d")}
              </span>
              {dayTasks.length > 0 && (
                <div className="flex items-center gap-px mt-px">
                  {dayTasks.slice(0, 3).map((task, i) => (
                    <span
                      key={task.id ?? i}
                      className="h-1 w-1 rounded-full"
                      style={{
                        backgroundColor: task.project?.color ?? "#71717a",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

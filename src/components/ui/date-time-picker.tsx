"use client"

import { useEffect, useMemo, useState } from "react"
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { PopoverContentProps } from "@radix-ui/react-popover"

interface DateTimePickerProps {
  value: string | null
  onChange: (value: string | null) => void
  className?: string
  variant?: "popover" | "inline"
  popoverAlign?: PopoverContentProps["align"]
  popoverSide?: PopoverContentProps["side"]
  popoverSideOffset?: number
  popoverAvoidCollisions?: boolean
}

const QUICK_TIME_OPTIONS = [
  { label: "09:00", hour: 9, minute: 0 },
  { label: "12:00", hour: 12, minute: 0 },
  { label: "17:00", hour: 17, minute: 0 },
  { label: "20:00", hour: 20, minute: 0 },
] as const

function buildLocalDate(date: Date, hour: number, minute: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0
  )
}

export function DateTimePicker({
  value,
  onChange,
  className,
  variant = "popover",
  popoverAlign = "end",
  popoverSide = "bottom",
  popoverSideOffset = 10,
  popoverAvoidCollisions = true,
}: DateTimePickerProps) {
  const selectedDate = useMemo(() => (value ? new Date(value) : null), [value])
  const [open, setOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState<Date>(
    selectedDate ?? new Date()
  )
  const [draftDate, setDraftDate] = useState<Date | null>(selectedDate)
  const [hour, setHour] = useState(
    selectedDate ? String(selectedDate.getHours()).padStart(2, "0") : "09"
  )
  const [minute, setMinute] = useState(
    selectedDate ? String(selectedDate.getMinutes()).padStart(2, "0") : "00"
  )

  useEffect(() => {
    const nextSelected = value ? new Date(value) : null
    setDraftDate(nextSelected)
    setCurrentMonth(nextSelected ?? new Date())
    setHour(nextSelected ? String(nextSelected.getHours()).padStart(2, "0") : "09")
    setMinute(
      nextSelected ? String(nextSelected.getMinutes()).padStart(2, "0") : "00"
    )
  }, [value, open])

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    const days: Date[] = []

    let day = calendarStart
    while (day <= calendarEnd) {
      days.push(day)
      day = addDays(day, 1)
    }

    return days
  }, [currentMonth])

  const applySelection = () => {
    if (!draftDate) {
      onChange(null)
      setOpen(false)
      return
    }

    const nextDate = buildLocalDate(
      draftDate,
      Number.parseInt(hour, 10),
      Number.parseInt(minute, 10)
    )
    onChange(nextDate.toISOString())
    setOpen(false)
  }

  const clearSelection = () => {
    setDraftDate(null)
    onChange(null)
    setOpen(false)
  }

  const setToday = () => {
    const now = new Date()
    setDraftDate(now)
    setCurrentMonth(now)
    setHour(String(now.getHours()).padStart(2, "0"))
    setMinute(String(now.getMinutes()).padStart(2, "0"))
  }

  const chooseDay = (day: Date) => {
    setDraftDate((current) =>
      buildLocalDate(
        day,
        current?.getHours() ?? Number.parseInt(hour, 10),
        current?.getMinutes() ?? Number.parseInt(minute, 10)
      )
    )
  }

  const displayValue = selectedDate
    ? format(selectedDate, "dd MMM yyyy • HH:mm")
    : "Set date and time"

  const pickerContent = (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-surface-container px-3 py-2.5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-on-surface-variant/35">
            Calendar
          </p>
          <p className="mt-1 text-sm font-black text-on-surface">
            {format(currentMonth, "MMMM yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl"
            onClick={() => setCurrentMonth((month) => subMonths(month, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl"
            onClick={() => setCurrentMonth((month) => addMonths(month, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((dayLabel) => (
          <div
            key={dayLabel}
            className="pb-1 text-[10px] font-black uppercase tracking-[0.25em] text-on-surface-variant/35"
          >
            {dayLabel}
          </div>
        ))}
        {calendarDays.map((day) => {
          const isSelected = draftDate ? isSameDay(day, draftDate) : false
          const isToday = isSameDay(day, new Date())
          const isOutside = !isSameMonth(day, currentMonth)

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => chooseDay(day)}
              className={cn(
                "flex h-11 items-center justify-center rounded-2xl text-sm font-bold transition-all",
                isSelected
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : isToday
                    ? "bg-primary/8 text-primary"
                    : "text-on-surface hover:bg-surface-container",
                isOutside && !isSelected && "text-on-surface-variant/30"
              )}
            >
              {format(day, "d")}
            </button>
          )
        })}
      </div>

      <div className="rounded-[1.5rem] border border-on-surface-variant/8 bg-gradient-to-br from-surface-container to-surface-container-high p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-primary" />
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-on-surface-variant/35">
            Time
          </p>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <select
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            className="h-12 rounded-2xl border border-on-surface-variant/10 bg-surface-container-lowest px-4 text-sm font-bold text-on-surface outline-none transition-all focus:ring-2 focus:ring-primary/10"
          >
            {Array.from({ length: 24 }, (_, index) => {
              const hourValue = String(index).padStart(2, "0")
              return (
                <option key={hourValue} value={hourValue}>
                  {hourValue}
                </option>
              )
            })}
          </select>
          <span className="text-lg font-black text-on-surface-variant/35">:</span>
          <select
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            className="h-12 rounded-2xl border border-on-surface-variant/10 bg-surface-container-lowest px-4 text-sm font-bold text-on-surface outline-none transition-all focus:ring-2 focus:ring-primary/10"
          >
            {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map(
              (minuteValue) => (
                <option key={minuteValue} value={minuteValue}>
                  {minuteValue}
                </option>
              )
            )}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_TIME_OPTIONS.map((option) => {
            const isActive =
              hour === String(option.hour).padStart(2, "0") &&
              minute === String(option.minute).padStart(2, "0")

            return (
              <button
                key={option.label}
                type="button"
                onClick={() => {
                  setHour(String(option.hour).padStart(2, "0"))
                  setMinute(String(option.minute).padStart(2, "0"))
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/15"
                    : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-xl px-3 text-[11px] font-black uppercase tracking-[0.18em]"
            onClick={clearSelection}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-xl px-3 text-[11px] font-black uppercase tracking-[0.18em]"
            onClick={setToday}
          >
            Today
          </Button>
        </div>

        <Button
          type="button"
          size="sm"
          className="rounded-xl px-4 text-[11px] font-black uppercase tracking-[0.18em]"
          onClick={applySelection}
          disabled={!draftDate}
        >
          <Check className="mr-2 h-3.5 w-3.5" />
          Apply
        </Button>
      </div>
    </div>
  )

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "w-full rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container-lowest p-4 shadow-xl shadow-primary/5",
          className
        )}
      >
        {pickerContent}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group w-full rounded-2xl border border-on-surface-variant/5 bg-gradient-to-br from-surface-container-low to-surface-container px-4 py-3 text-left shadow-inner transition-all hover:border-primary/15 hover:shadow-lg hover:shadow-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/10",
            className
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-on-surface-variant/35">
                Due schedule
              </p>
              <p
                className={cn(
                  "mt-2 truncate text-sm font-bold",
                  selectedDate ? "text-on-surface" : "text-on-surface-variant/45"
                )}
              >
                {displayValue}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-container-lowest text-on-surface-variant/60 shadow-sm transition-all group-hover:text-primary">
              <CalendarDays className="h-4 w-4" />
            </div>
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align={popoverAlign}
        side={popoverSide}
        sideOffset={popoverSideOffset}
        avoidCollisions={popoverAvoidCollisions}
        className="w-[360px] rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container-lowest p-4 shadow-2xl shadow-primary/10"
      >
        {pickerContent}
      </PopoverContent>
    </Popover>
  )
}

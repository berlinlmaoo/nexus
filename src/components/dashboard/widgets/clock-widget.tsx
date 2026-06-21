"use client"

import { useState, useEffect } from "react"
import { Clock } from "lucide-react"

interface ClockDashWidgetProps {
  data?: any
}

interface TimezoneDisplay {
  label: string
  timezone: string
}

const timezones: TimezoneDisplay[] = [
  { label: "Local", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  { label: "UTC", timezone: "UTC" },
  { label: "Jakarta", timezone: "Asia/Jakarta" },
]

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(date)
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date)
}

function formatShortTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(date)
}

export function ClockDashWidget({ data }: ClockDashWidgetProps) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  if (!now) {
    return (
      <div className="flex h-full items-center justify-center">
        <Clock className="h-5 w-5 animate-pulse text-muted-foreground" />
      </div>
    )
  }

  const localTimezone = timezones[0].timezone

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="text-center">
        <p className="font-mono text-3xl font-bold tracking-wider text-foreground">
          {formatTime(now, localTimezone)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDate(now)}
        </p>
      </div>

      <div className="mt-4 flex w-full justify-center gap-4">
        {timezones.map((tz) => (
          <div key={tz.label} className="text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {tz.label}
            </p>
            <p className="font-mono text-sm tabular-nums text-on-surface-variant">
              {formatShortTime(now, tz.timezone)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

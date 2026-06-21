export interface FormAccessSchedule {
  enabled?: boolean
  daysOfWeek?: number[]
  startTime?: string
  endTime?: string
  timezone?: string
  // Manual master switch that OVERRIDES the schedule: "open" = force-open (ignore schedule),
  // "closed" = force-closed. undefined = follow the schedule (or always-open if not enabled).
  override?: "open" | "closed"
}

const DEFAULT_TIMEZONE = "Asia/Jakarta"
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export const FORM_ACCESS_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

export function normalizeFormAccessSchedule(value: unknown): FormAccessSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const input = value as Record<string, unknown>
  const daysOfWeek = Array.isArray(input.daysOfWeek)
    ? Array.from(
        new Set(
          input.daysOfWeek
            .map((day) => Number(day))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        )
      ).sort((a, b) => a - b)
    : []
  const startTime = typeof input.startTime === "string" && TIME_PATTERN.test(input.startTime) ? input.startTime : "00:00"
  const endTime = typeof input.endTime === "string" && TIME_PATTERN.test(input.endTime) ? input.endTime : "23:59"
  const timezone = typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : DEFAULT_TIMEZONE
  const override = input.override === "open" || input.override === "closed" ? input.override : undefined

  return {
    enabled: Boolean(input.enabled),
    daysOfWeek,
    startTime,
    endTime,
    timezone,
    ...(override ? { override } : {}),
  }
}

export function getFormAccessStatus(scheduleValue: unknown, now = new Date()) {
  const schedule = normalizeFormAccessSchedule(scheduleValue)

  // Manual override wins over everything.
  if (schedule?.override === "open") return { allowed: true, schedule }
  if (schedule?.override === "closed") {
    return { allowed: false, schedule, message: "Form lagi ditutup sementara." }
  }

  if (!schedule?.enabled) return { allowed: true, schedule }

  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZone: schedule.timezone ?? DEFAULT_TIMEZONE,
  }).formatToParts(now)

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun"
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00"
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00"
  const dayIndex = FORM_ACCESS_DAY_LABELS.findIndex((label) => label === weekday)
  const currentMinutes = Number(hour) * 60 + Number(minute)
  const startMinutes = timeToMinutes(schedule.startTime ?? "00:00")
  const endMinutes = timeToMinutes(schedule.endTime ?? "23:59")
  // No days selected → treat the time window as applying to EVERY day (instead of locking shut).
  const days = schedule.daysOfWeek ?? []
  const isScheduledDay = days.length === 0 ? true : days.includes(dayIndex)
  const isScheduledTime =
    startMinutes <= endMinutes
      ? currentMinutes >= startMinutes && currentMinutes <= endMinutes
      : currentMinutes >= startMinutes || currentMinutes <= endMinutes

  if (isScheduledDay && isScheduledTime) return { allowed: true, schedule }

  return {
    allowed: false,
    schedule,
    message: `This form is only available ${formatFormAccessSchedule(schedule)}.`,
  }
}

export function formatFormAccessSchedule(scheduleValue: unknown) {
  const schedule = normalizeFormAccessSchedule(scheduleValue)
  if (!schedule?.enabled) return "anytime"

  const days = (schedule.daysOfWeek ?? []).map((day) => FORM_ACCESS_DAY_LABELS[day]).filter(Boolean)
  const dayText = days.length > 0 ? days.join(", ") : "no selected days"
  const startTime = schedule.startTime ?? "00:00"
  const endTime = schedule.endTime ?? "23:59"
  const timezone = schedule.timezone ?? DEFAULT_TIMEZONE

  return `${dayText}, ${startTime}-${endTime} (${timezone})`
}

function timeToMinutes(value: string) {
  const [, hour = "0", minute = "0"] = value.match(TIME_PATTERN) ?? []
  return Number(hour) * 60 + Number(minute)
}

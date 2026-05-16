const TASK_CARD_TIME_ZONE = "Asia/Jakarta"
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const monthDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: TASK_CARD_TIME_ZONE,
})

const monthDayTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TASK_CARD_TIME_ZONE,
})

function formatDateOnlyValue(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10))
  if (!year || !month || !day) return value

  const utcDate = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(utcDate)
}

function getTimeZonePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? ""
}

export function formatTaskDateTime(dateValue: string | Date) {
  if (typeof dateValue === "string") {
    const rawValue = dateValue.trim()
    if (!rawValue) return ""
    if (DATE_ONLY_PATTERN.test(rawValue)) return formatDateOnlyValue(rawValue)
  }

  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue
  if (Number.isNaN(date.getTime())) {
    return typeof dateValue === "string" ? dateValue : ""
  }

  const parts = monthDayTimeFormatter.formatToParts(date)
  const hour = getTimeZonePart(parts, "hour")
  const minute = getTimeZonePart(parts, "minute")
  const hasExplicitTime = hour !== "00" || minute !== "00"

  if (!hasExplicitTime) {
    return monthDayFormatter.format(date)
  }

  return `${monthDayFormatter.format(date)} • ${hour}:${minute}`
}

export function formatTaskDueDate(dateValue: string | Date) {
  return formatTaskDateTime(dateValue)
}

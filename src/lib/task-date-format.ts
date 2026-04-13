import { format } from "date-fns"

export function formatTaskDueDate(dateValue: string | Date) {
  const dueDate = typeof dateValue === "string" ? new Date(dateValue) : dateValue
  const dateLabel = format(dueDate, "MMM d")
  const hasExplicitTime = dueDate.getHours() !== 0 || dueDate.getMinutes() !== 0

  if (!hasExplicitTime) {
    return dateLabel
  }

  return `${dateLabel} • ${format(dueDate, "HH:mm")}`
}

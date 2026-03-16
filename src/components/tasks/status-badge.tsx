"use client"

import { cn } from "@/lib/utils"
import { Circle, Loader2, Eye, CheckCircle2, XCircle } from "lucide-react"

interface StatusBadgeProps {
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
  className?: string
  showLabel?: boolean
}

const statusConfig = {
  TODO: {
    label: "To Do",
    color: "bg-muted text-muted-foreground border-border",
    icon: Circle,
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    icon: Loader2,
  },
  IN_REVIEW: {
    label: "In Review",
    color: "bg-muted text-muted-foreground border-border",
    icon: Eye,
  },
  DONE: {
    label: "Done",
    color: "bg-green-100 text-green-700 border-green-200",
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "bg-red-100 text-red-700 border-red-200",
    icon: XCircle,
  },
}

export function StatusBadge({
  status,
  className,
  showLabel = true,
}: StatusBadgeProps) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        config.color,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {showLabel && config.label}
    </span>
  )
}

"use client"

import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Minus,
} from "lucide-react"

interface PriorityBadgeProps {
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
  className?: string
  showLabel?: boolean
}

const priorityConfig = {
  URGENT: {
    label: "Urgent",
    color: "bg-red-100 text-red-700 border-red-200",
    icon: AlertTriangle,
  },
  HIGH: {
    label: "High",
    color: "bg-orange-100 text-orange-700 border-orange-200",
    icon: ArrowUp,
  },
  MEDIUM: {
    label: "Medium",
    color: "bg-yellow-100 text-yellow-700 border-yellow-200",
    icon: ArrowRight,
  },
  LOW: {
    label: "Low",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    icon: ArrowDown,
  },
  NONE: {
    label: "None",
    color: "bg-muted text-muted-foreground border-border",
    icon: Minus,
  },
}

export function PriorityBadge({
  priority,
  className,
  showLabel = true,
}: PriorityBadgeProps) {
  const config = priorityConfig[priority]
  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        config.color,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {showLabel && config.label}
    </span>
  )
}

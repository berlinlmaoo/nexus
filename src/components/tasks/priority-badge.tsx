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
    color: "bg-red-500/10 text-red-600 border-red-500/20",
    icon: AlertTriangle,
  },
  HIGH: {
    label: "High",
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: ArrowUp,
  },
  MEDIUM: {
    label: "Medium",
    color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    icon: ArrowRight,
  },
  LOW: {
    label: "Low",
    color: "bg-primary/5 text-primary border-primary/10",
    icon: ArrowDown,
  },
  NONE: {
    label: "None",
    color: "bg-surface-container-high text-on-surface-variant border-transparent",
    icon: Minus,
  },
}

export function PriorityBadge({
  priority,
  className,
  showLabel = true,
}: PriorityBadgeProps) {
  const config = priorityConfig[priority] || priorityConfig.NONE
  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest transition-all",
        config.color,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {showLabel && config.label}
    </span>
  )
}

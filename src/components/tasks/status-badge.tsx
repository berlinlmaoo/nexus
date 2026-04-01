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
    label: "Pending",
    color: "bg-surface-container-high text-on-surface-variant border-transparent",
    icon: Circle,
  },
  IN_PROGRESS: {
    label: "Executing",
    color: "bg-primary/10 text-primary border-primary/20",
    icon: Loader2,
  },
  IN_REVIEW: {
    label: "Evaluating",
    color: "bg-secondary/10 text-secondary border-secondary/20",
    icon: Eye,
  },
  DONE: {
    label: "Finalized",
    color: "bg-green-500/10 text-green-600 border-green-500/20",
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: "Terminated",
    color: "bg-red-500/10 text-red-600 border-red-500/20",
    icon: XCircle,
  },
}

export function StatusBadge({
  status,
  className,
  showLabel = true,
}: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.TODO
  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all",
        config.color,
        className
      )}
    >
      <Icon className={cn("h-3 w-3", status === "IN_PROGRESS" && "animate-spin")} />
      {showLabel && config.label}
    </span>
  )
}

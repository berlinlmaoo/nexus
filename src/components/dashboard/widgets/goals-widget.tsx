"use client"

import Link from "next/link"
import { Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Goal {
  id: string
  title: string
  status: "ON_TRACK" | "AT_RISK" | "BEHIND" | "COMPLETED"
  progress: number
}

interface GoalsDashWidgetProps {
  data?: {
    goals?: Goal[]
  }
}

const statusConfig: Record<
  Goal["status"],
  { label: string; color: string; barColor: string }
> = {
  ON_TRACK: {
    label: "On Track",
    color: "bg-green-100 text-green-700 border-green-200",
    barColor: "bg-green-500",
  },
  AT_RISK: {
    label: "At Risk",
    color: "bg-yellow-100 text-yellow-700 border-yellow-200",
    barColor: "bg-yellow-500",
  },
  BEHIND: {
    label: "Behind",
    color: "bg-red-100 text-red-700 border-red-200",
    barColor: "bg-red-500",
  },
  COMPLETED: {
    label: "Completed",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    barColor: "bg-blue-500",
  },
}

export function GoalsDashWidget({ data }: GoalsDashWidgetProps) {
  const goals = data?.goals ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-1.5">
        <Target className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-sm font-medium text-muted-foreground">Goals</h3>
      </div>

      {goals.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
          No goals to display
        </div>
      ) : (
        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto">
          {goals.map((goal) => {
            const config = statusConfig[goal.status]
            return (
              <Link
                key={goal.id}
                href={`/goals/${goal.id}`}
                className="block rounded-md border border-border/50 p-2.5 transition-colors hover:bg-accent"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {goal.title}
                  </span>
                  <Badge
                    className={cn(
                      "shrink-0 text-[10px] px-1.5 py-0",
                      config.color
                    )}
                  >
                    {config.label}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        config.barColor
                      )}
                      style={{ width: `${Math.min(100, Math.max(0, goal.progress))}%` }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {goal.progress}%
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

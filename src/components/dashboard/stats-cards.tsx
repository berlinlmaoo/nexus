"use client"

import { useEffect, useState } from "react"
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ListTodo,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatsData {
  totalTasks: number
  inProgressTasks: number
  overdueTasks: number
  completedThisWeek: number
}

interface StatsCardsProps {
  stats: StatsData
}

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (value === 0) {
      setDisplay(0)
      return
    }
    const duration = 600
    const steps = 20
    const increment = value / steps
    let current = 0
    let step = 0

    const timer = setInterval(() => {
      step++
      current = Math.min(Math.round(increment * step), value)
      setDisplay(current)
      if (step >= steps) clearInterval(timer)
    }, duration / steps)

    return () => clearInterval(timer)
  }, [value])

  return <span>{display}</span>
}

const cards = [
  {
    key: "totalTasks" as const,
    label: "Total Tasks",
    icon: ListTodo,
    color: "text-foreground",
    bg: "bg-muted",
  },
  {
    key: "inProgressTasks" as const,
    label: "In Progress",
    icon: Clock,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    key: "overdueTasks" as const,
    label: "Overdue",
    icon: AlertTriangle,
    color: "text-red-500",
    bg: "bg-red-50",
  },
  {
    key: "completedThisWeek" as const,
    label: "Completed This Week",
    icon: CheckCircle2,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
]

export function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card
          key={card.key}
          className="transition-shadow hover:shadow-md animate-fade-in"
        >
          <CardContent className="flex items-center gap-4 p-5">
            <div className={cn("rounded-lg p-2.5", card.bg)}>
              <card.icon className={cn("h-5 w-5", card.color)} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="text-2xl font-bold">
                <AnimatedNumber value={stats[card.key]} />
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

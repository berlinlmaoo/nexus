"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import {
  CheckCircle2,
  Clock,
  ListTodo,
  TrendingUp,
  Target,
  Loader2,
} from "lucide-react"

interface RollupData {
  totalTasks: number
  completedTasks: number
  completionPercent: number
  avgCompletionDays: number
  linkedGoal?: {
    id: string
    title: string
    progress: number
    status: string
  }
}

interface ProjectRollupsProps {
  projectId: string
}

export function ProjectRollups({ projectId }: ProjectRollupsProps) {
  const [data, setData] = useState<RollupData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchRollups() {
      try {
        const res = await fetch(`/api/projects/${projectId}/rollups`)
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    fetchRollups()
  }, [projectId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  const cards = [
    {
      label: "Total Tasks",
      value: data.totalTasks,
      icon: ListTodo,
      color: "text-muted-foreground",
    },
    {
      label: "Completed",
      value: data.completedTasks,
      icon: CheckCircle2,
      color: "text-emerald-600",
    },
    {
      label: "Completion",
      value: `${data.completionPercent}%`,
      icon: TrendingUp,
      color: "text-blue-600",
    },
    {
      label: "Avg. Days",
      value: data.avgCompletionDays > 0 ? `${data.avgCompletionDays}d` : "—",
      icon: Clock,
      color: "text-amber-600",
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.label} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`h-4 w-4 ${card.color}`} />
                <span className="text-xs text-muted-foreground">{card.label}</span>
              </div>
              <p className="text-2xl font-bold">{card.value}</p>
            </Card>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Overall Progress</span>
          <span className="font-medium">{data.completionPercent}%</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100 transition-all duration-500"
            style={{ width: `${data.completionPercent}%` }}
          />
        </div>
      </div>

      {/* Goal link */}
      {data.linkedGoal && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Linked Goal</span>
          </div>
          <p className="text-sm font-medium mb-2">{data.linkedGoal.title}</p>
          <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${data.linkedGoal.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {data.linkedGoal.progress}% — {data.linkedGoal.status.replace("_", " ")}
          </p>
        </Card>
      )}
    </div>
  )
}

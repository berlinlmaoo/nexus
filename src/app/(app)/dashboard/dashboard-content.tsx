"use client"

import { useEffect, useState } from "react"
import { WidgetGrid } from "@/components/dashboard/widget-grid"
import { DashboardSkeleton } from "@/components/ui/skeleton"

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface DashboardData {
  stats: {
    totalTasks: number
    inProgressTasks: number
    overdueTasks: number
    completedThisWeek: number
  }
  tasks: Array<{
    id: string
    title: string
    status: string
    priority: string
    dueDate: string | null
    project: { id: string; name: string; color: string }
  }>
  activity: Array<{
    id: string
    action: string
    details: string | null
    createdAt: string
    user: { id: string; name: string; avatar: string | null }
    task: { id: string; title: string } | null
    project: { id: string; name: string } | null
  }>
  projects: Array<{
    id: string
    name: string
    color: string
    totalTasks: number
    completedTasks: number
    progress: number
  }>
  goals?: Array<{
    id: string
    title: string
    status: string
    progress: number
    owner: string
    milestonesTotal: number
    milestonesCompleted: number
  }>
  sprints?: Array<{
    id: string
    name: string
    project: string
    projectColor: string
    totalTasks: number
    completedTasks: number
    progress: number
  }>
}

export function DashboardContent({ userName }: { userName: string }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch")
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => console.error("Dashboard fetch error:", err))
      .finally(() => setLoading(false))
  }, [])

  const greeting = getGreeting()

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">
          {greeting}, {userName}
        </h1>
        <p className="text-muted-foreground mt-1">
          Here&apos;s what&apos;s happening with your projects today.
        </p>
      </div>

      {/* Widget Grid */}
      <WidgetGrid data={data} loading={!data} />
    </div>
  )
}

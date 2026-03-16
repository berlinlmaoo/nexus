"use client"

import { useEffect, useState, useCallback } from "react"
import { WidgetGrid } from "@/components/dashboard/widget-grid"
import { DashboardSkeleton } from "@/components/ui/skeleton"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

interface ProjectOption {
  id: string
  name: string
  color: string
  taskLists: { id: string; name: string }[]
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
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState("")
  const [selectedProject, setSelectedProject] = useState("")
  const [selectedTaskList, setSelectedTaskList] = useState("")
  const [taskPriority, setTaskPriority] = useState("MEDIUM")
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [creating, setCreating] = useState(false)

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

  const openQuickCreate = useCallback(async () => {
    setQuickCreateOpen(true)
    setTaskTitle("")
    setSelectedProject("")
    setSelectedTaskList("")
    setTaskPriority("MEDIUM")
    try {
      const res = await fetch("/api/projects")
      if (res.ok) {
        const data = await res.json()
        const projectList = Array.isArray(data) ? data : data.projects ?? []
        // Fetch task lists for each project
        const withTaskLists = await Promise.all(
          projectList.slice(0, 20).map(async (p: { id: string; name: string; color: string }) => {
            try {
              const tlRes = await fetch(`/api/projects/${p.id}/task-lists`)
              const tls = tlRes.ok ? await tlRes.json() : []
              return { ...p, taskLists: Array.isArray(tls) ? tls : [] }
            } catch {
              return { ...p, taskLists: [] }
            }
          })
        )
        setProjects(withTaskLists)
      }
    } catch {
      setProjects([])
    }
  }, [])

  const createTask = useCallback(async () => {
    if (!taskTitle.trim() || !selectedTaskList) return
    setCreating(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle.trim(),
          taskListId: selectedTaskList,
          priority: taskPriority,
          status: "TODO",
        }),
      })
      if (res.ok) {
        setQuickCreateOpen(false)
        // Refresh dashboard data
        const dashRes = await fetch("/api/dashboard")
        if (dashRes.ok) {
          const json = await dashRes.json()
          setData(json)
        }
      }
    } catch (err) {
      console.error("Failed to create task:", err)
    } finally {
      setCreating(false)
    }
  }, [taskTitle, selectedTaskList, taskPriority])

  const selectedProjectData = projects.find((p) => p.id === selectedProject)

  const greeting = getGreeting()

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="space-y-4">
      {/* Greeting + Quick Create */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            {greeting}, {userName}
          </h1>
          <p className="text-neutral-500 text-sm mt-1">
            Here&apos;s what&apos;s happening with your projects today.
          </p>
        </div>
        <Button
          onClick={openQuickCreate}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus className="h-4 w-4 mr-1" />
          Quick Task
        </Button>
      </div>

      {/* Widget Grid */}
      <WidgetGrid data={data} loading={!data} />

      {/* Quick Create Task Dialog */}
      <Dialog open={quickCreateOpen} onOpenChange={setQuickCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quick Create Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1">Task Title</label>
              <Input
                placeholder="What needs to be done?"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && taskTitle.trim() && selectedTaskList) createTask() }}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1">Project</label>
              <select
                value={selectedProject}
                onChange={(e) => {
                  setSelectedProject(e.target.value)
                  setSelectedTaskList("")
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            {selectedProjectData && selectedProjectData.taskLists.length > 0 && (
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-1">Task List</label>
                <select
                  value={selectedTaskList}
                  onChange={(e) => setSelectedTaskList(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select list...</option>
                  {selectedProjectData.taskLists.map((tl) => (
                    <option key={tl.id} value={tl.id}>{tl.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1">Priority</label>
              <div className="flex gap-2">
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setTaskPriority(p)}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium border transition-colors ${
                      taskPriority === p
                        ? p === "URGENT" ? "bg-red-100 text-red-700 border-red-300"
                        : p === "HIGH" ? "bg-orange-100 text-orange-700 border-orange-300"
                        : p === "MEDIUM" ? "bg-yellow-100 text-yellow-700 border-yellow-300"
                        : "bg-green-100 text-green-700 border-green-300"
                        : "bg-muted text-muted-foreground border-border hover:bg-accent"
                    }`}
                  >
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
            <Button
              onClick={createTask}
              disabled={creating || !taskTitle.trim() || !selectedTaskList}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              {creating ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

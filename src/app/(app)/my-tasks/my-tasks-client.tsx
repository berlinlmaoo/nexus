"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { PriorityBadge } from "@/components/tasks/priority-badge"
import { StatusBadge } from "@/components/tasks/status-badge"
import {
  CheckSquare,
  Calendar,
  FolderKanban,
} from "lucide-react"
import { format, isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: string | null
  tags: string[]
  position: number
  taskListId: string
  project: { id: string; name: string; color: string }
  assignees: { id: string; name: string; avatar: string | null }[]
}

type GroupBy = "status" | "project" | "priority" | "dueDate"

export function MyTasksClient({ tasks }: { tasks: Task[] }) {
  const router = useRouter()
  const [groupBy, setGroupBy] = useState<GroupBy>("project")

  const groupTasks = () => {
    const groups: Record<string, Task[]> = {}

    tasks.forEach((task) => {
      let key: string
      switch (groupBy) {
        case "status":
          key = task.status
          break
        case "project":
          key = task.project.name
          break
        case "priority":
          key = task.priority
          break
        case "dueDate":
          if (!task.dueDate) key = "No Due Date"
          else if (isPast(new Date(task.dueDate)) && !isToday(new Date(task.dueDate)))
            key = "Overdue"
          else if (isToday(new Date(task.dueDate))) key = "Today"
          else key = "Upcoming"
          break
        default:
          key = "Other"
      }
      if (!groups[key]) groups[key] = []
      groups[key].push(task)
    })

    return groups
  }

  const groups = groupTasks()

  const handleTaskClick = (task: Task) => {
    router.push(`/projects/${task.project.id}?task=${task.id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CheckSquare className="h-6 w-6 text-zinc-800" />
            My Tasks
          </h1>
          <p className="text-muted-foreground mt-1">
            {tasks.length} tasks assigned to you
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Group by:</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-3 text-xs"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            <option value="project">Project</option>
            <option value="status">Status</option>
            <option value="priority">Priority</option>
            <option value="dueDate">Due Date</option>
          </select>
        </div>
      </div>

      {tasks.length === 0 ? (
        <Card className="p-12 text-center">
          <CheckSquare className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <h3 className="mt-4 text-lg font-medium">No tasks assigned</h3>
          <p className="text-muted-foreground mt-1">
            You&apos;re all caught up!
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([group, groupTasks]) => (
            <div key={group}>
              <div className="flex items-center gap-2 mb-2">
                {groupBy === "project" && (
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{
                      backgroundColor:
                        groupTasks[0]?.project.color || "#18181B",
                    }}
                  />
                )}
                <h2 className="font-semibold text-sm">
                  {group.replace("_", " ")}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {groupTasks.length}
                </span>
              </div>
              <div className="space-y-1">
                {groupTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 py-2.5 px-3 rounded-md border hover:shadow-sm transition-shadow cursor-pointer group"
                    onClick={() => handleTaskClick(task)}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">
                        {task.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {groupBy !== "project" && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <FolderKanban className="h-3 w-3" />
                          {task.project.name}
                        </span>
                      )}
                      {task.dueDate && (
                        <span
                          className={cn(
                            "flex items-center gap-1 text-xs",
                            isPast(new Date(task.dueDate)) &&
                              !isToday(new Date(task.dueDate))
                              ? "text-red-600"
                              : "text-muted-foreground"
                          )}
                        >
                          <Calendar className="h-3 w-3" />
                          {format(new Date(task.dueDate), "MMM d")}
                        </span>
                      )}
                      <StatusBadge status={task.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"} />
                      <PriorityBadge priority={task.priority as "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE"} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

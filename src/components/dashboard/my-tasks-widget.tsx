"use client"

import Link from "next/link"
import { format, isPast, isToday } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Task {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  project: {
    id: string
    name: string
    color: string
  }
}

interface MyTasksWidgetProps {
  tasks: Task[]
}

const priorityConfig: Record<string, { label: string; class: string }> = {
  URGENT: { label: "Urgent", class: "bg-red-100 text-red-700 border-red-200" },
  HIGH: { label: "High", class: "bg-orange-100 text-orange-700 border-orange-200" },
  MEDIUM: { label: "Medium", class: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  LOW: { label: "Low", class: "bg-green-100 text-green-700 border-green-200" },
  NONE: { label: "None", class: "bg-muted text-muted-foreground border-border" },
}

const statusConfig: Record<string, { label: string; class: string }> = {
  TODO: { label: "To Do", class: "bg-muted text-muted-foreground" },
  IN_PROGRESS: { label: "In Progress", class: "bg-blue-100 text-blue-700" },
  IN_REVIEW: { label: "In Review", class: "bg-muted text-muted-foreground" },
  DONE: { label: "Done", class: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "Cancelled", class: "bg-muted text-muted-foreground" },
}

export function MyTasksWidget({ tasks }: MyTasksWidgetProps) {
  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">My Tasks</CardTitle>
          <Link
            href="/my-tasks"
            className="text-sm text-foreground hover:text-muted-foreground transition-colors"
          >
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 px-4 pb-4">
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No tasks assigned to you
          </p>
        ) : (
          tasks.map((task) => {
            const priority = priorityConfig[task.priority] ?? priorityConfig.NONE
            const status = statusConfig[task.status] ?? statusConfig.TODO
            const dueDate = task.dueDate ? new Date(task.dueDate) : null
            const overdue = dueDate && !isToday(dueDate) && isPast(dueDate)

            return (
              <Link
                key={task.id}
                href={`/projects/${task.project.id}?task=${task.id}`}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors group"
              >
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: task.project.color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium group-hover:text-muted-foreground transition-colors">
                    {task.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {task.project.name}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0", priority.class)}
                  >
                    {priority.label}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0", status.class)}
                  >
                    {status.label}
                  </Badge>
                  {dueDate && (
                    <span
                      className={cn(
                        "text-xs whitespace-nowrap",
                        overdue
                          ? "text-red-500 font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {format(dueDate, "MMM d")}
                    </span>
                  )}
                </div>
              </Link>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

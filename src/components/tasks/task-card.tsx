"use client"

import { Card } from "@/components/ui/card"
import { UserAvatar } from "@/components/ui/user-avatar"
import { PriorityBadge } from "./priority-badge"
import { Calendar, Tag, Diamond, ShieldCheck, Repeat } from "lucide-react"
import { format, isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"

export interface TaskCardData {
  id: string
  title: string
  description: string | null
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
  dueDate: string | null
  tags: string[]
  position: number
  taskListId: string
  taskListName?: string
  taskType?: "TASK" | "MILESTONE" | "APPROVAL"
  isRecurring?: boolean
  approvalStatus?: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED"
  assignees: {
    id: string
    name: string
    avatar: string | null
  }[]
  subtaskCount?: number
  subtaskDoneCount?: number
}

interface TaskCardProps {
  task: TaskCardData
  onClick?: () => void
  isDragging?: boolean
  index?: number
}

const priorityBorderColors: Record<string, string> = {
  URGENT: "border-l-red-500",
  HIGH: "border-l-orange-500",
  MEDIUM: "border-l-yellow-500",
  LOW: "border-l-blue-500",
  NONE: "border-l-border",
}

export function TaskCard({ task, onClick, isDragging, index = 0 }: TaskCardProps) {
  const isOverdue =
    task.dueDate &&
    isPast(new Date(task.dueDate)) &&
    !isToday(new Date(task.dueDate)) &&
    task.status !== "DONE"

  return (
    <Card
      className={cn(
        "cursor-pointer border-l-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
        priorityBorderColors[task.priority],
        isDragging && "shadow-xl rotate-1 scale-105 opacity-90 ring-2 ring-ring"
      )}
      style={{
        animationDelay: `${index * 50}ms`,
      }}
      onClick={onClick}
    >
      <div className="p-3 space-y-2">
        {/* Title */}
        <div className="flex items-start gap-1.5">
          {task.taskType === "MILESTONE" && (
            <Diamond className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          )}
          {task.taskType === "APPROVAL" && (
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          )}
          <p className="text-sm font-medium leading-snug line-clamp-2">
            {task.title}
          </p>
          {task.isRecurring && (
            <Repeat className="h-3 w-3 text-muted-foreground/60 shrink-0 mt-0.5 ml-auto" />
          )}
        </div>

        {/* Approval badge */}
        {task.taskType === "APPROVAL" && task.approvalStatus && task.approvalStatus !== "PENDING" && (
          <span className={cn(
            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
            task.approvalStatus === "APPROVED" && "bg-emerald-100 text-emerald-700",
            task.approvalStatus === "CHANGES_REQUESTED" && "bg-amber-100 text-amber-700",
            task.approvalStatus === "REJECTED" && "bg-red-100 text-red-700"
          )}>
            {task.approvalStatus.replace("_", " ")}
          </span>
        )}

        {/* Tags */}
        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors duration-200"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
            {task.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground px-1">
                +{task.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Bottom row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PriorityBadge priority={task.priority} showLabel={false} />
            {task.dueDate && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px]",
                  isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"
                )}
              >
                <Calendar className="h-3 w-3" />
                {format(new Date(task.dueDate), "MMM d")}
              </span>
            )}
          </div>

          {/* Assignee avatars */}
          {task.assignees.length > 0 && (
            <div className="flex -space-x-1.5">
              {task.assignees.slice(0, 2).map((a) => (
                <UserAvatar
                  key={a.id}
                  user={{ name: a.name, avatar: a.avatar }}
                  size="xs"
                  className="border border-background transition-transform duration-200 hover:scale-110 hover:z-10"
                />
              ))}
              {task.assignees.length > 2 && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-[8px] font-medium">
                  +{task.assignees.length - 2}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

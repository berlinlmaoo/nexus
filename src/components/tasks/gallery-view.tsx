"use client"

import { memo, useCallback, useMemo } from "react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { StatusBadge } from "./status-badge"
import { PriorityBadge } from "./priority-badge"
import type { TaskCardData } from "./task-card"
import { Calendar, Plus } from "lucide-react"
import { format, isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"
import { TaskCustomFieldChip } from "./task-custom-field-chip"

interface GalleryViewProps {
  tasks: TaskCardData[]
  onTaskClick?: (task: TaskCardData) => void
  projectId?: string
  defaultTaskListId?: string
}

const gradientByPriority: Record<string, string> = {
  URGENT: "from-red-100 via-red-50 to-white",
  HIGH: "from-orange-100 via-orange-50 to-white",
  MEDIUM: "from-yellow-100 via-yellow-50 to-white",
  LOW: "from-blue-100 via-blue-50 to-white",
  NONE: "from-muted via-muted/50 to-background",
}

interface GalleryTaskCardProps {
  task: TaskCardData
  animationDelayMs: number
  onTaskClick?: (task: TaskCardData) => void
}

const GalleryTaskCard = memo(function GalleryTaskCard({
  task,
  animationDelayMs,
  onTaskClick,
}: GalleryTaskCardProps) {
  const isOverdue =
    task.dueDate &&
    isPast(new Date(task.dueDate)) &&
    !isToday(new Date(task.dueDate)) &&
    task.status !== "DONE"

  const handleOpen = useCallback(() => {
    onTaskClick?.(task)
  }, [onTaskClick, task])

  return (
    <div
      onClick={handleOpen}
      className="rounded-xl border bg-background overflow-hidden cursor-pointer hover:shadow-lg hover:-translate-y-1 transition-all duration-200 group animate-fade-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div
        className={cn(
          "h-28 bg-gradient-to-br relative",
          gradientByPriority[task.priority] || gradientByPriority.NONE
        )}
      >
        <div className="absolute top-2.5 left-2.5">
          <StatusBadge status={task.status} className="text-[10px] shadow-sm" />
        </div>

        {task.assignees.length > 0 && (
          <div className="absolute bottom-2.5 right-2.5 flex -space-x-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
            {task.assignees.slice(0, 3).map((assignee) => (
              <UserAvatar
                key={assignee.id}
                user={{ name: assignee.name, avatar: assignee.avatar }}
                size="sm"
                className="border-2 border-white shadow-sm"
              />
            ))}
            {task.assignees.length > 3 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium shadow-sm">
                +{task.assignees.length - 3}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-3.5 space-y-2">
        <h3 className="text-sm font-semibold line-clamp-2 leading-snug group-hover:text-foreground transition-colors">
          {task.title}
        </h3>

        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {task.tags.length > 2 && (
              <span className="text-[10px] text-muted-foreground">+{task.tags.length - 2}</span>
            )}
          </div>
        )}

        {task.customFieldChips && task.customFieldChips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.customFieldChips.slice(0, 3).map((chip) => (
              <TaskCustomFieldChip key={chip.id} chip={chip} className="max-w-[140px]" />
            ))}
            {task.customFieldChips.length > 3 && (
              <span
                className="inline-flex items-center rounded-full bg-muted/50 px-2 py-1 text-[10px] font-semibold text-muted-foreground/80"
                title={task.customFieldChips.slice(3).map((chip) => `${chip.fieldName}: ${chip.label}`).join(", ")}
              >
                +{task.customFieldChips.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
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

        {task.subtaskCount && task.subtaskCount > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-foreground rounded-full transition-all duration-500"
                style={{
                  width: `${task.subtaskDoneCount ? (task.subtaskDoneCount / task.subtaskCount) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {task.subtaskDoneCount}/{task.subtaskCount}
            </span>
          </div>
        )}
      </div>
    </div>
  )
})

export function GalleryView({ tasks, onTaskClick }: GalleryViewProps) {
  const taskEntries = useMemo(
    () =>
      tasks.map((task, index) => ({
        task,
        animationDelayMs: index < 8 ? index * 40 : 0,
      })),
    [tasks]
  )

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {taskEntries.map(({ task, animationDelayMs }) => (
        <GalleryTaskCard
          key={task.id}
          task={task}
          animationDelayMs={animationDelayMs}
          onTaskClick={onTaskClick}
        />
      ))}

      {/* + New card */}
      <div
        className="rounded-xl border-2 border-dashed bg-muted/30 flex flex-col items-center justify-center min-h-[200px] cursor-pointer hover:border-border hover:bg-muted/50 transition-all duration-200 group"
        style={{ animationDelay: `${Math.min(tasks.length, 8) * 40}ms` }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted group-hover:bg-muted transition-colors">
          <Plus className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
        <span className="text-sm text-muted-foreground mt-2 group-hover:text-foreground transition-colors">
          New Task
        </span>
      </div>
    </div>
  )
}

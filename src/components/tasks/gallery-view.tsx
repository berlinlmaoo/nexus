"use client"

import { UserAvatar } from "@/components/ui/user-avatar"
import { StatusBadge } from "./status-badge"
import { PriorityBadge } from "./priority-badge"
import type { TaskCardData } from "./task-card"
import { Calendar, Plus } from "lucide-react"
import { format, isPast, isToday } from "date-fns"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

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

export function GalleryView({ tasks, onTaskClick, projectId, defaultTaskListId }: GalleryViewProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {tasks.map((task, i) => {
        const isOverdue =
          task.dueDate &&
          isPast(new Date(task.dueDate)) &&
          !isToday(new Date(task.dueDate)) &&
          task.status !== "DONE"

        return (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.25 }}
            onClick={() => onTaskClick?.(task)}
            className="rounded-xl border bg-background overflow-hidden cursor-pointer hover:shadow-lg hover:-translate-y-1 transition-all duration-200 group"
          >
            {/* Cover */}
            <div
              className={cn(
                "h-28 bg-gradient-to-br relative",
                gradientByPriority[task.priority] || gradientByPriority.NONE
              )}
            >
              {/* Status badge overlay */}
              <div className="absolute top-2.5 left-2.5">
                <StatusBadge status={task.status} className="text-[10px] shadow-sm" />
              </div>

              {/* Assignees overlay */}
              {task.assignees.length > 0 && (
                <div className="absolute bottom-2.5 right-2.5 flex -space-x-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                  {task.assignees.slice(0, 3).map((a) => (
                    <UserAvatar
                      key={a.id}
                      user={{ name: a.name, avatar: a.avatar }}
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

            {/* Content */}
            <div className="p-3.5 space-y-2">
              <h3 className="text-sm font-semibold line-clamp-2 leading-snug group-hover:text-foreground transition-colors">
                {task.title}
              </h3>

              {/* Tags */}
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

              {/* Footer */}
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

              {/* Subtask progress */}
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
          </motion.div>
        )
      })}

      {/* + New card */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: tasks.length * 0.04 }}
        className="rounded-xl border-2 border-dashed bg-muted/30 flex flex-col items-center justify-center min-h-[200px] cursor-pointer hover:border-border hover:bg-muted/50 transition-all duration-200 group"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted group-hover:bg-muted transition-colors">
          <Plus className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
        <span className="text-sm text-muted-foreground mt-2 group-hover:text-foreground transition-colors">
          New Task
        </span>
      </motion.div>
    </div>
  )
}

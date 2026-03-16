"use client"

import { useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { UserAvatar } from "@/components/ui/user-avatar"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"
import type { TaskCardData } from "./task-card"

interface WorkloadViewProps {
  tasks: TaskCardData[]
  members: { id: string; name: string; avatar?: string | null }[]
  onTaskClick?: (task: TaskCardData) => void
}

export function WorkloadView({ tasks, members, onTaskClick }: WorkloadViewProps) {
  const [selectedMember, setSelectedMember] = useState<string | null>(null)

  const workloadData = useMemo(() => {
    return members.map((member) => {
      const memberTasks = tasks.filter((t) => t.assignees.some((a) => a.id === member.id))
      const todo = memberTasks.filter((t) => t.status === "TODO").length
      const inProgress = memberTasks.filter((t) => t.status === "IN_PROGRESS").length
      const inReview = memberTasks.filter((t) => t.status === "IN_REVIEW").length
      const done = memberTasks.filter((t) => t.status === "DONE").length
      const total = memberTasks.length
      const active = todo + inProgress + inReview

      let load: "low" | "medium" | "high" | "overloaded" = "low"
      if (active > 10) load = "overloaded"
      else if (active >= 7) load = "high"
      else if (active >= 4) load = "medium"

      return { member, todo, inProgress, inReview, done, total, active, load, tasks: memberTasks }
    })
  }, [tasks, members])

  const selectedMemberData = useMemo(() => {
    if (!selectedMember) return null
    return workloadData.find((d) => d.member.id === selectedMember) || null
  }, [selectedMember, workloadData])

  const LOAD_COLORS = {
    low: "bg-green-50 text-green-700 border-green-200",
    medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
    high: "bg-orange-50 text-orange-700 border-orange-200",
    overloaded: "bg-red-50 text-red-700 border-red-200",
  }

  const BAR_COLORS = { todo: "bg-zinc-400", inProgress: "bg-zinc-600", inReview: "bg-zinc-800", done: "bg-green-500" }
  const maxTasks = Math.max(...workloadData.map((d) => d.total), 1)

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Workload</h3>
        {workloadData.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No team members to display</div>
        ) : (
          <div className="space-y-2">
            {workloadData.map(({ member, todo, inProgress, inReview, done, active, load }) => {
              const isSelected = selectedMember === member.id
              const isOverloaded = load === "overloaded"
              return (
                <div
                  key={member.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg p-2 cursor-pointer transition-all",
                    isSelected ? "bg-muted ring-1 ring-ring" : "hover:bg-muted/50",
                    isOverloaded && "bg-red-50/50"
                  )}
                  onClick={() => setSelectedMember(isSelected ? null : member.id)}
                >
                  <div className="flex items-center gap-2 w-40 shrink-0">
                    <UserAvatar user={{ name: member.name, avatar: member.avatar }} size="sm" />
                    <span className="text-sm font-medium truncate">{member.name}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex h-6 rounded-md overflow-hidden bg-muted/30">
                      {todo > 0 && <div className={cn("h-full transition-all", BAR_COLORS.todo)} style={{ width: `${(todo / maxTasks) * 100}%` }} title={`To Do: ${todo}`} />}
                      {inProgress > 0 && <div className={cn("h-full transition-all", BAR_COLORS.inProgress)} style={{ width: `${(inProgress / maxTasks) * 100}%` }} title={`In Progress: ${inProgress}`} />}
                      {inReview > 0 && <div className={cn("h-full transition-all", BAR_COLORS.inReview)} style={{ width: `${(inReview / maxTasks) * 100}%` }} title={`In Review: ${inReview}`} />}
                      {done > 0 && <div className={cn("h-full transition-all", BAR_COLORS.done)} style={{ width: `${(done / maxTasks) * 100}%` }} title={`Done: ${done}`} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-medium tabular-nums w-16 text-right">{active} active</span>
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border min-w-[60px] text-center", LOAD_COLORS[load])}>
                      {load}
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Legend */}
            <div className="flex items-center gap-4 pt-3 mt-2 border-t text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-400" /> To Do</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-600" /> In Progress</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-800" /> In Review</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" /> Done</span>
            </div>
          </div>
        )}
      </Card>

      {/* Selected member tasks */}
      <AnimatePresence>
        {selectedMemberData && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">
                  {selectedMemberData.member.name}&apos;s Tasks ({selectedMemberData.total})
                </h4>
                <button
                  onClick={() => setSelectedMember(null)}
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1">
                {selectedMemberData.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-accent cursor-pointer transition-colors"
                    onClick={() => onTaskClick?.(task)}
                  >
                    <div className={cn(
                      "h-2 w-2 rounded-full",
                      task.status === "TODO" && "bg-zinc-400",
                      task.status === "IN_PROGRESS" && "bg-zinc-600",
                      task.status === "IN_REVIEW" && "bg-zinc-800",
                      task.status === "DONE" && "bg-green-500",
                    )} />
                    <span className="text-sm flex-1 truncate">{task.title}</span>
                    <span className="text-[10px] text-muted-foreground">{task.status.replace("_", " ")}</span>
                    {task.dueDate && (
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                ))}
                {selectedMemberData.tasks.length === 0 && (
                  <div className="py-6 text-center text-sm text-muted-foreground">No tasks assigned</div>
                )}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

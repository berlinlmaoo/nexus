"use client"

import { memo, useCallback, useMemo, useState } from "react"
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

interface WorkloadMemberData {
  member: { id: string; name: string; avatar?: string | null }
  todo: number
  inProgress: number
  inReview: number
  done: number
  total: number
  active: number
  load: "low" | "medium" | "high" | "overloaded"
  tasks: TaskCardData[]
}

const LOAD_COLORS = {
  low: "bg-green-50 text-green-700 border-green-200",
  medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  overloaded: "bg-red-50 text-red-700 border-red-200",
}

const BAR_COLORS = {
  todo: "bg-surface-container-high",
  inProgress: "bg-on-surface-variant",
  inReview: "bg-foreground",
  done: "bg-green-500",
}

interface WorkloadRowProps {
  data: WorkloadMemberData
  maxTasks: number
  isSelected: boolean
  onToggle: (memberId: string) => void
}

const WorkloadRow = memo(function WorkloadRow({
  data,
  maxTasks,
  isSelected,
  onToggle,
}: WorkloadRowProps) {
  const { member, todo, inProgress, inReview, done, active, load } = data
  const isOverloaded = load === "overloaded"

  const handleToggle = useCallback(() => {
    onToggle(member.id)
  }, [member.id, onToggle])

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg p-2 cursor-pointer transition-all",
        isSelected ? "bg-muted ring-1 ring-ring" : "hover:bg-muted/50",
        isOverloaded && "bg-red-50/50"
      )}
      onClick={handleToggle}
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
})

export function WorkloadView({ tasks, members, onTaskClick }: WorkloadViewProps) {
  const [selectedMember, setSelectedMember] = useState<string | null>(null)

  const workloadData = useMemo(() => {
    const memberTaskMap = new Map<string, TaskCardData[]>()
    const countsByMember = new Map<string, { todo: number; inProgress: number; inReview: number; done: number }>()

    tasks.forEach((task) => {
      task.assignees.forEach((assignee) => {
        const memberTasks = memberTaskMap.get(assignee.id)
        if (memberTasks) {
          memberTasks.push(task)
        } else {
          memberTaskMap.set(assignee.id, [task])
        }

        const counts = countsByMember.get(assignee.id) ?? { todo: 0, inProgress: 0, inReview: 0, done: 0 }
        if (task.status === "TODO") counts.todo += 1
        else if (task.status === "IN_PROGRESS") counts.inProgress += 1
        else if (task.status === "IN_REVIEW") counts.inReview += 1
        else if (task.status === "DONE") counts.done += 1
        countsByMember.set(assignee.id, counts)
      })
    })

    return members.map((member) => {
      const memberTasks = memberTaskMap.get(member.id) ?? []
      const counts = countsByMember.get(member.id) ?? { todo: 0, inProgress: 0, inReview: 0, done: 0 }
      const todo = counts.todo
      const inProgress = counts.inProgress
      const inReview = counts.inReview
      const done = counts.done
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

  const maxTasks = Math.max(...workloadData.map((d) => d.total), 1)
  const toggleSelectedMember = useCallback((memberId: string) => {
    setSelectedMember((prev) => (prev === memberId ? null : memberId))
  }, [])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Workload</h3>
        {workloadData.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No team members to display</div>
        ) : (
          <div className="space-y-2">
            {workloadData.map((memberData) => (
              <WorkloadRow
                key={memberData.member.id}
                data={memberData}
                maxTasks={maxTasks}
                isSelected={selectedMember === memberData.member.id}
                onToggle={toggleSelectedMember}
              />
            ))}

            {/* Legend */}
            <div className="flex items-center gap-4 pt-3 mt-2 border-t text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-surface-container-high" /> To Do</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-on-surface-variant" /> In Progress</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-foreground" /> In Review</span>
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
                      task.status === "TODO" && "bg-surface-container-high",
                      task.status === "IN_PROGRESS" && "bg-on-surface-variant",
                      task.status === "IN_REVIEW" && "bg-foreground",
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

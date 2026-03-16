"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/user-avatar"
import { PriorityBadge } from "./priority-badge"
import { StatusBadge } from "./status-badge"
import { TimeTracker } from "./time-tracker"
import { CustomFields } from "./custom-fields"
import { TaskDependencies } from "./task-dependencies"
import { TaskActivity } from "./task-activity"
import { TaskAttachments } from "./task-attachments"
import { TaskComments } from "./task-comments"
import { TaskRelations } from "./task-relations"
import type { TaskCardData } from "./task-card"
import { BlockEditor, type Block, parseDescriptionToBlocks, serializeBlocksForTask } from "@/components/editor"
import {
  X,
  Loader2,
  Trash2,
  Plus,
  CheckCircle2,
  Circle,
  Calendar,
  Clock,
  MessageSquare,
  ListTodo,
  Activity,
  Tag,
  Link2,
  Settings2,
  Diamond,
  ShieldCheck,
  Repeat,
  Paperclip,
  Maximize2,
  User,
  Flag,
  FolderKanban,
  Eye,
  EyeOff,
  Heart,
  FolderPlus,
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

interface Subtask {
  id: string
  title: string
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
  dueDate: string | null
  assignees?: { user: { id: string; name: string; avatar: string | null } }[]
}

interface ActivityLogEntry {
  id: string
  action: string
  details: string | null
  createdAt: string
  user: { name: string }
}

interface TaskDetailPanelProps {
  task: TaskCardData
  onClose: () => void
  onUpdate?: () => void
}

const STATUS_OPTIONS = [
  { value: "TODO", label: "To Do" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "IN_REVIEW", label: "In Review" },
  { value: "DONE", label: "Done" },
  { value: "CANCELLED", label: "Cancelled" },
] as const

const PRIORITY_OPTIONS = [
  { value: "URGENT", label: "Urgent" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
  { value: "NONE", label: "None" },
] as const

export function TaskDetailPanel({
  task,
  onClose,
  onUpdate,
}: TaskDetailPanelProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || "")
  const descriptionBlocksRef = useRef<Block[]>(parseDescriptionToBlocks(task.description))
  const [status, setStatus] = useState(task.status)
  const [priority, setPriority] = useState(task.priority)
  const [dueDate, setDueDate] = useState(
    task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : ""
  )
  const [tags, setTags] = useState<string[]>(task.tags)
  const [tagInput, setTagInput] = useState("")
  const [taskType, setTaskType] = useState<"TASK" | "MILESTONE" | "APPROVAL">("TASK")
  const [approvalStatus, setApprovalStatus] = useState<"PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED">("PENDING")
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurPattern, setRecurPattern] = useState<{
    frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
    interval: number
    daysOfWeek?: number[]
    dayOfMonth?: number
    endDate?: string
  }>({ frequency: "WEEKLY", interval: 1 })

  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("")
  const [addingSubtask, setAddingSubtask] = useState(false)

  const [activeTab, setActiveTab] = useState<
    "subtasks" | "comments" | "attachments" | "activity" | "dependencies" | "relations" | "fields"
  >("comments")

  const [projectId, setProjectId] = useState<string | null>(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [togglingFollow, setTogglingFollow] = useState(false)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [togglingLike, setTogglingLike] = useState(false)
  const [taskProjectsList, setTaskProjectsList] = useState<Array<{
    id?: string
    projectId: string
    project: { id: string; name: string; color: string; icon: string }
    taskListId: string
    taskListName: string
    isPrimary?: boolean
  }>>([])
  const [showAddProject, setShowAddProject] = useState(false)
  const [availableProjects, setAvailableProjects] = useState<Array<{ id: string; name: string; taskLists: Array<{ id: string; name: string }> }>>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [selectedTaskListId, setSelectedTaskListId] = useState("")

  useEffect(() => {
    fetch(`/api/tasks/${task.id}/followers`)
      .then(res => res.json())
      .then(data => { if (data.isFollowing !== undefined) setIsFollowing(data.isFollowing) })
      .catch(() => {})
  }, [task.id])

  // Fetch likes
  useEffect(() => {
    fetch(`/api/tasks/${task.id}/likes`)
      .then(res => res.json())
      .then(data => {
        setLiked(data.liked ?? false)
        setLikeCount(data.count ?? 0)
      })
      .catch(() => {})
  }, [task.id])

  // Fetch task projects
  useEffect(() => {
    fetch(`/api/tasks/${task.id}/projects`)
      .then(res => res.json())
      .then(data => {
        const projects: typeof taskProjectsList = []
        if (data.primaryProject) {
          projects.push({ ...data.primaryProject, isPrimary: true })
        }
        if (data.additionalProjects) {
          projects.push(...data.additionalProjects.map((p: typeof taskProjectsList[0]) => ({ ...p, isPrimary: false })))
        }
        setTaskProjectsList(projects)
      })
      .catch(() => {})
  }, [task.id])

  const toggleLike = async () => {
    setTogglingLike(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/likes`, { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setLiked(data.liked)
        setLikeCount(data.count)
      }
    } catch {} finally { setTogglingLike(false) }
  }

  const handleAddToProject = async () => {
    if (!selectedProjectId || !selectedTaskListId) return
    try {
      const res = await fetch(`/api/tasks/${task.id}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, taskListId: selectedTaskListId }),
      })
      if (res.ok) {
        const tp = await res.json()
        setTaskProjectsList(prev => [...prev, {
          id: tp.id,
          projectId: tp.projectId,
          project: tp.project,
          taskListId: tp.taskListId,
          taskListName: tp.taskList.name,
          isPrimary: false,
        }])
        setShowAddProject(false)
        setSelectedProjectId("")
        setSelectedTaskListId("")
      }
    } catch {}
  }

  const handleRemoveFromProject = async (projId: string) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/projects`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projId }),
      })
      if (res.ok) {
        setTaskProjectsList(prev => prev.filter(p => p.projectId !== projId || p.isPrimary))
      }
    } catch {}
  }

  const toggleFollow = async () => {
    setTogglingFollow(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/followers`, { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setIsFollowing(data.following)
      }
    } catch {} finally { setTogglingFollow(false) }
  }

  useEffect(() => {
    fetch(`/api/tasks/${task.id}?include=subtasks`)
      .then((res) => res.json())
      .then((data) => {
        setSubtasks(data.subtasks || [])
        if (data.taskList?.project?.id) setProjectId(data.taskList.project.id)
        if (data.taskType) setTaskType(data.taskType)
        if (data.approvalStatus) setApprovalStatus(data.approvalStatus)
        if (data.isRecurring !== undefined) setIsRecurring(data.isRecurring)
        if (data.recurPattern) setRecurPattern(data.recurPattern)
      })
      .catch(() => {})
  }, [task.id])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: serializeBlocksForTask(descriptionBlocksRef.current),
          status,
          priority,
          dueDate: dueDate || null,
          tags,
          taskType,
          isRecurring,
          recurPattern: isRecurring ? recurPattern : undefined,
        }),
      })
      onUpdate?.()
      router.refresh()
    } catch (error) {
      console.error("Failed to save task:", error)
    } finally {
      setSaving(false)
    }
  }, [task.id, title, description, status, priority, dueDate, tags, taskType, isRecurring, recurPattern, onUpdate, router])

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this task?")) return
    setDeleting(true)
    try {
      await fetch(`/api/tasks/${task.id}`, { method: "DELETE" })
      onClose()
      onUpdate?.()
      router.refresh()
    } catch (error) {
      console.error("Failed to delete task:", error)
    } finally {
      setDeleting(false)
    }
  }

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return
    setAddingSubtask(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newSubtaskTitle.trim(),
          parentId: task.id,
          taskListId: task.taskListId,
          status: "TODO",
          priority: "NONE",
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setSubtasks((prev) => [...prev, data.task])
        setNewSubtaskTitle("")
      }
    } catch (error) {
      console.error("Failed to add subtask:", error)
    } finally {
      setAddingSubtask(false)
    }
  }

  const handleAddTag = () => {
    const tag = tagInput.trim()
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
      setTagInput("")
    }
  }

  const handleToggleComplete = useCallback(async () => {
    const newStatus = status === "DONE" ? "TODO" : "DONE"
    setStatus(newStatus)
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      onUpdate?.()
      router.refresh()
    } catch {}
  }, [status, task.id, onUpdate, router])

  const isDone = status === "DONE"

  const tabs = [
    { key: "subtasks" as const, label: "Subtasks", icon: ListTodo },
    { key: "comments" as const, label: "Comments", icon: MessageSquare },
    { key: "attachments" as const, label: "Files", icon: Paperclip },
    { key: "activity" as const, label: "Activity", icon: Activity },
    { key: "dependencies" as const, label: "Deps", icon: Link2 },
    { key: "relations" as const, label: "Relations", icon: Link2 },
    { key: "fields" as const, label: "Fields", icon: Settings2 },
  ]

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[45%] sm:min-w-[440px] sm:max-w-[680px] bg-white border-l border-neutral-200 shadow-2xl animate-slide-in-right flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-6 h-12 shrink-0">
        <div className="flex items-center gap-3">
          {/* Mark complete button */}
          <button
            onClick={handleToggleComplete}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isDone
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-neutral-200 hover:bg-neutral-50 text-neutral-600"
            )}
          >
            {isDone ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Circle className="h-3.5 w-3.5" />
            )}
            {isDone ? "Completed" : "Mark complete"}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {/* Like button */}
          <button
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors",
              liked
                ? "text-red-500 bg-red-50 dark:bg-red-950"
                : "text-muted-foreground hover:bg-muted"
            )}
            onClick={toggleLike}
            disabled={togglingLike}
            title={liked ? "Unlike" : "Like"}
          >
            <Heart className={cn("h-3.5 w-3.5", liked && "fill-current")} />
            {likeCount > 0 && <span>{likeCount}</span>}
          </button>
          <button
            className={cn(
              "rounded p-1.5 transition-colors",
              isFollowing
                ? "text-foreground bg-muted"
                : "text-muted-foreground hover:bg-muted"
            )}
            onClick={toggleFollow}
            disabled={togglingFollow}
            title={isFollowing ? "Unfollow task" : "Follow task"}
          >
            {isFollowing ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button
            className="rounded p-1.5 text-muted-foreground hover:bg-muted transition-colors"
            onClick={() => router.push(`/tasks/${task.id}`)}
            title="Open full page"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            onClick={handleDelete}
            disabled={deleting}
            title="Delete task"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            className="rounded p-1.5 text-muted-foreground hover:bg-muted transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Title */}
        <div className="px-6 pt-6 pb-2">
          <input
            className="w-full text-xl font-semibold bg-transparent border-none outline-none focus:ring-0 p-0 text-foreground placeholder:text-muted-foreground/50"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
          />
        </div>

        {/* Fields as rows - Asana style */}
        <div className="px-6 py-3 space-y-0">
          {/* Assignee row */}
          <div className="flex items-center py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Assignee</span>
            </div>
            <div className="flex-1">
              {task.assignees.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {task.assignees.map((a) => (
                    <div key={a.id} className="flex items-center gap-1.5 rounded-full border px-2 py-0.5">
                      <UserAvatar user={{ name: a.name, avatar: a.avatar }} size="xs" className="h-4 w-4" />
                      <span className="text-xs">{a.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground/50">No assignee</span>
              )}
            </div>
          </div>

          {/* Due Date row */}
          <div className="flex items-center py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Due date</span>
            </div>
            <div className="flex-1">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-7 rounded border bg-transparent px-2 text-xs outline-none focus:border-foreground/30"
              />
            </div>
          </div>

          {/* Status row */}
          <div className="flex items-center py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0">
              <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Status</span>
            </div>
            <div className="flex-1">
              <select
                className="h-7 rounded border bg-transparent px-2 text-xs outline-none focus:border-foreground/30"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskCardData["status"])}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Priority row */}
          <div className="flex items-center py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0">
              <Flag className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Priority</span>
            </div>
            <div className="flex-1">
              <select
                className="h-7 rounded border bg-transparent px-2 text-xs outline-none focus:border-foreground/30"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskCardData["priority"])}
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Task Type row */}
          <div className="flex items-center py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0">
              <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Type</span>
            </div>
            <div className="flex-1 flex gap-1.5">
              {([
                { value: "TASK" as const, label: "Task", icon: ListTodo },
                { value: "MILESTONE" as const, label: "Milestone", icon: Diamond },
                { value: "APPROVAL" as const, label: "Approval", icon: ShieldCheck },
              ]).map((opt) => {
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTaskType(opt.value)}
                    className={cn(
                      "flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-all",
                      taskType === opt.value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {taskType === "APPROVAL" && (
            <div className="flex items-center py-2 border-b border-border/30">
              <div className="flex items-center gap-2 w-32 shrink-0">
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Approval</span>
              </div>
              <div className="flex-1 flex flex-wrap gap-1.5">
                {([
                  { value: "PENDING" as const, label: "Pending", className: "border-border bg-muted/50 text-muted-foreground" },
                  { value: "APPROVED" as const, label: "Approve", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
                  { value: "CHANGES_REQUESTED" as const, label: "Changes", className: "border-amber-300 bg-amber-50 text-amber-700" },
                  { value: "REJECTED" as const, label: "Reject", className: "border-red-300 bg-red-50 text-red-700" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setApprovalStatus(opt.value)}
                    className={cn(
                      "rounded border px-2 py-1 text-[11px] font-medium transition-all",
                      approvalStatus === opt.value
                        ? opt.className + " ring-1 ring-offset-1 ring-ring"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recurring row */}
          <div className="flex items-start py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0 pt-1">
              <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Repeat</span>
            </div>
            <div className="flex-1">
              <select
                value={isRecurring ? recurPattern.frequency : "NONE"}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === "NONE") {
                    setIsRecurring(false)
                  } else {
                    setIsRecurring(true)
                    setRecurPattern({ ...recurPattern, frequency: val as typeof recurPattern.frequency })
                  }
                }}
                className="h-7 rounded border bg-transparent px-2 text-xs outline-none focus:border-foreground/30"
              >
                <option value="NONE">None</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
              {isRecurring && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Every</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={recurPattern.interval}
                      onChange={(e) => setRecurPattern({ ...recurPattern, interval: parseInt(e.target.value) || 1 })}
                      className="h-6 w-12 rounded border bg-transparent px-1.5 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">
                      {recurPattern.frequency === "DAILY" && (recurPattern.interval === 1 ? "day" : "days")}
                      {recurPattern.frequency === "WEEKLY" && (recurPattern.interval === 1 ? "week" : "weeks")}
                      {recurPattern.frequency === "MONTHLY" && (recurPattern.interval === 1 ? "month" : "months")}
                      {recurPattern.frequency === "YEARLY" && (recurPattern.interval === 1 ? "year" : "years")}
                    </span>
                  </div>
                  {recurPattern.frequency === "WEEKLY" && (
                    <div className="flex flex-wrap gap-1">
                      {(["SUN","MON","TUE","WED","THU","FRI","SAT"] as const).map((day, idx) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            const days = recurPattern.daysOfWeek ?? []
                            const next = days.includes(idx) ? days.filter(d => d !== idx) : [...days, idx]
                            setRecurPattern({ ...recurPattern, daysOfWeek: next })
                          }}
                          className={cn(
                            "h-6 w-8 rounded text-[10px] font-medium border transition-colors",
                            (recurPattern.daysOfWeek ?? []).includes(idx)
                              ? "bg-foreground text-background border-foreground"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          {day.slice(0, 2)}
                        </button>
                      ))}
                    </div>
                  )}
                  {recurPattern.frequency === "MONTHLY" && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">on day</span>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={recurPattern.dayOfMonth ?? 1}
                        onChange={(e) => setRecurPattern({ ...recurPattern, dayOfMonth: parseInt(e.target.value) || 1 })}
                        className="h-6 w-12 rounded border bg-transparent px-1.5 text-xs"
                      />
                    </div>
                  )}
                  {recurPattern.endDate !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">until</span>
                      <input
                        type="date"
                        value={recurPattern.endDate ?? ""}
                        onChange={(e) => setRecurPattern({ ...recurPattern, endDate: e.target.value || undefined })}
                        className="h-6 rounded border bg-transparent px-1.5 text-xs"
                      />
                      <button
                        onClick={() => {
                          const { endDate: _, ...rest } = recurPattern
                          setRecurPattern(rest as typeof recurPattern)
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {recurPattern.endDate === undefined && (
                    <button
                      onClick={() => setRecurPattern({ ...recurPattern, endDate: "" })}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      + Set end date
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Time Tracking row */}
          <div className="flex items-center py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Time</span>
            </div>
            <div className="flex-1">
              <TimeTracker taskId={task.id} />
            </div>
          </div>

          {/* Tags row */}
          <div className="flex items-start py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0 pt-1">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Tags</span>
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 text-[11px] h-5">
                    {tag}
                    <button onClick={() => setTags(tags.filter((t) => t !== tag))}><X className="h-2.5 w-2.5" /></button>
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  placeholder="Add tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag() } }}
                  className="h-6 flex-1 rounded border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-foreground/30"
                />
                <button
                  onClick={handleAddTag}
                  className="h-6 rounded border px-2 text-[11px] font-medium hover:bg-muted transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="px-6 py-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">Description</div>
          <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 text-sm min-h-[80px]">
            <BlockEditor
              initialBlocks={descriptionBlocksRef.current}
              onChange={(blocks) => {
                descriptionBlocksRef.current = blocks
                setDescription(serializeBlocksForTask(blocks))
              }}
              editable
              simplified
              minHeight="80px"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-2">
          <div className="flex border-b border-neutral-200 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  className={cn(
                    "flex items-center gap-1 px-3 py-2 text-xs font-medium border-b-2 transition-all duration-200 whitespace-nowrap",
                    activeTab === tab.key
                      ? "border-neutral-800 text-neutral-900"
                      : "border-transparent text-neutral-500 hover:text-neutral-700"
                  )}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <Icon className="h-3 w-3" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div className="py-3 space-y-2">
            {activeTab === "subtasks" && (
              <>
                {subtasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-2 py-1.5 group">
                    <button
                      onClick={async () => {
                        const newStatus = st.status === "DONE" ? "TODO" : "DONE"
                        try {
                          await fetch(`/api/tasks/${st.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ status: newStatus }),
                          })
                          setSubtasks(prev => prev.map(s => s.id === st.id ? { ...s, status: newStatus } : s))
                        } catch {}
                      }}
                    >
                      {st.status === "DONE" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    <span className={cn("text-[13px] flex-1 min-w-0 truncate", st.status === "DONE" && "line-through text-muted-foreground")}>{st.title}</span>
                    {/* Assignees */}
                    {st.assignees && st.assignees.length > 0 && (
                      <div className="flex -space-x-1 shrink-0">
                        {st.assignees.slice(0, 2).map((a) => (
                          <UserAvatar key={a.user.id} user={{ name: a.user.name, avatar: a.user.avatar }} size="xs" className="h-5 w-5 ring-1 ring-background" />
                        ))}
                      </div>
                    )}
                    {/* Due date */}
                    <input
                      type="date"
                      value={st.dueDate ? format(new Date(st.dueDate), "yyyy-MM-dd") : ""}
                      onChange={async (e) => {
                        const val = e.target.value || null
                        try {
                          await fetch(`/api/tasks/${st.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ dueDate: val }),
                          })
                          setSubtasks(prev => prev.map(s => s.id === st.id ? { ...s, dueDate: val } : s))
                        } catch {}
                      }}
                      className={cn(
                        "h-5 w-24 rounded border bg-transparent px-1 text-[10px] outline-none shrink-0 opacity-60 hover:opacity-100 focus:opacity-100 transition-opacity",
                        st.dueDate && new Date(st.dueDate) < new Date() && st.status !== "DONE" && "text-red-500 border-red-300"
                      )}
                      title="Due date"
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <input
                    placeholder="Add subtask..."
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddSubtask() } }}
                    className="h-7 flex-1 rounded border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/50"
                  />
                  <button
                    onClick={handleAddSubtask}
                    disabled={addingSubtask}
                    className="h-7 rounded border px-2 text-xs font-medium hover:bg-muted transition-colors"
                  >
                    {addingSubtask ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  </button>
                </div>
              </>
            )}

            {activeTab === "comments" && (
              <TaskComments taskId={task.id} />
            )}

            {activeTab === "attachments" && (
              <TaskAttachments taskId={task.id} />
            )}

            {activeTab === "activity" && (
              <TaskActivity taskId={task.id} />
            )}

            {activeTab === "dependencies" && (
              <TaskDependencies taskId={task.id} />
            )}

            {activeTab === "relations" && (
              <TaskRelations taskId={task.id} />
            )}

            {activeTab === "fields" && projectId && (
              <CustomFields taskId={task.id} projectId={projectId} />
            )}
            {activeTab === "fields" && !projectId && (
              <p className="text-xs text-muted-foreground text-center py-4">Loading fields...</p>
            )}
          </div>
        </div>
      </div>

      {/* Footer with save */}
      <div className="border-t border-neutral-200 px-6 py-3 flex justify-end gap-2 shrink-0 bg-white">
        <button
          onClick={onClose}
          className="h-8 rounded-lg border border-neutral-200 px-4 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-all duration-200 active:scale-95"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-8 rounded-lg bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-700 transition-all duration-200 disabled:opacity-50 active:scale-95 shadow-sm flex items-center gap-1.5"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  )
}

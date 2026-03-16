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
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

interface Subtask {
  id: string
  title: string
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
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
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[45%] sm:min-w-[440px] sm:max-w-[680px] bg-background border-l shadow-2xl animate-slide-in-right flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 h-12 shrink-0">
        <div className="flex items-center gap-3">
          {/* Mark complete button */}
          <button
            onClick={handleToggleComplete}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isDone
                ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                : "border-border hover:bg-muted"
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
        <div className="px-5 pt-5 pb-2">
          <input
            className="w-full text-xl font-semibold bg-transparent border-none outline-none focus:ring-0 p-0 text-foreground placeholder:text-muted-foreground/50"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
          />
        </div>

        {/* Fields as rows - Asana style */}
        <div className="px-5 py-3 space-y-0">
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
          <div className="flex items-center py-2 border-b border-border/30">
            <div className="flex items-center gap-2 w-32 shrink-0">
              <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Recurring</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsRecurring(!isRecurring)}
                  className={cn(
                    "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
                    isRecurring ? "bg-foreground" : "bg-muted-foreground/30"
                  )}
                >
                  <span className={cn(
                    "inline-block h-3 w-3 rounded-full bg-background transition-transform",
                    isRecurring ? "translate-x-3.5" : "translate-x-0.5"
                  )} />
                </button>
                <span className="text-xs text-muted-foreground">{isRecurring ? "On" : "Off"}</span>
              </div>
              {isRecurring && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Every</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={recurPattern.interval}
                    onChange={(e) => setRecurPattern({ ...recurPattern, interval: parseInt(e.target.value) || 1 })}
                    className="h-6 w-12 rounded border bg-transparent px-1.5 text-xs"
                  />
                  <select
                    value={recurPattern.frequency}
                    onChange={(e) => setRecurPattern({ ...recurPattern, frequency: e.target.value as typeof recurPattern.frequency })}
                    className="h-6 rounded border bg-transparent px-1.5 text-xs"
                  >
                    <option value="DAILY">Day(s)</option>
                    <option value="WEEKLY">Week(s)</option>
                    <option value="MONTHLY">Month(s)</option>
                    <option value="YEARLY">Year(s)</option>
                  </select>
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
        <div className="px-5 py-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">Description</div>
          <div className="rounded border border-border/50 bg-muted/20 px-3 py-2 text-sm min-h-[80px]">
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
        <div className="px-5 pt-2">
          <div className="flex border-b overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  className={cn(
                    "flex items-center gap-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap",
                    activeTab === tab.key
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
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
                  <div key={st.id} className="flex items-center gap-2 py-1">
                    {st.status === "DONE" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className={cn("text-[13px]", st.status === "DONE" && "line-through text-muted-foreground")}>{st.title}</span>
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
      <div className="border-t px-5 py-2.5 flex justify-end gap-2 shrink-0">
        <button
          onClick={onClose}
          className="h-8 rounded border px-3 text-xs font-medium hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-8 rounded bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  )
}

"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/user-avatar"
import { StatusBadge } from "@/components/tasks/status-badge"
import { PriorityBadge } from "@/components/tasks/priority-badge"
import { TaskComments } from "@/components/tasks/task-comments"
import { TaskActivity } from "@/components/tasks/task-activity"
import { TaskAttachments } from "@/components/tasks/task-attachments"
import {
  ChevronRight,
  Calendar,
  Loader2,
  Save,
  Plus,
  CheckCircle2,
  Circle,
  Tag,
  X,
  MessageSquare,
  ListTodo,
  Activity,
  Paperclip,
  User,
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

interface Subtask {
  id: string
  title: string
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
}

interface TaskFullPageData {
  id: string
  title: string
  description: string | null
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE"
  dueDate: string | null
  tags: string[]
  position: number
  taskListId: string
  taskType: "TASK" | "MILESTONE" | "APPROVAL"
  isRecurring: boolean
  assignees: { id: string; name: string; avatar: string | null }[]
  subtasks: Subtask[]
  project: { id: string; name: string; icon: string } | null
  creator: { id: string; name: string; avatar: string | null } | null
}

interface TaskFullPageProps {
  task: TaskFullPageData
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

export function TaskFullPage({ task }: TaskFullPageProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || "")
  const [status, setStatus] = useState(task.status)
  const [priority, setPriority] = useState(task.priority)
  const [dueDate, setDueDate] = useState(
    task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : ""
  )
  const [tags, setTags] = useState<string[]>(task.tags)
  const [tagInput, setTagInput] = useState("")
  const [subtasks, setSubtasks] = useState<Subtask[]>(task.subtasks)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("")
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [activeTab, setActiveTab] = useState<"subtasks" | "comments" | "attachments" | "activity">("subtasks")

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          status,
          priority,
          dueDate: dueDate || null,
          tags,
        }),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to save task:", error)
    } finally {
      setSaving(false)
    }
  }, [task.id, title, description, status, priority, dueDate, tags, router])

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

  const handleToggleSubtask = async (subtaskId: string, currentStatus: string) => {
    const newStatus = currentStatus === "DONE" ? "TODO" : "DONE"
    try {
      await fetch(`/api/tasks/${subtaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      setSubtasks((prev) =>
        prev.map((s) => (s.id === subtaskId ? { ...s, status: newStatus as Subtask["status"] } : s))
      )
    } catch (error) {
      console.error("Failed to toggle subtask:", error)
    }
  }

  const handleAddTag = () => {
    const tag = tagInput.trim()
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
      setTagInput("")
    }
  }

  const tabs = [
    { key: "subtasks" as const, label: "Subtasks", icon: ListTodo, count: subtasks.length },
    { key: "comments" as const, label: "Comments", icon: MessageSquare },
    { key: "attachments" as const, label: "Attachments", icon: Paperclip },
    { key: "activity" as const, label: "Activity", icon: Activity },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {task.project && (
          <>
            <Link
              href={`/projects/${task.project.id}`}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <span className="text-base">{task.project.icon}</span>
              {task.project.name}
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
          </>
        )}
        <span className="text-foreground font-medium truncate max-w-[300px]">{task.title}</span>
      </nav>

      {/* Cover area placeholder */}
      <div className="h-2 rounded-full bg-gradient-to-r from-muted via-muted/50 to-muted" />

      {/* Title (large, editable inline) */}
      <div>
        <input
          className="w-full text-3xl font-bold bg-transparent border-none outline-none focus:ring-0 p-0 placeholder:text-muted-foreground/60"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled task"
        />
      </div>

      {/* Metadata bar */}
      <div className="flex flex-wrap items-center gap-3 pb-6 border-b">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium transition-colors"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="h-5 w-px bg-border" />

        {/* Priority */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium transition-colors"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="h-5 w-px bg-border" />

        {/* Assignees */}
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          {task.assignees.length > 0 ? (
            <div className="flex -space-x-1.5">
              {task.assignees.map((a) => (
                <UserAvatar
                  key={a.id}
                  user={{ name: a.name, avatar: a.avatar }}
                  size="sm"
                  className="border-2 border-background"
                />
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Unassigned</span>
          )}
        </div>

        <div className="h-5 w-px bg-border" />

        {/* Due date */}
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-8 w-auto text-xs"
          />
        </div>

        {/* Save button */}
        <div className="ml-auto">
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>

      {/* Description / Block editor placeholder */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Description
        </label>
        <textarea
          className="w-full min-h-[200px] rounded-lg border border-input bg-muted/30 px-4 py-3 text-sm leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y transition-colors"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Write a description, add notes, or paste content here..."
        />
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Tag className="h-3 w-3" /> Tags
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 text-xs">
              {tag}
              <button onClick={() => setTags(tags.filter((t) => t !== tag))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <div className="flex items-center gap-1.5">
            <Input
              placeholder="Add tag..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag() } }}
              className="h-7 w-32 text-xs"
            />
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddTag}>Add</Button>
          </div>
        </div>
      </div>

      {/* Tabs: Subtasks | Comments | Attachments | Activity */}
      <div className="border-t pt-6">
        <div className="flex border-b">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-200",
                  activeTab === tab.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
                onClick={() => setActiveTab(tab.key)}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {tab.count !== undefined && (
                  <span className="ml-1 text-xs text-muted-foreground">({tab.count})</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="pt-6">
          {activeTab === "subtasks" && (
            <div className="space-y-2">
              {subtasks.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No subtasks yet</p>
              )}
              {subtasks.map((st) => (
                <motion.div
                  key={st.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <button onClick={() => handleToggleSubtask(st.id, st.status)}>
                    {st.status === "DONE" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground group-hover:text-muted-foreground transition-colors" />
                    )}
                  </button>
                  <span className={cn("text-sm flex-1", st.status === "DONE" && "line-through text-muted-foreground")}>
                    {st.title}
                  </span>
                  <StatusBadge status={st.status} className="text-[10px]" />
                </motion.div>
              ))}
              <div className="flex items-center gap-2 pt-2">
                <Input
                  placeholder="Add a subtask..."
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddSubtask() } }}
                  className="h-9 text-sm"
                />
                <Button variant="outline" size="sm" onClick={handleAddSubtask} disabled={addingSubtask}>
                  {addingSubtask ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          {activeTab === "comments" && <TaskComments taskId={task.id} />}
          {activeTab === "attachments" && <TaskAttachments taskId={task.id} />}
          {activeTab === "activity" && <TaskActivity taskId={task.id} />}
        </div>
      </div>
    </motion.div>
  )
}

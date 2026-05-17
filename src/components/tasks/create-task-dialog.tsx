"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Plus, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Member {
  id: string
  name: string
  avatar: string | null
}

interface TaskListOption {
  id: string
  name: string
}

interface CreateTaskDialogProps {
  projectId: string
  taskLists: TaskListOption[]
  defaultTaskListId?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  onCreated?: () => void
}

const STATUS_OPTIONS = [
  { value: "TODO", label: "To Do" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "IN_REVIEW", label: "In Review" },
  { value: "DONE", label: "Done" },
] as const

const PRIORITY_OPTIONS = [
  { value: "URGENT", label: "Urgent", color: "bg-red-100 text-red-700" },
  { value: "HIGH", label: "High", color: "bg-orange-100 text-orange-700" },
  { value: "MEDIUM", label: "Medium", color: "bg-yellow-100 text-yellow-700" },
  { value: "LOW", label: "Low", color: "bg-blue-100 text-blue-700" },
  { value: "NONE", label: "None", color: "bg-muted text-muted-foreground" },
] as const

export function CreateTaskDialog({
  projectId,
  taskLists,
  defaultTaskListId,
  open,
  onOpenChange,
  children,
  onCreated,
}: CreateTaskDialogProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const isControlled = open !== undefined
  const dialogOpen = isControlled ? open : internalOpen
  const setDialogOpen = (nextOpen: boolean) => {
    if (!isControlled) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  // Form state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState("TODO")
  const [priority, setPriority] = useState("MEDIUM")
  const [taskListId, setTaskListId] = useState(
    defaultTaskListId || taskLists[0]?.id || ""
  )
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([])
  const [assigneeSearch, setAssigneeSearch] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [tags, setTags] = useState<string[]>([])

  useEffect(() => {
    if (dialogOpen) {
      fetch(`/api/projects/${projectId}`)
        .then((res) => res.json())
        .then((data) => {
          const projectMembers = Array.isArray(data?.members)
            ? data.members
                .map((member: any) => member?.user ?? member)
                .filter((member: any): member is Member => Boolean(member?.id))
                .map((member: any) => ({
                  id: member.id,
                  name: member.name || member.email || "Unnamed member",
                  avatar: member.avatar || member.image || null,
                }))
            : []

          setMembers(projectMembers)
        })
        .catch((error) => {
          console.error("Failed to load project members:", error)
          setMembers([])
        })
    }
  }, [dialogOpen, projectId])

  useEffect(() => {
    if (!dialogOpen) return
    setTaskListId(defaultTaskListId || taskLists[0]?.id || "")
  }, [defaultTaskListId, dialogOpen, taskLists])

  const handleAddTag = () => {
    const tag = tagInput.trim()
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
      setTagInput("")
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const toggleAssignee = (memberId: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    )
  }

  const resetForm = () => {
    setTitle("")
    setDescription("")
    setStatus("TODO")
    setPriority("MEDIUM")
    setTaskListId(defaultTaskListId || taskLists[0]?.id || "")
    setSelectedAssignees([])
    setAssigneeSearch("")
    setDueDate("")
    setTags([])
    setTagInput("")
  }

  const filteredMembers = members.filter((member) => {
    const query = assigneeSearch.trim().toLowerCase()
    if (!query) return true
    return member.name.toLowerCase().includes(query)
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !taskListId) return

    setLoading(true)
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          status,
          priority,
          taskListId,
          projectId,
          assigneeIds: selectedAssignees,
          dueDate: dueDate || null,
          tags,
        }),
      })

      if (res.ok) {
        setDialogOpen(false)
        resetForm()
        onCreated?.()
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create task:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh_-_1rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] overflow-y-auto sm:max-w-[560px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
            <DialogDescription>Add a task to this project.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Title */}
            <div className="grid gap-2">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                placeholder="Task title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="task-desc">Description</Label>
              <textarea
                id="task-desc"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                placeholder="Describe the task..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Status + Priority row */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Status</Label>
                <select
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181B] focus-visible:ring-offset-2 sm:h-10"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label>Priority</Label>
                <select
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181B] focus-visible:ring-offset-2 sm:h-10"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Task List */}
            <div className="grid gap-2">
              <Label>Task List</Label>
              <select
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181B] focus-visible:ring-offset-2 sm:h-10"
                value={taskListId}
                onChange={(e) => setTaskListId(e.target.value)}
              >
                {taskLists.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Due Date */}
            <div className="grid gap-2">
              <Label htmlFor="task-due">Due Date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {/* Assignees */}
            <div className="grid gap-2">
              <Label>Assignees</Label>
              {members.length > 6 && (
                <Input
                  value={assigneeSearch}
                  onChange={(event) => setAssigneeSearch(event.target.value)}
                  placeholder="Search member..."
                  className="h-11 sm:h-10"
                />
              )}
              <div className="mobile-scroll-area flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-2xl border border-input/60 bg-background p-2 sm:max-h-40">
                {filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={cn(
                      "touch-target flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors sm:min-h-0",
                      selectedAssignees.includes(member.id)
                        ? "border-[#18181B] bg-[#18181B]/10 text-[#18181B]"
                        : "border-input hover:border-[#18181B]/50"
                    )}
                    onClick={() => toggleAssignee(member.id)}
                  >
                    {member.name}
                  </button>
                ))}
                {members.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    No members found
                  </span>
                )}
                {members.length > 0 && filteredMembers.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    No members match your search
                  </span>
                )}
              </div>
            </div>

            {/* Tags */}
            <div className="grid gap-2">
              <Label>Tags</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  placeholder="Add a tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddTag()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddTag}
                  className="h-11 w-full sm:h-9 sm:w-auto"
                >
                  Add
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 -mx-5 bg-surface-container-lowest px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 sm:static sm:mx-0 sm:bg-transparent sm:p-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="h-11 w-full sm:h-10 sm:w-auto"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !title.trim()} className="h-11 w-full sm:h-10 sm:w-auto">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

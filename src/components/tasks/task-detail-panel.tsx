"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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
  Share2,
  ChevronRight,
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
  task: initialTask,
  onClose,
  onUpdate,
}: TaskDetailPanelProps) {
  const router = useRouter()
  const [currentTask, setCurrentTask] = useState<TaskCardData>(initialTask)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const [title, setTitle] = useState(initialTask.title)
  const [description, setDescription] = useState(initialTask.description || "")
  const descriptionBlocksRef = useRef<Block[]>(parseDescriptionToBlocks(initialTask.description))
  const [status, setStatus] = useState(initialTask.status)
  const [priority, setPriority] = useState(initialTask.priority)
  const [dueDate, setDueDate] = useState(
    initialTask.dueDate ? format(new Date(initialTask.dueDate), "yyyy-MM-dd") : ""
  )
  const [tags, setTags] = useState<string[]>(initialTask.tags)
  const [taskType, setTaskType] = useState<"TASK" | "MILESTONE" | "APPROVAL">("TASK")
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [activeTab, setActiveTab] = useState<
    "subtasks" | "comments" | "attachments" | "activity" | "dependencies" | "relations" | "fields"
  >("comments")

  const [isFollowing, setIsFollowing] = useState(false)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [projectMembers, setProjectMembers] = useState<any[]>([])
  const [showMemberSelector, setShowMemberSelector] = useState(false)
  const memberSelectorRef = useRef<HTMLDivElement>(null)

  const [taskProjectsList, setTaskProjectsList] = useState<Array<{
    id?: string
    projectId: string
    project: { id: string; name: string; color: string; icon: string }
    taskListId: string
    taskListName: string
    isPrimary?: boolean
  }>>([])

  const currentUser = { id: 'current-user-id', name: 'Berlin' } // Simplified for UI update

  useEffect(() => {
    setCurrentTask(initialTask)
    setTitle(initialTask.title)
    setDescription(initialTask.description || "")
    setStatus(initialTask.status)
    setPriority(initialTask.priority)
    setDueDate(initialTask.dueDate ? format(new Date(initialTask.dueDate), "yyyy-MM-dd") : "")
    setTags(initialTask.tags)
  }, [initialTask])

  useEffect(() => {
    if (!currentTask.id) return
    // Fetch project members
    const projectId = taskProjectsList[0]?.projectId || currentTask.projectId
    if (projectId) {
      fetch(`/api/projects/${projectId}/members`)
        .then(res => res.json())
        .then(data => {
          // data is an array of ProjectMember objects with nested user
          const members = Array.isArray(data) ? data.map((m: any) => m.user) : []
          setProjectMembers(members)
        })
        .catch(() => {})
    }
  }, [currentTask.id, currentTask.projectId, taskProjectsList])

  // Handle click outside member selector
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (memberSelectorRef.current && !memberSelectorRef.current.contains(event.target as Node)) {
        setShowMemberSelector(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const toggleAssignee = async (memberId: string) => {
    const currentIds = currentTask.assignees.map(a => a.id)
    const isAssigned = currentIds.includes(memberId)
    const member = projectMembers.find(m => m.id === memberId)
    
    setSaving(true)
    try {
      const res = await fetch(`/api/tasks/${currentTask.id}/assignees`, {
        method: isAssigned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: memberId }),
      })
      if (res.ok) {
        // Optimistic UI update
        const newAssignees = isAssigned 
          ? currentTask.assignees.filter(a => a.id !== memberId)
          : [...currentTask.assignees, { id: member.id, name: member.name, avatar: member.avatar }]
        
        setCurrentTask(prev => ({ ...prev, assignees: newAssignees }))
        onUpdate?.()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    fetch(`/api/tasks/${currentTask.id}/likes`)
      .then(res => res.json())
      .then(data => {
        setLiked(data.liked ?? false)
        setLikeCount(data.count ?? 0)
      })
      .catch(() => {})
  }, [currentTask.id])

  useEffect(() => {
    fetch(`/api/tasks/${currentTask.id}/projects`)
      .then(res => res.json())
      .then(data => {
        const projects: typeof taskProjectsList = []
        if (data.primaryProject) projects.push({ ...data.primaryProject, isPrimary: true })
        if (data.additionalProjects) projects.push(...data.additionalProjects.map((p: any) => ({ ...p, isPrimary: false })))
        setTaskProjectsList(projects)
      })
      .catch(() => {})
  }, [currentTask.id])

  const saveTask = async (updates: Partial<TaskCardData>) => {
    setSaving(true)
    try {
      await fetch(`/api/tasks/${currentTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      setCurrentTask(prev => ({ ...prev, ...updates }))
      onUpdate?.()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const toggleLike = async () => {
    try {
      const res = await fetch(`/api/tasks/${currentTask.id}/likes`, { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setLiked(data.liked)
        setLikeCount(data.count)
      }
    } catch {}
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/tasks/${currentTask.id}`, { method: "DELETE" })
      if (res.ok) {
        setShowDeleteConfirm(false)
        onClose()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-primary/5 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-surface-container-highest shadow-2xl shadow-primary/20 animate-slide-in-right flex flex-col border-l border-on-surface-variant/5">
        {/* Header Toolbar */}
        <div className="flex items-center justify-between px-8 py-6 bg-surface-container-highest/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="h-10 w-10 flex items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant/60 hover:text-primary hover:bg-surface-container transition-all"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="h-8 w-[1px] bg-on-surface-variant/10 mx-1" />
            <div className="flex items-center gap-2">
              {taskProjectsList.map((tp) => (
                <div 
                  key={tp.projectId}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm ring-1 ring-on-surface-variant/5"
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tp.project.color }} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-primary">{tp.project.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLike}
              className={cn(
                "font-bold text-xs transition-all duration-300 rounded-xl",
                liked ? "text-red-500 bg-red-50" : "text-on-surface-variant/40 hover:text-red-500 hover:bg-red-50"
              )}
            >
              <Heart className={cn("h-4 w-4 mr-2", liked && "fill-current")} />
              {likeCount}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="font-bold text-xs text-on-surface-variant/40 hover:text-primary hover:bg-surface-container rounded-xl"
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="font-bold text-xs text-red-500/40 hover:text-red-600 hover:bg-red-50 rounded-xl"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-12 space-y-10 scrollbar-hide">
          {/* Status & Title */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <select
                value={status}
                onChange={(e) => {
                  const newStatus = e.target.value as any
                  setStatus(newStatus)
                  saveTask({ status: newStatus })
                }}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border-none cursor-pointer focus:ring-2 focus:ring-primary/10 transition-all outline-none",
                  status === "DONE" ? "bg-green-100 text-green-700" : "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                )}
              >
                {STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-surface text-on-surface">{opt.label}</option>
                ))}
              </select>
              <select
                value={priority}
                onChange={(e) => {
                  const newPriority = e.target.value as any
                  setPriority(newPriority)
                  saveTask({ priority: newPriority })
                }}
                className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border-none bg-surface-container-high text-on-surface-variant cursor-pointer focus:ring-2 focus:ring-primary/10 transition-all outline-none"
              >
                {PRIORITY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-surface text-on-surface">{opt.label}</option>
                ))}
              </select>
            </div>

            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => saveTask({ title })}
              className="w-full bg-transparent border-none p-0 text-4xl font-headline font-black text-on-surface tracking-tight leading-tight focus:ring-0 placeholder:text-on-surface-variant/10 resize-none h-auto outline-none"
              placeholder="Designation Required"
              rows={2}
            />
          </div>

          {/* Metadata Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-on-surface-variant/5 group hover:ring-2 hover:ring-primary/5 transition-all relative">
              <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30 mb-4 flex items-center gap-2">
                <User className="h-3 w-3" /> Assigned Personnel
              </p>
              <div className="flex flex-wrap gap-2">
                {currentTask.assignees.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-surface-container-low border border-on-surface-variant/5">
                    <UserAvatar user={{ name: a.name, image: a.avatar }} size="xs" />
                    <span className="text-[11px] font-bold text-on-surface">{a.name}</span>
                  </div>
                ))}
                <button 
                  onClick={() => setShowMemberSelector(!showMemberSelector)}
                  className="h-7 w-7 rounded-lg bg-surface-container-low flex items-center justify-center text-on-surface-variant/20 hover:text-primary hover:bg-surface-container transition-all"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {/* Member Selector Dropdown */}
              {showMemberSelector && (
                <div 
                  ref={memberSelectorRef}
                  className="absolute top-full left-0 mt-2 w-64 bg-surface-container-lowest rounded-2xl shadow-2xl border border-on-surface-variant/5 z-20 p-2 animate-scale-in"
                >
                  <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/30 px-3 py-2">Select Personnel</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {projectMembers.map((member) => {
                      const isAssigned = currentTask.assignees.some(a => a.id === member.id)
                      return (
                        <button
                          key={member.id}
                          onClick={() => toggleAssignee(member.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all",
                            isAssigned ? "bg-primary/5 text-primary" : "text-on-surface-variant hover:bg-surface-container-low"
                          )}
                        >
                          <UserAvatar user={{ name: member.name, image: member.avatar }} size="xs" />
                          <span className="text-xs font-bold flex-1 text-left">{member.name}</span>
                          {isAssigned && <CheckCircle2 className="h-3.5 w-3.5" />}
                        </button>
                      )
                    })}
                    {projectMembers.length === 0 && (
                      <p className="text-[10px] text-on-surface-variant/40 text-center py-4">No operatives found</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-on-surface-variant/5 group hover:ring-2 hover:ring-primary/5 transition-all">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30 flex items-center gap-2">
                  <Calendar className="h-3 w-3" /> Due Date
                </p>
                {dueDate && (
                  <button 
                    onClick={() => { setDueDate(""); saveTask({ dueDate: null }) }}
                    className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/20 hover:text-red-500 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value)
                  saveTask({ dueDate: e.target.value || null })
                }}
                className="w-full bg-surface-container-low border-none rounded-lg px-3 py-2 text-xs font-bold text-on-surface focus:ring-2 focus:ring-primary/5 transition-all outline-none"
              />
            </div>
          </div>

          {/* Intelligence/Description */}
          <div className="bg-surface-container-lowest p-8 rounded-[2rem] shadow-sm border border-on-surface-variant/5">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30 mb-6 flex items-center gap-2">
              <Activity className="h-3 w-3" /> Core Intelligence
            </p>
            <div className="prose prose-slate max-w-none prose-p:text-on-surface-variant/80 prose-p:leading-relaxed prose-p:text-sm">
              <BlockEditor
                initialBlocks={descriptionBlocksRef.current}
                onChange={(blocks) => {
                  descriptionBlocksRef.current = blocks
                  saveTask({ description: serializeBlocksForTask(blocks) })
                }}
                editable={true}
              />
            </div>
          </div>

          {/* Tab Selection */}
          <div className="space-y-6">
            <div className="flex items-center p-1 bg-surface-container-high rounded-xl w-fit">
              {[
                { id: "comments", label: "Communication", icon: MessageSquare },
                { id: "subtasks", label: "Execution", icon: ListTodo },
                { id: "activity", label: "Protocol", icon: Activity },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all duration-300",
                    activeTab === tab.id
                      ? "bg-surface-container-lowest text-primary shadow-sm shadow-primary/5"
                      : "text-on-surface-variant/40 hover:text-on-surface-variant/70"
                  )}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-surface-container-lowest rounded-[2rem] p-8 shadow-sm border border-on-surface-variant/5 min-h-[300px]">
              {activeTab === "comments" && <TaskComments taskId={currentTask.id} currentUserId={currentUser.id} />}
              {activeTab === "subtasks" && (
                <div className="space-y-6">
                  {subtasks.length === 0 ? (
                    <div className="py-12 text-center text-on-surface-variant/20 italic text-sm">No tactical subtasks defined.</div>
                  ) : (
                    subtasks.map(st => (
                      <div key={st.id} className="flex items-center gap-4 group/st">
                        <button className="h-5 w-5 rounded-full border-2 border-on-surface-variant/20 hover:border-primary transition-all flex items-center justify-center">
                          {st.status === "DONE" && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </button>
                        <span className={cn("text-sm font-medium flex-1 text-primary", st.status === "DONE" && "text-on-surface-variant/40 line-through")}>{st.title}</span>
                      </div>
                    ))
                  )}
                  <button className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-on-surface-variant/20 hover:text-primary transition-all">
                    <Plus className="h-4 w-4" /> Expand Protocol
                  </button>
                </div>
              )}
              {activeTab === "activity" && <TaskActivity taskId={currentTask.id} />}
            </div>
          </div>
        </div>

        {/* Sync Status */}
        {saving && (
          <div className="absolute bottom-8 right-8 bg-primary text-primary-foreground px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-pulse ring-4 ring-primary/10">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Synchronizing</span>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete task?"
        description={`Delete "${currentTask.title}" permanently? This action cannot be undone.`}
        confirmLabel="Delete task"
        icon={<Trash2 className="h-5 w-5" />}
        isLoading={deleting}
        onConfirm={handleDelete}
      />
    </>
  )
}

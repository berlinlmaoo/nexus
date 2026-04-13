"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DateTimePicker } from "@/components/ui/date-time-picker"
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
  Copy,
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

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

const STATUS_SECTION_ALIASES: Record<TaskCardData["status"], string[]> = {
  TODO: ["to do", "todo", "backlog"],
  IN_PROGRESS: ["in progress", "doing", "wip"],
  IN_REVIEW: ["in review", "review"],
  DONE: ["done", "complete", "completed"],
  CANCELLED: ["cancelled", "canceled"],
}

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
  const getStatusFromSectionName = (sectionName: string): TaskCardData["status"] | undefined => {
    const normalizedName = sectionName.toLowerCase().trim()

    return (Object.entries(STATUS_SECTION_ALIASES).find(([, aliases]) =>
      aliases.includes(normalizedName)
    )?.[0] as TaskCardData["status"] | undefined)
  }

  const router = useRouter()
  const [currentTask, setCurrentTask] = useState<TaskCardData>(initialTask)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const [title, setTitle] = useState(initialTask.title)
  const [description, setDescription] = useState(initialTask.description || "")
  const descriptionBlocksRef = useRef<Block[]>(parseDescriptionToBlocks(initialTask.description))
  const [status, setStatus] = useState(initialTask.status)
  const [priority, setPriority] = useState(initialTask.priority)
  const [dueDate, setDueDate] = useState<string | null>(initialTask.dueDate ?? null)
  const [tags, setTags] = useState<string[]>(initialTask.tags)
  const [taskType, setTaskType] = useState<"TASK" | "MILESTONE" | "APPROVAL">("TASK")
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [activeTab, setActiveTab] = useState<
    "subtasks" | "comments" | "attachments" | "activity" | "dependencies" | "relations" | "fields"
  >("attachments")

  const [isFollowing, setIsFollowing] = useState(false)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [projectMembers, setProjectMembers] = useState<any[]>([])
  const [projectSections, setProjectSections] = useState<Array<{ id: string; name: string }>>([])
  const [showMemberSelector, setShowMemberSelector] = useState(false)
  const [memberSearch, setMemberSearch] = useState("")
  const memberSelectorRef = useRef<HTMLDivElement>(null)

  const [taskProjectsList, setTaskProjectsList] = useState<Array<{
    id?: string
    projectId: string
    project: { id: string; name: string; color: string; icon: string }
    taskListId: string
    taskListName: string
    isPrimary?: boolean
  }>>([])
  const [availableProjects, setAvailableProjects] = useState<Array<{
    id: string
    name: string
    color: string
    icon: string
    defaultTaskListId: string
    defaultTaskListName: string
  }>>([])
  const [showProjectSelector, setShowProjectSelector] = useState(false)
  const [projectSearch, setProjectSearch] = useState("")
  const [linkingProjectId, setLinkingProjectId] = useState<string | null>(null)
  const [unlinkingProjectId, setUnlinkingProjectId] = useState<string | null>(null)
  const projectSelectorRef = useRef<HTMLDivElement>(null)

  const currentUser = { id: 'current-user-id', name: 'Berlin' } // Simplified for UI update

  const loadTaskProjects = useCallback(async () => {
    const response = await fetch(`/api/tasks/${currentTask.id}/projects`)
    if (!response.ok) throw new Error("Failed to load project mentions")

    const data = await response.json()
    const projects: typeof taskProjectsList = []
    if (data.primaryProject) projects.push({ ...data.primaryProject, isPrimary: true })
    if (data.additionalProjects) {
      projects.push(...data.additionalProjects.map((project: any) => ({ ...project, isPrimary: false })))
    }

    setTaskProjectsList(projects)
    setAvailableProjects(Array.isArray(data.availableProjects) ? data.availableProjects : [])
  }, [currentTask.id])

  useEffect(() => {
    setCurrentTask(initialTask)
    setTitle(initialTask.title)
    setDescription(initialTask.description || "")
    setStatus(initialTask.status)
    setPriority(initialTask.priority)
    setDueDate(initialTask.dueDate ?? null)
    setTags(initialTask.tags)
  }, [initialTask])

  useEffect(() => {
    if (!currentTask.id) return
    const projectId = currentTask.projectId || currentTask.viewProjectId || currentTask.primaryProjectId
    if (!projectId) return

    fetch(`/api/projects/${projectId}`)
      .then(res => res.json())
      .then(data => {
        const taskLists = Array.isArray(data?.taskLists)
          ? data.taskLists.map((taskList: any) => ({ id: taskList.id, name: taskList.name }))
          : []
        const members = Array.isArray(data?.members)
          ? data.members.map((member: any) => member.user)
          : []

        setProjectSections(taskLists)
        setProjectMembers(members)
      })
      .catch(() => {})
  }, [currentTask.id, currentTask.projectId, currentTask.viewProjectId, currentTask.primaryProjectId])

  // Handle click outside member selector
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (memberSelectorRef.current && !memberSelectorRef.current.contains(event.target as Node)) {
        setShowMemberSelector(false)
      }
      if (projectSelectorRef.current && !projectSelectorRef.current.contains(event.target as Node)) {
        setShowProjectSelector(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    if (showMemberSelector) return
    setMemberSearch("")
  }, [showMemberSelector])

  useEffect(() => {
    if (showProjectSelector) return
    setProjectSearch("")
  }, [showProjectSelector])

  const filteredProjectMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase()

    const rankMember = (member: any) => {
      const name = (member.name || "").toLowerCase()
      if (!query) return 3
      if (name === query) return 0
      if (name.startsWith(query)) return 1
      if (name.includes(query)) return 2
      return 99
    }

    return [...projectMembers]
      .map((member, index) => ({
        member,
        index,
        score: rankMember(member),
      }))
      .filter(({ score }) => score < 99)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score
        return a.index - b.index
      })
      .map(({ member }) => member)
  }, [memberSearch, projectMembers])

  const filteredAvailableProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()

    const rankProject = (project: { name: string }) => {
      const name = project.name.toLowerCase()
      if (!query) return 3
      if (name === query) return 0
      if (name.startsWith(query)) return 1
      if (name.includes(query)) return 2
      return 99
    }

    return [...availableProjects]
      .map((project, index) => ({
        project,
        index,
        score: rankProject(project),
      }))
      .filter(({ score }) => score < 99)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score
        return a.index - b.index
      })
      .map(({ project }) => project)
  }, [availableProjects, projectSearch])

  const getSectionForStatus = useCallback(
    (targetStatus: TaskCardData["status"]) => {
      const aliases = STATUS_SECTION_ALIASES[targetStatus]

      return projectSections.find((section) =>
        aliases.includes(section.name.toLowerCase().trim())
      )
    },
    [projectSections]
  )

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
    loadTaskProjects().catch(() => {})
  }, [loadTaskProjects])

  const saveTask = async (updates: Partial<TaskCardData>) => {
    setSaving(true)
    try {
      await fetch(`/api/tasks/${currentTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...updates,
          projectContextId: currentTask.projectId || currentTask.viewProjectId || currentTask.primaryProjectId,
        }),
      })
      setCurrentTask(prev => ({ ...prev, ...updates }))
      onUpdate?.()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const handleSectionSelect = async (sectionId: string) => {
    const selectedSection = projectSections.find((section) => section.id === sectionId)
    if (!selectedSection) return
    const projectContextId = currentTask.projectId || currentTask.viewProjectId || currentTask.primaryProjectId

    const nextStatus = getStatusFromSectionName(selectedSection.name)
    setStatus(nextStatus ?? currentTask.status)
    setCurrentTask((prev) => ({
      ...prev,
      taskListId: selectedSection.id,
      taskListName: selectedSection.name,
      ...(nextStatus ? { status: nextStatus } : {}),
    }))
    setTaskProjectsList((prev) =>
      prev.map((taskProject) =>
        taskProject.projectId === projectContextId
          ? {
              ...taskProject,
              taskListId: selectedSection.id,
              taskListName: selectedSection.name,
            }
          : taskProject
      )
    )

    await saveTask({
      taskListId: selectedSection.id,
      taskListName: selectedSection.name,
      ...(nextStatus ? { status: nextStatus } : {}),
    })
  }

  const handleToggleDone = async () => {
    const nextStatus: TaskCardData["status"] = status === "DONE" ? "TODO" : "DONE"
    const matchingSection = getSectionForStatus(nextStatus)

    setStatus(nextStatus)
    setCurrentTask((prev) => ({
      ...prev,
      status: nextStatus,
      ...(matchingSection
        ? {
            taskListId: matchingSection.id,
            taskListName: matchingSection.name,
          }
        : {}),
    }))

    if (matchingSection) {
      const projectContextId = currentTask.projectId || currentTask.viewProjectId || currentTask.primaryProjectId
      setTaskProjectsList((prev) =>
        prev.map((taskProject) =>
          taskProject.projectId === projectContextId
            ? {
                ...taskProject,
                taskListId: matchingSection.id,
                taskListName: matchingSection.name,
              }
            : taskProject
        )
      )
    }

    await saveTask({
      status: nextStatus,
      ...(matchingSection
        ? {
            taskListId: matchingSection.id,
            taskListName: matchingSection.name,
          }
        : {}),
    })
  }

  const handleLinkProject = async (project: {
    id: string
    name: string
    defaultTaskListId: string
  }) => {
    setLinkingProjectId(project.id)
    try {
      const response = await fetch(`/api/tasks/${currentTask.id}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          taskListId: project.defaultTaskListId,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `Failed to link ${project.name}`)
      }

      toast.success(`Task now appears in ${project.name}`)
      setShowProjectSelector(false)
      await loadTaskProjects()
      onUpdate?.()
      router.refresh()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to link project")
    } finally {
      setLinkingProjectId(null)
    }
  }

  const handleUnlinkProject = async (projectId: string, projectName: string, isPrimary?: boolean) => {
    if (isPrimary) return

    setUnlinkingProjectId(projectId)
    try {
      const response = await fetch(`/api/tasks/${currentTask.id}/projects`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `Failed to unlink ${projectName}`)
      }

      toast.success(`${projectName} removed`)
      onUpdate?.()

      if (currentTask.projectId === projectId && currentTask.isCrossProject) {
        router.refresh()
        onClose()
        return
      }

      await loadTaskProjects()
      router.refresh()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to unlink project")
    } finally {
      setUnlinkingProjectId(null)
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

  const handleDuplicate = async () => {
    setDuplicating(true)
    try {
      const res = await fetch(`/api/tasks/${currentTask.id}/duplicate`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to duplicate task")
      }

      toast.success("Task duplicated")
      onUpdate?.()
      router.refresh()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to duplicate task")
    } finally {
      setDuplicating(false)
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
              onClick={handleDuplicate}
              disabled={duplicating}
              className="font-bold text-xs text-on-surface-variant/40 hover:text-primary hover:bg-surface-container rounded-xl"
            >
              {duplicating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            </Button>
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
              <button
                type="button"
                onClick={handleToggleDone}
                disabled={saving}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-all outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-60",
                  status === "DONE"
                    ? "bg-green-100 text-green-700"
                    : "bg-surface-container-high text-on-surface-variant shadow-sm hover:text-primary"
                )}
                aria-label={status === "DONE" ? "Mark task as not done" : "Mark task as done"}
              >
                {status === "DONE" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Circle className="h-3.5 w-3.5" />
                )}
                {status === "DONE" ? "Done" : "Mark done"}
              </button>
              <select
                value={currentTask.taskListId}
                onChange={(e) => handleSectionSelect(e.target.value)}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border-none cursor-pointer focus:ring-2 focus:ring-primary/10 transition-all outline-none",
                  status === "DONE" ? "bg-green-100 text-green-700" : "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                )}
              >
                {projectSections.map((section) => (
                  <option key={section.id} value={section.id} className="bg-surface text-on-surface">
                    {section.name}
                  </option>
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
                  <div className="px-2 pb-2">
                    <Input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search personnel..."
                      className="h-10 rounded-xl border-on-surface-variant/10 bg-surface-container-low px-3 text-xs font-semibold"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {filteredProjectMembers.map((member) => {
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
                    {projectMembers.length > 0 && filteredProjectMembers.length === 0 && (
                      <p className="text-[10px] text-on-surface-variant/40 text-center py-4">No personnel match your search</p>
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
                    onClick={() => { setDueDate(null); saveTask({ dueDate: null }) }}
                    className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/20 hover:text-red-500 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <DateTimePicker
                value={dueDate}
                onChange={(nextValue) => {
                  setDueDate(nextValue)
                  saveTask({ dueDate: nextValue })
                }}
              />
            </div>

            <div
              ref={projectSelectorRef}
              className="relative col-span-2 bg-surface-container-lowest p-5 rounded-2xl shadow-sm border border-on-surface-variant/5 group hover:ring-2 hover:ring-primary/5 transition-all"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30 flex items-center gap-2">
                    <FolderPlus className="h-3 w-3" /> Also In Projects
                  </p>
                  <p className="mt-2 text-xs text-on-surface-variant/45">
                    Mention another division by linking this task to another project in the same workspace.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowProjectSelector((prev) => !prev)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant/40 transition-all hover:bg-surface-container hover:text-primary"
                  aria-label="Link this task to another project"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {taskProjectsList.map((taskProject) => {
                  const isCurrentViewProject =
                    (currentTask.projectId || currentTask.viewProjectId) === taskProject.projectId

                  return (
                    <div
                      key={taskProject.projectId}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-3 py-2 shadow-sm",
                        isCurrentViewProject
                          ? "border-primary/20 bg-primary/5"
                          : "border-on-surface-variant/5 bg-surface-container-low"
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: taskProject.project.color }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-on-surface truncate">
                          {taskProject.project.name}
                        </p>
                        <p className="text-[10px] text-on-surface-variant/45">
                          {taskProject.isPrimary ? "Primary project" : `In ${taskProject.taskListName}`}
                        </p>
                      </div>
                      {taskProject.isPrimary && (
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-primary">
                          Primary
                        </span>
                      )}
                      {!taskProject.isPrimary && (
                        <button
                          type="button"
                          onClick={() =>
                            handleUnlinkProject(
                              taskProject.projectId,
                              taskProject.project.name,
                              taskProject.isPrimary
                            )
                          }
                          disabled={unlinkingProjectId === taskProject.projectId}
                          className="rounded-lg p-1 text-on-surface-variant/30 transition-colors hover:bg-red-50 hover:text-red-500"
                          aria-label={`Remove ${taskProject.project.name}`}
                        >
                          {unlinkingProjectId === taskProject.projectId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {showProjectSelector && (
                <div
                  className="absolute left-5 right-5 top-[calc(100%+8px)] z-20 rounded-2xl border border-on-surface-variant/5 bg-surface-container-lowest p-3 shadow-2xl"
                >
                  <p className="px-2 py-2 text-[9px] font-black uppercase tracking-widest text-on-surface-variant/30">
                    Link Project
                  </p>
                  <div className="px-2 pb-3">
                    <Input
                      value={projectSearch}
                      onChange={(event) => setProjectSearch(event.target.value)}
                      placeholder="Search project or division..."
                      className="h-10 rounded-xl border-on-surface-variant/10 bg-surface-container-low px-3 text-xs font-semibold"
                    />
                  </div>
                  <div className="max-h-52 space-y-1 overflow-y-auto">
                    {filteredAvailableProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => handleLinkProject(project)}
                        disabled={linkingProjectId === project.id}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all hover:bg-surface-container-low"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-on-surface">
                            {project.name}
                          </p>
                          <p className="text-[10px] text-on-surface-variant/45">
                            Default section: {project.defaultTaskListName}
                          </p>
                        </div>
                        {linkingProjectId === project.id && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        )}
                      </button>
                    ))}
                    {availableProjects.length === 0 && (
                      <p className="py-4 text-center text-[10px] text-on-surface-variant/40">
                        No other projects available in this workspace.
                      </p>
                    )}
                    {availableProjects.length > 0 && filteredAvailableProjects.length === 0 && (
                      <p className="py-4 text-center text-[10px] text-on-surface-variant/40">
                        No projects match your search.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="col-span-2">
              <CustomFields
                taskId={currentTask.id}
                projectId={
                  currentTask.viewProjectId ||
                  currentTask.projectId ||
                  currentTask.primaryProjectId ||
                  initialTask.projectId
                }
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
                { id: "attachments", label: "Attachments", icon: Paperclip },
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
              {activeTab === "attachments" && <TaskAttachments taskId={currentTask.id} />}
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

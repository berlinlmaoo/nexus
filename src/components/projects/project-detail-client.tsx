"use client"

import { useState, useCallback, useMemo, useEffect, lazy, Suspense } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/ui/user-avatar"
import { TaskListView } from "@/components/tasks/task-list-view"
import { BoardView } from "@/components/tasks/board-view"
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { ProjectHeader } from "@/components/projects/project-header"
import { SkeletonKanban, SkeletonList } from "@/components/ui/skeleton"
import type { TaskCardData } from "@/components/tasks/task-card"
import {
  List,
  LayoutGrid,
  CalendarDays,
  UserPlus,
  Plus,
  Filter,
  GanttChart,
  Users,
  Zap,
  Workflow,
  Search,
  ArrowUpDown,
  Layers,
  X,
  ClipboardList,
  Activity,
  Home,
  Image,
  BarChart3,
  Columns3,
  Settings2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ProjectIcon } from "@/components/projects/project-icon"
import { useRealtimeProject } from "@/hooks/use-realtime-project"
import Link from "next/link"
import { StatusUpdates } from "@/components/projects/status-updates"
import { AddPageDialog } from "@/components/projects/add-page-dialog"
import { SavedFilters } from "@/components/tasks/saved-filters"
import { SaveTemplateDialog } from "@/components/projects/template-dialog"
import { Copy } from "lucide-react"
import { ErrorBoundary } from "@/components/ui/error-boundary"

// Lazy load heavy view components
const CalendarView = lazy(() => import("@/components/tasks/calendar-view").then(m => ({ default: m.CalendarView })))
const TimelineView = lazy(() => import("@/components/tasks/timeline-view").then(m => ({ default: m.TimelineView })))
const GanttChartView = lazy(() => import("@/components/tasks/gantt-chart-view").then(m => ({ default: m.GanttChartView })))
const WorkloadView = lazy(() => import("@/components/tasks/workload-view").then(m => ({ default: m.WorkloadView })))
const GalleryView = lazy(() => import("@/components/tasks/gallery-view").then(m => ({ default: m.GalleryView })))
const ChartsView = lazy(() => import("@/components/tasks/charts-view").then(m => ({ default: m.ChartsView })))
const ProjectOverview = lazy(() => import("@/components/projects/project-overview").then(m => ({ default: m.ProjectOverview })))
const FeedView = lazy(() => import("@/components/tasks/feed-view").then(m => ({ default: m.FeedView })))
const KanbanView = lazy(() => import("@/components/tasks/kanban-view").then(m => ({ default: m.KanbanView })))

interface ProjectMember {
  id: string
  name: string
  avatar: string | null
  role: string
}

interface TaskListData {
  id: string
  name: string
  tasks: TaskCardData[]
  isTemporary?: boolean
  temporarySourceProjectId?: string
}

interface ProjectPageData {
  id: string
  name: string
  icon: string
  pageType: string
}

interface ProjectDetailData {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  enableTaskBatchDuplicate: boolean
  members: ProjectMember[]
  taskLists: TaskListData[]
  pages?: ProjectPageData[]
}

interface CurrentUser {
  id: string
  name: string
  avatar: string | null
}

interface ProjectDetailClientProps {
  project: ProjectDetailData
  currentUser: CurrentUser
}

type ViewMode = "overview" | "list" | "board" | "kanban" | "calendar" | "timeline" | "gantt" | "gallery" | "charts" | "feed" | "workload"
type SortMode = "position" | "priority" | "dueDate" | "created" | "assignee"
type GroupMode = "status" | "assignee" | "priority" | "dueDate" | "none"

const STATUS_FILTERS = ["ALL", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const
const PRIORITY_FILTERS = ["ALL", "URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const

const PRIORITY_ORDER: Record<string, number> = {
  URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4,
}

const STATUS_TO_SECTION_NAMES: Record<TaskCardData["status"], string[]> = {
  TODO: ["to do", "todo", "backlog"],
  IN_PROGRESS: ["in progress", "doing", "wip"],
  IN_REVIEW: ["in review", "review"],
  DONE: ["done", "complete", "completed"],
  CANCELLED: ["cancelled", "canceled"],
}

function getStoredView(projectId: string): ViewMode {
  if (typeof window === "undefined") return "list"
  try {
    const stored = localStorage.getItem(`nexus-view-${projectId}`)
    if (stored && ["overview", "list", "board", "kanban", "calendar", "timeline", "gantt", "gallery", "charts", "feed", "workload"].includes(stored)) {
      return stored as ViewMode
    }
  } catch {}
  return "list"
}

function StatusUpdatesButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
          open ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
        onClick={() => setOpen(!open)}
      >
        <Activity className="h-3.5 w-3.5" /> Status
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background border-l shadow-2xl animate-slide-in-right flex flex-col">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="font-semibold">Project Status</h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <StatusUpdates projectId={projectId} />
            </div>
          </div>
        </>
      )}
    </>
  )
}

export function ProjectDetailClient({ project, currentUser }: ProjectDetailClientProps) {
  const router = useRouter()

  // Real-time updates via Socket.IO
  useRealtimeProject({
    projectId: project.id,
    userId: currentUser.id,
    userName: currentUser.name,
    userAvatar: currentUser.avatar,
  })
  const [viewMode, setViewMode] = useState<ViewMode>(() => getStoredView(project.id))
  const [selectedTask, setSelectedTask] = useState<TaskCardData | null>(null)
  const [createTaskListId, setCreateTaskListId] = useState<string | undefined>(undefined)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [projectMeta, setProjectMeta] = useState({
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    icon: project.icon,
    enableTaskBatchDuplicate: project.enableTaskBatchDuplicate,
  })

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL")
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL")
  const [sprintFilter, setSprintFilter] = useState<string>("ALL")
  const [showFilters, setShowFilters] = useState(false)

  // Sprints for filter
  const [sprints, setSprints] = useState<{ id: string; name: string; status: string }[]>([])
  const [sprintTaskMap, setSprintTaskMap] = useState<Record<string, Set<string>>>({})

  useEffect(() => {
    setProjectMeta({
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      icon: project.icon,
      enableTaskBatchDuplicate: project.enableTaskBatchDuplicate,
    })
  }, [project.id, project.name, project.description, project.color, project.icon, project.enableTaskBatchDuplicate])

  useEffect(() => {
    if (typeof window === "undefined") return

    const dirtyKey = `nexus-project-dirty:${project.id}`

    const refreshFromDirtyFlag = () => {
      const dirtyValue = localStorage.getItem(dirtyKey)
      if (!dirtyValue) return

      localStorage.removeItem(dirtyKey)
      router.refresh()
    }

    const handleDirtyEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail
      if (detail?.projectId !== project.id) return

      localStorage.removeItem(dirtyKey)
      router.refresh()
    }

    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key !== dirtyKey || !event.newValue) return

      localStorage.removeItem(dirtyKey)
      router.refresh()
    }

    refreshFromDirtyFlag()
    window.addEventListener("nexus:project-dirty", handleDirtyEvent as EventListener)
    window.addEventListener("storage", handleStorageEvent)

    return () => {
      window.removeEventListener("nexus:project-dirty", handleDirtyEvent as EventListener)
      window.removeEventListener("storage", handleStorageEvent)
    }
  }, [project.id, router])

  useEffect(() => {
    fetch(`/api/sprints?projectId=${project.id}`)
      .then(res => res.ok ? res.json() : { sprints: [] })
      .then(data => {
        const sprintList = data.sprints || data || []
        setSprints(sprintList)
        const map: Record<string, Set<string>> = {}
        for (const sprint of sprintList) {
          map[sprint.id] = new Set((sprint.tasks || []).map((st: { taskId?: string; task?: { id: string } }) => st.taskId || st.task?.id))
        }
        setSprintTaskMap(map)
      })
      .catch(() => {})
  }, [project.id])

  // Search
  const [searchQuery, setSearchQuery] = useState("")

  // Sort
  const [sortMode, setSortMode] = useState<SortMode>("position")

  // Group
  const [groupMode, setGroupMode] = useState<GroupMode>("status")

  const defaultTaskListId = project.taskLists[0]?.id

  const handleViewChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(`nexus-view-${project.id}`, mode)
    } catch {}
  }, [project.id])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable

      if (e.key === "Escape") {
        if (selectedTask) {
          setSelectedTask(null)
          e.preventDefault()
        }
        if (createDialogOpen) {
          setCreateDialogOpen(false)
          e.preventDefault()
        }
      }

      if (e.key === "n" && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setCreateDialogOpen(true)
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [selectedTask, createDialogOpen])

  // All tasks flat — with optimistic local state
  const serverTasks = useMemo(() =>
    project.taskLists.flatMap((tl) =>
      tl.tasks.map((t) => ({ ...t, taskListName: tl.name }))
    ),
    [project.taskLists]
  )
  const [allTasks, setAllTasks] = useState(serverTasks)
  const [viewKey, setViewKey] = useState(0)
  useEffect(() => { setAllTasks(serverTasks) }, [serverTasks])

  const isVisibleLinkedTask = useCallback((task: TaskCardData) => {
    if (!task.isCrossProject) return true
    return task.status !== "DONE"
  }, [])

  const matchesCurrentFilters = useCallback((task: TaskCardData) => {
    if (!isVisibleLinkedTask(task)) return false
    if (statusFilter !== "ALL" && task.status !== statusFilter) return false
    if (priorityFilter !== "ALL" && task.priority !== priorityFilter) return false
    if (assigneeFilter !== "ALL" && !task.assignees.some((a) => a.id === assigneeFilter)) return false
    if (sprintFilter === "NONE") {
      const allSprintTaskIds = new Set<string>()
      Object.values(sprintTaskMap).forEach((s) => s.forEach((id) => allSprintTaskIds.add(id)))
      if (allSprintTaskIds.has(task.id)) return false
    } else if (sprintFilter !== "ALL") {
      const sprintTasks = sprintTaskMap[sprintFilter]
      if (sprintTasks && !sprintTasks.has(task.id)) return false
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      if (
        !task.title.toLowerCase().includes(q) &&
        !task.tags.some((tag) => tag.toLowerCase().includes(q)) &&
        !task.description?.toLowerCase().includes(q)
      ) {
        return false
      }
    }
    return true
  }, [assigneeFilter, isVisibleLinkedTask, priorityFilter, searchQuery, sprintFilter, sprintTaskMap, statusFilter])

  // Filter + search
  const filteredTasks = useMemo(() => {
    let tasks = allTasks.filter(matchesCurrentFilters)

    // Sort
    tasks = [...tasks].sort((a, b) => {
      switch (sortMode) {
        case "priority": return (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4)
        case "dueDate": {
          if (!a.dueDate && !b.dueDate) return 0
          if (!a.dueDate) return 1
          if (!b.dueDate) return -1
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
        }
        case "assignee": {
          const aName = a.assignees[0]?.name || "zzz"
          const bName = b.assignees[0]?.name || "zzz"
          return aName.localeCompare(bName)
        }
        default: return a.position - b.position
      }
    })

    return tasks
  }, [allTasks, matchesCurrentFilters, sortMode])

  // Filtered sections for list view
  // No useMemo — recomputes every render to guarantee sync across views
  const temporaryLinkedSections = Array.from(
    allTasks
      .filter((task) => task.isCrossProject && matchesCurrentFilters(task))
      .reduce((map, task) => {
        const sectionId = `linked:${task.primaryProjectId || task.projectId}`
        const existingSection = map.get(sectionId) ?? {
          id: sectionId,
          name: task.primaryProjectName || "Linked Project",
          tasks: [] as TaskCardData[],
          isTemporary: true,
          temporarySourceProjectId: task.primaryProjectId || task.projectId,
        }

        existingSection.tasks.push(task)
        map.set(sectionId, existingSection)
        return map
      }, new Map<string, TaskListData>())
      .values()
  )
    .map((section) => ({
      ...section,
      tasks: section.tasks.sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const filteredSections = [
    ...temporaryLinkedSections,
    ...project.taskLists.map((tl) => ({
      id: tl.id,
      name: tl.name,
      tasks: allTasks
        .filter((t) => !t.isCrossProject && t.taskListId === tl.id)
        .filter(matchesCurrentFilters),
    })),
  ]

  const sectionIdByStatus = useMemo(() => {
    const normalizedSections = project.taskLists.map((taskList) => ({
      id: taskList.id,
      name: taskList.name.toLowerCase().trim(),
    }))

    return Object.fromEntries(
      Object.entries(STATUS_TO_SECTION_NAMES).map(([status, aliases]) => [
        status,
        normalizedSections.find((section) => aliases.includes(section.name))?.id,
      ])
    ) as Record<TaskCardData["status"], string | undefined>
  }, [project.taskLists])

  const activeFilterCount = [
    statusFilter !== "ALL",
    priorityFilter !== "ALL",
    assigneeFilter !== "ALL",
    sprintFilter !== "ALL",
  ].filter(Boolean).length

  const handleTaskClick = useCallback((task: TaskCardData) => {
    setSelectedTask(task)
  }, [])

  // Sync selectedTask with latest data from allTasks
  useEffect(() => {
    if (selectedTask) {
      const updated = allTasks.find(t => t.id === selectedTask.id)
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedTask)) {
        setSelectedTask(updated)
      }
    }
  }, [allTasks, selectedTask])

  const handleToggleStatus = useCallback(
    async (taskId: string, done: boolean) => {
      const newStatus = done ? "DONE" : "TODO"
      const targetSectionId = sectionIdByStatus[newStatus]
      // Optimistic update
      setAllTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: newStatus,
                ...(targetSectionId ? { taskListId: targetSectionId } : {}),
              }
            : t
        )
      )
      setViewKey((k) => k + 1)
      try {
        const patchBody: Record<string, string> = { status: newStatus }
        if (targetSectionId) patchBody.taskListId = targetSectionId
        patchBody.projectContextId = project.id
        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        })
        router.refresh()
      } catch (error) {
        console.error("Failed to update task:", error)
        // Revert on error
        setAllTasks(serverTasks)
      }
    },
    [router, sectionIdByStatus, serverTasks]
  )

  const handleStatusChange = useCallback(
    async (taskId: string, newStatus: TaskCardData["status"]) => {
      const targetSectionId = sectionIdByStatus[newStatus]
      // Optimistic update — all views see the change instantly
      setAllTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: newStatus,
                ...(targetSectionId ? { taskListId: targetSectionId } : {}),
              }
            : t
        )
      )
      setViewKey((k) => k + 1)
      try {
        const patchBody: Record<string, string> = { status: newStatus }
        if (targetSectionId) patchBody.taskListId = targetSectionId
        patchBody.projectContextId = project.id
        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        })
        router.refresh()
      } catch (error) {
        console.error("Failed to update task status:", error)
        // Revert on error
        setAllTasks(serverTasks)
      }
    },
    [router, sectionIdByStatus, serverTasks]
  )

  // Map section names to statuses for auto-status on drag
  const STATUS_MAP: Record<string, TaskCardData["status"]> = {
    "to do": "TODO", "todo": "TODO", "backlog": "TODO",
    "in progress": "IN_PROGRESS", "doing": "IN_PROGRESS", "wip": "IN_PROGRESS",
    "in review": "IN_REVIEW", "review": "IN_REVIEW",
    "done": "DONE", "complete": "DONE", "completed": "DONE",
    "cancelled": "CANCELLED", "canceled": "CANCELLED",
  }

  const handleSectionChange = useCallback(
    async (taskId: string, newSectionId: string) => {
      // Find section name and auto-map to status
      const section = project.taskLists.find((tl) => tl.id === newSectionId)
      const sectionName = section?.name?.toLowerCase().trim() || ""
      const autoStatus = STATUS_MAP[sectionName]

      // Optimistic update — move task to new section + update status if mapped
      setAllTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t
          const updated = { ...t, taskListId: newSectionId }
          if (autoStatus) updated.status = autoStatus
          return updated
        })
      )
      setViewKey((k) => k + 1)
      try {
        const patchBody: Record<string, string> = {
          taskListId: newSectionId,
          projectContextId: project.id,
        }
        if (autoStatus) patchBody.status = autoStatus
        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        })
        router.refresh()
      } catch (error) {
        console.error("Failed to move task:", error)
        setAllTasks(serverTasks)
      }
    },
    [router, serverTasks, project.taskLists]
  )

  const handleMoveTask = useCallback(
    async (taskId: string, newSectionId: string, newIndex: number) => {
      // Find section name and auto-map to status
      const section = project.taskLists.find((tl) => tl.id === newSectionId)
      const sectionName = section?.name?.toLowerCase().trim() || ""
      const autoStatus = STATUS_MAP[sectionName]

      // Optimistic update
      setAllTasks((prev) => {
        const updated = prev.map((t) => {
          if (t.id !== taskId) return t
          const newTask = { ...t, taskListId: newSectionId, position: newIndex * 100 }
          if (autoStatus) newTask.status = autoStatus
          return newTask
        })
        return updated
      })
      setViewKey((k) => k + 1)

      try {
        const patchBody: Record<string, any> = {
          taskListId: newSectionId,
          position: newIndex * 100,
          projectContextId: project.id,
        }
        if (autoStatus) patchBody.status = autoStatus

        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        })
        router.refresh()
      } catch (error) {
        console.error("Failed to move task:", error)
        setAllTasks(serverTasks)
      }
    },
    [router, serverTasks, project.taskLists]
  )

  const handleTaskDateChange = useCallback(
    async (taskId: string, newDueDate: string) => {
      setAllTasks((prev) =>
        prev.map((task) =>
          task.id === taskId
            ? {
                ...task,
                dueDate: newDueDate,
              }
            : task
        )
      )
      setViewKey((k) => k + 1)

      try {
        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dueDate: newDueDate,
            projectContextId: project.id,
          }),
        })
        router.refresh()
      } catch (error) {
        console.error("Failed to move task on calendar:", error)
        setAllTasks(serverTasks)
      }
    },
    [project.id, router, serverTasks]
  )

  const handleAddTask = useCallback((taskListId: string) => {
    setCreateTaskListId(taskListId)
    setCreateDialogOpen(true)
  }, [])

  const viewTabs = [
    { id: "overview" as const, label: "Overview", icon: Home },
    { id: "list" as const, label: "List", icon: List },
    { id: "board" as const, label: "Board", icon: LayoutGrid },
    { id: "kanban" as const, label: "Kanban", icon: Columns3 },
    { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
    { id: "timeline" as const, label: "Timeline", icon: GanttChart },
    { id: "gantt" as const, label: "Gantt", icon: Workflow },
    { id: "gallery" as const, label: "Gallery", icon: Image },
    { id: "charts" as const, label: "Charts", icon: BarChart3 },
    { id: "feed" as const, label: "Feed", icon: Activity },
    { id: "workload" as const, label: "Workload", icon: Users },
  ]

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* ── Asana-style compact header: tabs left, actions right ── */}
      <div className="border-b bg-background shrink-0">
        {/* Left: project name + view tabs */}
        <div className="flex min-w-0 items-center overflow-x-auto hide-scrollbar">
          {/* Project indicator */}
          <div className="flex shrink-0 items-center gap-2 border-r px-3 py-2 sm:pl-4 sm:pr-3">
            <div
              className="h-5 w-5 rounded flex items-center justify-center text-xs shrink-0"
              style={{ backgroundColor: projectMeta.color + "20", color: projectMeta.color }}
            >
              <ProjectIcon icon={projectMeta.icon} color={projectMeta.color} size="sm" />
            </div>
            <span className="max-w-[140px] truncate text-sm font-semibold sm:max-w-[160px]">{projectMeta.name}</span>
          </div>

          {/* View tabs */}
          {viewTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap border-b-2 -mb-px px-3 py-2.5 text-[12px] font-medium transition-all duration-150 sm:text-[13px]",
                  viewMode === tab.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
                onClick={() => handleViewChange(tab.id)}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Right: members + share */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 sm:justify-end sm:pr-4 sm:pl-0 sm:py-0">
          <button
            onClick={() => setShowProjectSettings((prev) => !prev)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              showProjectSettings
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Customize</span>
          </button>
          <div className="hidden -space-x-1.5 sm:flex">
            {project.members.slice(0, 4).map((member) => (
              <UserAvatar
                key={member.id}
                user={{ name: member.name, avatar: member.avatar }}
                size="xs"
                className="border-2 border-background h-6 w-6"
              />
            ))}
            {project.members.length > 4 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-medium">
                +{project.members.length - 4}
              </div>
            )}
          </div>
          <button className="flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-colors hover:bg-foreground/90">
            <UserPlus className="h-3 w-3" />
            <span className="hidden sm:inline">Share</span>
          </button>
        </div>
      </div>

      <Dialog open={showProjectSettings} onOpenChange={setShowProjectSettings}>
        <DialogContent className="max-w-3xl overflow-hidden rounded-[2rem] border-none p-0 shadow-2xl">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-xl font-headline font-black tracking-tight text-primary">
              Customize Project
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[80vh] overflow-y-auto pb-4">
            <ProjectHeader
              project={{
                id: projectMeta.id,
                name: projectMeta.name,
                description: projectMeta.description,
                color: projectMeta.color,
                icon: projectMeta.icon,
                enableTaskBatchDuplicate: projectMeta.enableTaskBatchDuplicate,
              }}
              onProjectChange={setProjectMeta}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Toolbar: search, filter, sort, group, add task ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b bg-background px-3 py-2 shrink-0 hide-scrollbar">
        {/* Add task */}
        <CreateTaskDialog
          projectId={project.id}
          taskLists={project.taskLists.map((tl) => ({ id: tl.id, name: tl.name }))}
          defaultTaskListId={defaultTaskListId}
          onCreated={() => router.refresh()}
        >
          <button className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-foreground hover:bg-muted/50 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            Add task
          </button>
        </CreateTaskDialog>

        <div className="w-px h-4 bg-border" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 w-24 rounded border-0 bg-transparent pl-7 pr-2 text-xs outline-none transition-all duration-200 placeholder:text-muted-foreground/50 focus:w-36 focus:bg-muted/30 sm:w-28 sm:focus:w-48"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        {/* Filter */}
        <button
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
            showFilters ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-3 w-3" />
          Filter
          {activeFilterCount > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-foreground text-[9px] text-background px-1">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <ArrowUpDown className="h-3 w-3" />
              Sort
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[150px] rounded-xl">
            {([
              ["position", "Default"],
              ["priority", "Priority"],
              ["dueDate", "Due Date"],
              ["assignee", "Assignee"],
            ] as const).map(([value, label]) => (
              <DropdownMenuItem
                key={value}
                onClick={() => setSortMode(value)}
                className={cn(
                  "cursor-pointer rounded-lg text-xs font-medium",
                  sortMode === value && "bg-muted"
                )}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Group */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Layers className="h-3 w-3" />
              Group
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[150px] rounded-xl">
            {([
              ["status", "Status"],
              ["priority", "Priority"],
              ["assignee", "Assignee"],
              ["none", "None"],
            ] as const).map(([value, label]) => (
              <DropdownMenuItem
                key={value}
                onClick={() => setGroupMode(value)}
                className={cn(
                  "cursor-pointer rounded-lg text-xs font-medium",
                  groupMode === value && "bg-muted"
                )}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="w-px h-4 bg-border" />

        {/* Quick links */}
        <Link href={`/projects/${project.id}/sprints`} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
          <Zap className="h-3 w-3" /> Sprints
        </Link>
        <Link href={`/projects/${project.id}/automations`} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
          <Workflow className="h-3 w-3" /> Rules
        </Link>

        <div className="flex-1" />

        {/* Status + Saved Filters */}
        <StatusUpdatesButton projectId={project.id} />
        <SavedFilters
          projectId={project.id}
          currentFilters={{ status: statusFilter, priority: priorityFilter, assignee: assigneeFilter, sort: sortMode, group: groupMode, search: searchQuery }}
          onApply={(filters) => { setStatusFilter(filters.status); setPriorityFilter(filters.priority); setAssigneeFilter(filters.assignee); setSortMode(filters.sort as SortMode); setGroupMode(filters.group as GroupMode); setSearchQuery(filters.search) }}
        />
      </div>

      {/* Filter bar (collapsible) */}
      {showFilters && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-muted/20 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Status:</span>
            <select className="h-6 rounded border bg-background px-2 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((s) => (<option key={s} value={s}>{s === "ALL" ? "All" : s.replace("_", " ")}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Priority:</span>
            <select className="h-6 rounded border bg-background px-2 text-xs" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              {PRIORITY_FILTERS.map((p) => (<option key={p} value={p}>{p === "ALL" ? "All" : p}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Assignee:</span>
            <select className="h-6 rounded border bg-background px-2 text-xs" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
              <option value="ALL">All</option>
              {project.members.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
            </select>
          </div>
          {sprints.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">Sprint:</span>
              <select className="h-6 rounded border bg-background px-2 text-xs" value={sprintFilter} onChange={(e) => setSprintFilter(e.target.value)}>
                <option value="ALL">All</option>
                <option value="NONE">No Sprint</option>
                {sprints.map((s) => (<option key={s.id} value={s.id}>{s.name}{s.status === "ACTIVE" ? " (Active)" : ""}</option>))}
              </select>
            </div>
          )}
          {activeFilterCount > 0 && (
            <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setStatusFilter("ALL"); setPriorityFilter("ALL"); setAssigneeFilter("ALL"); setSprintFilter("ALL") }}>
              Clear all
            </button>
          )}
        </div>
      )}

      {/* ── View content (full remaining height) ── */}
      <div className={cn(
        "flex-1 overflow-auto min-w-0",
        ["overview", "charts", "feed", "gallery"].includes(viewMode) && "p-4"
      )}>
        {viewMode === "overview" && (
          <>
            {project.pages && project.pages.length > 0 && (
              <div className="mb-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {project.pages.map((pg) => (
                    <Link
                      key={pg.id}
                      href={`/projects/${project.id}/pages/${pg.id}`}
                      className="flex items-center gap-3 rounded-lg border border-on-surface-variant/5 bg-surface-container-lowest p-4 hover:bg-surface-container-low transition-all duration-150 group"
                    >
                      <span className="text-2xl group-hover:scale-110 transition-transform">{pg.icon}</span>
                      <span className="text-sm font-medium truncate text-on-surface">{pg.name}</span>
                    </Link>
                  ))}
                  <AddPageDialog projectId={project.id}>
                    <button className="flex items-center gap-3 rounded-lg border border-dashed border-on-surface-variant/10 p-4 text-on-surface-variant/40 hover:text-on-surface hover:border-primary/20 transition-all duration-150">
                      <Plus className="h-5 w-5" />
                      <span className="text-sm font-medium">Add Page</span>
                    </button>
                  </AddPageDialog>
                </div>
              </div>
            )}
            <ErrorBoundary>
              <Suspense fallback={<SkeletonList rows={6} />}>
                <ProjectOverview project={project} />
              </Suspense>
            </ErrorBoundary>
          </>
        )}
        {viewMode === "list" && (
          <TaskListView
            key={`list-${viewKey}`}
            sections={filteredSections}
            onTaskClick={handleTaskClick}
            onToggleStatus={handleToggleStatus}
            onAddTask={handleAddTask}
            onMoveTask={handleMoveTask}
            projectId={project.id}
          />
        )}
        {viewMode === "board" && (
          <BoardView
            key={`board-${viewKey}`}
            tasks={filteredTasks}
            sections={filteredSections}
            onTaskClick={handleTaskClick}
            onStatusChange={handleStatusChange}
            onSectionChange={handleSectionChange}
            projectId={project.id}
            defaultTaskListId={defaultTaskListId}
            enableTaskBatchDuplicate={projectMeta.enableTaskBatchDuplicate}
          />
        )}
        {viewMode === "kanban" && (
          <Suspense fallback={<SkeletonKanban />}>
            <KanbanView
              key={`kanban-${viewKey}`}
              tasks={filteredTasks}
              sections={filteredSections}
              onTaskClick={handleTaskClick}
              onStatusChange={handleStatusChange}
              onSectionChange={handleSectionChange}
              projectId={project.id}
              defaultTaskListId={defaultTaskListId}
            />
          </Suspense>
        )}
        {viewMode === "calendar" && (
          <Suspense fallback={<SkeletonKanban />}>
            <ErrorBoundary>
              <CalendarView
                key={`calendar-${viewKey}`}
                tasks={filteredTasks}
                onTaskClick={handleTaskClick}
                onTaskDateChange={handleTaskDateChange}
                projectId={project.id}
                defaultTaskListId={defaultTaskListId}
              />
            </ErrorBoundary>
          </Suspense>
        )}
        {viewMode === "timeline" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <TimelineView key={`timeline-${viewKey}`} tasks={filteredTasks} onTaskClick={handleTaskClick} />
          </Suspense>
        )}
        {viewMode === "gantt" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <GanttChartView key={`gantt-${viewKey}`} tasks={filteredTasks} onTaskClick={handleTaskClick} />
          </Suspense>
        )}
        {viewMode === "gallery" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <GalleryView key={`gallery-${viewKey}`} tasks={filteredTasks} onTaskClick={handleTaskClick} projectId={project.id} defaultTaskListId={defaultTaskListId} />
          </Suspense>
        )}
        {viewMode === "charts" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <ChartsView key={`charts-${viewKey}`} tasks={filteredTasks} members={project.members} />
          </Suspense>
        )}
        {viewMode === "feed" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <FeedView key={`feed-${viewKey}`} projectId={project.id} />
          </Suspense>
        )}
        {viewMode === "workload" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <WorkloadView key={`workload-${viewKey}`} tasks={filteredTasks} members={project.members} onTaskClick={handleTaskClick} />
          </Suspense>
        )}

        {/* Empty state */}
        {filteredTasks.length === 0 && viewMode !== "overview" && viewMode !== "feed" && (
          <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/60 mb-4">
              <Search className="h-7 w-7 text-muted-foreground/60" />
            </div>
            <h3 className="text-base font-semibold">No tasks found</h3>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-xs">
              {searchQuery ? "Try adjusting your search or filters" : "Create a task to get started"}
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              Press <kbd className="px-1.5 py-0.5 rounded-md border bg-muted text-[10px] font-mono shadow-sm">N</kbd> to create a new task
            </p>
          </div>
        )}
      </div>

      {/* Floating create button */}
      <CreateTaskDialog
        projectId={project.id}
        taskLists={project.taskLists.map((tl) => ({ id: tl.id, name: tl.name }))}
        defaultTaskListId={createTaskListId}
        onCreated={() => { setCreateTaskListId(undefined); setCreateDialogOpen(false) }}
      >
        <button className="fixed bottom-20 md:bottom-6 right-24 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg hover:bg-foreground/90 transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Plus className="h-5 w-5" />
        </button>
      </CreateTaskDialog>

      {/* Task detail panel */}
      {selectedTask && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity"
            onClick={() => setSelectedTask(null)}
          />
          <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} onUpdate={() => router.refresh()} />
        </>
      )}
    </div>
  )
}

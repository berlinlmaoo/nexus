"use client"

import { useState, useCallback, useMemo, useEffect, lazy, Suspense } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useRealtimeProject } from "@/hooks/use-realtime-project"
import Link from "next/link"
import { StatusUpdates } from "@/components/projects/status-updates"
import { AddPageDialog } from "@/components/projects/add-page-dialog"
import { SavedFilters } from "@/components/tasks/saved-filters"
import { SaveTemplateDialog } from "@/components/projects/template-dialog"
import { Copy } from "lucide-react"

// Lazy load heavy view components
const KanbanView = lazy(() => import("@/components/tasks/kanban-view").then(m => ({ default: m.KanbanView })))
const CalendarView = lazy(() => import("@/components/tasks/calendar-view").then(m => ({ default: m.CalendarView })))
const TimelineView = lazy(() => import("@/components/tasks/timeline-view").then(m => ({ default: m.TimelineView })))
const GanttChartView = lazy(() => import("@/components/tasks/gantt-chart-view").then(m => ({ default: m.GanttChartView })))
const WorkloadView = lazy(() => import("@/components/tasks/workload-view").then(m => ({ default: m.WorkloadView })))
const GalleryView = lazy(() => import("@/components/tasks/gallery-view").then(m => ({ default: m.GalleryView })))
const ChartsView = lazy(() => import("@/components/tasks/charts-view").then(m => ({ default: m.ChartsView })))
const ProjectOverview = lazy(() => import("@/components/projects/project-overview").then(m => ({ default: m.ProjectOverview })))
const FeedView = lazy(() => import("@/components/tasks/feed-view").then(m => ({ default: m.FeedView })))

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
  const [showSort, setShowSort] = useState(false)

  // Group
  const [groupMode, setGroupMode] = useState<GroupMode>("status")
  const [showGroup, setShowGroup] = useState(false)

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
  useEffect(() => { setAllTasks(serverTasks) }, [serverTasks])

  // Filter + search
  const filteredTasks = useMemo(() => {
    let tasks = allTasks

    if (statusFilter !== "ALL") tasks = tasks.filter(t => t.status === statusFilter)
    if (priorityFilter !== "ALL") tasks = tasks.filter(t => t.priority === priorityFilter)
    if (assigneeFilter !== "ALL") tasks = tasks.filter(t => t.assignees.some(a => a.id === assigneeFilter))
    if (sprintFilter === "NONE") {
      // Show tasks not in any sprint
      const allSprintTaskIds = new Set<string>()
      Object.values(sprintTaskMap).forEach(s => s.forEach(id => allSprintTaskIds.add(id)))
      tasks = tasks.filter(t => !allSprintTaskIds.has(t.id))
    } else if (sprintFilter !== "ALL") {
      const sprintTasks = sprintTaskMap[sprintFilter]
      if (sprintTasks) tasks = tasks.filter(t => sprintTasks.has(t.id))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      tasks = tasks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q)) ||
        t.description?.toLowerCase().includes(q)
      )
    }

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
  }, [allTasks, statusFilter, priorityFilter, assigneeFilter, sprintFilter, sprintTaskMap, searchQuery, sortMode])

  // Filtered sections for list view
  const filteredSections = useMemo(() =>
    project.taskLists.map((tl) => ({
      id: tl.id,
      name: tl.name,
      tasks: tl.tasks.filter((t) => {
        if (statusFilter !== "ALL" && t.status !== statusFilter) return false
        if (priorityFilter !== "ALL" && t.priority !== priorityFilter) return false
        if (assigneeFilter !== "ALL" && !t.assignees.some((a) => a.id === assigneeFilter)) return false
        if (sprintFilter === "NONE") {
          const allSprintTaskIds = new Set<string>()
          Object.values(sprintTaskMap).forEach(s => s.forEach(id => allSprintTaskIds.add(id)))
          if (allSprintTaskIds.has(t.id)) return false
        } else if (sprintFilter !== "ALL") {
          const sprintTasks = sprintTaskMap[sprintFilter]
          if (sprintTasks && !sprintTasks.has(t.id)) return false
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase()
          if (!t.title.toLowerCase().includes(q) && !t.tags.some(tag => tag.toLowerCase().includes(q))) return false
        }
        return true
      }),
    })),
    [project.taskLists, statusFilter, priorityFilter, assigneeFilter, sprintFilter, sprintTaskMap, searchQuery]
  )

  const activeFilterCount = [
    statusFilter !== "ALL",
    priorityFilter !== "ALL",
    assigneeFilter !== "ALL",
    sprintFilter !== "ALL",
  ].filter(Boolean).length

  const handleTaskClick = useCallback((task: TaskCardData) => {
    setSelectedTask(task)
  }, [])

  const handleToggleStatus = useCallback(
    async (taskId: string, done: boolean) => {
      try {
        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: done ? "DONE" : "TODO" }),
        })
        router.refresh()
      } catch (error) {
        console.error("Failed to update task:", error)
      }
    },
    [router]
  )

  const handleStatusChange = useCallback(
    async (taskId: string, newStatus: TaskCardData["status"]) => {
      // Optimistic update — all views see the change instantly
      setAllTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      )
      try {
        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        })
        router.refresh()
      } catch (error) {
        console.error("Failed to update task status:", error)
        // Revert on error
        setAllTasks(serverTasks)
      }
    },
    [router, serverTasks]
  )

  const handleAddTask = useCallback((taskListId: string) => {
    setCreateTaskListId(taskListId)
    setCreateDialogOpen(true)
  }, [])

  const viewTabs = [
    { id: "overview" as const, label: "Overview", icon: Home },
    { id: "list" as const, label: "List", icon: List },
    { id: "board" as const, label: "Board", icon: LayoutGrid },
    { id: "kanban" as const, label: "Kanban", icon: Layers },
    { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
    { id: "timeline" as const, label: "Timeline", icon: GanttChart },
    { id: "gantt" as const, label: "Gantt", icon: Workflow },
    { id: "gallery" as const, label: "Gallery", icon: Image },
    { id: "charts" as const, label: "Charts", icon: BarChart3 },
    { id: "feed" as const, label: "Feed", icon: Activity },
    { id: "workload" as const, label: "Workload", icon: Users },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Project Header */}
      <ProjectHeader project={project} />

      {/* View tabs row */}
      <div className="border-b bg-white dark:bg-zinc-950 px-4 shrink-0 overflow-x-auto hide-scrollbar">
        <div className="flex items-center">
          {viewTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-all duration-200 whitespace-nowrap",
                  viewMode === tab.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
                onClick={() => handleViewChange(tab.id)}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Toolbar row: search, filter, sort, group */}
      <div className="flex items-center gap-1 border-b bg-white dark:bg-zinc-950 px-4 py-1.5 shrink-0 overflow-x-auto hide-scrollbar">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 w-32 rounded border bg-transparent pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:ring-0 transition-all duration-150"
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
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[9px] text-background">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Sort */}
          <div className="relative">
            <button
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                showSort ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              onClick={() => { setShowSort(!showSort); setShowGroup(false) }}
            >
              <ArrowUpDown className="h-3 w-3" />
              Sort
            </button>
            {showSort && (
              <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border bg-background p-1 shadow-lg min-w-[130px]">
                {([
                  ["position", "Default"],
                  ["priority", "Priority"],
                  ["dueDate", "Due Date"],
                  ["assignee", "Assignee"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => { setSortMode(value); setShowSort(false) }}
                    className={cn(
                      "flex w-full items-center rounded-md px-2.5 py-1.5 text-xs transition-colors",
                      sortMode === value ? "bg-muted font-medium" : "hover:bg-muted/50"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Group */}
          <div className="relative">
            <button
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                showGroup ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              onClick={() => { setShowGroup(!showGroup); setShowSort(false) }}
            >
              <Layers className="h-3 w-3" />
              Group
            </button>
            {showGroup && (
              <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border bg-background p-1 shadow-lg min-w-[130px]">
                {([
                  ["status", "Status"],
                  ["priority", "Priority"],
                  ["assignee", "Assignee"],
                  ["none", "None"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => { setGroupMode(value); setShowGroup(false) }}
                    className={cn(
                      "flex w-full items-center rounded-md px-2.5 py-1.5 text-xs transition-colors",
                      groupMode === value ? "bg-muted font-medium" : "hover:bg-muted/50"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Customize */}
          <StatusUpdatesButton projectId={project.id} />

          {/* Saved Filters */}
          <SavedFilters
            projectId={project.id}
            currentFilters={{
              status: statusFilter,
              priority: priorityFilter,
              assignee: assigneeFilter,
              sort: sortMode,
              group: groupMode,
              search: searchQuery,
            }}
            onApply={(filters) => {
              setStatusFilter(filters.status)
              setPriorityFilter(filters.priority)
              setAssigneeFilter(filters.assignee)
              setSortMode(filters.sort as SortMode)
              setGroupMode(filters.group as GroupMode)
              setSearchQuery(filters.search)
            }}
          />

          {/* Members + Share */}
          <div className="flex items-center gap-1 ml-1 pl-1 border-l">
            <div className="flex -space-x-1.5">
              {project.members.slice(0, 3).map((member) => (
                <UserAvatar
                  key={member.id}
                  user={{ name: member.name, avatar: member.avatar }}
                  size="xs"
                  className="border border-background h-6 w-6"
                />
              ))}
              {project.members.length > 3 && (
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-medium">
                  +{project.members.length - 3}
                </div>
              )}
            </div>
            <button className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <UserPlus className="h-3 w-3" />
              Share
            </button>
          </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Status:</span>
            <select className="h-7 rounded border bg-background px-2 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((s) => (<option key={s} value={s}>{s === "ALL" ? "All" : s.replace("_", " ")}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Priority:</span>
            <select className="h-7 rounded border bg-background px-2 text-xs" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              {PRIORITY_FILTERS.map((p) => (<option key={p} value={p}>{p === "ALL" ? "All" : p}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Assignee:</span>
            <select className="h-7 rounded border bg-background px-2 text-xs" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
              <option value="ALL">All</option>
              {project.members.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
            </select>
          </div>
          {sprints.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">Sprint:</span>
              <select className="h-7 rounded border bg-background px-2 text-xs" value={sprintFilter} onChange={(e) => setSprintFilter(e.target.value)}>
                <option value="ALL">All</option>
                <option value="NONE">No Sprint</option>
                {sprints.map((s) => (<option key={s.id} value={s.id}>{s.name}{s.status === "ACTIVE" ? " (Active)" : ""}</option>))}
              </select>
            </div>
          )}
          {activeFilterCount > 0 && (
            <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setStatusFilter("ALL"); setPriorityFilter("ALL"); setAssigneeFilter("ALL"); setSprintFilter("ALL") }}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Quick action pills */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-white dark:bg-zinc-950">
        <Link href={`/projects/${project.id}/sprints`}>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border transition-all duration-200 active:scale-95">
            <Zap className="h-3 w-3" /> Sprints
          </button>
        </Link>
        <Link href={`/projects/${project.id}/automations`}>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border transition-all duration-200 active:scale-95">
            <Workflow className="h-3 w-3" /> Automations
          </button>
        </Link>
        <Link href={`/projects/${project.id}/forms`}>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border transition-all duration-200 active:scale-95">
            <ClipboardList className="h-3 w-3" /> Forms
          </button>
        </Link>
        <SaveTemplateDialog project={{ id: project.id, name: project.name }}>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border transition-all duration-200 active:scale-95">
            <Copy className="h-3 w-3" /> Template
          </button>
        </SaveTemplateDialog>
      </div>

      {/* View content */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === "overview" && (
          <>
            {project.pages && project.pages.length > 0 && (
              <div className="mb-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {project.pages.map((pg) => (
                    <Link
                      key={pg.id}
                      href={`/projects/${project.id}/pages/${pg.id}`}
                      className="flex items-center gap-3 rounded-lg border p-4 hover:bg-muted/50 hover:border-border transition-all duration-150 group"
                    >
                      <span className="text-2xl group-hover:scale-110 transition-transform">{pg.icon}</span>
                      <span className="text-sm font-medium truncate">{pg.name}</span>
                    </Link>
                  ))}
                  <AddPageDialog projectId={project.id}>
                    <button className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-muted-foreground hover:text-foreground hover:border-border transition-all duration-150">
                      <Plus className="h-5 w-5" />
                      <span className="text-sm font-medium">Add Page</span>
                    </button>
                  </AddPageDialog>
                </div>
              </div>
            )}
            <Suspense fallback={<SkeletonList rows={6} />}>
              <ProjectOverview project={project} />
            </Suspense>
          </>
        )}
        {viewMode === "list" && (
          <TaskListView
            sections={filteredSections}
            onTaskClick={handleTaskClick}
            onToggleStatus={handleToggleStatus}
            onAddTask={handleAddTask}
            projectId={project.id}
          />
        )}
        {viewMode === "board" && (
          <BoardView
            tasks={filteredTasks}
            onTaskClick={handleTaskClick}
            onStatusChange={handleStatusChange}
            projectId={project.id}
            defaultTaskListId={defaultTaskListId}
          />
        )}
        {viewMode === "kanban" && (
          <Suspense fallback={<SkeletonKanban />}>
            <KanbanView
              tasks={filteredTasks}
              onTaskClick={handleTaskClick}
              onStatusChange={handleStatusChange}
              projectId={project.id}
              defaultTaskListId={defaultTaskListId}
            />
          </Suspense>
        )}
        {viewMode === "calendar" && (
          <Suspense fallback={<SkeletonKanban />}>
            <CalendarView
              tasks={filteredTasks}
              onTaskClick={handleTaskClick}
              projectId={project.id}
              defaultTaskListId={defaultTaskListId}
            />
          </Suspense>
        )}
        {viewMode === "timeline" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <TimelineView tasks={filteredTasks} onTaskClick={handleTaskClick} />
          </Suspense>
        )}
        {viewMode === "gantt" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <GanttChartView tasks={filteredTasks} onTaskClick={handleTaskClick} />
          </Suspense>
        )}
        {viewMode === "gallery" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <GalleryView tasks={filteredTasks} onTaskClick={handleTaskClick} projectId={project.id} defaultTaskListId={defaultTaskListId} />
          </Suspense>
        )}
        {viewMode === "charts" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <ChartsView tasks={filteredTasks} members={project.members} />
          </Suspense>
        )}
        {viewMode === "feed" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <FeedView projectId={project.id} />
          </Suspense>
        )}
        {viewMode === "workload" && (
          <Suspense fallback={<SkeletonList rows={6} />}>
            <WorkloadView tasks={filteredTasks} members={project.members} onTaskClick={handleTaskClick} />
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
        <button className="fixed bottom-20 md:bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg hover:bg-foreground/90 transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
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

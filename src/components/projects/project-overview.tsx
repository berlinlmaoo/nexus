"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { InlineDatabase } from "@/components/databases/inline-database"
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Copy,
  AlertTriangle,
  Users,
  FileText,
  CalendarDays,
  ListTodo,
  Activity,
  Loader2,
  CircleCheckBig,
  UserRoundX,
  TimerReset,
  ArrowRight,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { ProjectIcon } from "./project-icon"
import { formatTaskDueDate } from "@/lib/task-date-format"

interface OverviewTask {
  id: string
  title: string
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED"
  dueDate: string | null
  taskListName?: string
  assignees?: { id: string; name: string; avatar: string | null }[]
}

interface ProjectOverviewTaskSource {
  id: string
  title: string
  status: OverviewTask["status"]
  dueDate: string | null
  taskListName?: string
  assignees?: OverviewTask["assignees"]
}

interface ActivityEntry {
  id?: string
  action?: string
  details?: string | null
  createdAt?: string | null
  user?: {
    name?: string | null
  } | null
}

interface ProjectOverviewProps {
  project: {
    id: string
    name: string
    description: string | null
    color: string
    icon: string
    members: { id: string; name: string; avatar: string | null; role: string }[]
    taskLists: { id: string; name: string; tasks: ProjectOverviewTaskSource[] }[]
  }
}

interface OverviewSection {
  id: string
  type: "stats" | "assignments" | "calendar" | "docs" | "tasks" | "activity" | "text"
  title: string
  collapsed: boolean
}

const DEFAULT_SECTIONS: OverviewSection[] = [
  { id: "stats", type: "stats", title: "Quick Stats", collapsed: false },
  { id: "assignments", type: "assignments", title: "Assignment Overview", collapsed: false },
  { id: "todo-list", type: "tasks", title: "Active Tasks", collapsed: false },
  { id: "calendar", type: "calendar", title: "Upcoming Calendar", collapsed: false },
  { id: "docs", type: "docs", title: "Documents", collapsed: false },
  { id: "activity", type: "activity", title: "Recent Activity", collapsed: false },
]

const SECTION_TYPES = [
  { type: "assignments" as const, label: "Assignments", icon: Users },
  { type: "calendar" as const, label: "Calendar", icon: CalendarDays },
  { type: "tasks" as const, label: "Task List", icon: ListTodo },
  { type: "docs" as const, label: "Documents", icon: FileText },
  { type: "activity" as const, label: "Activity Feed", icon: Activity },
]

const TASK_PREVIEW_COUNT = 4

function isTaskDone(task: OverviewTask) {
  return task.status === "DONE"
}

function isTaskOverdue(task: OverviewTask) {
  return Boolean(task.dueDate && new Date(task.dueDate) < new Date() && !isTaskDone(task))
}

function getNearestUpcomingDueDate(tasks: OverviewTask[]) {
  let nearestDueDate: string | null = null
  let nearestTimestamp = Number.POSITIVE_INFINITY
  const now = Date.now()

  for (const task of tasks) {
    if (!task.dueDate || isTaskDone(task)) continue
    const dueTimestamp = new Date(task.dueDate).getTime()
    if (dueTimestamp < now || dueTimestamp >= nearestTimestamp) continue
    nearestTimestamp = dueTimestamp
    nearestDueDate = task.dueDate
  }

  return nearestDueDate
}

function sortAssignmentTasks(tasks: OverviewTask[]) {
  return [...tasks].sort((a, b) => {
    const aOverdue = isTaskOverdue(a) ? 0 : 1
    const bOverdue = isTaskOverdue(b) ? 0 : 1
    if (aOverdue !== bOverdue) return aOverdue - bOverdue

    const aDone = isTaskDone(a) ? 1 : 0
    const bDone = isTaskDone(b) ? 1 : 0
    if (aDone !== bDone) return aDone - bDone

    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    }
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return a.title.localeCompare(b.title)
  })
}

interface AssignmentCardSummary {
  id: string
  name: string
  avatar: string | null
  role?: string
  isUnassigned?: boolean
  tasks: OverviewTask[]
  activeCount: number
  doneCount: number
  overdueCount: number
  nearestDueDate: string | null
}

function buildAssignmentChatReport(projectName: string, cards: AssignmentCardSummary[]) {
  const generatedAt = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const sections = cards.map((card) => {
    const taskLines = card.tasks.map((task) => {
      const dueLabel = task.dueDate ? formatTaskDueDate(task.dueDate) : "No due date"
      const overdueLabel = isTaskOverdue(task) ? " [OVERDUE]" : ""
      return `- ${task.title} — ${dueLabel}${overdueLabel}`
    })

    return [
      `${card.name}`,
      `Active: ${card.activeCount} | Done: ${card.doneCount} | Overdue: ${card.overdueCount}`,
      ...taskLines,
    ].join("\n")
  })

  return [
    `${projectName} — Assignment Overview`,
    `Generated: ${generatedAt}`,
    "",
    ...sections,
  ].join("\n\n")
}

export function ProjectOverview({ project }: ProjectOverviewProps) {
  const [sections, setSections] = useState<OverviewSection[]>(DEFAULT_SECTIONS)
  const [isClient, setIsClient] = useState(false)
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([])
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [expandedAssignmentCards, setExpandedAssignmentCards] = useState<Record<string, boolean>>({})

  // Handle client-side initialization
  useEffect(() => {
    setIsClient(true)
    try {
      const stored = localStorage.getItem(`nexus-overview-${project.id}`)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSections(parsed)
        }
      }
    } catch (e) {
      console.error("Failed to load overview sections:", e)
    }
  }, [project.id])

  // Persist sections order
  useEffect(() => {
    if (!isClient) return
    try {
      localStorage.setItem(`nexus-overview-${project.id}`, JSON.stringify(sections))
    } catch {}
  }, [sections, project.id, isClient])

  // Fetch activity
  useEffect(() => {
    if (!project?.id) return
    fetch(`/api/activity?projectId=${project.id}&limit=10`)
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setActivityEntries(Array.isArray(data) ? data : data.activities || []))
      .catch((e) => console.error("Failed to fetch activity:", e))
  }, [project.id])

  // Safe data derived with defensive checks
  const taskLists = useMemo(
    () => (Array.isArray(project?.taskLists) ? project.taskLists : []),
    [project?.taskLists]
  )
  const members = useMemo(
    () => (Array.isArray(project?.members) ? project.members : []),
    [project?.members]
  )
  const {
    allTasks,
    totalTasks,
    doneTasks,
    overdueTasks,
    completionPct,
    unassignedTasks,
  } = useMemo(() => {
    const seenTaskIds = new Set<string>()
    const nextAllTasks: OverviewTask[] = []
    const nextUnassignedTasks: OverviewTask[] = []
    let nextDoneTasks = 0
    let nextOverdueTasks = 0

    for (const taskList of taskLists) {
      const tasks = Array.isArray(taskList.tasks) ? taskList.tasks : []
      for (const task of tasks) {
        if (!task?.id || seenTaskIds.has(task.id)) continue
        seenTaskIds.add(task.id)

        const normalizedTask: OverviewTask = {
          id: task.id,
          title: task.title,
          status: task.status,
          dueDate: task.dueDate,
          taskListName: task.taskListName || taskList.name,
          assignees: Array.isArray(task.assignees) ? task.assignees : [],
        }

        nextAllTasks.push(normalizedTask)

        if (isTaskDone(normalizedTask)) nextDoneTasks += 1
        if (isTaskOverdue(normalizedTask)) nextOverdueTasks += 1
        if (!normalizedTask.assignees || normalizedTask.assignees.length === 0) {
          nextUnassignedTasks.push(normalizedTask)
        }
      }
    }

    const nextTotalTasks = nextAllTasks.length

    return {
      allTasks: nextAllTasks,
      totalTasks: nextTotalTasks,
      doneTasks: nextDoneTasks,
      overdueTasks: nextOverdueTasks,
      completionPct: nextTotalTasks > 0 ? Math.round((nextDoneTasks / nextTotalTasks) * 100) : 0,
      unassignedTasks: nextUnassignedTasks,
    }
  }, [taskLists])

  const assignmentCards = useMemo<AssignmentCardSummary[]>(() => {
    const memberSummaries = new Map<string, AssignmentCardSummary>()

    for (const member of members) {
      memberSummaries.set(member.id, {
        id: member.id,
        name: member.name,
        avatar: member.avatar,
        role: member.role,
        tasks: [],
        activeCount: 0,
        doneCount: 0,
        overdueCount: 0,
        nearestDueDate: null,
      })
    }

    for (const task of allTasks) {
      if (!task.assignees || task.assignees.length === 0) continue

      const taskDone = isTaskDone(task)
      const taskOverdue = isTaskOverdue(task)
      const taskDueTimestamp = task.dueDate ? new Date(task.dueDate).getTime() : null

      for (const assignee of task.assignees) {
        const summary = memberSummaries.get(assignee.id)
        if (!summary) continue

        summary.tasks.push(task)
        if (taskDone) summary.doneCount += 1
        else summary.activeCount += 1
        if (taskOverdue) summary.overdueCount += 1

        if (
          taskDueTimestamp !== null &&
          !taskDone &&
          (summary.nearestDueDate === null || taskDueTimestamp < new Date(summary.nearestDueDate).getTime())
        ) {
          summary.nearestDueDate = task.dueDate
        }
      }
    }

    const namedCards = Array.from(memberSummaries.values())
      .map((summary) => ({
        ...summary,
        tasks: sortAssignmentTasks(summary.tasks),
      }))
      .filter((card) => card.tasks.length > 0)
      .filter((card): card is AssignmentCardSummary => Boolean(card))
      .sort((a, b) => {
        if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount
        if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount
        return a.name.localeCompare(b.name)
      })

    if (unassignedTasks.length === 0) {
      return namedCards
    }

    const unassignedCard: AssignmentCardSummary = {
      id: "unassigned",
      name: "Unassigned",
      avatar: null,
      isUnassigned: true,
      tasks: sortAssignmentTasks(unassignedTasks),
      activeCount: unassignedTasks.reduce((count, task) => count + (isTaskDone(task) ? 0 : 1), 0),
      doneCount: unassignedTasks.reduce((count, task) => count + (isTaskDone(task) ? 1 : 0), 0),
      overdueCount: unassignedTasks.reduce((count, task) => count + (isTaskOverdue(task) ? 1 : 0), 0),
      nearestDueDate: getNearestUpcomingDueDate(unassignedTasks),
    }

    if (unassignedCard.overdueCount === 0) {
      return [...namedCards, unassignedCard]
    }

    const firstNonOverdueIndex = namedCards.findIndex((card) => card.overdueCount === 0)
    if (firstNonOverdueIndex === -1) {
      return [...namedCards, unassignedCard]
    }

    return [
      ...namedCards.slice(0, firstNonOverdueIndex),
      unassignedCard,
      ...namedCards.slice(firstNonOverdueIndex),
    ]
  }, [allTasks, members, unassignedTasks])

  const assignedMembersWithTasks = assignmentCards.filter((card) => !card.isUnassigned).length

  const toggleSection = useCallback((id: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s))
    )
  }, [])

  const removeSection = useCallback((id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const addSection = useCallback((type: OverviewSection["type"]) => {
    const id = `${type}-${Date.now()}`
    const titles: Record<string, string> = {
      assignments: "Assignment Overview",
      calendar: "Calendar",
      tasks: "Task List",
      docs: "Documents",
      activity: "Activity",
    }
    setSections((prev) => [...prev, { id, type, title: titles[type] || "Section", collapsed: false }])
    setShowAddMenu(false)
  }, [])

  if (!isClient) return <div className="py-24 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary/20" /></div>

  const renderSection = (section: OverviewSection) => {
    switch (section.type) {
      case "stats":
        return (
          <StatsSection
            totalTasks={totalTasks}
            doneTasks={doneTasks}
            overdueTasks={overdueTasks}
            completionPct={completionPct}
            assignedMembersWithTasks={assignedMembersWithTasks}
            unassignedTaskCount={unassignedTasks.length}
          />
        )
      case "assignments":
        return (
          <AssignmentOverviewSection
            projectName={project.name}
            cards={assignmentCards}
            expandedCards={expandedAssignmentCards}
            onToggleExpand={(cardId) =>
              setExpandedAssignmentCards((prev) => ({
                ...prev,
                [cardId]: !prev[cardId],
              }))
            }
          />
        )
      case "tasks":
        return <InlineDatabase type="tasks" projectId={project.id} filters={{ status: "TODO,IN_PROGRESS" }} viewType="list" maxHeight={300} />
      case "calendar":
        return <InlineDatabase type="calendar" projectId={project.id} viewType="list" maxHeight={300} />
      case "docs":
        return <InlineDatabase type="docs" projectId={project.id} viewType="list" maxHeight={250} />
      case "activity":
        return <ActivitySection entries={activityEntries} />
      default:
        return null
    }
  }

  return (
    <div className="space-y-8 pb-20 animate-fade-in sm:space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
          <ProjectIcon icon={project.icon} color={project.color} size="xl" className="rounded-2xl ring-4 ring-surface-container-low shadow-2xl shadow-primary/10" />
          <div className="min-w-0">
            <h1 className="text-3xl font-headline font-black leading-none tracking-tight text-on-surface sm:text-4xl">{project.name}</h1>
            {project.description && (
              <p className="mt-2 text-base font-medium text-on-surface-variant/60 sm:text-lg">{project.description}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-primary">Project Node</span>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/20">•</span>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Secure ID: {project.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-6 sm:space-y-8">
        {(sections || []).map((section) => (
          <div
            key={section.id}
            className="group rounded-[2rem] border border-on-surface-variant/5 bg-surface-container-low/30 p-5 transition-all duration-300 hover:bg-surface-container-low/50 sm:rounded-[2.5rem] sm:p-8"
          >
            {/* Section header */}
            <div className="mb-5 flex flex-wrap items-center gap-3 sm:mb-6">
              <button
                onClick={() => toggleSection(section.id)}
                className="flex min-w-0 items-center gap-3 text-left text-base font-headline font-black tracking-tight text-on-surface transition-colors hover:text-primary sm:text-lg"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-container text-on-surface-variant/40 transition-colors group-hover:text-primary">
                  {section.collapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </div>
                {section.title}
              </button>
              {section.id !== "stats" && (
                <button
                  onClick={() => removeSection(section.id)}
                  className="ml-auto rounded-lg bg-surface-container px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/20 transition-all hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  Terminate Section
                </button>
              )}
            </div>

            {/* Section content */}
            {!section.collapsed && (
              <div className="pt-2 animate-scale-in">
                {renderSection(section)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Section */}
      <div className="relative pt-6 sm:pt-8">
        <Button
          variant="outline"
          className="h-14 w-full rounded-3xl border-2 border-dashed border-on-surface-variant/10 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 transition-all hover:border-primary/20 hover:bg-surface-container-low hover:text-on-surface sm:h-16"
          onClick={() => setShowAddMenu(!showAddMenu)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Deploy Intelligence Node
        </Button>

        <AnimatePresence>
          {showAddMenu && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-1/2 z-20 mb-4 w-[calc(100vw-3rem)] max-w-sm -translate-x-1/2 rounded-[2rem] border-none bg-surface-container-highest p-3 shadow-2xl shadow-primary/20"
            >
              <div className="grid grid-cols-1 gap-1">
                {SECTION_TYPES.map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    onClick={() => addSection(type)}
                    className="flex items-center gap-4 rounded-2xl px-5 py-4 text-xs font-black uppercase tracking-widest text-on-surface-variant/60 hover:bg-primary hover:text-primary-foreground transition-all group text-left"
                  >
                    <div className="h-8 w-8 rounded-xl bg-surface-container flex items-center justify-center group-hover:bg-primary-foreground/10">
                      <Icon className="h-4 w-4" />
                    </div>
                    {label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function StatsSection({
  totalTasks,
  doneTasks,
  overdueTasks,
  completionPct,
  assignedMembersWithTasks,
  unassignedTaskCount,
}: {
  totalTasks: number
  doneTasks: number
  overdueTasks: number
  completionPct: number
  assignedMembersWithTasks: number
  unassignedTaskCount: number
}) {
  const stats = [
    {
      label: "Task Volume",
      value: totalTasks,
      icon: ListTodo,
      color: "text-on-surface",
      accent: "text-primary/40",
      bg: "bg-surface-container-low",
    },
    {
      label: "Assigned Members",
      value: assignedMembersWithTasks,
      icon: Users,
      color: "text-on-surface",
      accent: "text-primary/40",
      bg: "bg-surface-container-low",
    },
    {
      label: "Overdue Tasks",
      value: overdueTasks,
      icon: AlertTriangle,
      color: overdueTasks > 0 ? "text-red-600" : "text-on-surface-variant/40",
      accent: overdueTasks > 0 ? "text-red-500/40" : "text-on-surface-variant/10",
      bg: overdueTasks > 0 ? "bg-red-50/50" : "bg-surface-container-low",
    },
    {
      label: "Unassigned Tasks",
      value: unassignedTaskCount,
      icon: UserRoundX,
      color: unassignedTaskCount > 0 ? "text-amber-700" : "text-on-surface",
      accent: unassignedTaskCount > 0 ? "text-amber-500/50" : "text-primary/40",
      bg: unassignedTaskCount > 0 ? "bg-amber-50/60" : "bg-surface-container-low",
    },
  ]

  return (
      <div className="space-y-6 sm:space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "flex flex-col gap-3 rounded-3xl border border-on-surface-variant/5 p-4 sm:gap-4 sm:p-6",
                stat.bg
              )}
            >
              <div className="flex items-center justify-between">
                <div className={cn("h-10 w-10 rounded-2xl flex items-center justify-center bg-surface-container-lowest shadow-sm", stat.accent)}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">{stat.label}</span>
              </div>
              <span className={cn("text-2xl font-headline font-black tracking-tight sm:text-3xl", stat.color)}>{stat.value}</span>
            </motion.div>
          )
        })}
      </div>

      {/* Completion bar */}
      <div className="rounded-3xl border border-on-surface-variant/5 bg-surface-container-low p-5 sm:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Completion Health</h4>
          <div className="text-right">
            <span className="text-lg font-headline font-black text-on-surface">{completionPct}%</span>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/20">
              {doneTasks} / {totalTasks} complete
            </p>
          </div>
        </div>
        <div className="h-4 w-full bg-surface-container rounded-full overflow-hidden p-1">
          <motion.div
            className="h-full bg-primary rounded-full shadow-lg shadow-primary/20"
            initial={{ width: 0 }}
            animate={{ width: `${completionPct}%` }}
            transition={{ duration: 1.5, ease: "circOut" }}
          />
        </div>
      </div>
    </div>
  )
}

function AssignmentOverviewSection({
  projectName,
  cards,
  expandedCards,
  onToggleExpand,
}: {
  projectName: string
  cards: AssignmentCardSummary[]
  expandedCards: Record<string, boolean>
  onToggleExpand: (cardId: string) => void
}) {
  const handleCopyChatReport = async () => {
    try {
      await navigator.clipboard.writeText(buildAssignmentChatReport(projectName, cards))
      toast.success("Chat report copied", {
        description: "Assignment overview is ready to paste into chat.",
      })
    } catch {
      toast.error("Failed to copy report")
    }
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-[2rem] bg-surface-container-low/50 p-12 text-center border border-dashed border-on-surface-variant/10">
        <div className="h-16 w-16 rounded-3xl bg-surface-container mx-auto flex items-center justify-center text-on-surface-variant/10 mb-4">
          <Users className="h-8 w-8" />
        </div>
        <p className="text-sm font-bold text-on-surface-variant/40 uppercase tracking-widest">
          No assigned work detected yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-stretch sm:justify-end">
        <Button
          variant="outline"
          onClick={handleCopyChatReport}
          className="h-11 w-full rounded-full border-on-surface-variant/10 bg-surface-container-lowest text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/70 hover:text-on-surface sm:h-auto sm:w-auto"
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy Chat Report
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {cards.map((card, index) => (
          <AssignmentSummaryCard
            key={card.id}
            card={card}
            expanded={Boolean(expandedCards[card.id])}
            onToggleExpand={() => onToggleExpand(card.id)}
            index={index}
          />
        ))}
      </div>
    </div>
  )
}

function AssignmentSummaryCard({
  card,
  expanded,
  onToggleExpand,
  index,
}: {
  card: AssignmentCardSummary
  expanded: boolean
  onToggleExpand: () => void
  index: number
}) {
  const visibleTasks = expanded ? card.tasks : card.tasks.slice(0, TASK_PREVIEW_COUNT)
  const hasMoreTasks = card.tasks.length > TASK_PREVIEW_COUNT

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        "rounded-[2rem] border p-5 sm:p-6",
        card.overdueCount > 0
          ? "border-red-200 bg-red-50/30"
          : "border-on-surface-variant/5 bg-surface-container-low/60"
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-2xl border text-sm font-black uppercase",
                card.isUnassigned
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-on-surface-variant/10 bg-surface-container-lowest text-on-surface"
              )}
            >
              {card.isUnassigned ? <UserRoundX className="h-5 w-5" /> : getInitials(card.name)}
            </div>
            <div className="min-w-0">
              <h4 className="truncate text-base font-headline font-black tracking-tight text-on-surface sm:text-lg">
                {card.name}
              </h4>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <SummaryPill icon={TimerReset} label={`${card.activeCount} active`} />
                <SummaryPill icon={CircleCheckBig} label={`${card.doneCount} done`} tone="success" />
                <SummaryPill
                  icon={AlertTriangle}
                  label={`${card.overdueCount} overdue`}
                  tone={card.overdueCount > 0 ? "danger" : "muted"}
                />
              </div>
            </div>
          </div>
        </div>

        {card.nearestDueDate && (
          <div className="text-left sm:text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/30">
              Next Due
            </p>
            <p className="mt-1 text-sm font-bold text-on-surface">
              {formatTaskDueDate(card.nearestDueDate)}
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {visibleTasks.map((task) => (
          <div
            key={`${card.id}-${task.id}`}
            className={cn(
              "rounded-2xl border px-4 py-3",
              isTaskOverdue(task)
                ? "border-red-200 bg-red-50/60"
                : "border-on-surface-variant/5 bg-surface-container-lowest"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-on-surface">{task.title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {task.dueDate && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest",
                        isTaskOverdue(task)
                          ? "bg-red-100 text-red-700"
                          : "bg-surface-container text-on-surface-variant/70"
                      )}
                    >
                      <CalendarDays className="h-3 w-3" />
                      {formatTaskDueDate(task.dueDate)}
                    </span>
                  )}
                  <span className="inline-flex items-center rounded-full bg-surface-container px-2 py-1 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/70">
                    {task.taskListName || formatStatusLabel(task.status)}
                  </span>
                </div>
              </div>

              {isTaskOverdue(task) && (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                  Late
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {hasMoreTasks && (
        <button
          onClick={onToggleExpand}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-surface-container px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/60 transition-colors hover:text-on-surface sm:w-auto"
        >
          {expanded ? "Show Less" : `View All Tasks (${card.tasks.length})`}
          <ArrowRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        </button>
      )}
    </motion.div>
  )
}

function SummaryPill({
  icon: Icon,
  label,
  tone = "default",
}: {
  icon: typeof Users | typeof TimerReset | typeof CircleCheckBig | typeof AlertTriangle
  label: string
  tone?: "default" | "success" | "danger" | "muted"
}) {
  const toneClassName =
    tone === "success"
      ? "bg-green-100 text-green-700"
      : tone === "danger"
        ? "bg-red-100 text-red-700"
        : tone === "muted"
          ? "bg-surface-container text-on-surface-variant/50"
          : "bg-surface-container-lowest text-on-surface-variant/70"

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest", toneClassName)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
}

function formatStatusLabel(status: OverviewTask["status"]) {
  return status.replace(/_/g, " ")
}

function ActivitySection({ entries }: { entries: ActivityEntry[] }) {
  const visibleEntries = useMemo(
    () =>
      entries.slice(0, 10).map((entry, index) => ({
        ...entry,
        animationDelayMs: index < 6 ? index * 30 : 0,
        formattedDate: entry.createdAt
          ? new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "Uknown Time",
        userName: entry.user?.name || "Unknown Personnel",
      })),
    [entries]
  )

  if (entries.length === 0) {
    return (
      <div className="rounded-[2rem] bg-surface-container-low/50 p-12 text-center border border-dashed border-on-surface-variant/10">
        <div className="h-16 w-16 rounded-3xl bg-surface-container mx-auto flex items-center justify-center text-on-surface-variant/10 mb-4">
          <Activity className="h-8 w-8" />
        </div>
        <p className="text-sm font-bold text-on-surface-variant/40 uppercase tracking-widest">Signal silence. No recent logs detected.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visibleEntries.map((entry, index) => (
        <div
          key={entry.id || index}
          className="group flex items-center gap-6 px-6 py-4 hover:bg-surface-container rounded-2xl transition-all duration-300 animate-fade-in"
          style={{ animationDelay: `${entry.animationDelayMs}ms` }}
        >
          <div className="h-10 w-10 rounded-xl bg-surface-container flex items-center justify-center shrink-0 shadow-sm group-hover:bg-surface-container-highest transition-colors">
            <Activity className="h-4 w-4 text-on-surface-variant/40 group-hover:text-primary transition-colors" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-on-surface">
              <span className="font-black uppercase tracking-tight text-on-surface mr-1">
                {entry.userName}
              </span>{" "}
              <span className="text-on-surface-variant/60 font-medium">{entry.action}</span>
            </p>
            {entry.details && (
              <p className="text-xs text-on-surface-variant/40 mt-1 truncate font-medium italic">{entry.details}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/20 whitespace-nowrap">
              {entry.formattedDate}
            </p>
            <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/10">Logged</p>
          </div>
        </div>
      ))}
    </div>
  )
}

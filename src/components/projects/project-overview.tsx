"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { InlineDatabase } from "@/components/databases/inline-database"
import {
  ChevronDown,
  ChevronRight,
  Plus,
  GripVertical,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  FileText,
  CalendarDays,
  ListTodo,
  Activity,
  BarChart3,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence, Reorder } from "framer-motion"
import { ProjectIcon } from "./project-icon"

interface ProjectOverviewProps {
  project: {
    id: string
    name: string
    description: string | null
    color: string
    icon: string
    members: { id: string; name: string; avatar: string | null; role: string }[]
    taskLists: { id: string; name: string; tasks: any[] }[]
  }
}

interface OverviewSection {
  id: string
  type: "stats" | "calendar" | "docs" | "tasks" | "activity" | "text"
  title: string
  collapsed: boolean
}

const DEFAULT_SECTIONS: OverviewSection[] = [
  { id: "stats", type: "stats", title: "Quick Stats", collapsed: false },
  { id: "todo-list", type: "tasks", title: "Active Tasks", collapsed: false },
  { id: "calendar", type: "calendar", title: "Upcoming Calendar", collapsed: false },
  { id: "docs", type: "docs", title: "Documents", collapsed: false },
  { id: "activity", type: "activity", title: "Recent Activity", collapsed: false },
]

const SECTION_TYPES = [
  { type: "calendar" as const, label: "Calendar", icon: CalendarDays },
  { type: "tasks" as const, label: "Task List", icon: ListTodo },
  { type: "docs" as const, label: "Documents", icon: FileText },
  { type: "activity" as const, label: "Activity Feed", icon: Activity },
]

export function ProjectOverview({ project }: ProjectOverviewProps) {
  const [sections, setSections] = useState<OverviewSection[]>(() => {
    if (typeof window === "undefined") return DEFAULT_SECTIONS
    try {
      const stored = localStorage.getItem(`nexus-overview-${project.id}`)
      return stored ? JSON.parse(stored) : DEFAULT_SECTIONS
    } catch {
      return DEFAULT_SECTIONS
    }
  })

  const [activityEntries, setActivityEntries] = useState<any[]>([])
  const [showAddMenu, setShowAddMenu] = useState(false)

  // Persist sections order
  useEffect(() => {
    try {
      localStorage.setItem(`nexus-overview-${project.id}`, JSON.stringify(sections))
    } catch {}
  }, [sections, project.id])

  // Fetch activity
  useEffect(() => {
    fetch(`/api/activity?projectId=${project.id}&limit=10`)
      .then((res) => res.json())
      .then((data) => setActivityEntries(Array.isArray(data) ? data : data.activities || []))
      .catch(() => {})
  }, [project.id])

  const allTasks = project.taskLists.flatMap((tl) => tl.tasks)
  const totalTasks = allTasks.length
  const doneTasks = allTasks.filter((t) => t.status === "DONE").length
  const overdueTasks = allTasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "DONE"
  ).length
  const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  const toggleSection = (id: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s))
    )
  }

  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id))
  }

  const addSection = (type: OverviewSection["type"]) => {
    const id = `${type}-${Date.now()}`
    const titles: Record<string, string> = {
      calendar: "Calendar",
      tasks: "Task List",
      docs: "Documents",
      activity: "Activity",
    }
    setSections((prev) => [...prev, { id, type, title: titles[type] || "Section", collapsed: false }])
    setShowAddMenu(false)
  }

  const renderSection = (section: OverviewSection) => {
    switch (section.type) {
      case "stats":
        return <StatsSection totalTasks={totalTasks} doneTasks={doneTasks} overdueTasks={overdueTasks} completionPct={completionPct} memberCount={project.members.length} />
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
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <ProjectIcon icon={project.icon} color={project.color} size="lg" />
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{project.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Sections */}
      <Reorder.Group
        axis="y"
        values={sections}
        onReorder={setSections}
        className="space-y-4"
      >
        {sections.map((section) => (
          <Reorder.Item
            key={section.id}
            value={section}
            className="list-none"
          >
            <div className="group">
              {/* Section header */}
              <div className="flex items-center gap-2 mb-2">
                <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
                <button
                  onClick={() => toggleSection(section.id)}
                  className="flex items-center gap-1.5 text-sm font-semibold hover:text-foreground transition-colors"
                >
                  {section.collapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                  {section.title}
                </button>
                {section.id !== "stats" && (
                  <button
                    onClick={() => removeSection(section.id)}
                    className="text-xs text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all ml-auto"
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Section content */}
              <AnimatePresence>
                {!section.collapsed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    {renderSection(section)}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Reorder.Item>
        ))}
      </Reorder.Group>

      {/* Add Section */}
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          className="w-full border-dashed text-muted-foreground hover:text-foreground"
          onClick={() => setShowAddMenu(!showAddMenu)}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Section
        </Button>

        <AnimatePresence>
          {showAddMenu && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg border bg-background p-1 shadow-lg"
            >
              {SECTION_TYPES.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => addSection(type)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {label}
                </button>
              ))}
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
  memberCount,
}: {
  totalTasks: number
  doneTasks: number
  overdueTasks: number
  completionPct: number
  memberCount: number
}) {
  const stats = [
    {
      label: "Total Tasks",
      value: totalTasks,
      icon: ListTodo,
      color: "text-muted-foreground",
      bg: "bg-muted",
    },
    {
      label: "Completed",
      value: `${completionPct}%`,
      icon: CheckCircle2,
      color: "text-green-700",
      bg: "bg-green-50",
    },
    {
      label: "Overdue",
      value: overdueTasks,
      icon: AlertTriangle,
      color: overdueTasks > 0 ? "text-red-700" : "text-muted-foreground",
      bg: overdueTasks > 0 ? "bg-red-50" : "bg-muted/50",
    },
    {
      label: "Members",
      value: memberCount,
      icon: Users,
      color: "text-muted-foreground",
      bg: "bg-muted",
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              "rounded-lg border p-4 flex flex-col gap-2",
              stat.bg
            )}
          >
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4", stat.color)} />
              <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
            </div>
            <span className={cn("text-2xl font-bold", stat.color)}>{stat.value}</span>
          </motion.div>
        )
      })}

      {/* Completion bar */}
      <div className="col-span-2 md:col-span-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full bg-foreground rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${completionPct}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
          <span className="text-xs font-medium text-muted-foreground w-12 text-right">{completionPct}%</span>
        </div>
      </div>
    </div>
  )
}

function ActivitySection({ entries }: { entries: any[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-center">
        <Activity className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No recent activity</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border divide-y">
      {entries.slice(0, 10).map((entry, i) => (
        <motion.div
          key={entry.id || i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.03 }}
          className="flex items-start gap-3 px-4 py-3"
        >
          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
            <Activity className="h-3 w-3 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm">
              <span className="font-medium">{entry.user?.name || "Someone"}</span>{" "}
              <span className="text-muted-foreground">{entry.action}</span>
            </p>
            {entry.details && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.details}</p>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {entry.createdAt
              ? new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : ""}
          </span>
        </motion.div>
      ))}
    </div>
  )
}

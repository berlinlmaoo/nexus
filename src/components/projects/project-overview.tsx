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
  Loader2,
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
  const [sections, setSections] = useState<OverviewSection[]>(DEFAULT_SECTIONS)
  const [isClient, setIsClient] = useState(false)
  const [activityEntries, setActivityEntries] = useState<any[]>([])
  const [showAddMenu, setShowAddMenu] = useState(false)

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

  if (!isClient) return <div className="py-24 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary/20" /></div>

  // Safe data derived with defensive checks
  const taskLists = Array.isArray(project?.taskLists) ? project.taskLists : []
  const members = Array.isArray(project?.members) ? project.members : []
  const allTasks = taskLists.flatMap((tl) => Array.isArray(tl.tasks) ? tl.tasks : [])
  const totalTasks = allTasks.length
  const doneTasks = allTasks.filter((t) => t && t.status === "DONE").length
  const overdueTasks = allTasks.filter(
    (t) => t && t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "DONE"
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
        return <StatsSection totalTasks={totalTasks} doneTasks={doneTasks} overdueTasks={overdueTasks} completionPct={completionPct} memberCount={members.length} />
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
    <div className="space-y-12 pb-20 animate-fade-in">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-6">
          <ProjectIcon icon={project.icon} color={project.color} size="xl" className="shadow-2xl shadow-primary/10 rounded-2xl ring-4 ring-surface-container-low" />
          <div>
            <h1 className="text-4xl font-headline font-black text-on-surface tracking-tight leading-none">{project.name}</h1>
            {project.description && (
              <p className="text-lg text-on-surface-variant/60 font-medium mt-2">{project.description}</p>
            )}
            <div className="flex items-center gap-2 mt-4">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] bg-primary/10 text-primary px-3 py-1 rounded-full">Project Node</span>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/20">•</span>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Secure ID: {project.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-8">
        {(sections || []).map((section) => (
          <div
            key={section.id}
            className="group bg-surface-container-low/30 hover:bg-surface-container-low/50 transition-all duration-300 rounded-[2.5rem] p-8 border border-on-surface-variant/5"
          >
            {/* Section header */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => toggleSection(section.id)}
                className="flex items-center gap-3 text-lg font-headline font-black text-on-surface tracking-tight hover:text-primary transition-colors"
              >
                <div className="h-8 w-8 rounded-xl bg-surface-container flex items-center justify-center text-on-surface-variant/40 group-hover:text-primary transition-colors">
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
                  className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/20 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all ml-auto bg-surface-container px-3 py-1.5 rounded-lg"
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
      <div className="relative pt-8">
        <Button
          variant="outline"
          className="w-full h-16 border-dashed border-2 border-on-surface-variant/10 rounded-3xl text-on-surface-variant/40 hover:text-on-surface hover:border-primary/20 hover:bg-surface-container-low transition-all font-black uppercase tracking-[0.2em] text-[10px]"
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
              className="absolute left-1/2 -translate-x-1/2 bottom-full mb-4 z-20 w-72 rounded-[2rem] border-none bg-surface-container-highest p-3 shadow-2xl shadow-primary/20"
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
      label: "Node Density",
      value: totalTasks,
      icon: ListTodo,
      color: "text-on-surface",
      accent: "text-primary/40",
      bg: "bg-surface-container-low",
    },
    {
      label: "Sync Status",
      value: `${completionPct}%`,
      icon: CheckCircle2,
      color: "text-green-600",
      accent: "text-green-500/40",
      bg: "bg-green-50/50",
    },
    {
      label: "Protocol Latency",
      value: overdueTasks,
      icon: AlertTriangle,
      color: overdueTasks > 0 ? "text-red-600" : "text-on-surface-variant/40",
      accent: overdueTasks > 0 ? "text-red-500/40" : "text-on-surface-variant/10",
      bg: overdueTasks > 0 ? "bg-red-50/50" : "bg-surface-container-low",
    },
    {
      label: "Active Units",
      value: memberCount,
      icon: Users,
      color: "text-on-surface",
      accent: "text-primary/40",
      bg: "bg-surface-container-low",
    },
  ]

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "rounded-3xl p-6 flex flex-col gap-4 border border-on-surface-variant/5",
                stat.bg
              )}
            >
              <div className="flex items-center justify-between">
                <div className={cn("h-10 w-10 rounded-2xl flex items-center justify-center bg-surface-container-lowest shadow-sm", stat.accent)}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">{stat.label}</span>
              </div>
              <span className={cn("text-3xl font-headline font-black tracking-tight", stat.color)}>{stat.value}</span>
            </motion.div>
          )
        })}
      </div>

      {/* Completion bar */}
      <div className="p-8 rounded-3xl bg-surface-container-low border border-on-surface-variant/5">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Network Synchronization</h4>
          <span className="text-lg font-headline font-black text-on-surface">{completionPct}%</span>
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

function ActivitySection({ entries }: { entries: any[] }) {
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
      {entries.slice(0, 10).map((entry, i) => (
        <motion.div
          key={entry.id || i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.03 }}
          className="group flex items-center gap-6 px-6 py-4 hover:bg-surface-container rounded-2xl transition-all duration-300"
        >
          <div className="h-10 w-10 rounded-xl bg-surface-container flex items-center justify-center shrink-0 shadow-sm group-hover:bg-surface-container-highest transition-colors">
            <Activity className="h-4 w-4 text-on-surface-variant/40 group-hover:text-primary transition-colors" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-on-surface">
              <span className="font-black uppercase tracking-tight text-on-surface mr-1">
                {entry.user?.name || "Unknown Personnel"}
              </span>{" "}
              <span className="text-on-surface-variant/60 font-medium">{entry.action}</span>
            </p>
            {entry.details && (
              <p className="text-xs text-on-surface-variant/40 mt-1 truncate font-medium italic">{entry.details}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/20 whitespace-nowrap">
              {entry.createdAt
                ? new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : "Uknown Time"}
            </p>
            <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/10">Logged</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

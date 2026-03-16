"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Home,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  LogOut,
  Target,
  FileText,
  Users,
  Inbox,
  Briefcase,
  BarChart3,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  Settings,
  Search,
  Star,
  Clock,
  Archive,
  ArchiveRestore,
  Sparkles,
  Monitor,
  FolderKanban,
  Layers,
  LayoutDashboard,
  FileBarChart,
  Compass,
  MoreVertical,
} from "lucide-react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/stores/app-store"
import { ProjectIcon, isUploadedIcon } from "@/components/projects/project-icon"

interface SidebarProps {
  user: {
    name: string
    email: string
    image?: string | null
  }
}

interface Project {
  id: string
  name: string
  color: string
  icon: string
  status?: string
}

interface ProjectPage {
  id: string
  name: string
  icon: string
  pageType: string
  children?: ProjectPage[]
}

const ICON_MAP: Record<string, string> = {
  folder: "📁", rocket: "🚀", star: "⭐", zap: "⚡", target: "🎯",
  briefcase: "💼", code: "💻", globe: "🌍", heart: "❤️", shield: "🛡️",
  layers: "📚", box: "📦", cpu: "🔧", database: "🗄️", feather: "✏️",
  flag: "🏁",
}

function PageTreeItem({
  page,
  projectId,
  depth = 0,
  pathname,
  onDelete,
  onDuplicate,
}: {
  page: ProjectPage
  projectId: string
  depth?: number
  pathname: string
  onDelete: (pageId: string) => void
  onDuplicate: (pageId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const hasChildren = page.children && page.children.length > 0
  const href = `/projects/${projectId}/pages/${page.id}`
  const isActive = pathname === href

  return (
    <div>
      <div
        className="group relative flex items-center"
        onContextMenu={(e) => {
          e.preventDefault()
          setShowMenu(true)
        }}
      >
        {hasChildren && (
          <button
            onClick={(e) => { e.preventDefault(); setExpanded(!expanded) }}
            className="absolute left-0 z-10 flex h-5 w-5 items-center justify-center text-neutral-400 hover:text-neutral-700"
            style={{ marginLeft: `${depth * 12 + 8}px` }}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        )}
        <Link
          href={href}
          className={cn(
            "flex flex-1 items-center gap-2 rounded-md py-1 text-[13px] transition-all duration-150",
            isActive
              ? "bg-neutral-100 text-neutral-900 font-medium"
              : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
          )}
          style={{ paddingLeft: `${depth * 12 + (hasChildren ? 22 : 12)}px`, paddingRight: "8px" }}
        >
          <span className="shrink-0 text-xs">{page.icon}</span>
          <span className="truncate">{page.name}</span>
        </Link>
        <div className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(!showMenu) }}
            className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-50" onClick={() => setShowMenu(false)} />
              <div className="fixed right-auto z-[60] mt-1 w-36 rounded-md border border-neutral-200 bg-white py-1 shadow-xl" style={{ left: '160px' }}>
                <Link
                  href={href}
                  onClick={() => setShowMenu(false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
                >
                  <Pencil className="h-3 w-3" /> Rename
                </Link>
                <button
                  onClick={() => { onDuplicate(page.id); setShowMenu(false) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
                >
                  <Copy className="h-3 w-3" /> Duplicate
                </button>
                <button
                  onClick={() => { setConfirmDelete(true); setShowMenu(false) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {confirmDelete && createPortal(
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setConfirmDelete(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-80 rounded-lg border border-neutral-200 bg-white p-5 shadow-2xl">
            <h4 className="text-sm font-semibold text-neutral-900 mb-2">Delete page</h4>
            <p className="text-xs text-neutral-500 mb-4">
              Are you sure you want to delete &ldquo;{page.name}&rdquo;? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-md px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete(page.id); setConfirmDelete(false) }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {expanded && hasChildren && (
        <div>
          {page.children!.map((child) => (
            <PageTreeItem
              key={child.id}
              page={child}
              projectId={projectId}
              depth={depth + 1}
              pathname={pathname}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [workspaceOpen, setWorkspaceOpen] = useState(true)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const [projectPages, setProjectPages] = useState<Record<string, ProjectPage[]>>({})
  const { sidebarOpen, toggleSidebar } = useAppStore()
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number; projectId: string } | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<{ id: string; name: string } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Favorites & Recents
  const [favorites, setFavorites] = useState<Array<{ id: string; type: string; targetId: string }>>([])
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  const [recentsOpen, setRecentsOpen] = useState(true)
  const [recentProjects, setRecentProjects] = useState<Array<{ id: string; name: string; color: string; icon: string }>>([])

  const RECENTS_KEY = "nexus-recent-projects"

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setProjects(Array.isArray(data) ? data : data.projects ?? []))
      .catch(() => setProjects([]))
  }, [])

  // Fetch favorites
  useEffect(() => {
    fetch("/api/favorites")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setFavorites(Array.isArray(data) ? data : []))
      .catch(() => setFavorites([]))
  }, [])

  // Load recent projects from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY)
      if (raw) setRecentProjects(JSON.parse(raw))
    } catch {}
  }, [])

  // Track current project visit in recents
  useEffect(() => {
    const match = pathname?.match(/^\/projects\/([^/]+)/)
    if (match && projects.length > 0) {
      const pid = match[1]
      const project = projects.find((p) => p.id === pid)
      if (project) {
        setRecentProjects((prev) => {
          const filtered = prev.filter((p) => p.id !== pid)
          const updated = [{ id: project.id, name: project.name, color: project.color, icon: project.icon }, ...filtered].slice(0, 5)
          try { localStorage.setItem(RECENTS_KEY, JSON.stringify(updated)) } catch {}
          return updated
        })
      }
    }
  }, [pathname, projects])

  useEffect(() => {
    const match = pathname?.match(/^\/projects\/([^/]+)/)
    if (match) {
      const pid = match[1]
      setExpandedProjects((prev) => ({ ...prev, [pid]: true }))
    }
  }, [pathname])

  const fetchPages = useCallback((projectId: string) => {
    if (projectPages[projectId]) return
    fetch(`/api/projects/${projectId}/pages`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setProjectPages((prev) => ({ ...prev, [projectId]: Array.isArray(data) ? data : [] })))
      .catch(() => {})
  }, [projectPages])

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      const next = { ...prev, [projectId]: !prev[projectId] }
      if (next[projectId]) fetchPages(projectId)
      return next
    })
  }, [fetchPages])

  const handleDeletePage = useCallback(async (projectId: string, pageId: string) => {
    try {
      await fetch(`/api/projects/${projectId}/pages/${pageId}`, { method: "DELETE" })
      setProjectPages((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] || []).filter((p) => p.id !== pageId),
      }))
      router.refresh()
    } catch {}
  }, [router])

  const handleDuplicatePage = useCallback(async (projectId: string, pageId: string) => {
    try {
      const pageRes = await fetch(`/api/projects/${projectId}/pages/${pageId}`)
      if (!pageRes.ok) return
      const page = await pageRes.json()
      const res = await fetch(`/api/projects/${projectId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${page.name} (copy)`,
          icon: page.icon,
          pageType: page.pageType,
          content: page.content,
          parentId: page.parentId || undefined,
        }),
      })
      if (res.ok) {
        const newPage = await res.json()
        setProjectPages((prev) => ({
          ...prev,
          [projectId]: [...(prev[projectId] || []), newPage],
        }))
      }
    } catch {}
  }, [])

  const handleDeleteProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== projectId))
        setProjectPages((prev) => { const n = { ...prev }; delete n[projectId]; return n })
        setExpandedProjects((prev) => { const n = { ...prev }; delete n[projectId]; return n })
        router.refresh()
      }
    } catch {}
  }, [router])

  useEffect(() => {
    Object.entries(expandedProjects).forEach(([pid, open]) => {
      if (open) fetchPages(pid)
    })
  }, [expandedProjects, fetchPages])

  if (!sidebarOpen) return null

  // Icon rail items
  const iconRailItems = [
    { icon: FolderKanban, label: "Projects", href: "/projects" },
    { icon: FileText, label: "Wiki", href: "/docs" },
    { icon: Sparkles, label: "AI", href: "#" },
    { icon: Monitor, label: "Desk", href: "/dashboard" },
  ]

  // Workspace nav items
  const workspaceItems = [
    { label: "Projects", href: "/projects", icon: FolderKanban },
    { label: "Goals", href: "/goals", icon: Target },
    { label: "Analytics", href: "/reports", icon: FileBarChart },
    { label: "Dashboards", href: "/dashboard", icon: LayoutDashboard },
    { label: "Docs", href: "/docs", icon: FileText },
    { label: "Views", href: "#", icon: Compass },
  ]

  const getProjectEmoji = (project: Project) => {
    if (isUploadedIcon(project.icon)) return null
    return ICON_MAP[project.icon] || "📁"
  }

  return (
    <aside
      ref={sidebarRef}
      className="fixed left-0 top-0 z-40 flex h-screen select-none animate-fade-in"
    >
      {/* LEFT: Icon Rail — 56px dark slate */}
      <div className="flex w-14 flex-col items-center bg-icon-rail py-3 gap-1">
        {/* Workspace logo */}
        <Link href="/dashboard" className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 mb-3">
          <img
            src="/logos/nexus-logo-mono-white.png"
            alt="NEXUS"
            className="h-4 w-auto object-contain opacity-90"
          />
        </Link>

        {/* Icon buttons */}
        {iconRailItems.map((item) => {
          const isActive = pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150",
                isActive
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:bg-white/10 hover:text-white/80"
              )}
              title={item.label}
            >
              <item.icon className="h-4.5 w-4.5" />
            </Link>
          )
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings at bottom */}
        <Link
          href="/settings"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150",
            pathname?.startsWith("/settings")
              ? "bg-white/15 text-white"
              : "text-white/50 hover:bg-white/10 hover:text-white/80"
          )}
          title="Settings"
        >
          <Settings className="h-4.5 w-4.5" />
        </Link>
      </div>

      {/* RIGHT: Nav Panel — 250px white */}
      <div className="flex w-60 flex-col bg-white border-r border-neutral-200">
        {/* Top: Projects header with filter icons */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-neutral-900">Projects</h2>
          <div className="flex items-center gap-1">
            <button className="rounded p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors">
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* New work item button */}
        <div className="px-3 pb-3">
          <Link
            href="/projects"
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors w-full"
          >
            <Plus className="h-3.5 w-3.5" />
            New work item
          </Link>
        </div>

        {/* Main nav scroll area */}
        <nav className="flex-1 overflow-y-auto px-2">
          {/* Home & Your work */}
          <div className="space-y-0.5 mb-2">
            {[
              { label: "Home", href: "/dashboard", icon: Home },
              { label: "My Tasks", href: "/my-tasks", icon: CheckSquare },
              { label: "Inbox", href: "/inbox", icon: Inbox },
            ].map((item) => {
              const isActive = pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
                    isActive
                      ? "bg-neutral-100 text-neutral-900 font-medium"
                      : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>

          {/* Workspace section */}
          <div className="mb-2">
            <button
              onClick={() => setWorkspaceOpen(!workspaceOpen)}
              className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
            >
              <span>Workspace</span>
              {workspaceOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            {workspaceOpen && (
              <div className="mt-0.5 space-y-0.5">
                {workspaceItems.map((item) => {
                  const isActive = pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
                        isActive
                          ? "bg-neutral-100 text-neutral-900 font-medium"
                          : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Favorites section */}
          {favorites.length > 0 && (
            <div className="mb-2">
              <button
                onClick={() => setFavoritesOpen(!favoritesOpen)}
                className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Star className="h-3 w-3 text-yellow-500" />
                  Favorites
                </span>
                {favoritesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {favoritesOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {favorites
                    .filter((f) => f.type === "project")
                    .map((fav) => {
                      const project = projects.find((p) => p.id === fav.targetId)
                      if (!project) return null
                      const isActive = pathname?.startsWith(`/projects/${project.id}`) ?? false
                      const emoji = getProjectEmoji(project)
                      return (
                        <Link
                          key={fav.id}
                          href={`/projects/${project.id}`}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
                            isActive
                              ? "bg-neutral-100 text-neutral-900 font-medium"
                              : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                          )}
                        >
                          {emoji ? (
                            <span className="text-sm shrink-0">{emoji}</span>
                          ) : (
                            <ProjectIcon icon={project.icon} size="sm" className="h-4 w-4" />
                          )}
                          <span className="truncate">{project.name}</span>
                          <Star className="h-3 w-3 ml-auto text-yellow-500 flex-shrink-0" />
                        </Link>
                      )
                    })}
                </div>
              )}
            </div>
          )}

          {/* Recent section */}
          {recentProjects.length > 0 && (
            <div className="mb-2">
              <button
                onClick={() => setRecentsOpen(!recentsOpen)}
                className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Recent
                </span>
                {recentsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {recentsOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {recentProjects.map((project) => {
                    const isActive = pathname?.startsWith(`/projects/${project.id}`) ?? false
                    const emoji = isUploadedIcon(project.icon) ? null : (ICON_MAP[project.icon] || "📁")
                    return (
                      <Link
                        key={project.id}
                        href={`/projects/${project.id}`}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
                          isActive
                            ? "bg-neutral-100 text-neutral-900 font-medium"
                            : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                        )}
                      >
                        {emoji ? (
                          <span className="text-sm shrink-0">{emoji}</span>
                        ) : (
                          <ProjectIcon icon={project.icon} size="sm" className="h-4 w-4" />
                        )}
                        <span className="truncate">{project.name}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Projects section */}
          <div className="mb-2">
            <button
              onClick={() => setProjectsOpen(!projectsOpen)}
              className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
            >
              <span>Projects</span>
              <div className="flex items-center gap-1">
                <Link
                  href="/projects"
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-0.5 hover:bg-neutral-100 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </Link>
                {projectsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </div>
            </button>

            <div
              className={cn(
                "mt-0.5 space-y-0.5 overflow-hidden transition-all duration-200 ease-in-out",
                projectsOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
              )}
            >
              {/* Archived toggle */}
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                <Archive className="h-3 w-3" />
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
              {projects.filter(p => showArchived || p.status !== "ARCHIVED").length === 0 ? (
                <p className="px-2 py-2 text-xs text-neutral-400">
                  No projects yet
                </p>
              ) : (
                projects.filter(p => showArchived || p.status !== "ARCHIVED").map((project) => {
                  const isProjectActive = pathname?.startsWith(`/projects/${project.id}`) ?? false
                  const isExpanded = expandedProjects[project.id] || false
                  const pages = projectPages[project.id] || []
                  const emoji = getProjectEmoji(project)

                  return (
                    <div key={project.id}>
                      <div className="flex items-center group">
                        <button
                          onClick={() => toggleProject(project.id)}
                          className="flex h-6 w-5 shrink-0 items-center justify-center text-neutral-300 hover:text-neutral-600 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </button>
                        <Link
                          href={`/projects/${project.id}`}
                          className={cn(
                            "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
                            isProjectActive
                              ? "bg-neutral-100 text-neutral-900 font-medium"
                              : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                          )}
                        >
                          {emoji ? (
                            <span className="text-sm shrink-0">{emoji}</span>
                          ) : (
                            <ProjectIcon icon={project.icon} size="sm" className="h-4 w-4" />
                          )}
                          <span className={cn("truncate", project.status === "ARCHIVED" && "opacity-50")}>{project.name}</span>
                          {project.status === "ARCHIVED" && <Archive className="h-3 w-3 text-neutral-400 shrink-0" />}
                        </Link>
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setProjectMenu({ x: e.clientX, y: e.clientY, projectId: project.id }) }}
                          className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-100 transition-all"
                        >
                          <MoreHorizontal className="h-3 w-3 text-neutral-400" />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="ml-5 mt-0.5 space-y-0 border-l border-neutral-200 pl-1">
                          {pages.map((page) => (
                            <PageTreeItem
                              key={page.id}
                              page={page}
                              projectId={project.id}
                              pathname={pathname ?? ''}
                              onDelete={(pageId) => handleDeletePage(project.id, pageId)}
                              onDuplicate={(pageId) => handleDuplicatePage(project.id, pageId)}
                            />
                          ))}
                          <Link
                            href={`/projects/${project.id}?addPage=true`}
                            className="flex items-center gap-2 rounded-md py-1 pl-3 text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                            <span>Add Page</span>
                          </Link>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Teams */}
          <div className="space-y-0.5 pb-2">
            <Link
              href="/teams"
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
                pathname === "/teams" || pathname?.startsWith("/teams/")
                  ? "bg-neutral-100 text-neutral-900 font-medium"
                  : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
              )}
            >
              <Users className="h-4 w-4 shrink-0" />
              <span>Teams</span>
            </Link>
          </div>
        </nav>

        {/* User section */}
        <div className="border-t border-neutral-200 p-2">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-neutral-50 transition-colors duration-200">
            <UserAvatar
              user={{ name: user.name, image: user.image }}
              size="sm"
              className="border border-neutral-200"
            />
            <div className="flex-1 min-w-0">
              <p className="truncate text-[13px] font-medium text-neutral-900">
                {user.name}
              </p>
            </div>
            <button
              onClick={() => {
                window.location.href = "/api/auth/signout"
              }}
              className="rounded-md p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Project context menu */}
      {projectMenu && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setProjectMenu(null)} />
          <div
            className="fixed z-50 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg min-w-[160px]"
            style={{
              left: Math.min(projectMenu.x, window.innerWidth - 170),
              top: Math.min(projectMenu.y, window.innerHeight - 140),
            }}
          >
            {(() => {
              const p = projects.find((p) => p.id === projectMenu.projectId)
              const isArchived = p?.status === "ARCHIVED"
              return (
                <>
                  <button
                    onClick={async () => {
                      try {
                        await fetch(`/api/projects/${projectMenu.projectId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ status: isArchived ? "ACTIVE" : "ARCHIVED" }),
                        })
                        setProjects(prev => prev.map(p => p.id === projectMenu.projectId ? { ...p, status: isArchived ? "ACTIVE" : "ARCHIVED" } : p))
                      } catch {}
                      setProjectMenu(null)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    {isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    {isArchived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/projects/${projectMenu.projectId}/duplicate`, { method: "POST" })
                        if (res.ok) {
                          const newProject = await res.json()
                          setProjects(prev => [{ id: newProject.id, name: newProject.name, color: newProject.color, icon: newProject.icon, status: newProject.status }, ...prev])
                        }
                      } catch {}
                      setProjectMenu(null)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </button>
                  <button
                    onClick={() => {
                      if (p) setConfirmDeleteProject({ id: p.id, name: p.name })
                      setProjectMenu(null)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete project
                  </button>
                </>
              )
            })()}
          </div>
        </>,
        document.body
      )}

      {/* Confirm delete project */}
      {confirmDeleteProject && createPortal(
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setConfirmDeleteProject(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-80 rounded-lg border border-neutral-200 bg-white p-5 shadow-2xl">
            <h4 className="text-sm font-semibold text-neutral-900 mb-2">Delete project</h4>
            <p className="text-xs text-neutral-500 mb-4">
              Are you sure you want to delete &ldquo;{confirmDeleteProject.name}&rdquo;? This will delete all tasks, pages, and data. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteProject(null)}
                className="rounded-md px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { handleDeleteProject(confirmDeleteProject.id); setConfirmDeleteProject(null) }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </aside>
  )
}

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
  PanelLeftClose,
  PanelLeft,
  Star,
  Clock,
  Archive,
  ArchiveRestore,
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

const topNavItems = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "My Tasks", href: "/my-tasks", icon: CheckSquare, badge: true },
  { label: "Inbox", href: "/inbox", icon: Inbox, badge: true },
]

const insightsItems = [
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Portfolios", href: "/portfolios", icon: Briefcase },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Docs", href: "/docs", icon: FileText },
]

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
            className="absolute left-0 z-10 flex h-5 w-5 items-center justify-center text-sidebar-text/40 hover:text-sidebar-text"
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
              ? "bg-sidebar-light text-white"
              : "text-sidebar-text/70 hover:bg-sidebar-light hover:text-white"
          )}
          style={{ paddingLeft: `${depth * 12 + (hasChildren ? 22 : 12)}px`, paddingRight: "8px" }}
        >
          <span className="shrink-0 text-xs">{page.icon}</span>
          <span className="truncate">{page.name}</span>
        </Link>
        <div className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(!showMenu) }}
            className="flex h-5 w-5 items-center justify-center rounded text-sidebar-text/40 hover:bg-sidebar-lighter hover:text-white"
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-50" onClick={() => setShowMenu(false)} />
              <div className="fixed right-auto z-[60] mt-1 w-36 rounded-md border border-white/10 bg-[#2e2f31] py-1 shadow-xl" style={{ left: '160px' }}>
                <Link
                  href={href}
                  onClick={() => setShowMenu(false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-sidebar-text hover:bg-sidebar-light hover:text-white"
                >
                  <Pencil className="h-3 w-3" /> Rename
                </Link>
                <button
                  onClick={() => { onDuplicate(page.id); setShowMenu(false) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-sidebar-text hover:bg-sidebar-light hover:text-white"
                >
                  <Copy className="h-3 w-3" /> Duplicate
                </button>
                <button
                  onClick={() => { setConfirmDelete(true); setShowMenu(false) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
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
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-80 rounded-lg border border-white/10 bg-[#2e2f31] p-5 shadow-2xl">
            <h4 className="text-sm font-semibold text-white mb-2">Delete page</h4>
            <p className="text-xs text-zinc-400 mb-4">
              Are you sure you want to delete &ldquo;{page.name}&rdquo;? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
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
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
  const [projectPages, setProjectPages] = useState<Record<string, ProjectPage[]>>({})
  const { sidebarOpen, toggleSidebar } = useAppStore()
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [isResizing, setIsResizing] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
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

  // Resize handler
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(400, startWidth + ev.clientX - startX))
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [sidebarWidth])

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev)
  }, [])

  if (!sidebarOpen) return null

  const effectiveWidth = isCollapsed ? 56 : sidebarWidth

  return (
    <aside
      ref={sidebarRef}
      className="fixed left-0 top-0 z-40 flex h-screen flex-col bg-sidebar text-sidebar-text animate-fade-in max-md:shadow-2xl select-none"
      style={{ width: `${effectiveWidth}px` }}
    >
      {/* Top area: brand + create */}
      <div className="flex items-center justify-between px-3 pt-4 pb-2">
        {!isCollapsed && (
          <Link href="/dashboard" className="flex items-center">
            <img
              src="/logos/nexus-logo-mono-white.png"
              alt="NEXUS"
              className="h-5 w-auto object-contain"
            />
          </Link>
        )}
        <button
          onClick={toggleCollapse}
          className="rounded-md p-1.5 text-sidebar-text/60 hover:bg-sidebar-light hover:text-white transition-colors"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Create button */}
      {!isCollapsed ? (
        <div className="px-3 pb-2">
          <Link
            href="/projects"
            className="flex items-center gap-2 rounded-md bg-sidebar-lighter px-3 py-2 text-sm font-medium text-white hover:bg-[#484a4d] transition-colors w-full"
          >
            <Plus className="h-4 w-4" />
            Create
          </Link>
        </div>
      ) : (
        <div className="flex justify-center pb-2">
          <Link
            href="/projects"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-lighter text-white hover:bg-[#484a4d] transition-colors"
            title="Create"
          >
            <Plus className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2">
        {/* Top nav: Home, My Tasks, Inbox */}
        <div className="space-y-0.5">
          {topNavItems.map((item) => {
            const isActive =
              pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-150",
                  isActive
                    ? "bg-sidebar-light text-white"
                    : "text-sidebar-text hover:bg-sidebar-light hover:text-white"
                )}
                title={isCollapsed ? item.label : undefined}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors duration-150",
                    isActive ? "text-white" : "text-sidebar-text group-hover:text-white"
                  )}
                />
                {!isCollapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                  </>
                )}
              </Link>
            )
          })}
        </div>

        {/* Divider */}
        <div className="my-3 border-t border-white/[0.08]" />

        {/* Insights section */}
        {!isCollapsed && (
          <div className="mb-2">
            <button
              onClick={() => setInsightsOpen(!insightsOpen)}
              className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-text/50 hover:text-sidebar-text/80 transition-colors"
            >
              <span>Insights</span>
              {insightsOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>

            {insightsOpen && (
              <div className="mt-0.5 space-y-0.5">
                {insightsItems.map((item) => {
                  const isActive =
                    pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-150",
                        isActive
                          ? "bg-sidebar-light text-white"
                          : "text-sidebar-text hover:bg-sidebar-light hover:text-white"
                      )}
                    >
                      <item.icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors duration-150",
                          isActive ? "text-white" : "text-sidebar-text group-hover:text-white"
                        )}
                      />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Collapsed mode: show insight icons */}
        {isCollapsed && (
          <div className="space-y-0.5 mb-2">
            {insightsItems.map((item) => {
              const isActive =
                pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-center rounded-md p-2 transition-all duration-150",
                    isActive
                      ? "bg-sidebar-light text-white"
                      : "text-sidebar-text hover:bg-sidebar-light hover:text-white"
                  )}
                  title={item.label}
                >
                  <item.icon className="h-4 w-4" />
                </Link>
              )
            })}
          </div>
        )}

        {/* Favorites section */}
        {!isCollapsed && favorites.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => setFavoritesOpen(!favoritesOpen)}
              className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-text/50 hover:text-sidebar-text/80 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Star className="h-3 w-3" />
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
                    return (
                      <Link
                        key={fav.id}
                        href={`/projects/${project.id}`}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-all duration-150",
                          isActive
                            ? "bg-sidebar-light text-white"
                            : "text-sidebar-text hover:bg-sidebar-light hover:text-white"
                        )}
                      >
                        {isUploadedIcon(project.icon) ? (
                          <ProjectIcon icon={project.icon} size="sm" className="h-4 w-4" />
                        ) : (
                          <span
                            className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10"
                            style={{ backgroundColor: project.color }}
                          />
                        )}
                        <span className="truncate">{project.name}</span>
                        <Star className="h-3 w-3 ml-auto text-yellow-400/70 flex-shrink-0" />
                      </Link>
                    )
                  })}
              </div>
            )}
          </div>
        )}

        {/* Recents section */}
        {!isCollapsed && recentProjects.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => setRecentsOpen(!recentsOpen)}
              className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-text/50 hover:text-sidebar-text/80 transition-colors"
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
                  return (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-all duration-150",
                        isActive
                          ? "bg-sidebar-light text-white"
                          : "text-sidebar-text hover:bg-sidebar-light hover:text-white"
                      )}
                    >
                      {isUploadedIcon(project.icon) ? (
                        <ProjectIcon icon={project.icon} size="sm" className="h-4 w-4" />
                      ) : (
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10"
                          style={{ backgroundColor: project.color }}
                        />
                      )}
                      <span className="truncate">{project.name}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="my-3 border-t border-white/[0.08]" />

        {/* Projects section */}
        {!isCollapsed ? (
          <div>
            <button
              onClick={() => setProjectsOpen(!projectsOpen)}
              className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-text/50 hover:text-sidebar-text/80 transition-colors"
            >
              <span>Projects</span>
              <div className="flex items-center gap-1">
                <Link
                  href="/projects"
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-0.5 hover:bg-sidebar-lighter transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </Link>
                {projectsOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
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
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-sidebar-text/40 hover:text-sidebar-text/70 transition-colors"
              >
                <Archive className="h-3 w-3" />
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
              {projects.filter(p => showArchived || p.status !== "ARCHIVED").length === 0 ? (
                <p className="px-3 py-2 text-xs text-sidebar-text/40">
                  No projects yet
                </p>
              ) : (
                projects.filter(p => showArchived || p.status !== "ARCHIVED").map((project) => {
                  const isProjectActive = pathname?.startsWith(`/projects/${project.id}`) ?? false
                  const isExpanded = expandedProjects[project.id] || false
                  const pages = projectPages[project.id] || []

                  return (
                    <div key={project.id}>
                      <div className="flex items-center group">
                        <button
                          onClick={() => toggleProject(project.id)}
                          className="flex h-6 w-5 shrink-0 items-center justify-center text-sidebar-text/30 hover:text-sidebar-text transition-colors"
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
                            "flex flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-all duration-150",
                            isProjectActive
                              ? "bg-sidebar-light text-white"
                              : "text-sidebar-text hover:bg-sidebar-light hover:text-white"
                          )}
                        >
                          {isUploadedIcon(project.icon) ? (
                            <ProjectIcon icon={project.icon} size="sm" className="h-4 w-4" />
                          ) : (
                            <span
                              className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10"
                              style={{ backgroundColor: project.color }}
                            />
                          )}
                          <span className={cn("truncate", project.status === "ARCHIVED" && "opacity-50")}>{project.name}</span>
                          {project.status === "ARCHIVED" && <Archive className="h-3 w-3 text-sidebar-text/30 shrink-0" />}
                        </Link>
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setProjectMenu({ x: e.clientX, y: e.clientY, projectId: project.id }) }}
                          className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-sidebar-lighter transition-all"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="ml-5 mt-0.5 space-y-0 border-l border-white/[0.06] pl-1">
                          {pages.map((page) => (
                            <PageTreeItem
                              key={page.id}
                              page={page}
                              projectId={project.id}
                              pathname={pathname}
                              onDelete={(pageId) => handleDeletePage(project.id, pageId)}
                              onDuplicate={(pageId) => handleDuplicatePage(project.id, pageId)}
                            />
                          ))}
                          <Link
                            href={`/projects/${project.id}?addPage=true`}
                            className="flex items-center gap-2 rounded-md py-1 pl-3 text-[12px] text-sidebar-text/40 hover:text-sidebar-text/70 transition-colors"
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
        ) : (
          <div className="flex flex-col items-center space-y-1">
            {projects.slice(0, 5).map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-sidebar-light transition-colors"
                title={project.name}
              >
                {isUploadedIcon(project.icon) ? (
                  <ProjectIcon icon={project.icon} size="sm" className="h-4 w-4" />
                ) : (
                  <span
                    className="h-3 w-3 rounded-full ring-1 ring-white/10"
                    style={{ backgroundColor: project.color }}
                  />
                )}
              </Link>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="my-3 border-t border-white/[0.08]" />

        {/* Teams + Settings */}
        {!isCollapsed ? (
          <div className="space-y-0.5 pb-2">
            {[
              { label: "Teams", href: "/teams", icon: Users },
              { label: "Settings", href: "/settings", icon: Settings },
            ].map((item) => {
              const isActive =
                pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-150",
                    isActive
                      ? "bg-sidebar-light text-white"
                      : "text-sidebar-text hover:bg-sidebar-light hover:text-white"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors duration-150",
                      isActive ? "text-white" : "text-sidebar-text group-hover:text-white"
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="space-y-0.5 pb-2">
            {[
              { label: "Teams", href: "/teams", icon: Users },
              { label: "Settings", href: "/settings", icon: Settings },
            ].map((item) => {
              const isActive =
                pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-center rounded-md p-2 transition-all duration-150",
                    isActive
                      ? "bg-sidebar-light text-white"
                      : "text-sidebar-text hover:bg-sidebar-light hover:text-white"
                  )}
                  title={item.label}
                >
                  <item.icon className="h-4 w-4" />
                </Link>
              )
            })}
          </div>
        )}
      </nav>

      {/* User section */}
      <div className="border-t border-white/[0.08] p-2">
        {!isCollapsed ? (
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-sidebar-light transition-colors">
            <UserAvatar
              user={{ name: user.name, image: user.image }}
              size="sm"
              className="border border-white/20"
            />
            <div className="flex-1 min-w-0">
              <p className="truncate text-[13px] font-medium text-white">
                {user.name}
              </p>
            </div>
            <button
              onClick={() => {
                window.location.href = "/api/auth/signout"
              }}
              className="rounded-md p-1 text-sidebar-text/50 hover:text-white transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-1">
            <UserAvatar
              user={{ name: user.name, image: user.image }}
              size="sm"
              className="border border-white/20"
            />
          </div>
        )}
      </div>

      {/* Resize handle */}
      {!isCollapsed && (
        <div
          className={cn(
            "absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-white/10 transition-colors",
            isResizing && "bg-white/20"
          )}
          onMouseDown={startResize}
        />
      )}

      {/* Project context menu */}
      {projectMenu && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setProjectMenu(null)} />
          <div
            className="fixed z-50 rounded-lg border border-white/10 bg-[#2e2f31] p-1 shadow-lg min-w-[160px]"
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
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-sidebar-text hover:bg-zinc-700 transition-colors"
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
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-sidebar-text hover:bg-zinc-700 transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </button>
                  <button
                    onClick={() => {
                      if (p) setConfirmDeleteProject({ id: p.id, name: p.name })
                      setProjectMenu(null)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 transition-colors"
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
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-80 rounded-lg border border-white/10 bg-[#2e2f31] p-5 shadow-2xl">
            <h4 className="text-sm font-semibold text-white mb-2">Delete project</h4>
            <p className="text-xs text-zinc-400 mb-4">
              Are you sure you want to delete &ldquo;{confirmDeleteProject.name}&rdquo;? This will delete all tasks, pages, and data. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteProject(null)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
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

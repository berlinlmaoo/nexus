"use client"

import { useState, useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Bell, CheckCheck, Circle, Inbox, Loader2, Trash2, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  read: boolean
  link: string | null
  createdAt: string
  projectId: string | null
}

interface ProjectInfo {
  id: string
  name: string
  color: string
}

type ViewTab = "all" | "by-project" | "by-type"

export function InboxClient({
  notifications: initialNotifications,
  projectMap,
}: {
  notifications: Notification[]
  projectMap: Record<string, ProjectInfo>
}) {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [viewTab, setViewTab] = useState<ViewTab>("all")
  const [markingAll, setMarkingAll] = useState(false)
  const [clearingRead, setClearingRead] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const filtered = filter === "unread"
    ? notifications.filter(n => !n.read)
    : notifications

  const unreadCount = notifications.filter(n => !n.read).length

  const markRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n))
    } catch (e) {
      console.error(e)
      toast.error("Failed to mark notification as read")
    }
  }

  const markAllRead = async () => {
    setMarkingAll(true)
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      })
      setNotifications(notifications.map(n => ({ ...n, read: true })))
      toast.success("All notifications marked as read")
    } catch (e) {
      console.error(e)
      toast.error("Failed to mark all as read")
    } finally {
      setMarkingAll(false)
    }
  }

  const readCount = notifications.filter(n => n.read).length

  const clearAllRead = async () => {
    if (!window.confirm(`Delete ${readCount} read notification${readCount !== 1 ? "s" : ""}? This cannot be undone.`)) return
    setClearingRead(true)
    try {
      await fetch("/api/notifications?clearRead=true", { method: "DELETE" })
      setNotifications(notifications.filter(n => !n.read))
      toast.success(`Cleared ${readCount} read notification${readCount !== 1 ? "s" : ""}`)
    } catch (e) {
      console.error(e)
      toast.error("Failed to clear read notifications")
    } finally {
      setClearingRead(false)
    }
  }

  const deleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      setNotifications(notifications.filter(n => n.id !== id))
      toast.success("Notification deleted")
    } catch (e) {
      console.error(e)
      toast.error("Failed to delete notification")
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Group by project
  const groupedByProject = useMemo(() => {
    const groups: Record<string, Notification[]> = {}
    for (const n of filtered) {
      const key = n.projectId || "_none"
      if (!groups[key]) groups[key] = []
      groups[key].push(n)
    }
    return groups
  }, [filtered])

  // Group by type
  const groupedByType = useMemo(() => {
    const groups: Record<string, Notification[]> = {}
    for (const n of filtered) {
      const key = n.type
      if (!groups[key]) groups[key] = []
      groups[key].push(n)
    }
    return groups
  }, [filtered])

  const renderNotification = (notification: Notification) => (
    <Card
      key={notification.id}
      className={cn(
        "p-4 cursor-pointer rounded-xl transition-all duration-200 hover:shadow-sm group",
        !notification.read
          ? "bg-muted/50 border-muted-foreground/10"
          : "hover:bg-muted/30"
      )}
      onClick={() => {
        if (!notification.read) markRead(notification.id)
        if (notification.link) window.location.href = notification.link
      }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1.5">
          {!notification.read ? (
            <Circle className="h-2 w-2 fill-foreground text-foreground" />
          ) : (
            <Circle className="h-2 w-2 text-transparent" />
          )}
        </div>
        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Bell className="h-4 w-4 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn("text-sm", !notification.read ? "font-semibold" : "font-medium")}>
              {notification.title}
            </h4>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {formatDate(notification.createdAt)}
              </span>
              <button
                onClick={(e) => deleteNotification(notification.id, e)}
                className="rounded p-1 text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-all duration-200"
                title="Delete notification"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          {notification.message && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.message}</p>
          )}
          <Badge variant="secondary" className="mt-2 text-[10px]">{notification.type.replace(/_/g, " ")}</Badge>
        </div>
      </div>
    </Card>
  )

  const renderGrouped = (groups: Record<string, Notification[]>, labelFn: (key: string) => string) => (
    <div className="space-y-4">
      {Object.entries(groups).map(([key, items]) => {
        const isCollapsed = collapsedGroups[key]
        return (
          <div key={key}>
            <button
              onClick={() => toggleGroup(key)}
              className="flex items-center gap-2 mb-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
            >
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {labelFn(key)}
              <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
            </button>
            {!isCollapsed && (
              <div className="space-y-2">
                {items.map(renderNotification)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {notifications.length} notification{notifications.length !== 1 ? "s" : ""}{unreadCount > 0 ? ` · ${unreadCount} unread` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {readCount > 0 && (
            <Button variant="outline" size="sm" onClick={clearAllRead} disabled={clearingRead}>
              {clearingRead ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Clear all read
            </Button>
          )}
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead} disabled={markingAll}>
              {markingAll ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCheck className="h-4 w-4 mr-2" />}
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* View tabs + filter */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
        {([
          { key: "all" as const, label: "All" },
          { key: "by-project" as const, label: "By Project" },
          { key: "by-type" as const, label: "By Type" },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setViewTab(tab.key)}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200",
              viewTab === tab.key
                ? "bg-foreground text-background shadow-sm"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
            )}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200",
              filter === "all"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200",
              filter === "unread"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Unread ({unreadCount})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-in">
          <div className="h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
            <Inbox className="h-8 w-8 text-muted-foreground/60" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            {filter === "unread" ? "No unread notifications" : "No notifications"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            {filter === "unread" ? "You're all caught up!" : "Notifications will appear here when you have updates"}
          </p>
        </div>
      ) : viewTab === "all" ? (
        <div className="space-y-2">
          {filtered.map(renderNotification)}
        </div>
      ) : viewTab === "by-project" ? (
        renderGrouped(groupedByProject, (key) => {
          if (key === "_none") return "No Project"
          return projectMap[key]?.name || "Unknown Project"
        })
      ) : (
        renderGrouped(groupedByType, (key) => {
          const labels: Record<string, string> = {
            task_assigned: "Task Assigned",
            task_completed: "Task Completed",
            comment_added: "Comments",
            comment_mention: "Mentions",
            task_due_soon: "Due Soon",
            project_invite: "Project Invites",
            status_update: "Status Updates",
          }
          return labels[key] || key.replace(/_/g, " ")
        })
      )}
    </div>
  )
}

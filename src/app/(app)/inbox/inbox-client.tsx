"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Bell, CheckCheck, Circle, Inbox, Loader2 } from "lucide-react"

interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  read: boolean
  link: string | null
  createdAt: string
}

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  TASK_ASSIGNED: { icon: "clipboard", color: "text-blue-600" },
  TASK_COMPLETED: { icon: "check", color: "text-green-600" },
  COMMENT_ADDED: { icon: "message", color: "text-foreground" },
  MENTION: { icon: "at", color: "text-orange-600" },
  DUE_DATE: { icon: "calendar", color: "text-red-600" },
}

export function InboxClient({ notifications: initialNotifications }: { notifications: Notification[] }) {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [markingAll, setMarkingAll] = useState(false)

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
    } catch (e) {
      console.error(e)
    } finally {
      setMarkingAll(false)
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

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={markingAll}>
            {markingAll ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCheck className="h-4 w-4 mr-2" />}
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filter === "all"
              ? "bg-[#18181B] text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filter === "unread"
              ? "bg-[#18181B] text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Unread ({unreadCount})
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Inbox className="h-8 w-8 text-[#18181B]" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {filter === "unread" ? "You're all caught up!" : "Notifications will appear here when you have updates"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(notification => (
            <Card
              key={notification.id}
              className={`p-4 transition-colors cursor-pointer ${
                !notification.read ? "bg-muted/50 border-muted" : "hover:bg-muted/30"
              }`}
              onClick={() => {
                if (!notification.read) markRead(notification.id)
                if (notification.link) window.location.href = notification.link
              }}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {!notification.read ? (
                    <Circle className="h-2.5 w-2.5 fill-[#18181B] text-[#18181B]" />
                  ) : (
                    <Circle className="h-2.5 w-2.5 text-transparent" />
                  )}
                </div>
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Bell className="h-4 w-4 text-[#18181B]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className={`text-sm ${!notification.read ? "font-semibold" : "font-medium"}`}>
                      {notification.title}
                    </h4>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                      {formatDate(notification.createdAt)}
                    </span>
                  </div>
                  {notification.message && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.message}</p>
                  )}
                  <Badge variant="secondary" className="mt-1.5 text-[10px]">{notification.type.replace(/_/g, " ")}</Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

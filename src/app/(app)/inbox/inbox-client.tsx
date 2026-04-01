"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Bell, CheckCheck, Circle, Inbox, Loader2, Trash2, ChevronDown, ChevronRight, Filter, Sparkles } from "lucide-react"
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

  const filtered = filter === "unread" ? notifications.filter(n => !n.read) : notifications
  const unreadCount = notifications.filter(n => !n.read).length

  const markRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n))
    } catch (e) { console.error(e) }
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
      toast.success("Intelligence Cleared", { description: "All tactical notifications marked as read." })
    } catch (e) { console.error(e) } finally { setMarkingAll(false) }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const diffMs = new Date().getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h`
    return `${Math.floor(diffMins / 1440)}d`
  }

  return (
    <div className="max-w-5xl mx-auto space-y-12 animate-fade-in pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-headline font-black tracking-tighter text-primary">
            Intelligence Feed
          </h1>
          <p className="text-on-surface-variant/60 font-medium text-lg flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-primary" />
            {unreadCount} pending transmissions
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-surface-container-low p-1.5 rounded-2xl">
          <button 
            onClick={markAllRead}
            disabled={markingAll || unreadCount === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-on-surface-variant/40 hover:text-primary hover:bg-surface-container transition-all disabled:opacity-20"
          >
            {markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            Clear All
          </button>
          <div className="h-6 w-[1px] bg-on-surface-variant/10" />
          <div className="flex bg-surface-container p-1 rounded-xl">
            {["all", "unread"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  filter === f ? "bg-surface-container-lowest text-primary shadow-sm" : "text-on-surface-variant/40 hover:text-on-surface-variant/70"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center bg-surface-container-low/20 rounded-[3rem] border-2 border-dashed border-on-surface-variant/5">
            <div className="w-20 h-20 rounded-3xl bg-surface-container flex items-center justify-center text-on-surface-variant/20 mb-6">
              <Inbox className="h-10 w-10" />
            </div>
            <h3 className="text-2xl font-headline font-black text-primary tracking-tight">Feed is silent</h3>
            <p className="text-on-surface-variant/40 mt-2 max-w-xs mx-auto font-medium">No active transmissions currently requiring your attention.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.read) markRead(n.id)
                  if (n.link) window.location.href = n.link
                }}
                className={cn(
                  "group flex items-start gap-6 p-6 rounded-[2rem] transition-all duration-300 cursor-pointer border border-transparent hover:shadow-2xl hover:shadow-primary/5",
                  !n.read ? "bg-surface-container-lowest ring-2 ring-primary/5" : "bg-surface-container-low/40 opacity-60 hover:opacity-100 hover:bg-surface-container-low"
                )}
              >
                <div className="relative mt-1">
                  <div className={cn(
                    "h-12 w-12 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110",
                    !n.read ? "bg-primary text-primary-foreground" : "bg-surface-container text-on-surface-variant/40"
                  )}>
                    <Bell className="h-5 w-5" />
                  </div>
                  {!n.read && <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-tertiary-new ring-2 ring-surface-container-lowest animate-pulse" />}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <h4 className={cn("text-base tracking-tight", !n.read ? "font-black text-primary" : "font-bold text-on-surface-variant/60")}>
                      {n.title}
                    </h4>
                    <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/20 group-hover:text-primary transition-colors">{formatDate(n.createdAt)}</span>
                  </div>
                  {n.message && <p className="text-sm text-on-surface-variant/60 font-medium leading-relaxed line-clamp-2">{n.message}</p>}
                  {n.projectId && projectMap[n.projectId] && (
                    <div className="flex items-center gap-2 pt-2">
                      <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: projectMap[n.projectId].color }} />
                      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-on-surface-variant/30">{projectMap[n.projectId].name}</span>
                    </div>
                  )}
                </div>
                
                <div className="self-center opacity-0 group-hover:opacity-100 transition-all">
                  <div className="h-10 w-10 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant/40 hover:bg-primary hover:text-primary-foreground">
                    <ChevronRight className="h-5 w-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

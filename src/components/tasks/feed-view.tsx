"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Loader2,
  MessageSquare,
  ArrowRightLeft,
  PlusCircle,
  CheckCircle2,
  Filter,
  Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface ActivityEntry {
  id: string
  action: string
  details: string | null
  createdAt: string
  user: { id: string; name: string; avatar: string | null }
  task: {
    id: string
    title: string
    status: string
    priority: string
  } | null
  project: { id: string; name: string; color: string } | null
}

interface FeedViewProps {
  projectId: string
}

const FILTERS = [
  { value: "all", label: "All Activity" },
  { value: "comments", label: "Comments" },
  { value: "status", label: "Status Changes" },
  { value: "created", label: "New Tasks" },
]

const ACTION_ICONS: Record<string, typeof Activity> = {
  COMMENTED: MessageSquare,
  STATUS_CHANGED: ArrowRightLeft,
  CREATED: PlusCircle,
  COMPLETED: CheckCircle2,
}

const STATUS_COLORS: Record<string, string> = {
  TODO: "bg-muted text-muted-foreground border-border",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  IN_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  DONE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
}

const PRIORITY_INDICATORS: Record<string, string> = {
  URGENT: "border-l-red-500",
  HIGH: "border-l-orange-500",
  MEDIUM: "border-l-yellow-500",
  LOW: "border-l-blue-500",
  NONE: "border-l-border",
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function getActionLabel(action: string): string {
  const map: Record<string, string> = {
    CREATED: "created a task",
    UPDATED: "updated a task",
    STATUS_CHANGED: "changed status",
    COMMENTED: "commented on",
    COMPLETED: "completed",
    ASSIGNED: "was assigned to",
    PRIORITY_CHANGED: "changed priority of",
    DELETED: "deleted",
  }
  return map[action] || action.toLowerCase().replace(/_/g, " ")
}

export function FeedView({ projectId }: FeedViewProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState("all")
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)
  const observerRef = useRef<HTMLDivElement>(null)
  const LIMIT = 20

  const fetchEntries = useCallback(
    async (reset = false) => {
      const isLoadMore = !reset
      if (isLoadMore) setLoadingMore(true)
      else setLoading(true)

      try {
        const currentOffset = reset ? 0 : offset
        const res = await fetch(
          `/api/activity?projectId=${projectId}&limit=${LIMIT}&offset=${currentOffset}`
        )
        if (res.ok) {
          const data = await res.json()
          const newEntries = Array.isArray(data) ? data : data.activities || []
          if (reset) {
            setEntries(newEntries)
            setOffset(newEntries.length)
          } else {
            setEntries((prev) => [...prev, ...newEntries])
            setOffset((prev) => prev + newEntries.length)
          }
          setHasMore(newEntries.length === LIMIT)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [projectId, offset]
  )

  useEffect(() => {
    fetchEntries(true)
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll
  useEffect(() => {
    if (!observerRef.current || !hasMore || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchEntries(false)
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [hasMore, loadingMore]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter entries
  const filteredEntries = entries.filter((entry) => {
    if (filter === "all") return true
    if (filter === "comments") return entry.action === "COMMENTED"
    if (filter === "status")
      return entry.action === "STATUS_CHANGED" || entry.action === "COMPLETED"
    if (filter === "created") return entry.action === "CREATED"
    return true
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-all",
              filter === f.value
                ? "bg-foreground text-background"
                : "bg-muted dark:bg-zinc-800 text-muted-foreground hover:bg-accent dark:hover:bg-zinc-700"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      {filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold text-sm">No activity yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Activity will appear here as the team works on tasks
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map((entry) => {
            const ActionIcon =
              ACTION_ICONS[entry.action] || Activity

            return (
              <div
                key={entry.id}
                className={cn(
                  "rounded-lg border p-4 transition-colors hover:bg-muted/30",
                  entry.task &&
                    `border-l-[3px] ${PRIORITY_INDICATORS[entry.task.priority] || "border-l-border"}`
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <UserAvatar
                    user={{
                      name: entry.user.name,
                      avatar: entry.user.avatar,
                    }}
                    size="sm"
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {entry.user.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {getActionLabel(entry.action)}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {formatRelativeTime(entry.createdAt)}
                      </span>
                    </div>

                    {/* Task card preview */}
                    {entry.task && (
                      <div className="mt-2 rounded-md bg-muted/50 p-2.5">
                        <div className="flex items-center gap-2">
                          <ActionIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate">
                            {entry.task.title}
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[9px] shrink-0 ml-auto",
                              STATUS_COLORS[entry.task.status] || ""
                            )}
                          >
                            {entry.task.status.replace("_", " ")}
                          </Badge>
                        </div>
                      </div>
                    )}

                    {/* Details */}
                    {entry.details && (
                      <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                        {entry.details}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Infinite scroll sentinel */}
          {hasMore && (
            <div ref={observerRef} className="flex items-center justify-center py-4">
              {loadingMore && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

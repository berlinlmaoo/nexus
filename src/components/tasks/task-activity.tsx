"use client"

import { useState, useEffect, useCallback } from "react"
import { formatDistanceToNow } from "date-fns"
import { motion } from "framer-motion"
import {
  Circle,
  ArrowRight,
  UserPlus,
  Edit3,
  MessageSquare,
  Paperclip,
  Loader2,
  History,
} from "lucide-react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Skeleton } from "@/components/ui/skeleton"

interface ActivityEntry {
  id: string
  type: string
  description: string
  user: { id: string; name: string; avatar: string | null }
  createdAt: string
  metadata?: Record<string, string>
}

interface TaskActivityProps {
  taskId: string
}

const ACTIVITY_ICONS: Record<string, typeof Circle> = {
  CREATED: Circle,
  STATUS_CHANGED: ArrowRight,
  ASSIGNEE_CHANGED: UserPlus,
  FIELD_UPDATED: Edit3,
  COMMENT_ADDED: MessageSquare,
  ATTACHMENT_ADDED: Paperclip,
}

function getActivityIcon(type: string) {
  return ACTIVITY_ICONS[type] || Circle
}

function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <Skeleton variant="circular" className="h-8 w-8" />
            {i < 3 && <Skeleton className="w-px flex-1 mt-1" />}
          </div>
          <div className="flex-1 space-y-2 pb-4">
            <Skeleton className="h-4 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton variant="circular" className="h-5 w-5" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" as const },
  },
}

export function TaskActivity({ taskId }: TaskActivityProps) {
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity?taskId=${taskId}`)
      if (!res.ok) throw new Error("Failed to fetch activity")
      const data = await res.json()
      setActivities(data.activities || [])
      setError(null)
    } catch (err) {
      console.error("Failed to fetch activity:", err)
      setError("Failed to load activity")
    } finally {
      setLoading(false)
    }
  }, [taskId])

  // Initial fetch
  useEffect(() => {
    setLoading(true)
    fetchActivities()
  }, [fetchActivities])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    }

    const startPolling = () => {
      if (document.hidden || interval) return
      interval = setInterval(() => {
        if (!document.hidden) {
          fetchActivities()
        }
      }, 30_000)
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
        return
      }

      fetchActivities()
      startPolling()
    }

    startPolling()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [fetchActivities])

  if (loading) {
    return <ActivitySkeleton />
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => {
            setLoading(true)
            fetchActivities()
          }}
          className="mt-2 text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
        >
          Try again
        </button>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="rounded-full bg-muted p-3 mb-3">
          <History className="h-5 w-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm font-medium text-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Activity will appear here as changes are made.
        </p>
      </div>
    )
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative"
    >
      {activities.map((entry, index) => {
        const Icon = getActivityIcon(entry.type)
        const isLast = index === activities.length - 1

        return (
          <motion.div
            key={entry.id}
            variants={itemVariants}
            className="relative flex gap-3"
          >
            {/* Timeline column */}
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background z-10">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              {!isLast && (
                <div className="w-px flex-1 bg-border" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-5 min-w-0">
              <p className="text-sm text-foreground leading-snug">
                {entry.description}
              </p>

              <div className="flex items-center gap-2 mt-1.5">
                <UserAvatar
                  user={{ name: entry.user.name, avatar: entry.user.avatar }}
                  size="xs"
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {entry.user.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(entry.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>

              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(entry.metadata).map(([key, value]) => (
                    <span
                      key={key}
                      className="inline-flex items-center rounded-md border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      <span className="font-medium mr-1">{key}:</span>
                      {value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )
      })}
    </motion.div>
  )
}

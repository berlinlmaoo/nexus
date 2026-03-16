"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { formatDistanceToNow } from "date-fns"
import {
  Send,
  Loader2,
  Clock,
  TrendingUp,
  AlertTriangle,
  XCircle,
  PauseCircle,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Button } from "@/components/ui/button"

enum ProjectHealth {
  ON_TRACK = "ON_TRACK",
  AT_RISK = "AT_RISK",
  OFF_TRACK = "OFF_TRACK",
  ON_HOLD = "ON_HOLD",
  COMPLETE = "COMPLETE",
}

interface StatusAuthor {
  id: string
  name: string
  avatar: string | null
}

interface StatusUpdate {
  id: string
  status: ProjectHealth
  text: string
  createdAt: string
  author: StatusAuthor
}

interface StatusUpdatesProps {
  projectId: string
}

const statusConfig: Record<
  ProjectHealth,
  {
    label: string
    icon: React.ElementType
    badge: string
    activeRing: string
    activeBg: string
  }
> = {
  [ProjectHealth.ON_TRACK]: {
    label: "On Track",
    icon: TrendingUp,
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
    activeRing: "ring-emerald-400",
    activeBg: "bg-emerald-100 text-emerald-700",
  },
  [ProjectHealth.AT_RISK]: {
    label: "At Risk",
    icon: AlertTriangle,
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    activeRing: "ring-amber-400",
    activeBg: "bg-amber-100 text-amber-700",
  },
  [ProjectHealth.OFF_TRACK]: {
    label: "Off Track",
    icon: XCircle,
    badge: "bg-red-100 text-red-700 border-red-200",
    activeRing: "ring-red-400",
    activeBg: "bg-red-100 text-red-700",
  },
  [ProjectHealth.ON_HOLD]: {
    label: "On Hold",
    icon: PauseCircle,
    badge: "bg-muted text-muted-foreground border-border",
    activeRing: "ring-ring",
    activeBg: "bg-muted text-muted-foreground",
  },
  [ProjectHealth.COMPLETE]: {
    label: "Complete",
    icon: CheckCircle2,
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    activeRing: "ring-blue-400",
    activeBg: "bg-blue-100 text-blue-700",
  },
}

const statusOptions = Object.values(ProjectHealth)

export function StatusUpdates({ projectId }: StatusUpdatesProps) {
  const [updates, setUpdates] = useState<StatusUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState<ProjectHealth>(
    ProjectHealth.ON_TRACK
  )
  const [text, setText] = useState("")

  const fetchUpdates = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/status-updates?projectId=${encodeURIComponent(projectId)}`
      )
      if (!res.ok) throw new Error("Failed to fetch")
      const data: StatusUpdate[] = await res.json()
      setUpdates(data)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchUpdates()
  }, [fetchUpdates])

  const handlePost = async () => {
    if (!text.trim() || posting) return

    setPosting(true)
    try {
      const res = await fetch("/api/status-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status: selectedStatus, text }),
      })
      if (!res.ok) throw new Error("Failed to post")
      const newUpdate: StatusUpdate = await res.json()
      setUpdates((prev) => [newUpdate, ...prev])
      setText("")
    } catch {
      // silently fail
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Composer */}
      <div className="rounded-lg border border-border bg-background p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {statusOptions.map((status) => {
            const config = statusConfig[status]
            const Icon = config.icon
            const isActive = selectedStatus === status

            return (
              <button
                key={status}
                type="button"
                onClick={() => setSelectedStatus(status)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                  config.badge,
                  isActive && cn("ring-2", config.activeRing)
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {config.label}
              </button>
            )
          })}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a status update..."
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="flex justify-end">
          <Button
            onClick={handlePost}
            disabled={!text.trim() || posting}
            size="sm"
          >
            {posting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Post Update
          </Button>
        </div>
      </div>

      {/* History */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
        </div>
      ) : updates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">
            No status updates yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Post the first update to keep your team informed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {updates.map((update, index) => {
            const config = statusConfig[update.status]
            const Icon = config.icon

            return (
              <motion.div
                key={update.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.05 }}
                className="rounded-lg border border-border bg-background p-4"
              >
                <div className="flex items-start gap-3">
                  <UserAvatar
                    user={{
                      name: update.author.name,
                      avatar: update.author.avatar,
                    }}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {update.author.name}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                          config.badge
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        {config.label}
                      </span>
                      <span className="text-xs text-muted-foreground/60">
                        {formatDistanceToNow(new Date(update.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground whitespace-pre-wrap">
                      {update.text}
                    </p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

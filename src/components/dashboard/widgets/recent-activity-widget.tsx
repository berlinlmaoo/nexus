"use client"

import { useState, useEffect, useCallback } from "react"
import { formatDistanceToNow } from "date-fns"
import { Activity, RefreshCw } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface ActivityEntry {
  id: string
  action: string
  details?: string | null
  createdAt: string
  user: {
    id: string
    name: string
    avatar?: string | null
  }
  task?: { id: string; title: string } | null
  project?: { id: string; name: string } | null
}

interface RecentActivityWidgetProps {
  data?: {
    activity?: ActivityEntry[]
  }
}

export function RecentActivityWidget({ data }: RecentActivityWidgetProps) {
  const [activity, setActivity] = useState<ActivityEntry[]>((data?.activity ?? []).slice(0, 20))
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Sync from props on initial load
  useEffect(() => {
    if (data?.activity) {
      setActivity(data.activity.slice(0, 20))
    }
  }, [data?.activity])

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch("/api/dashboard")
      if (res.ok) {
        const json = await res.json()
        if (json.activity) {
          setActivity(json.activity.slice(0, 20))
        }
      }
    } catch {
      // silently fail
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(refresh, 60000)
    return () => clearInterval(interval)
  }, [refresh])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <div></div>
        <button
          onClick={refresh}
          disabled={isRefreshing}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
        </button>
      </div>

      {activity.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No recent activity
        </p>
      ) : (
        <ScrollArea className="h-[320px]">
          <div className="space-y-0.5 pr-3">
            {(() => {
              // Group identical consecutive entries (same action + same task within 1 hour)
              const grouped: (ActivityEntry & { count: number })[] = []
              for (const entry of activity) {
                const last = grouped[grouped.length - 1]
                if (
                  last &&
                  last.action === entry.action &&
                  last.task?.id === entry.task?.id &&
                  last.user.id === entry.user.id &&
                  Math.abs(new Date(last.createdAt).getTime() - new Date(entry.createdAt).getTime()) < 3600000
                ) {
                  last.count++
                } else {
                  grouped.push({ ...entry, count: 1 })
                }
              }
              return grouped
            })().map((entry) => {
              const initials = entry.user.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2)

              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                >
                  <Avatar className="h-6 w-6 flex-shrink-0 mt-0.5">
                    {entry.user.avatar && (
                      <AvatarImage src={entry.user.avatar} alt={entry.user.name} />
                    )}
                    <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                      {initials || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-relaxed">
                      <span className="font-medium text-foreground">
                        {entry.user.name}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {entry.action}
                      </span>
                      {entry.task && (
                        <span className="font-medium text-foreground">
                          {" "}{entry.task.title}
                        </span>
                      )}
                      {entry.count > 1 && (
                        <span className="text-muted-foreground/80 font-medium">
                          {" "}(x{entry.count})
                        </span>
                      )}
                      {entry.project && (
                        <span className="text-muted-foreground">
                          {" "}in {entry.project.name}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {formatDistanceToNow(new Date(entry.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

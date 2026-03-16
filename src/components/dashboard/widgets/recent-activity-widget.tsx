"use client"

import { formatDistanceToNow } from "date-fns"
import { Activity } from "lucide-react"
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
  const activity = (data?.activity ?? []).slice(0, 20)

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
        <Activity className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Recent activity</span>
      </div>

      {activity.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No recent activity
        </p>
      ) : (
        <ScrollArea className="h-[320px]">
          <div className="space-y-0.5 pr-3">
            {activity.map((entry) => {
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

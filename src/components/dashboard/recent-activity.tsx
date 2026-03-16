"use client"

import { formatDistanceToNow } from "date-fns"
import { UserAvatar } from "@/components/ui/user-avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface ActivityEntry {
  id: string
  action: string
  details: string | null
  createdAt: string
  user: {
    id: string
    name: string
    avatar: string | null
  }
  task: { id: string; title: string } | null
  project: { id: string; name: string } | null
}

interface RecentActivityProps {
  activity: ActivityEntry[]
}

export function RecentActivity({ activity }: RecentActivityProps) {
  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 px-4 pb-4">
        {activity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No recent activity
          </p>
        ) : (
          activity.map((entry) => {
            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
              >
                <UserAvatar user={{ name: entry.user.name, avatar: entry.user.avatar }} size="sm" className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{entry.user.name}</span>{" "}
                    <span className="text-muted-foreground">
                      {entry.action}
                    </span>
                    {entry.task && (
                      <span className="font-medium">
                        {" "}
                        {entry.task.title}
                      </span>
                    )}
                    {entry.project && (
                      <span className="text-muted-foreground">
                        {" "}
                        in {entry.project.name}
                      </span>
                    )}
                  </p>
                  {entry.details && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {entry.details}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    {formatDistanceToNow(new Date(entry.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

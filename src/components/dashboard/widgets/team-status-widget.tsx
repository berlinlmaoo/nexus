"use client"

import { Users } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

interface TeamMember {
  id: string
  name: string
  avatar?: string | null
  role?: string | null
  isOnline?: boolean
}

interface TeamStatusWidgetProps {
  data?: {
    teamMembers?: TeamMember[]
  }
}

export function TeamStatusWidget({ data }: TeamStatusWidgetProps) {
  const members = data?.teamMembers ?? []

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
        <Users className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{members.length} members</span>
      </div>

      {members.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No team members
        </p>
      ) : (
        <div className="space-y-0.5">
          {members.map((member) => {
            const initials = member.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)

            // Simulate online status: use provided value or deterministic pseudo-random
            const online =
              member.isOnline ??
              member.id.charCodeAt(0) % 3 !== 0

            return (
              <div
                key={member.id}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
              >
                <div className="relative flex-shrink-0">
                  <Avatar className="h-7 w-7">
                    {member.avatar && (
                      <AvatarImage src={member.avatar} alt={member.name} />
                    )}
                    <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                      {initials || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                      online ? "bg-green-500" : "bg-muted-foreground/40"
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-foreground">
                    {member.name}
                  </p>
                  {member.role && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {member.role}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium flex-shrink-0",
                    online ? "text-green-600" : "text-muted-foreground"
                  )}
                >
                  {online ? "Online" : "Offline"}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

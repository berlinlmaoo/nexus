"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { PresenceUser } from "@/hooks/use-presence"

interface PresenceIndicatorProps {
  users: PresenceUser[]
  maxVisible?: number
  size?: "sm" | "md"
}

export function PresenceIndicator({
  users,
  maxVisible = 4,
  size = "sm",
}: PresenceIndicatorProps) {
  if (users.length === 0) return null

  const visible = users.slice(0, maxVisible)
  const remaining = users.length - maxVisible

  const sizeClasses = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs"

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {visible.map((user) => (
          <div key={user.userId} className="relative group">
            <Avatar
              className={cn(
                sizeClasses,
                "border-2 border-background ring-1 transition-transform hover:scale-110 hover:z-10"
              )}
              style={{ ['--tw-ring-color' as string]: user.color }}
            >
              {user.avatar && (
                <AvatarImage src={user.avatar} alt={user.name} />
              )}
              <AvatarFallback
                className="font-medium"
                style={{ backgroundColor: user.color, color: "#fff" }}
              >
                {user.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)}
              </AvatarFallback>
            </Avatar>

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-foreground text-white text-[10px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              {user.name}
              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-foreground" />
            </div>

            {/* Online dot */}
            <div
              className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background"
              style={{ backgroundColor: "#22c55e" }}
            />
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <span className="text-xs text-muted-foreground font-medium">
          +{remaining}
        </span>
      )}

      {users.length > 0 && (
        <span className="text-[11px] text-muted-foreground ml-0.5">
          {users.length === 1
            ? "1 person viewing"
            : `${users.length} people viewing`}
        </span>
      )}
    </div>
  )
}

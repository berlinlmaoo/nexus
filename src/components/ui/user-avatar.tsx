"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

interface UserAvatarProps {
  user: {
    name: string
    avatar?: string | null
    image?: string | null
  }
  size?: "xs" | "sm" | "md" | "lg" | "xl"
  className?: string
}

const sizeClasses = {
  xs: "h-5 w-5",
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-10 w-10",
  xl: "h-16 w-16",
}

const textSizes = {
  xs: "text-[8px]",
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
  xl: "text-lg",
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function UserAvatar({ user, size = "md", className }: UserAvatarProps) {
  const avatarUrl = user.avatar || user.image || null

  return (
    <Avatar className={cn(sizeClasses[size], className)}>
      {avatarUrl && (
        <AvatarImage src={avatarUrl} alt={user.name} className="object-cover" />
      )}
      <AvatarFallback
        className={cn(
          "bg-muted font-medium text-on-surface-variant",
          textSizes[size]
        )}
      >
        {getInitials(user.name)}
      </AvatarFallback>
    </Avatar>
  )
}

"use client"

import * as React from "react"
import { Crown } from "lucide-react"

import { cn } from "@/lib/utils"

export interface LeaderboardRanking {
  userId: string
  userName: string
  rank: number
  value: number
  avatarUrl?: string | null
}

function initialsOf(name?: string | null) {
  if (!name) return "?"
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")
}

const PODIUM_STYLE: Record<number, { bar: string; barText: string; ring: string; crown: string; height: string; avatar: number }> = {
  1: { bar: "bg-amber-300", barText: "text-amber-900", ring: "ring-amber-300", crown: "text-amber-500", height: "h-32", avatar: 72 },
  2: { bar: "bg-slate-200", barText: "text-slate-600", ring: "ring-slate-300", crown: "text-slate-400", height: "h-24", avatar: 56 },
  3: { bar: "bg-orange-300", barText: "text-orange-900", ring: "ring-orange-300", crown: "text-orange-500", height: "h-20", avatar: 56 },
}

function PodiumAvatar({ item, size, ring }: { item: LeaderboardRanking; size: number; ring: string }) {
  return item.avatarUrl ? (
    <img src={item.avatarUrl} alt={item.userName} className={cn("rounded-full object-cover ring-2", ring)} style={{ width: size, height: size }} />
  ) : (
    <span className={cn("inline-grid place-items-center rounded-full bg-muted font-bold text-foreground ring-2", ring)} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {initialsOf(item.userName)}
    </span>
  )
}

interface LeaderboardPodiumProps extends React.HTMLAttributes<HTMLDivElement> {
  rankings: LeaderboardRanking[]
}

const LeaderboardPodium = React.forwardRef<HTMLDivElement, LeaderboardPodiumProps>(
  ({ rankings, className, ...props }, ref) => {
    const byRank = (rank: number) => rankings.find((r) => r.rank === rank)
    const order = [2, 1, 3]

    return (
      <div ref={ref} className={cn("flex items-end justify-center gap-3", className)} {...props}>
        {order.map((rank) => {
          const item = byRank(rank)
          const s = PODIUM_STYLE[rank]
          if (!item) return <div key={rank} className="flex-1" />
          return (
            <div key={rank} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="relative mb-2">
                <PodiumAvatar item={item} size={s.avatar} ring={s.ring} />
                <span className="absolute -bottom-1 -right-1 grid place-items-center rounded-full bg-card p-1 shadow-sm ring-1 ring-border">
                  <Crown className={cn("h-3.5 w-3.5", s.crown)} />
                </span>
              </div>
              <div className="max-w-full truncate text-sm font-semibold">{item.userName}</div>
              <div className="mb-2 text-sm text-muted-foreground tabular-nums">{item.value.toLocaleString()}</div>
              <div className={cn("flex w-full items-start justify-center rounded-t-xl pt-3 text-2xl font-bold", s.bar, s.barText, s.height)}>
                {rank}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
)

LeaderboardPodium.displayName = "LeaderboardPodium"

export { LeaderboardPodium }

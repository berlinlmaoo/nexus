"use client"

import * as React from "react"
import { Crown } from "lucide-react"

import { cn } from "@/lib/utils"
import { AvatarFace } from "@/components/Avatar"
import { formatCount } from "@/lib/number-format"

export interface LeaderboardRanking {
  userId: string
  userName: string
  /** Podium place 1–3 (layout). */
  rank: number
  /** The rank to print when it differs from the place (a tie: two people on rank 1). */
  label?: number
  value: number
  avatarUrl?: string | null
}

const PODIUM_STYLE: Record<number, { bar: string; barText: string; ring: string; crown: string; height: string; avatar: number }> = {
  1: { bar: "bg-amber-300 dark:bg-amber-400/25", barText: "text-amber-900 dark:text-amber-200", ring: "ring-amber-300", crown: "text-amber-500", height: "h-32", avatar: 72 },
  2: { bar: "bg-slate-200 dark:bg-slate-400/20", barText: "text-slate-600 dark:text-slate-200", ring: "ring-slate-300", crown: "text-slate-400", height: "h-24", avatar: 56 },
  3: { bar: "bg-orange-300 dark:bg-orange-400/25", barText: "text-orange-900 dark:text-orange-200", ring: "ring-orange-300", crown: "text-orange-500", height: "h-20", avatar: 56 },
}

function PodiumAvatar({ item, size, ring }: { item: LeaderboardRanking; size: number; ring: string }) {
  return <AvatarFace name={item.userName} avatar={item.avatarUrl} seed={item.userName || item.userId} size={size} decorative className={ring} />
}

interface LeaderboardPodiumProps extends React.HTMLAttributes<HTMLDivElement> {
  rankings: LeaderboardRanking[]
}

const LeaderboardPodium = React.forwardRef<HTMLDivElement, LeaderboardPodiumProps>(
  ({ rankings, className, ...props }, ref) => {
    const byRank = (rank: number) => rankings.find((r) => r.rank === rank)
    // The classic podium (2nd left, 1st centre, 3rd right) only when the first place is alone at the top.
    // With a tie at the top every step reads "1", and 2-1-3 then looked like a different order from the
    // list beneath (UI tour run 7, 14 Oct 2026: list Staff A, QA Dev, QA Dev 2; podium QA Dev,
    // Staff A, QA Dev 2). Tied, the steps run left to right in the list's order.
    const first = byRank(1)
    const second = byRank(2)
    const tiedTop = !!first && !!second && (first.label ?? 1) === (second.label ?? 2)
    const order = tiedTop ? [1, 2, 3] : [2, 1, 3]

    return (
      <div ref={ref} className={cn("flex items-end justify-center gap-3", className)} {...props}>
        {order.map((rank) => {
          const item = byRank(rank)
          if (!item) return <div key={rank} className="flex-1" />
          // Tied people share a rank, so they share its step too: 1 / 1 / 1 are three gold steps of one height
          // (QA BoD R2 N05). The place only decides left / middle / right.
          const s = PODIUM_STYLE[Math.min(3, Math.max(1, item.label ?? rank))] ?? PODIUM_STYLE[rank]
          return (
            <div key={rank} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="relative mb-2">
                <PodiumAvatar item={item} size={s.avatar} ring={s.ring} />
                <span className="absolute -bottom-1 -right-1 grid place-items-center rounded-full bg-card p-1 shadow-sm ring-1 ring-border">
                  <Crown className={cn("h-3.5 w-3.5", s.crown)} />
                </span>
              </div>
              <div className="max-w-full truncate text-sm font-semibold">{item.userName}</div>
              <div className="mb-2 text-sm text-muted-foreground tabular-nums">{formatCount(item.value)}</div>
              <div className={cn("flex w-full items-start justify-center rounded-t-xl pt-3 text-2xl font-bold", s.bar, s.barText, s.height)}>
                {item.label ?? rank}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
)

LeaderboardPodium.displayName = "LeaderboardPodium"

/**
 * More people share 1st than the podium has steps (UI tour run 14, R14-WB-9): three equal "1" blocks for 3 of
 * 7 tied people left the other four out and a large empty gold area. Instead, one gold band holds everyone who
 * shares 1st, in the list's order, with the caption ("7-way tie for 1st") on top.
 */
function LeaderboardTie({ rankings, caption, className }: { rankings: LeaderboardRanking[]; caption: React.ReactNode; className?: string }) {
  const s = PODIUM_STYLE[1]
  return (
    <div className={cn("rounded-xl px-4 py-4", s.bar, className)}>
      <p className={cn("flex items-center justify-center gap-1.5 text-center text-sm font-semibold", s.barText)}>
        <Crown aria-hidden className="h-4 w-4 shrink-0" />
        <span>{caption}</span>
        {rankings[0] ? <span className="tabular-nums">· {formatCount(rankings[0].value)}</span> : null}
      </p>
      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-3">
        {rankings.map((item) => (
          <li key={item.userId} className="flex w-20 min-w-0 flex-col items-center gap-1">
            <PodiumAvatar item={item} size={44} ring={cn("ring-2", s.ring)} />
            <span className={cn("max-w-full truncate text-xs font-semibold", s.barText)}>{item.userName}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export { LeaderboardPodium, LeaderboardTie }

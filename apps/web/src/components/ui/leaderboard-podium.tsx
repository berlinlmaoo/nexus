"use client"

import * as React from "react"
import { Crown } from "lucide-react"

import { cn } from "@/lib/utils"
import { FitText } from "@/components/FitText"
import { AvatarFace } from "@/components/Avatar"
import { formatCount } from "@/lib/number-format"

export interface LeaderboardRanking {
  userId: string
  userName: string
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
  /** The top three scores, best first: everyone on a score stands on its step together. */
  groups: LeaderboardRanking[][]
  /** "7 tied" under a shared step. */
  tiedLabel: (n: number) => string
  /** "+4" after the names a shared step has no room for. */
  moreLabel: (n: number) => string
}

const STACK_MAX = 3

/**
 * Three steps, 2nd left, 1st centre, 3rd right, one per score (owner, 16 Oct 2026: keep the podium when
 * people tie). A step shared by several people shows their faces stacked, how many share it and their names;
 * the next steps hold the next scores. It replaced both the "1 / 1 / 1" podium (UI tour run 7: steps in a
 * different order from the list) and the gold band for a big tie (run 14, R14-WB-9).
 */
const LeaderboardPodium = React.forwardRef<HTMLDivElement, LeaderboardPodiumProps>(
  ({ groups, tiedLabel, moreLabel, className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-end justify-center gap-3", className)} {...props}>
      {[2, 1, 3].map((place) => {
        const group = groups[place - 1] ?? []
        if (!group.length) return <div key={place} className="flex-1" />
        const s = PODIUM_STYLE[place]
        const shown = group.slice(0, STACK_MAX)
        const names = group.slice(0, 2).map((g) => g.userName).join(", ")
        return (
          <div key={place} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="relative mb-2">
              {group.length === 1 ? (
                <PodiumAvatar item={group[0]} size={s.avatar} ring={s.ring} />
              ) : (
                <div className="flex -space-x-3">
                  {shown.map((g) => <PodiumAvatar key={g.userId} item={g} size={Math.round(s.avatar * 0.5)} ring={cn("ring-2", s.ring)} />)}
                  {group.length > STACK_MAX && (
                    <span className={cn("relative grid shrink-0 place-items-center rounded-full bg-card text-xs font-semibold tabular-nums ring-2", s.ring)}
                      style={{ width: Math.round(s.avatar * 0.5), height: Math.round(s.avatar * 0.5) }}>
                      +{group.length - STACK_MAX}
                    </span>
                  )}
                </div>
              )}
              {/* A shared step goes without the crown badge: on the stack it covered the "+4". */}
              {group.length === 1 && <span className="absolute -bottom-1 -right-1 grid place-items-center rounded-full bg-card p-1 shadow-sm ring-1 ring-border">
                <Crown className={cn("h-3.5 w-3.5", s.crown)} />
              </span>}
            </div>
            {group.length === 1 ? (
              // Between words only (overflow-wrap:anywhere split "Adrinfisol" at 390), smaller before "…" (FitText).
              <FitText as="div" text={group[0].userName} className="max-w-full text-balance text-center text-sm font-semibold leading-tight" />
            ) : (
              <div className="flex max-w-full flex-col items-center" title={group.map((g) => g.userName).join(", ")}>
                <span className="text-sm font-semibold">{tiedLabel(group.length)}</span>
                <span className="max-w-full text-balance text-center text-xs leading-tight text-muted-foreground">
                  {names}{group.length > 2 ? ` ${moreLabel(group.length - 2)}` : ""}
                </span>
              </div>
            )}
            <div className="mb-2 mt-0.5 text-sm text-muted-foreground tabular-nums">{formatCount(group[0].value)} XP</div>
            <div className={cn("flex w-full items-start justify-center rounded-t-xl pt-3 text-2xl font-bold", s.bar, s.barText, s.height)}>
              {place}
            </div>
          </div>
        )
      })}
    </div>
  )
)

LeaderboardPodium.displayName = "LeaderboardPodium"

export { LeaderboardPodium }

"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  LeaderboardPodium,
  type LeaderboardRanking as LeaderboardPodiumRanking,
} from "@/components/ui/leaderboard-podium"
import {
  LeaderboardRankings,
  type LeaderboardRankingItem,
} from "@/components/ui/leaderboard-rankings"
import { type MorphOrigin } from "@/components/motion/MorphPanel"

interface LeaderboardRunOption {
  id: string
  label: string
}

interface LeaderboardCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  subtitle?: string
  fromDate?: string | Date
  toDate?: string | Date
  podiumRankings: LeaderboardPodiumRanking[]
  rankings: LeaderboardRankingItem[]
  currentUserId?: string
  runOptions?: LeaderboardRunOption[]
  selectedRunId?: string
  onRunChange?: (runId: string) => void
  onSelectUser?: (item: LeaderboardRankingItem, origin?: MorphOrigin) => void
}

function formatRangeDate(date: string | Date) {
  const parsed = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(parsed.getTime())) return ""

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

const LeaderboardCard = React.forwardRef<HTMLDivElement, LeaderboardCardProps>(
  (
    {
      className,
      title = "Leaderboard",
      subtitle,
      fromDate,
      toDate,
      podiumRankings,
      rankings,
      currentUserId,
      runOptions,
      selectedRunId,
      onRunChange,
      onSelectUser,
      ...props
    },
    ref
  ) => {
    const fromLabel = fromDate ? formatRangeDate(fromDate) : ""
    const toLabel = toDate ? formatRangeDate(toDate) : ""
    const rangeLabel = fromLabel && toLabel ? `${fromLabel} - ${toLabel}` : subtitle ?? ""
    const resolvedRunId = selectedRunId ?? runOptions?.[0]?.id ?? ""
    const hasOnRunChange = Boolean(onRunChange)
    const [localRunId, setLocalRunId] = React.useState(resolvedRunId)

    React.useEffect(() => {
      if (hasOnRunChange) return
      setLocalRunId(resolvedRunId)
    }, [hasOnRunChange, resolvedRunId])

    const activeRunId = hasOnRunChange ? resolvedRunId : localRunId

    return (
      <div
        ref={ref}
        className={cn("bg-card rounded-2xl border p-6 shadow-sm", className)}
        {...props}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-xl font-semibold">{title}</h3>
            {rangeLabel ? <p className="text-muted-foreground text-sm">{rangeLabel}</p> : null}
          </div>

          {runOptions && runOptions.length > 0 ? (
            <select
              aria-label="Select leaderboard run"
              value={activeRunId}
              onChange={(e) => {
                if (onRunChange) {
                  onRunChange(e.target.value)
                  return
                }
                setLocalRunId(e.target.value)
              }}
              className="bg-background text-foreground rounded-md border px-3 py-1.5 text-sm"
            >
              {runOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <LeaderboardPodium rankings={podiumRankings} className="mb-6" />

        <LeaderboardRankings
          rankings={rankings}
          currentUserId={currentUserId}
          onSelectUser={onSelectUser}
        />
      </div>
    )
  }
)

LeaderboardCard.displayName = "LeaderboardCard"

export { LeaderboardCard }
export type { LeaderboardCardProps, LeaderboardRunOption }

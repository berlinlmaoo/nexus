"use client"

import { SelectPicker } from "@/components/SelectPicker";
import * as React from "react"
import { motion } from "framer-motion"
import { ChevronLeft, ChevronRight, Crown } from "lucide-react"

import { cn } from "@/lib/utils"
import { type MorphOrigin } from "@/components/motion/MorphPanel"
import { AvatarFace } from "@/components/Avatar";
import { formatCount } from "@/lib/number-format"

export interface LeaderboardRankingItem {
  userId: string
  rank: number
  userName: string
  byline?: string
  value: number
  displayed?: boolean
  avatarUrl?: string | null
}


function formatValue(value: number) {
  // The full XP number, "1.100" in both languages (UI tour run 13) — no "k" abbreviation.
  return formatCount(value)
}

const CROWN_COLOR: Record<number, string> = {
  1: "text-amber-500",
  2: "text-slate-400",
  3: "text-orange-500",
}

interface LeaderboardRankingsProps extends React.HTMLAttributes<HTMLDivElement> {
  rankings: LeaderboardRankingItem[]
  currentUserId?: string
  showPagination?: boolean
  defaultPageSize?: number
  onSelectUser?: (item: LeaderboardRankingItem, origin?: MorphOrigin) => void
}

const PAGE_SIZES = [5, 10, 25, 50]

const LeaderboardRankings = React.forwardRef<HTMLDivElement, LeaderboardRankingsProps>(
  ({ rankings, currentUserId, showPagination = false, defaultPageSize = 10, onSelectUser, className, ...props }, ref) => {
    const visible = React.useMemo(() => rankings.filter((r) => r.displayed !== false), [rankings])
    const [pageSize, setPageSize] = React.useState(defaultPageSize)
    const [page, setPage] = React.useState(0)

    const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
    React.useEffect(() => { if (page > pageCount - 1) setPage(0) }, [page, pageCount])

    const rows = showPagination ? visible.slice(page * pageSize, page * pageSize + pageSize) : visible

    return (
      <div ref={ref} className={cn("space-y-3", className)} {...props}>
        <div className="overflow-hidden rounded-2xl border">
          <div className="divide-y">
            {rows.map((item) => {
              const isMe = currentUserId != null && item.userId === currentUserId
              return (
                <motion.button
                  layoutId={onSelectUser ? `xp-card-${item.userId}` : undefined}
                  type="button"
                  key={item.userId}
                  onClick={() => onSelectUser?.(item)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-3 text-left sm:px-4",
                    onSelectUser && "cursor-pointer hover:bg-muted/40",
                    isMe && "rounded-xl bg-muted/40 ring-2 ring-foreground/70 dark:bg-accent dark:ring-1 dark:ring-inset dark:ring-ring/60 dark:hover:bg-accent"
                  )}
                >
                  <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">{item.rank}</span>
                  <span className="grid w-5 shrink-0 place-items-center">
                    {item.rank <= 3 && <Crown className={cn("h-4 w-4", CROWN_COLOR[item.rank])} />}
                  </span>
                  <div className="shrink-0">
                    {/* Initials under the photo: a lazy photo far down the list (ranks 27+) is never an empty
                        circle while it loads (UI tour run 7). */}
                    <AvatarFace name={item.userName} avatar={item.avatarUrl} seed={item.userName || item.userId} size={40} decorative className="ring-0" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold leading-tight">{item.userName}</div>
                    {item.byline && <div className="truncate text-sm text-muted-foreground">{item.byline}</div>}
                  </div>
                  <span className="shrink-0 text-base font-bold tabular-nums">{formatValue(item.value)}</span>
                </motion.button>
              )
            })}
            {rows.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">No rankings yet.</div>}
          </div>
        </div>

        {showPagination && visible.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-1 text-sm">
            <label className="flex items-center gap-2 text-muted-foreground">
              Show
              <SelectPicker
                variant="field"
                size="sm"
                ariaLabel="Rows per page"
                value={String(pageSize)}
                onChange={(v) => { setPageSize(Number(v)); setPage(0) }}
                options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
                className="h-8 rounded-md px-2 text-sm text-foreground"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="grid h-8 w-8 place-items-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-muted-foreground">Page {page + 1} of {pageCount}</span>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="grid h-8 w-8 place-items-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }
)

LeaderboardRankings.displayName = "LeaderboardRankings"

export { LeaderboardRankings }

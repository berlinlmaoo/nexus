import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular"
}

export function Skeleton({ className, variant = "rectangular", ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "skeleton-shimmer",
        variant === "circular" && "rounded-full",
        variant === "text" && "h-4 rounded",
        className
      )}
      {...props}
    />
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border p-4 space-y-3", className)}>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="flex items-center gap-2 pt-2">
        <Skeleton variant="circular" className="h-6 w-6" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  )
}

export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
          <Skeleton variant="circular" className="h-8 w-8 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonKanban() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {Array.from({ length: 4 }).map((_, col) => (
        <div key={col} className="flex-shrink-0 w-72 space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Skeleton variant="circular" className="h-2.5 w-2.5" />
            <Skeleton className="h-4 w-20" />
            <div className="ml-auto">
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
          </div>
          <div className="space-y-2 p-2 rounded-lg bg-muted/30">
            {Array.from({ length: col === 0 ? 3 : col === 1 ? 2 : 1 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80 mt-2" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton variant="circular" className="h-8 w-8" />
            </div>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border p-5 space-y-4">
          <Skeleton className="h-5 w-24" />
          <SkeletonList rows={4} />
        </div>
        <div className="rounded-lg border p-5 space-y-4">
          <Skeleton className="h-5 w-32" />
          <SkeletonList rows={4} />
        </div>
      </div>
    </div>
  )
}

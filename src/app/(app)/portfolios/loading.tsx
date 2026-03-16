import { Skeleton, SkeletonCard } from "@/components/ui/skeleton"

export default function PortfoliosLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-28" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} className="h-36" />
        ))}
      </div>
    </div>
  )
}

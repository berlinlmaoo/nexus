import { Skeleton, SkeletonCard } from "@/components/ui/skeleton"

export default function ProjectsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} className="h-40" />
        ))}
      </div>
    </div>
  )
}

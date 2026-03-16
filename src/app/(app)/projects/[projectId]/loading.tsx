import { Skeleton, SkeletonKanban } from "@/components/ui/skeleton"

export default function ProjectDetailLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Cover */}
      <Skeleton className="h-32 w-full rounded-xl" />

      {/* Header */}
      <div className="flex items-center gap-4 -mt-8 ml-6">
        <Skeleton className="h-16 w-16 rounded-xl border-4 border-background" />
        <div className="space-y-2 pt-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20" />
        ))}
      </div>

      {/* Board */}
      <SkeletonKanban />
    </div>
  )
}

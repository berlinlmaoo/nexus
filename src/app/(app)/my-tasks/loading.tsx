import { Skeleton, SkeletonList } from "@/components/ui/skeleton"

export default function MyTasksLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>
      <SkeletonList rows={8} />
    </div>
  )
}

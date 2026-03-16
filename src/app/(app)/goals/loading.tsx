import { Skeleton, SkeletonList } from "@/components/ui/skeleton"

export default function GoalsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <SkeletonList rows={5} />
    </div>
  )
}

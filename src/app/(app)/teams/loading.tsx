import { Skeleton, SkeletonList } from "@/components/ui/skeleton"

export default function TeamsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-24" />
      <SkeletonList rows={5} />
    </div>
  )
}

import { Skeleton, SkeletonList } from "@/components/ui/skeleton"

export default function InboxLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-24" />
      <SkeletonList rows={6} />
    </div>
  )
}

import { Skeleton } from "@/components/ui/skeleton"

export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-28" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-5 space-y-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-40 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}

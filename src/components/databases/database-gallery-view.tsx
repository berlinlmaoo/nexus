"use client"

import { UserAvatar } from "@/components/ui/user-avatar"
import { cn } from "@/lib/utils"

interface GalleryItem {
  id: string
  title: string
  subtitle?: string
  coverColor?: string
  coverImage?: string
  properties: { label: string; value: string }[]
  assignees?: { id: string; name: string; avatar: string | null }[]
}

interface DatabaseGalleryViewProps {
  items: GalleryItem[]
  columns?: number
  className?: string
}

export function DatabaseGalleryView({
  items,
  columns = 3,
  className,
}: DatabaseGalleryViewProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">No items</p>
      </div>
    )
  }

  return (
    <div
      className={cn("grid gap-3 p-4", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-lg border bg-background overflow-hidden hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 cursor-pointer group"
        >
          {/* Cover */}
          <div
            className={cn(
              "h-24 bg-gradient-to-br flex items-end p-3",
              item.coverColor || "from-muted to-surface-container-lowest"
            )}
            style={item.coverImage ? { backgroundImage: `url(${item.coverImage})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
          >
            {item.assignees && item.assignees.length > 0 && (
              <div className="flex -space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {item.assignees.slice(0, 3).map((a) => (
                  <UserAvatar
                    key={a.id}
                    user={{ name: a.name, avatar: a.avatar }}
                    size="xs"
                    className="border border-white"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="p-3 space-y-1.5">
            <h4 className="text-sm font-medium line-clamp-2">{item.title}</h4>
            {item.subtitle && (
              <p className="text-xs text-muted-foreground">{item.subtitle}</p>
            )}
            {item.properties.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {item.properties.map((prop) => (
                  <span
                    key={prop.label}
                    className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {prop.value}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

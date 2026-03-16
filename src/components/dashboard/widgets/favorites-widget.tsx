"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  CheckSquare,
  Folder,
  FileText,
  Star,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface FavoriteItem {
  id: string
  name: string
  type: "task" | "project" | "doc"
  href: string
}

interface FavoritesDashWidgetProps {
  data?: any
}

const typeIcons: Record<FavoriteItem["type"], typeof CheckSquare> = {
  task: CheckSquare,
  project: Folder,
  doc: FileText,
}

export function FavoritesDashWidget({ data }: FavoritesDashWidgetProps) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchFavorites() {
      try {
        const res = await fetch("/api/favorites")
        if (!res.ok) throw new Error("Failed to fetch")
        const json = await res.json()
        if (!cancelled) {
          setFavorites(json.favorites ?? json.data ?? json ?? [])
        }
      } catch {
        if (!cancelled) setFavorites([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchFavorites()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-1.5">
        <Star className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-sm font-medium text-muted-foreground">Favorites</h3>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
        </div>
      ) : favorites.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground/60">
          No favorites yet. Star items to pin them here.
        </div>
      ) : (
        <div className="flex-1 min-h-0 space-y-1 overflow-y-auto">
          {favorites.map((item) => {
            const Icon = typeIcons[item.type] ?? FileText
            return (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span className="truncate text-muted-foreground">{item.name}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  CheckSquare,
  FolderKanban,
  Activity,
  Calendar,
  Zap,
  Users,
  BarChart3,
  StickyNote,
  Target,
  Star,
  Clock,
  TrendingUp,
  Search,
  Plus,
  Check,
} from "lucide-react"

const ICON_MAP: Record<string, React.ElementType> = {
  CheckSquare,
  FolderKanban,
  Activity,
  Calendar,
  Zap,
  Users,
  BarChart3,
  StickyNote,
  Target,
  Star,
  Clock,
  TrendingUp,
}

interface WidgetRegistryEntry {
  title: string
  icon: string
  description: string
  defaultW: number
  defaultH: number
  minW?: number
  minH?: number
}

interface AddWidgetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (type: string) => void
  registry: Record<string, WidgetRegistryEntry>
  activeTypes: Set<string>
}

export function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
  registry,
  activeTypes,
}: AddWidgetDialogProps) {
  const [search, setSearch] = useState("")

  const entries = Object.entries(registry).filter(([, entry]) =>
    entry.title.toLowerCase().includes(search.toLowerCase()) ||
    entry.description.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search widgets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto py-1">
          {entries.map(([type, entry]) => {
            const Icon = ICON_MAP[entry.icon] || CheckSquare
            const isActive = activeTypes.has(type)

            return (
              <button
                key={type}
                onClick={() => onAdd(type)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-all hover:shadow-md",
                  isActive && "border-border bg-zinc-50 dark:bg-zinc-900"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <div className="rounded-md bg-zinc-100 dark:bg-zinc-800 p-1.5">
                    <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                  </div>
                  <span className="text-sm font-medium flex-1">{entry.title}</span>
                  {isActive && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      <Check className="h-3 w-3 mr-0.5" />
                      Added
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {entry.description}
                </p>
              </button>
            )
          })}
        </div>

        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No widgets found matching &ldquo;{search}&rdquo;
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

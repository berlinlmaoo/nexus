"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ToggleBlockProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  onTitleChange?: (title: string) => void
  editable?: boolean
}

export function ToggleBlock({
  title,
  children,
  defaultOpen = false,
  onTitleChange,
  editable = false,
}: ToggleBlockProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="my-2 rounded-lg border bg-background">
      {/* Toggle header */}
      <button
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-muted/50 transition-colors rounded-t-lg"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
            open && "rotate-90"
          )}
        />
        {editable ? (
          <input
            className="flex-1 bg-transparent border-none outline-none text-sm font-medium"
            value={title}
            onChange={(e) => onTitleChange?.(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Toggle heading"
          />
        ) : (
          <span className="flex-1 text-sm font-medium">{title}</span>
        )}
      </button>

      {/* Collapsible content */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="px-3 pb-3 pl-9 border-t">
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </div>
  )
}

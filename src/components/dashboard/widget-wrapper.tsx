"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  GripVertical,
  X,
  ChevronDown,
  ChevronUp,
  Settings,
  Loader2,
} from "lucide-react"

interface WidgetWrapperProps {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  isEditing?: boolean
  onRemove?: () => void
  onSettings?: () => void
  loading?: boolean
  className?: string
  noPadding?: boolean
}

export function WidgetWrapper({
  title,
  icon,
  children,
  isEditing,
  onRemove,
  onSettings,
  loading,
  className,
  noPadding,
}: WidgetWrapperProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Card className={cn("flex flex-col h-full overflow-hidden shadow-none hover:shadow-sm border border-neutral-200 transition-shadow duration-150 rounded-xl", className)}>
      {/* Title bar */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-100 flex-shrink-0">
        {isEditing && (
          <div className="drag-handle cursor-grab active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-neutral-400" />
          </div>
        )}
        {icon && <span className="text-neutral-500">{icon}</span>}
        <h3 className="text-sm font-semibold text-neutral-800 flex-1 truncate">{title}</h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onSettings && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onSettings}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </Button>
          {isEditing && onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-red-500"
              onClick={onRemove}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className={cn("flex-1 overflow-auto", !noPadding && "p-5 pt-3")}>
          {loading ? (
            <div className="flex items-center justify-center h-full min-h-[100px]">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </Card>
  )
}

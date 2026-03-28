"use client"

import { type ReactNode } from "react"
import {
  CheckSquare,
  FolderOpen,
  Target,
  FileText,
  Users,
  Inbox,
  Search,
  Calendar,
  BarChart3,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
  compact?: boolean
  children?: ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-8 px-4" : "py-16 px-6",
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            "rounded-xl bg-muted/50 flex items-center justify-center mb-4",
            compact ? "h-10 w-10" : "h-14 w-14"
          )}
        >
          <Icon
            className={cn(
              "text-muted-foreground/60",
              compact ? "h-5 w-5" : "h-7 w-7"
            )}
          />
        </div>
      )}
      <h3
        className={cn(
          "font-medium text-foreground/80",
          compact ? "text-sm" : "text-base"
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            "text-muted-foreground mt-1 max-w-sm",
            compact ? "text-xs" : "text-sm"
          )}
        >
          {description}
        </p>
      )}
      {action && (
        <Button
          size={compact ? "sm" : "default"}
          className="mt-4"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
      {children}
    </div>
  )
}

// ── Preset empty states ─────────────────────────────────

export function EmptyTasks({
  onAdd,
  compact,
}: {
  onAdd?: () => void
  compact?: boolean
}) {
  return (
    <EmptyState
      icon={CheckSquare}
      title="No tasks yet"
      description="Tasks you create or get assigned to will show up here."
      action={onAdd ? { label: "Create a task", onClick: onAdd } : undefined}
      compact={compact}
    />
  )
}

export function EmptyProjects({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={FolderOpen}
      title="No projects yet"
      description="Create a project to start organizing your work."
      action={onAdd ? { label: "New Project", onClick: onAdd } : undefined}
    />
  )
}

export function EmptyGoals({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={Target}
      title="No goals set"
      description="Set goals to track progress across your projects."
      action={onAdd ? { label: "Create a goal", onClick: onAdd } : undefined}
    />
  )
}

export function EmptyDocs({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={FileText}
      title="No documents yet"
      description="Create docs to share knowledge with your team."
      action={onAdd ? { label: "New Document", onClick: onAdd } : undefined}
    />
  )
}

export function EmptyTeams({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={Users}
      title="No teams yet"
      description="Create teams to organize your workspace members."
      action={onAdd ? { label: "Create a team", onClick: onAdd } : undefined}
    />
  )
}

export function EmptyInbox() {
  return (
    <EmptyState
      icon={Inbox}
      title="You're all caught up"
      description="No new notifications. Nice work!"
    />
  )
}

export function EmptySearch({ query }: { query: string }) {
  return (
    <EmptyState
      icon={Search}
      title={`No results for "${query}"`}
      description="Try a different search term or check your filters."
    />
  )
}

export function EmptyCalendar() {
  return (
    <EmptyState
      icon={Calendar}
      title="No tasks scheduled"
      description="Tasks with due dates will appear on the calendar."
      compact
    />
  )
}

export function EmptyBoard() {
  return (
    <EmptyState
      icon={Zap}
      title="No tasks in this column"
      description="Drag tasks here or create a new one."
      compact
    />
  )
}

export function EmptyReports() {
  return (
    <EmptyState
      icon={BarChart3}
      title="No data to display"
      description="Reports will appear once your team starts tracking tasks."
    />
  )
}

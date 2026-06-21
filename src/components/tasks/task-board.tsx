'use client'

import { TaskCard, type TaskCardData } from './task-card'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TaskListColumn {
  id: string
  name: string
  tasks: TaskCardData[]
}

interface TaskBoardProps {
  columns: TaskListColumn[]
  onTaskClick: (task: TaskCardData) => void
  onAddTask: (taskListId: string) => void
}

const columnColors: Record<string, string> = {
  'To Do': 'border-t-on-surface-variant',
  'In Progress': 'border-t-blue-500',
  'In Review': 'border-t-foreground',
  Review: 'border-t-foreground',
  Done: 'border-t-green-500',
}

export function TaskBoard({ columns, onTaskClick, onAddTask }: TaskBoardProps) {
  return (
    <div className="mobile-horizontal-scroll flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div
          key={col.id}
          className={cn(
            'flex w-[min(82vw,300px)] min-w-[min(82vw,300px)] flex-col rounded-lg border border-t-4 bg-muted/30 sm:w-[300px] sm:min-w-[300px]',
            columnColors[col.name] || 'border-t-on-surface-variant'
          )}
        >
          {/* Column header */}
          <div className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{col.name}</h3>
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                {col.tasks.length}
              </span>
            </div>
            <button
              onClick={() => onAddTask(col.id)}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Tasks */}
          <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {col.tasks.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center">
                <p className="text-xs text-muted-foreground">No tasks</p>
              </div>
            )}
            {col.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

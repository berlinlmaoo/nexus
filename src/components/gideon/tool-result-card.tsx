'use client'

import {
  CheckCircle,
  ListTodo,
  FolderKanban,
  UserPlus,
  ArrowRightLeft,
} from 'lucide-react'

interface ToolResultCardProps {
  tool: string
  result: unknown
}

function getToolConfig(tool: string) {
  switch (tool) {
    case 'create_task':
      return {
        icon: CheckCircle,
        label: 'Task Created',
        color: 'border-green-500/50 bg-green-500/10',
        iconColor: 'text-green-400',
      }
    case 'update_task_status':
      return {
        icon: ArrowRightLeft,
        label: 'Status Updated',
        color: 'border-blue-500/50 bg-blue-500/10',
        iconColor: 'text-blue-400',
      }
    case 'assign_task':
      return {
        icon: UserPlus,
        label: 'Task Assigned',
        color: 'border-amber-500/50 bg-amber-500/10',
        iconColor: 'text-amber-400',
      }
    case 'list_tasks':
      return {
        icon: ListTodo,
        label: 'Tasks',
        color: 'border-zinc-700/50 bg-zinc-700/10',
        iconColor: 'text-zinc-400',
      }
    case 'list_projects':
      return {
        icon: FolderKanban,
        label: 'Projects',
        color: 'border-cyan-500/50 bg-cyan-500/10',
        iconColor: 'text-cyan-400',
      }
    default:
      return {
        icon: CheckCircle,
        label: 'Result',
        color: 'border-gray-500/50 bg-gray-500/10',
        iconColor: 'text-gray-400',
      }
  }
}

function renderResult(tool: string, result: unknown) {
  const data = (result || {}) as Record<string, unknown>

  if (tool === 'create_task') {
    return (
      <div className="space-y-0.5">
        <p className="font-medium text-white">{data.title as string}</p>
        <p className="text-xs text-gray-400">
          {data.priority as string} &middot; {data.status as string}
          {data.taskList ? ` · ${String(data.taskList)}` : null}
        </p>
        {Array.isArray(data.assignees) && data.assignees.length > 0 && (
          <p className="text-xs text-gray-400">
            Assigned to: {(data.assignees as string[]).join(', ')}
          </p>
        )}
      </div>
    )
  }

  if (tool === 'update_task_status') {
    return (
      <div>
        <p className="font-medium text-white">{data.title as string}</p>
        <p className="text-xs text-gray-400">New status: {data.status as string}</p>
      </div>
    )
  }

  if (tool === 'assign_task') {
    return (
      <div>
        <p className="font-medium text-white">{data.title as string}</p>
        {Array.isArray(data.assignees) && (
          <p className="text-xs text-gray-400">
            Assigned to: {(data.assignees as string[]).join(', ')}
          </p>
        )}
      </div>
    )
  }

  if (tool === 'list_tasks' || tool === 'list_projects') {
    const items = Array.isArray(data) ? data : (Array.isArray(result) ? result : [])
    if (items.length === 0) {
      return <p className="text-xs text-gray-400">No items found.</p>
    }
    return (
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {(items as Record<string, unknown>[]).map((item, i) => (
          <div key={i} className="rounded bg-black/20 px-2 py-1">
            <p className="text-xs font-medium text-white">{String(item.title || item.name || '')}</p>
            <p className="text-[10px] text-gray-400">
              {item.status ? String(item.status) : null}
              {item.priority ? ` · ${String(item.priority)}` : null}
              {item.project ? ` · ${String(item.project)}` : null}
              {item.members ? ` · ${(item.members as string[]).length} members` : null}
            </p>
          </div>
        ))}
      </div>
    )
  }

  return <pre className="text-xs text-gray-300">{JSON.stringify(result, null, 2)}</pre>
}

export function ToolResultCard({ tool, result }: ToolResultCardProps) {
  const config = getToolConfig(tool)
  const Icon = config.icon

  return (
    <div className={`rounded-lg border p-2.5 ${config.color}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${config.iconColor}`} />
        <span className={`text-xs font-semibold ${config.iconColor}`}>{config.label}</span>
      </div>
      {renderResult(tool, result)}
    </div>
  )
}

'use client'

import { TaskListView } from './task-list-view'
import type { TaskCardData } from './task-card'

interface TaskListSection {
  id: string
  name: string
  tasks: TaskCardData[]
}

interface TaskListProps {
  sections: TaskListSection[]
  onTaskClick: (task: TaskCardData) => void
  onAddTask: (taskListId: string) => void
}

export function TaskList({ sections, onTaskClick, onAddTask }: TaskListProps) {
  const handleToggleStatus = async (taskId: string, done: boolean) => {
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: done ? 'DONE' : 'TODO' }),
      })
    } catch (error) {
      console.error('Failed to update task:', error)
    }
  }

  return (
    <TaskListView
      sections={sections}
      onTaskClick={onTaskClick}
      onToggleStatus={handleToggleStatus}
      onAddTask={onAddTask}
    />
  )
}

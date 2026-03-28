"use client"

import { useState, useCallback } from "react"
import { toastSuccess, toastError } from "@/lib/toast"
import type { TaskCardData } from "@/components/tasks/task-card"

type TaskSection = {
  id: string
  name: string
  tasks: TaskCardData[]
}

/**
 * Hook for optimistic task mutations.
 * Updates the UI immediately, then syncs with the server.
 * On failure, reverts to the previous state and shows an error toast.
 */
export function useOptimisticTasks(initialSections: TaskSection[]) {
  const [sections, setSections] = useState(initialSections)

  // Sync from props when they change
  const syncFromProps = useCallback((newSections: TaskSection[]) => {
    setSections(newSections)
  }, [])

  const toggleStatus = useCallback(
    async (taskId: string, done: boolean) => {
      // Snapshot for rollback
      const prev = sections

      // Optimistic update
      setSections((s) =>
        s.map((sec) => ({
          ...sec,
          tasks: sec.tasks.map((t) =>
            t.id === taskId ? { ...t, status: done ? "DONE" : "TODO" } : t
          ),
        }))
      )

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: done ? "DONE" : "TODO" }),
        })
        if (!res.ok) throw new Error("Failed to update task")
        if (done) toastSuccess("Task completed")
      } catch {
        setSections(prev)
        toastError("Failed to update task status")
      }
    },
    [sections]
  )

  const deleteTask = useCallback(
    async (taskId: string) => {
      const prev = sections

      // Optimistic remove
      setSections((s) =>
        s.map((sec) => ({
          ...sec,
          tasks: sec.tasks.filter((t) => t.id !== taskId),
        }))
      )

      toastSuccess("Task deleted")

      try {
        const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" })
        if (!res.ok) throw new Error("Failed to delete task")
      } catch {
        setSections(prev)
        toastError("Failed to delete task — restored")
      }
    },
    [sections]
  )

  const updateTask = useCallback(
    async (taskId: string, updates: Partial<TaskCardData>) => {
      const prev = sections

      // Optimistic update
      setSections((s) =>
        s.map((sec) => ({
          ...sec,
          tasks: sec.tasks.map((t) =>
            t.id === taskId ? { ...t, ...updates } : t
          ),
        }))
      )

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        })
        if (!res.ok) throw new Error("Failed to update task")
      } catch {
        setSections(prev)
        toastError("Failed to update task — reverted")
      }
    },
    [sections]
  )

  const addTask = useCallback(
    async (sectionId: string, title: string, projectId: string) => {
      const tempId = `temp-${Date.now()}`
      const tempTask: TaskCardData = {
        id: tempId,
        title,
        status: "TODO",
        priority: "MEDIUM",
        position: 0,
        tags: [],
        assignees: [],
        taskListId: sectionId,
        dueDate: null,
        description: null,
      }

      // Optimistic add
      setSections((s) =>
        s.map((sec) =>
          sec.id === sectionId
            ? { ...sec, tasks: [...sec.tasks, tempTask] }
            : sec
        )
      )

      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, taskListId: sectionId, projectId }),
        })
        if (!res.ok) throw new Error("Failed to create task")
        const created = await res.json()

        // Replace temp with real task
        setSections((s) =>
          s.map((sec) => ({
            ...sec,
            tasks: sec.tasks.map((t) => (t.id === tempId ? { ...t, ...created, id: created.id } : t)),
          }))
        )
        toastSuccess("Task created")
      } catch {
        // Remove temp task
        setSections((s) =>
          s.map((sec) => ({
            ...sec,
            tasks: sec.tasks.filter((t) => t.id !== tempId),
          }))
        )
        toastError("Failed to create task")
      }
    },
    []
  )

  return {
    sections,
    syncFromProps,
    toggleStatus,
    deleteTask,
    updateTask,
    addTask,
  }
}

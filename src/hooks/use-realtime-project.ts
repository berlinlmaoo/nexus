"use client"

import { useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSocket } from "./use-socket"

interface UseRealtimeProjectOptions {
  projectId: string
  userId: string
  userName: string
  userAvatar?: string | null
  enabled?: boolean
  /** Called when any task event fires. Use to optimistically update local state. */
  onTaskCreated?: (task: Record<string, unknown>) => void
  onTaskUpdated?: (task: Record<string, unknown>) => void
  onTaskDeleted?: (data: { taskId: string }) => void
  onCommentAdded?: (data: { taskId: string; comment: Record<string, unknown> }) => void
}

/**
 * Subscribes to real-time project events via Socket.IO.
 * Joins the `project:{projectId}` room and listens for
 * task-created, task-updated, task-deleted, and comment-added events.
 * Falls back to router.refresh() when no specific handler is provided.
 */
export function useRealtimeProject({
  projectId,
  userId,
  userName,
  userAvatar,
  enabled = true,
  onTaskCreated,
  onTaskUpdated,
  onTaskDeleted,
  onCommentAdded,
}: UseRealtimeProjectOptions) {
  const { on, connected } = useSocket({
    room: `project:${projectId}`,
    userId,
    userName,
    userAvatar,
    enabled,
  })

  const router = useRouter()

  const refresh = useCallback(() => {
    router.refresh()
  }, [router])

  useEffect(() => {
    if (!connected || !enabled) return

    const unsubs: (() => void)[] = []

    unsubs.push(
      on("task-created", (task: unknown) => {
        if (onTaskCreated) {
          onTaskCreated(task as Record<string, unknown>)
        } else {
          refresh()
        }
      })
    )

    unsubs.push(
      on("task-updated", (task: unknown) => {
        if (onTaskUpdated) {
          onTaskUpdated(task as Record<string, unknown>)
        } else {
          refresh()
        }
      })
    )

    unsubs.push(
      on("task-deleted", (data: unknown) => {
        if (onTaskDeleted) {
          onTaskDeleted(data as { taskId: string })
        } else {
          refresh()
        }
      })
    )

    unsubs.push(
      on("comment-added", (data: unknown) => {
        if (onCommentAdded) {
          onCommentAdded(data as { taskId: string; comment: Record<string, unknown> })
        } else {
          refresh()
        }
      })
    )

    return () => {
      unsubs.forEach((unsub) => unsub())
    }
  }, [connected, enabled, on, onTaskCreated, onTaskUpdated, onTaskDeleted, onCommentAdded, refresh])

  return { connected }
}

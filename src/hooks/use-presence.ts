"use client"

import { useState, useEffect } from "react"
import { useSocket } from "./use-socket"

export interface PresenceUser {
  userId: string
  name: string
  avatar: string | null
  color: string
  lastSeen: number
}

interface UsePresenceOptions {
  room: string
  userId: string
  userName: string
  userAvatar?: string | null
  enabled?: boolean
}

export function usePresence({
  room,
  userId,
  userName,
  userAvatar,
  enabled = true,
}: UsePresenceOptions) {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([])
  const { connected, emit, on } = useSocket({
    room,
    userId,
    userName,
    userAvatar,
    enabled,
  })

  useEffect(() => {
    if (!connected || !enabled) return

    const cleanupUpdate = on("presence-update", (users: unknown) => {
      setOnlineUsers(users as PresenceUser[])
    })

    const cleanupJoin = on("presence-join", (user: unknown) => {
      setOnlineUsers((prev) => {
        const u = user as PresenceUser
        if (prev.some((p) => p.userId === u.userId)) return prev
        return [...prev, u]
      })
    })

    const cleanupLeave = on("presence-leave", (data: unknown) => {
      const d = data as { userId: string }
      setOnlineUsers((prev) => prev.filter((p) => p.userId !== d.userId))
    })

    return () => {
      cleanupUpdate()
      cleanupJoin()
      cleanupLeave()
    }
  }, [connected, enabled, on])

  // Filter out current user from online users list
  const otherUsers = onlineUsers.filter((u) => u.userId !== userId)

  return {
    onlineUsers,
    otherUsers,
    connected,
    emit,
    on,
    totalOnline: onlineUsers.length,
  }
}

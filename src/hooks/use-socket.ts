"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"

interface UseSocketOptions {
  room: string
  userId: string
  userName: string
  userAvatar?: string | null
  enabled?: boolean
}

export function useSocket({
  room,
  userId,
  userName,
  userAvatar,
  enabled = true,
}: UseSocketOptions) {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!enabled || !room || !userId) return

    // Initialize socket connection
    const initSocket = async () => {
      // Ping the pages API route to ensure the server is initialized
      await fetch("/api/socket")

      const socket = io({
        path: "/api/socket",
        transports: ["polling", "websocket"],
      })

      socketRef.current = socket

      socket.on("connect", () => {
        setConnected(true)
        socket.emit("join-room", {
          room,
          userId,
          name: userName,
          avatar: userAvatar,
        })
      })

      socket.on("disconnect", () => {
        setConnected(false)
      })

      socket.on("connect_error", () => {
        setConnected(false)
      })
    }

    initSocket()

    // Heartbeat
    const heartbeat = setInterval(() => {
      socketRef.current?.emit("heartbeat")
    }, 30000)

    return () => {
      clearInterval(heartbeat)
      if (socketRef.current) {
        socketRef.current.emit("leave-room", room)
        socketRef.current.disconnect()
        socketRef.current = null
      }
      setConnected(false)
    }
  }, [room, userId, userName, userAvatar, enabled])

  const emit = useCallback(
    (event: string, data: unknown) => {
      socketRef.current?.emit(event, data)
    },
    []
  )

  const on = useCallback(
    (event: string, handler: (...args: unknown[]) => void) => {
      socketRef.current?.on(event, handler)
      return () => {
        socketRef.current?.off(event, handler)
      }
    },
    []
  )

  const off = useCallback(
    (event: string, handler?: (...args: unknown[]) => void) => {
      if (handler) {
        socketRef.current?.off(event, handler)
      } else {
        socketRef.current?.removeAllListeners(event)
      }
    },
    []
  )

  return { socket: socketRef, connected, emit, on, off }
}

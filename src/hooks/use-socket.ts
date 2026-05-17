"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"

type SocketTransport = "polling" | "websocket"

interface UseSocketOptions {
  room: string
  userId: string
  userName: string
  userAvatar?: string | null
  enabled?: boolean
}

let socketServerReadyPromise: Promise<void> | null = null

function getSocketTransports(): SocketTransport[] {
  const configuredTransports = process.env.NEXT_PUBLIC_SOCKET_TRANSPORTS?.split(",")
    .map((transport) => transport.trim())
    .filter((transport): transport is SocketTransport =>
      transport === "polling" || transport === "websocket"
    )

  if (configuredTransports?.length) {
    return configuredTransports
  }

  // Cloudflare Tunnel can surface noisy browser warnings when a page closes
  // while Socket.IO is upgrading from polling to websocket. Polling keeps
  // realtime features reliable in production; dev still tests both paths.
  return process.env.NODE_ENV === "production"
    ? ["polling"]
    : ["polling", "websocket"]
}

async function ensureSocketServer() {
  if (!socketServerReadyPromise) {
    socketServerReadyPromise = fetch("/api/socket")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to initialize socket server")
        }
      })
      .catch((error) => {
        socketServerReadyPromise = null
        throw error
      })
  }

  return socketServerReadyPromise
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

    let cancelled = false

    // Initialize socket connection
    const initSocket = async () => {
      try {
        await ensureSocketServer()

        if (cancelled) return

        const transports = getSocketTransports()
        const canUpgradeToWebSocket =
          transports.includes("polling") && transports.includes("websocket")

        const socket = io({
          path: "/api/socket",
          transports,
          upgrade: canUpgradeToWebSocket,
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
      } catch {
        setConnected(false)
      }
    }

    initSocket()

    // Heartbeat
    const heartbeat = setInterval(() => {
      socketRef.current?.emit("heartbeat")
    }, 30000)

    return () => {
      cancelled = true
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

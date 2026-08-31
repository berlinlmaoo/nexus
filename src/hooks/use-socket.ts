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

// One connection shared by every hook instance. That sharing is not a choice: socket.io-client
// multiplexes, so io() with the same path hands back the SAME Socket object rather than opening a
// second one. The old code treated the object as private, which broke realtime two ways, both of
// which looked to a user like "it just stopped updating":
//
//   * the first consumer to unmount called disconnect() on the shared object and cut realtime for
//     every other consumer still on screen — leaving a conversation left the notification bell
//     deaf until a full page reload;
//   * a consumer mounting second attached its "connect" handler to a socket that had ALREADY
//     connected, so the event never arrived, `connected` stayed false, and it neither joined its
//     room nor subscribed to anything.
//
// The refcount below fixes the first; running the connect handler eagerly when the socket is
// already up fixes the second.
let sharedSocket: Socket | null = null
let sharedRefCount = 0

function acquireSocket(transports: SocketTransport[], upgrade: boolean): Socket {
  if (!sharedSocket) {
    sharedSocket = io({ path: "/api/socket", transports, upgrade })
  } else if (sharedSocket.disconnected) {
    // The client library keeps its own cache, so a released socket comes back as the same dormant
    // object rather than a fresh connection. Wake it rather than trusting io() to.
    sharedSocket.connect()
  }
  sharedRefCount += 1
  return sharedSocket
}

function releaseSocket() {
  sharedRefCount = Math.max(0, sharedRefCount - 1)
  if (sharedRefCount === 0) sharedSocket?.disconnect()
}

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
    socketServerReadyPromise = fetch("/api/realtime-init")
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
    let detach: (() => void) | null = null

    // Initialize socket connection
    const initSocket = async () => {
      try {
        await ensureSocketServer()

        if (cancelled) return

        const transports = getSocketTransports()
        const canUpgradeToWebSocket =
          transports.includes("polling") && transports.includes("websocket")

        const socket = acquireSocket(transports, canUpgradeToWebSocket)
        socketRef.current = socket

        const handleConnect = () => {
          setConnected(true)
          socket.emit("join-room", {
            room,
            userId,
            name: userName,
            avatar: userAvatar,
          })
        }
        const handleDisconnect = () => setConnected(false)
        const handleConnectError = () => setConnected(false)

        socket.on("connect", handleConnect)
        socket.on("disconnect", handleDisconnect)
        socket.on("connect_error", handleConnectError)

        // Already up, so no "connect" event is coming for this instance.
        if (socket.connected) handleConnect()

        detach = () => {
          socket.off("connect", handleConnect)
          socket.off("disconnect", handleDisconnect)
          socket.off("connect_error", handleConnectError)
          if (socket.connected) socket.emit("leave-room", room)
          releaseSocket()
        }
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
      detach?.()
      detach = null
      socketRef.current = null
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

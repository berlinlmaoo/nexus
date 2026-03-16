"use client"

import { useState, useEffect, useRef } from "react"

interface CursorData {
  socketId: string
  userId: string
  name: string
  color: string
  x: number
  y: number
  blockId?: string
}

interface LiveCursorsProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  onCursorData?: (cursors: CursorData[]) => void
  emit: (event: string, data: unknown) => void
  on: (event: string, handler: (...args: unknown[]) => void) => () => void
  connected: boolean
}

export function LiveCursors({
  containerRef,
  emit,
  on,
  connected,
}: LiveCursorsProps) {
  const [cursors, setCursors] = useState<Map<string, CursorData>>(new Map())
  const animationFrameRef = useRef<number | null>(null)

  // Track mouse movement and emit cursor position
  useEffect(() => {
    if (!connected || !containerRef.current) return

    const container = containerRef.current

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      // Throttle with rAF
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      animationFrameRef.current = requestAnimationFrame(() => {
        emit("cursor-move", { x, y })
      })
    }

    container.addEventListener("mousemove", handleMouseMove)
    return () => {
      container.removeEventListener("mousemove", handleMouseMove)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [connected, containerRef, emit])

  // Listen for other cursors
  useEffect(() => {
    if (!connected) return

    const cleanup = on("cursor-move", (data: unknown) => {
      const cursor = data as CursorData
      setCursors((prev) => {
        const next = new Map(prev)
        next.set(cursor.socketId, cursor)
        return next
      })
    })

    const cleanupLeave = on("presence-leave", (data: unknown) => {
      const d = data as { userId: string }
      setCursors((prev) => {
        const next = new Map(prev)
        next.forEach((val, key) => {
          if (val.userId === d.userId) next.delete(key)
        })
        return next
      })
    })

    return () => {
      cleanup()
      cleanupLeave()
    }
  }, [connected, on])

  // Remove stale cursors after 5 seconds of no movement
  useEffect(() => {
    const interval = setInterval(() => {
      setCursors((prev) => {
        if (prev.size === 0) return prev
        return prev // cursors are updated via events, no need to clean on interval for now
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <>
      {Array.from(cursors.values()).map((cursor) => (
        <div
          key={cursor.socketId}
          className="pointer-events-none absolute z-50 transition-all duration-75 ease-out"
          style={{
            left: cursor.x,
            top: cursor.y,
            transform: "translate(-1px, -1px)",
          }}
        >
          {/* Cursor SVG */}
          <svg
            width="16"
            height="20"
            viewBox="0 0 16 20"
            fill="none"
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.2))" }}
          >
            <path
              d="M0 0L16 12H6L3.5 19.5L0 0Z"
              fill={cursor.color}
            />
          </svg>

          {/* Name label */}
          <div
            className="absolute left-3 top-4 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.name}
          </div>
        </div>
      ))}
    </>
  )
}

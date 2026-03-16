"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Play, Square, Clock } from "lucide-react"

interface TimeTrackerProps {
  taskId: string
}

export function TimeTracker({ taskId }: TimeTrackerProps) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [entryId, setEntryId] = useState<string | null>(null)
  const [totalTime, setTotalTime] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    fetch(`/api/time-entries?taskId=${taskId}`)
      .then(r => r.json())
      .then(data => {
        const total = (data.entries || []).reduce((sum: number, e: any) => sum + (e.duration || 0), 0)
        setTotalTime(total)
      })
      .catch(() => {})
  }, [taskId])

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed(p => p + 1), 1000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running])

  const start = async () => {
    const res = await fetch("/api/time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, startTime: new Date().toISOString() }),
    })
    if (res.ok) {
      const data = await res.json()
      setEntryId(data.entry.id)
      setElapsed(0)
      setRunning(true)
    }
  }

  const stop = async () => {
    if (!entryId) return
    setRunning(false)
    const duration = elapsed
    await fetch("/api/time-entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId, endTime: new Date().toISOString(), duration }),
    })
    setTotalTime(prev => prev + duration)
    setEntryId(null)
    setElapsed(0)
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  const formatTotal = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  return (
    <div className="flex items-center gap-2">
      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{formatTotal(totalTime)}</span>
      {running ? (
        <>
          <span className="text-xs font-mono text-zinc-800">{formatTime(elapsed)}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={stop}>
            <Square className="h-3 w-3" />
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600" onClick={start}>
          <Play className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}

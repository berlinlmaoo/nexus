"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { StickyNote } from "lucide-react"

const STORAGE_KEY = "nexus-dashboard-notes"

interface NotesDashWidgetProps {
  data?: any
}

export function NotesDashWidget({ data }: NotesDashWidgetProps) {
  const [notes, setNotes] = useState("")
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setNotes(stored)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const saveNotes = useCallback((value: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, value)
      setSaved(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSaved(false), 1500)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setNotes(value)
    saveNotes(value)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">Quick Notes</h3>
        </div>
        {saved && (
          <span className="text-[10px] text-muted-foreground/60 transition-opacity">
            Saved
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={handleChange}
        placeholder="Write your notes here..."
        className="flex-1 min-h-0 w-full resize-none rounded-md border border-border bg-muted/50 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
      />
    </div>
  )
}

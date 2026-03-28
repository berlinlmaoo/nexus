"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"

interface InlineEditProps {
  value: string
  onSave: (value: string) => void
  className?: string
  inputClassName?: string
  placeholder?: string
}

/**
 * Click-to-edit text field.
 * Shows plain text by default, switches to input on click.
 * Saves on Enter or blur, cancels on Escape.
 */
export function InlineEdit({
  value,
  onSave,
  className,
  inputClassName,
  placeholder = "Untitled",
}: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const save = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    } else {
      setDraft(value)
    }
    setEditing(false)
  }, [draft, value, onSave])

  const cancel = useCallback(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  if (!editing) {
    return (
      <span
        onClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
        className={cn(
          "cursor-text hover:bg-muted/50 rounded px-1 -mx-1 transition-colors truncate",
          !value && "text-muted-foreground italic",
          className
        )}
        title="Click to edit"
      >
        {value || placeholder}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save()
        if (e.key === "Escape") cancel()
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "bg-transparent border border-ring rounded px-1 -mx-1 outline-none text-foreground w-full",
        inputClassName
      )}
      placeholder={placeholder}
    />
  )
}

interface InlineSelectProps<T extends string> {
  value: T
  options: { value: T; label: string; color?: string }[]
  onSave: (value: T) => void
  className?: string
}

/**
 * Click-to-edit dropdown select.
 * Shows current value as text, opens dropdown on click.
 */
export function InlineSelect<T extends string>({
  value,
  options,
  onSave,
  className,
}: InlineSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const current = options.find((o) => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        className={cn(
          "text-xs px-1.5 py-0.5 rounded hover:bg-muted/50 transition-colors truncate",
          current?.color,
          className
        )}
      >
        {current?.label || value}
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-popover border rounded-md shadow-lg py-1 min-w-[120px]">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={(e) => {
                e.stopPropagation()
                onSave(opt.value)
                setOpen(false)
              }}
              className={cn(
                "w-full text-left text-xs px-3 py-1.5 hover:bg-muted/50 transition-colors flex items-center gap-2",
                opt.value === value && "bg-muted/30 font-medium"
              )}
            >
              {opt.color && (
                <span className={cn("h-2 w-2 rounded-full", opt.color)} />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

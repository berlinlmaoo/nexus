"use client"

import { useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
} from "lucide-react"

interface InlineToolbarProps {
  position: { top: number; left: number }
  onClose: () => void
}

export function InlineToolbar({ position, onClose }: InlineToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        // Don't close immediately — let selection events handle it
      }
    }
    document.addEventListener("mousedown", handleMouseDown)
    return () => document.removeEventListener("mousedown", handleMouseDown)
  }, [onClose])

  const exec = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value)
  }, [])

  const handleLink = useCallback(() => {
    const url = prompt("Enter URL:")
    if (url) {
      exec("createLink", url)
    }
  }, [exec])

  const isActive = (command: string) => {
    try {
      return document.queryCommandState(command)
    } catch {
      return false
    }
  }

  const buttons = [
    { command: "bold", icon: Bold, label: "Bold" },
    { command: "italic", icon: Italic, label: "Italic" },
    { command: "underline", icon: Underline, label: "Underline" },
    { command: "strikeThrough", icon: Strikethrough, label: "Strikethrough" },
    { command: "code", icon: Code, label: "Inline code", custom: true },
  ]

  const handleCodeToggle = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return

    const range = sel.getRangeAt(0)
    const selectedText = range.toString()

    // Check if already wrapped in <code>
    const parentCode = sel.anchorNode?.parentElement?.closest("code")
    if (parentCode) {
      // Unwrap
      const text = document.createTextNode(parentCode.textContent || "")
      parentCode.parentNode?.replaceChild(text, parentCode)
    } else {
      // Wrap in <code>
      const code = document.createElement("code")
      code.className = "px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[0.9em]"
      range.surroundContents(code)
    }
  }, [])

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[110] flex items-center gap-0.5 bg-foreground rounded-lg px-1 py-1 shadow-xl animate-in fade-in zoom-in-95 duration-100"
      style={{
        top: position.top,
        left: position.left,
        transform: "translateX(-50%)",
      }}
    >
      {buttons.map((btn) => {
        const Icon = btn.icon
        return (
          <button
            key={btn.command}
            onMouseDown={(e) => {
              e.preventDefault() // Prevent losing selection
              if (btn.custom) {
                handleCodeToggle()
              } else {
                exec(btn.command)
              }
            }}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              isActive(btn.command)
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            title={btn.label}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        )
      })}
      <div className="w-px h-4 bg-foreground mx-0.5" />
      <button
        onMouseDown={(e) => {
          e.preventDefault()
          handleLink()
        }}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Link"
      >
        <Link className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

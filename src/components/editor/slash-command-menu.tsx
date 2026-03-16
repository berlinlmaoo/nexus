"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { SLASH_COMMANDS, type BlockType, type SlashCommandItem } from "./types"
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  CheckSquare,
  List,
  ListOrdered,
  Image,
  Globe,
  Minus,
  Code,
  Quote,
  MessageSquare,
  ChevronRight,
  Table,
  HardDrive,
} from "lucide-react"

const ICON_MAP: Record<string, React.ReactNode> = {
  type: <Type className="h-4 w-4" />,
  heading1: <Heading1 className="h-4 w-4" />,
  heading2: <Heading2 className="h-4 w-4" />,
  heading3: <Heading3 className="h-4 w-4" />,
  todo: <CheckSquare className="h-4 w-4" />,
  bullet: <List className="h-4 w-4" />,
  numbered: <ListOrdered className="h-4 w-4" />,
  image: <Image className="h-4 w-4" />,
  embed: <Globe className="h-4 w-4" />,
  divider: <Minus className="h-4 w-4" />,
  code: <Code className="h-4 w-4" />,
  quote: <Quote className="h-4 w-4" />,
  callout: <MessageSquare className="h-4 w-4" />,
  toggle: <ChevronRight className="h-4 w-4" />,
  table: <Table className="h-4 w-4" />,
  nas: <HardDrive className="h-4 w-4" />,
}

interface SlashCommandMenuProps {
  position: { top: number; left: number }
  onSelect: (type: BlockType) => void
  onClose: () => void
}

export function SlashCommandMenu({ position, onSelect, onClose }: SlashCommandMenuProps) {
  const [search, setSearch] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(search.toLowerCase()) ||
      cmd.description.toLowerCase().includes(search.toLowerCase())
  )

  const grouped = {
    Basic: filtered.filter((c) => c.category === "Basic"),
    Media: filtered.filter((c) => c.category === "Media"),
    Advanced: filtered.filter((c) => c.category === "Advanced"),
  }

  const flatList = [...grouped.Basic, ...grouped.Media, ...grouped.Advanced]

  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % flatList.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + flatList.length) % flatList.length)
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (flatList[selectedIndex]) {
          onSelect(flatList[selectedIndex].type)
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    },
    [flatList, selectedIndex, onSelect, onClose]
  )

  // Scroll selected item into view
  useEffect(() => {
    const el = menuRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  const renderCategory = (name: string, items: SlashCommandItem[], startIndex: number) => {
    if (items.length === 0) return null
    return (
      <div key={name}>
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {name}
        </div>
        {items.map((item, i) => {
          const globalIndex = startIndex + i
          return (
            <button
              key={item.type}
              data-index={globalIndex}
              onClick={() => onSelect(item.type)}
              onMouseEnter={() => setSelectedIndex(globalIndex)}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-2 text-left transition-colors",
                globalIndex === selectedIndex
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              <div className="flex items-center justify-center h-8 w-8 rounded-md border border-border bg-background">
                {ICON_MAP[item.icon]}
              </div>
              <div>
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground/60">{item.description}</div>
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  let runningIndex = 0

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] w-72 bg-background rounded-lg border border-border shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
      style={{ top: position.top, left: position.left }}
      onKeyDown={handleKeyDown}
    >
      <div className="border-b border-border/50 px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter..."
          className="w-full text-sm outline-none bg-transparent placeholder:text-muted-foreground/60"
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="max-h-[320px] overflow-y-auto py-1">
        {flatList.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground/60">No results</div>
        ) : (
          (["Basic", "Media", "Advanced"] as const).map((cat) => {
            const items = grouped[cat]
            const startIdx = runningIndex
            runningIndex += items.length
            return renderCategory(cat, items, startIdx)
          })
        )}
      </div>
    </div>
  )
}

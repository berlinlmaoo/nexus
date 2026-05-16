"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Bookmark,
  ChevronDown,
  X,
  Plus,
  Share2,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface SavedFilter {
  id: string
  name: string
  projectId: string
  filters: {
    status: string
    priority: string
    assignee: string
    sort: string
    group: string
    search: string
    customFields?: Record<string, string>
  }
}

interface SavedFiltersProps {
  projectId: string
  currentFilters: {
    status: string
    priority: string
    assignee: string
    sort: string
    group: string
    search: string
    customFields?: Record<string, string>
  }
  onApply: (filters: SavedFilter["filters"]) => void
}

const STORAGE_KEY = "nexus-saved-filters"

function loadFilters(projectId: string): SavedFilter[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const all: SavedFilter[] = JSON.parse(raw)
    return all.filter((f) => f.projectId === projectId)
  } catch {
    return []
  }
}

function saveAllFilters(filters: SavedFilter[]) {
  if (typeof window === "undefined") return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const existing: SavedFilter[] = raw ? JSON.parse(raw) : []
    const projectIds = new Set(filters.map((f) => f.projectId))
    const others = existing.filter((f) => !projectIds.has(f.projectId))
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...others, ...filters]))
  } catch {
    // Silently fail on storage errors
  }
}

function removeFilter(id: string) {
  if (typeof window === "undefined") return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const all: SavedFilter[] = JSON.parse(raw)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(all.filter((f) => f.id !== id))
    )
  } catch {
    // Silently fail
  }
}

export function SavedFilters({
  projectId,
  currentFilters,
  onApply,
}: SavedFiltersProps) {
  const [open, setOpen] = useState(false)
  const [filters, setFilters] = useState<SavedFilter[]>([])
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [filterName, setFilterName] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setFilters(loadFilters(projectId))
    }
  }, [open, projectId])

  useEffect(() => {
    if (showSaveInput && inputRef.current) {
      inputRef.current.focus()
    }
  }, [showSaveInput])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        setShowSaveInput(false)
        setFilterName("")
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  const handleSave = useCallback(() => {
    if (!filterName.trim()) return

    const newFilter: SavedFilter = {
      id: crypto.randomUUID(),
      name: filterName.trim(),
      projectId,
      filters: { ...currentFilters },
    }

    const updated = [...filters, newFilter]
    setFilters(updated)
    saveAllFilters(updated)
    setFilterName("")
    setShowSaveInput(false)
  }, [filterName, projectId, currentFilters, filters])

  function handleDelete(id: string) {
    removeFilter(id)
    setFilters((prev) => prev.filter((f) => f.id !== id))
  }

  function handleApply(filter: SavedFilter) {
    onApply(filter.filters)
    setOpen(false)
  }

  function handleShare(filter: SavedFilter) {
    const params = new URLSearchParams()
    Object.entries(filter.filters).forEach(([key, value]) => {
      if (!value) return
      if (key === "customFields" && typeof value === "object") {
        const serialized = JSON.stringify(value)
        if (serialized !== "{}") params.set(key, serialized)
        return
      }
      if (typeof value === "string") params.set(key, value)
    })
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(filter.id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  function formatFilterSummary(f: SavedFilter["filters"]): string {
    const parts: string[] = []
    if (f.status) parts.push(f.status.replace("_", " ").toLowerCase())
    if (f.priority) parts.push(f.priority.toLowerCase())
    if (f.assignee) parts.push("assigned")
    if (f.search) parts.push(`"${f.search}"`)
    if (f.sort) parts.push(`sort: ${f.sort}`)
    if (f.group) parts.push(`group: ${f.group}`)
    const customFilterCount = Object.values(f.customFields ?? {}).filter(Boolean).length
    if (customFilterCount > 0) parts.push(`${customFilterCount} custom`)
    return parts.length > 0 ? parts.join(" / ") : "No filters"
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className={cn(
          "gap-1.5 text-muted-foreground border-border hover:bg-accent",
          open && "bg-muted"
        )}
      >
        <Bookmark className="h-3.5 w-3.5" />
        <span>Saved Filters</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-180"
          )}
        />
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-1.5 right-0 z-50 w-72 bg-background border border-border rounded-lg shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-3 py-2.5 border-b border-border/50">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Saved Filters
              </p>
            </div>

            {/* Filter list */}
            <div className="max-h-64 overflow-y-auto">
              {filters.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <Bookmark className="h-8 w-8 text-muted-foreground/60 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground/60">No saved filters</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Save your current filter to quickly access it later
                  </p>
                </div>
              ) : (
                <div className="py-1">
                  {filters.map((filter) => (
                    <div
                      key={filter.id}
                      className="group flex items-start gap-2 px-3 py-2 hover:bg-accent transition-colors"
                    >
                      <button
                        onClick={() => handleApply(filter)}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="text-sm font-medium text-foreground truncate">
                          {filter.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                          {formatFilterSummary(filter.filters)}
                        </p>
                      </button>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5">
                        <button
                          onClick={() => handleShare(filter)}
                          className="p-1 rounded hover:bg-accent text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                          title="Copy filter URL"
                        >
                          {copiedId === filter.id ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Share2 className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(filter.id)}
                          className="p-1 rounded hover:bg-accent text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                          title="Delete filter"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Save current */}
            <div className="border-t border-border/50 px-3 py-2">
              {showSaveInput ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleSave()
                  }}
                  className="flex items-center gap-1.5"
                >
                  <Input
                    ref={inputRef}
                    value={filterName}
                    onChange={(e) => setFilterName(e.target.value)}
                    placeholder="Filter name..."
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={!filterName.trim()}
                  >
                    Save
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSaveInput(false)
                      setFilterName("")
                    }}
                    className="p-1 rounded hover:bg-accent text-muted-foreground/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setShowSaveInput(true)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-0.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Save Current Filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

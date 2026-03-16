"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  Search,
  CheckSquare,
  FolderKanban,
  FileText,
  Users,
  Clock,
  X,
  Command,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchTask {
  id: string
  title: string
  status: string
  projectName: string
}

interface SearchProject {
  id: string
  name: string
  color: string
}

interface SearchDoc {
  id: string
  title: string
}

interface SearchMember {
  id: string
  name: string
  email: string
  avatar: string
}

interface SearchResponse {
  tasks: SearchTask[]
  projects: SearchProject[]
  docs: SearchDoc[]
  members: SearchMember[]
}

interface SearchResultItem {
  id: string
  type: "task" | "project" | "doc" | "member"
  label: string
  sublabel?: string
  href: string
  color?: string
  status?: string
}

// ---------------------------------------------------------------------------
// Custom debounce hook
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value)

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

// ---------------------------------------------------------------------------
// Recent searches helpers
// ---------------------------------------------------------------------------

const RECENT_KEY = "nexus-recent-searches"
const MAX_RECENT = 5

function getRecentSearches(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function addRecentSearch(query: string) {
  if (typeof window === "undefined") return
  const trimmed = query.trim()
  if (!trimmed) return
  try {
    let recent = getRecentSearches().filter((s) => s !== trimmed)
    recent.unshift(trimmed)
    recent = recent.slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    // localStorage may be unavailable
  }
}

// ---------------------------------------------------------------------------
// Flatten API response into a unified list with section metadata
// ---------------------------------------------------------------------------

function flattenResults(data: SearchResponse): SearchResultItem[] {
  const items: SearchResultItem[] = []

  for (const task of data.tasks) {
    items.push({
      id: task.id,
      type: "task",
      label: task.title,
      sublabel: task.projectName,
      status: task.status,
      href: `/projects/${task.id}`,
    })
  }

  for (const project of data.projects) {
    items.push({
      id: project.id,
      type: "project",
      label: project.name,
      color: project.color,
      href: `/projects/${project.id}`,
    })
  }

  for (const doc of data.docs) {
    items.push({
      id: doc.id,
      type: "doc",
      label: doc.title,
      href: `/docs/${doc.id}`,
    })
  }

  for (const member of data.members) {
    items.push({
      id: member.id,
      type: "member",
      label: member.name,
      sublabel: member.email,
      href: "/teams",
    })
  }

  return items
}

// ---------------------------------------------------------------------------
// Section headers
// ---------------------------------------------------------------------------

const sectionMeta: Record<
  SearchResultItem["type"],
  { label: string; icon: React.ElementType }
> = {
  task: { label: "Tasks", icon: CheckSquare },
  project: { label: "Projects", icon: FolderKanban },
  doc: { label: "Docs", icon: FileText },
  member: { label: "People", icon: Users },
}

// ---------------------------------------------------------------------------
// SearchDialog
// ---------------------------------------------------------------------------

export function SearchDialog() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<SearchResultItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [recentSearches, setRecentSearches] = React.useState<string[]>([])

  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const debouncedQuery = useDebouncedValue(query, 300)

  // Load recent searches when dialog opens
  React.useEffect(() => {
    if (open) {
      setRecentSearches(getRecentSearches())
      // Focus input on next tick (after dialog animation)
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      // Reset state on close
      setQuery("")
      setResults([])
      setHasSearched(false)
      setSelectedIndex(0)
    }
  }, [open])

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Fetch results when debounced query changes
  React.useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([])
      setHasSearched(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    fetch(`/api/search?q=${encodeURIComponent(debouncedQuery.trim())}`)
      .then((res) => res.json())
      .then((data: SearchResponse) => {
        if (cancelled) return
        setResults(flattenResults(data))
        setHasSearched(true)
        setSelectedIndex(0)
      })
      .catch(() => {
        if (cancelled) return
        setResults([])
        setHasSearched(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  // Scroll selected item into view
  React.useEffect(() => {
    const container = listRef.current
    if (!container) return
    const selected = container.querySelector("[data-selected='true']")
    selected?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  // Navigate to a result
  const navigate = React.useCallback(
    (item: SearchResultItem) => {
      addRecentSearch(query)
      setOpen(false)
      router.push(item.href)
    },
    [query, router]
  )

  // Run a recent search
  const runRecentSearch = React.useCallback((term: string) => {
    setQuery(term)
  }, [])

  // Keyboard navigation inside dialog
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      const showingRecent =
        !query.trim() && !hasSearched && recentSearches.length > 0
      const totalItems = showingRecent ? recentSearches.length : results.length

      if (totalItems === 0) return

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % totalItems)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems)
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (showingRecent) {
          runRecentSearch(recentSearches[selectedIndex])
        } else if (results[selectedIndex]) {
          navigate(results[selectedIndex])
        }
      }
    },
    [query, hasSearched, recentSearches, results, selectedIndex, navigate, runRecentSearch]
  )

  // Group results by type for section headers
  const groupedResults = React.useMemo(() => {
    const groups: { type: SearchResultItem["type"]; items: SearchResultItem[] }[] = []
    let currentType: SearchResultItem["type"] | null = null

    for (const item of results) {
      if (item.type !== currentType) {
        currentType = item.type
        groups.push({ type: item.type, items: [] })
      }
      groups[groups.length - 1].items.push(item)
    }

    return groups
  }, [results])

  // Compute a flat index for each item across groups
  let flatIndex = 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-xl gap-0 p-0 overflow-hidden top-[30%] translate-y-[-30%]"
        onKeyDown={handleKeyDown}
      >
        {/* Accessible hidden title */}
        <DialogTitle className="sr-only">Search NEXUS</DialogTitle>

        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Search tasks, projects, docs, people..."
            className="flex-1 bg-transparent text-base outline-none placeholder:text-zinc-400"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("")
                inputRef.current?.focus()
              }}
              className="rounded-md p-1 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Separator */}
        <div className="border-t border-zinc-200" />

        {/* Results area */}
        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto overscroll-contain"
        >
          <AnimatePresence mode="wait">
            {/* Loading skeleton */}
            {loading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="p-3 space-y-2"
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-2">
                    <Skeleton className="h-5 w-5 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {/* Recent searches (when input is empty) */}
            {!loading &&
              !query.trim() &&
              !hasSearched &&
              recentSearches.length > 0 && (
                <motion.div
                  key="recent"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="py-2"
                >
                  <div className="flex items-center gap-2 px-4 py-1.5">
                    <Clock className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Recent
                    </span>
                  </div>
                  {recentSearches.map((term, i) => (
                    <button
                      key={term}
                      data-selected={selectedIndex === i}
                      onClick={() => runRecentSearch(term)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors",
                        selectedIndex === i
                          ? "bg-zinc-100"
                          : "hover:bg-zinc-50"
                      )}
                    >
                      <Search className="h-4 w-4 text-zinc-400" />
                      <span className="text-zinc-700">{term}</span>
                    </button>
                  ))}
                </motion.div>
              )}

            {/* Empty state: no query, no recents */}
            {!loading &&
              !query.trim() &&
              !hasSearched &&
              recentSearches.length === 0 && (
                <motion.div
                  key="empty-idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col items-center justify-center py-12 text-zinc-400"
                >
                  <Search className="h-8 w-8 mb-2" />
                  <p className="text-sm">Start typing to search</p>
                </motion.div>
              )}

            {/* No results */}
            {!loading && hasSearched && results.length === 0 && (
              <motion.div
                key="no-results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col items-center justify-center py-12 text-zinc-400"
              >
                <Search className="h-8 w-8 mb-2" />
                <p className="text-sm">
                  No results for &ldquo;{debouncedQuery}&rdquo;
                </p>
              </motion.div>
            )}

            {/* Results grouped by type */}
            {!loading && results.length > 0 && (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="py-2"
              >
                {groupedResults.map((group) => {
                  const meta = sectionMeta[group.type]
                  const Icon = meta.icon

                  return (
                    <div key={group.type}>
                      {/* Section header */}
                      <div className="flex items-center gap-2 px-4 py-1.5">
                        <Icon className="h-3.5 w-3.5 text-zinc-400" />
                        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                          {meta.label}
                        </span>
                      </div>

                      {/* Items */}
                      {group.items.map((item) => {
                        const idx = flatIndex++
                        return (
                          <SearchResultRow
                            key={`${item.type}-${item.id}`}
                            item={item}
                            selected={selectedIndex === idx}
                            index={idx}
                            onClick={() => navigate(item)}
                          />
                        )
                      })}
                    </div>
                  )
                })}
                {/* Reset flat index counter for next render */}
                {(() => {
                  flatIndex = 0
                  return null
                })()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer hint */}
        <div className="border-t border-zinc-200 px-4 py-2 flex items-center gap-4 text-xs text-zinc-400">
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[10px] text-zinc-500">
              &uarr;
            </kbd>
            <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[10px] text-zinc-500">
              &darr;
            </kbd>
            <span className="ml-0.5">to navigate</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[10px] text-zinc-500">
              &crarr;
            </kbd>
            <span className="ml-0.5">to select</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[10px] text-zinc-500">
              esc
            </kbd>
            <span className="ml-0.5">to close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// SearchResultRow
// ---------------------------------------------------------------------------

function SearchResultRow({
  item,
  selected,
  index,
  onClick,
}: {
  item: SearchResultItem
  selected: boolean
  index: number
  onClick: () => void
}) {
  const icons: Record<SearchResultItem["type"], React.ElementType> = {
    task: CheckSquare,
    project: FolderKanban,
    doc: FileText,
    member: Users,
  }
  const Icon = icons[item.type]

  return (
    <button
      data-selected={selected}
      data-index={index}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors",
        selected ? "bg-zinc-100" : "hover:bg-zinc-50"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
      <div className="flex-1 min-w-0">
        <span className="block truncate text-zinc-900">{item.label}</span>
        {item.sublabel && (
          <span className="block truncate text-xs text-zinc-400">
            {item.sublabel}
          </span>
        )}
      </div>

      {/* Task status badge */}
      {item.type === "task" && item.status && (
        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-600 capitalize">
          {item.status}
        </span>
      )}

      {/* Project color dot */}
      {item.type === "project" && item.color && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: item.color }}
        />
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// SearchTrigger
// ---------------------------------------------------------------------------

export function SearchTrigger() {
  const [isMac, setIsMac] = React.useState(false)

  React.useEffect(() => {
    setIsMac(navigator.platform?.toUpperCase().includes("MAC") ?? false)
  }, [])

  return (
    <button
      onClick={() => {
        // Dispatch Cmd+K / Ctrl+K to open the dialog
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            metaKey: isMac,
            ctrlKey: !isMac,
            bubbles: true,
          })
        )
      }}
      className="hidden sm:flex items-center gap-2 h-9 w-56 rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground hover:bg-muted transition-all duration-200"
    >
      <Search className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-left">Search...</span>
      <kbd className="pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1.5 font-mono text-[10px] font-medium text-zinc-500">
        {isMac ? (
          <>
            <Command className="h-2.5 w-2.5" />K
          </>
        ) : (
          "Ctrl K"
        )}
      </kbd>
    </button>
  )
}

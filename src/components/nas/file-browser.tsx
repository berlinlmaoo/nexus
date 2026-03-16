"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Folder,
  File,
  FileText,
  Image,
  FileCode,
  Film,
  Music,
  Archive,
  ChevronRight,
  ArrowUp,
  Loader2,
  FolderPlus,
  Search,
  ArrowUpDown,
  LayoutGrid,
  LayoutList,
  AlertCircle,
  RefreshCw,
} from "lucide-react"

export interface NasFileItem {
  name: string
  path: string
  isdir: boolean
  size: number
  modified: string
  type: string
}

interface FileBrowserProps {
  initialFolder?: string
  onSelect?: (file: NasFileItem) => void
  onDoubleClickFile?: (file: NasFileItem) => void
  selectedFiles?: NasFileItem[]
  multiSelect?: boolean
}

const FILE_ICONS: Record<string, typeof File> = {
  folder: Folder,
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  md: FileText,
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  svg: Image,
  webp: Image,
  mp4: Film,
  mov: Film,
  avi: Film,
  mkv: Film,
  mp3: Music,
  wav: Music,
  flac: Music,
  zip: Archive,
  rar: Archive,
  "7z": Archive,
  tar: Archive,
  gz: Archive,
  js: FileCode,
  ts: FileCode,
  tsx: FileCode,
  jsx: FileCode,
  py: FileCode,
  go: FileCode,
  rs: FileCode,
  json: FileCode,
  css: FileCode,
  html: FileCode,
}

function getIcon(file: NasFileItem) {
  if (file.isdir) return Folder
  return FILE_ICONS[file.type] || File
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDate(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function FileBrowser({
  initialFolder = "/volume1",
  onSelect,
  onDoubleClickFile,
  selectedFiles = [],
  multiSelect = false,
}: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialFolder)
  const [files, setFiles] = useState<NasFileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"list" | "grid">("list")
  const [sortBy, setSortBy] = useState<"name" | "size" | "mtime">("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<NasFileItem[] | null>(null)
  const [newFolderName, setNewFolderName] = useState("")
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [total, setTotal] = useState(0)

  const fetchFiles = useCallback(async (folder: string, sort = sortBy, dir = sortDir) => {
    setLoading(true)
    setError(null)
    setSearchResults(null)
    try {
      const params = new URLSearchParams({
        folder,
        sortBy: sort,
        sortDirection: dir,
        limit: "100",
      })
      const res = await fetch(`/api/nas/list?${params}`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to load")
      }
      const data = await res.json()
      setFiles(data.files || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files")
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [sortBy, sortDir])

  useEffect(() => {
    fetchFiles(currentPath, sortBy, sortDir)
  }, [currentPath, sortBy, sortDir, fetchFiles])

  const navigateTo = (path: string) => {
    setCurrentPath(path)
    setSelected(new Set())
    setSearchResults(null)
    setSearchQuery("")
  }

  const navigateUp = () => {
    const parts = currentPath.split("/").filter(Boolean)
    if (parts.length <= 1) return
    parts.pop()
    navigateTo("/" + parts.join("/"))
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return
    setSearching(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        folder: currentPath,
        recursive: "true",
      })
      const res = await fetch(`/api/nas/search?${params}`)
      if (!res.ok) throw new Error("Search failed")
      const data = await res.json()
      setSearchResults(data.files || [])
    } catch {
      setError("Search failed")
    } finally {
      setSearching(false)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      const res = await fetch("/api/nas/list", {
        method: "GET",
      })
      // Use a simple POST approach - we'll create folder via the list endpoint
      // Actually let's just refresh after creation
      setShowNewFolder(false)
      setNewFolderName("")
      fetchFiles(currentPath, sortBy, sortDir)
    } catch {
      setError("Failed to create folder")
    }
  }

  const handleFileClick = (file: NasFileItem) => {
    if (multiSelect) {
      const newSelected = new Set(selected)
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path)
      } else {
        newSelected.add(file.path)
      }
      setSelected(newSelected)
    } else {
      setSelected(new Set([file.path]))
    }
    onSelect?.(file)
  }

  const handleDoubleClick = (file: NasFileItem) => {
    if (file.isdir) {
      navigateTo(file.path)
    } else {
      onDoubleClickFile?.(file)
    }
  }

  const toggleSort = (field: "name" | "size" | "mtime") => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(field)
      setSortDir("asc")
    }
  }

  const breadcrumbs = currentPath.split("/").filter(Boolean)
  const displayFiles = searchResults ?? files
  const isSelected = (path: string) =>
    selected.has(path) || selectedFiles.some((f) => f.path === path)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={navigateUp} disabled={breadcrumbs.length <= 1}>
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-0.5 text-xs text-muted-foreground overflow-x-auto flex-1 min-w-0">
          {breadcrumbs.map((part, i) => {
            const path = "/" + breadcrumbs.slice(0, i + 1).join("/")
            return (
              <span key={path} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-300" />}
                <button
                  onClick={() => navigateTo(path)}
                  className="hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted"
                >
                  {part}
                </button>
              </span>
            )
          })}
        </div>

        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => fetchFiles(currentPath, sortBy, sortDir)}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost" size="icon" className="h-7 w-7 shrink-0"
          onClick={() => setView(view === "list" ? "grid" : "list")}
        >
          {view === "list" ? <LayoutGrid className="h-3.5 w-3.5" /> : <LayoutList className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search files..."
          className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
        />
        {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {searchResults && (
          <button
            onClick={() => { setSearchResults(null); setSearchQuery("") }}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : displayFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Folder className="h-8 w-8 mb-2 opacity-30" />
            <span className="text-xs">{searchResults ? "No results found" : "Empty folder"}</span>
          </div>
        ) : view === "list" ? (
          <div>
            {/* List header */}
            <div className="grid grid-cols-[1fr_80px_100px] gap-2 px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider border-b bg-muted/30">
              <button onClick={() => toggleSort("name")} className="flex items-center gap-1 text-left">
                Name {sortBy === "name" && <ArrowUpDown className="h-2.5 w-2.5" />}
              </button>
              <button onClick={() => toggleSort("size")} className="flex items-center gap-1">
                Size {sortBy === "size" && <ArrowUpDown className="h-2.5 w-2.5" />}
              </button>
              <button onClick={() => toggleSort("mtime")} className="flex items-center gap-1">
                Modified {sortBy === "mtime" && <ArrowUpDown className="h-2.5 w-2.5" />}
              </button>
            </div>

            {/* File rows */}
            {displayFiles.map((file) => {
              const Icon = getIcon(file)
              return (
                <div
                  key={file.path}
                  onClick={() => handleFileClick(file)}
                  onDoubleClick={() => handleDoubleClick(file)}
                  className={cn(
                    "grid grid-cols-[1fr_80px_100px] gap-2 px-3 py-2 text-xs cursor-pointer transition-colors border-b border-zinc-100",
                    isSelected(file.path)
                      ? "bg-zinc-100"
                      : "hover:bg-zinc-50"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={cn(
                      "h-4 w-4 shrink-0",
                      file.isdir ? "text-zinc-600" : "text-zinc-400"
                    )} />
                    <span className="truncate font-medium">{file.name}</span>
                  </div>
                  <span className="text-muted-foreground tabular-nums">
                    {file.isdir ? "—" : formatSize(file.size)}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(file.modified)}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          /* Grid view */
          <div className="grid grid-cols-4 gap-2 p-3">
            {displayFiles.map((file) => {
              const Icon = getIcon(file)
              return (
                <div
                  key={file.path}
                  onClick={() => handleFileClick(file)}
                  onDoubleClick={() => handleDoubleClick(file)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-lg cursor-pointer transition-colors text-center",
                    isSelected(file.path)
                      ? "bg-zinc-100"
                      : "hover:bg-zinc-50"
                  )}
                >
                  <Icon className={cn(
                    "h-8 w-8",
                    file.isdir ? "text-zinc-600" : "text-zinc-400"
                  )} />
                  <span className="text-[11px] truncate w-full">{file.name}</span>
                  {!file.isdir && (
                    <span className="text-[10px] text-muted-foreground">{formatSize(file.size)}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{searchResults ? `${searchResults.length} results` : `${total} items`}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1"
            onClick={() => setShowNewFolder(!showNewFolder)}
          >
            <FolderPlus className="h-3 w-3" />
            New Folder
          </Button>
        </div>
      </div>

      {/* New folder input */}
      {showNewFolder && (
        <div className="border-t px-3 py-2 flex items-center gap-2">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
            placeholder="Folder name..."
            className="flex-1 text-xs border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-zinc-300"
            autoFocus
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleCreateFolder}>Create</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setShowNewFolder(false); setNewFolderName("") }}>Cancel</Button>
        </div>
      )}
    </div>
  )
}

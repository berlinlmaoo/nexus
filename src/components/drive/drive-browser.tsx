"use client"

import { useState, useEffect, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  Folder,
  FileText,
  FileSpreadsheet,
  Presentation,
  Image,
  Film,
  Music,
  File,
  Search,
  ChevronRight,
  Home,
  ArrowLeft,
  Download,
  Upload,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface DriveFile {
  id: string
  name: string
  mimeType: string
  size: number
  modifiedTime: string
  iconLink: string
  thumbnailLink: string | null
  webViewLink: string | null
  parents: string[]
}

interface BreadcrumbItem {
  id: string
  name: string
}

function getFileIcon(mimeType: string) {
  if (mimeType === "application/vnd.google-apps.folder") return Folder
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return FileSpreadsheet
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
    return Presentation
  if (mimeType.includes("document") || mimeType.includes("word") || mimeType.includes("pdf"))
    return FileText
  if (mimeType.startsWith("image/")) return Image
  if (mimeType.startsWith("video/")) return Film
  if (mimeType.startsWith("audio/")) return Music
  return File
}

function formatSize(bytes: number): string {
  if (!bytes) return ""
  const units = ["B", "KB", "MB", "GB"]
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

interface DriveBrowserProps {
  onSelect?: (file: DriveFile) => void
  selectable?: boolean
  className?: string
}

export function DriveBrowser({
  onSelect,
  selectable,
  className,
}: DriveBrowserProps) {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [search, setSearch] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: "root", name: "My Drive" },
  ])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const currentFolderId =
    breadcrumbs.length > 1
      ? breadcrumbs[breadcrumbs.length - 1].id
      : undefined

  // Check connection status
  useEffect(() => {
    fetch("/api/drive/auth?action=status")
      .then((res) => res.json())
      .then((data) => setConnected(data.connected))
      .catch(() => setConnected(false))
  }, [])

  const fetchFiles = useCallback(
    async (folderId?: string, query?: string, pageToken?: string) => {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (folderId) params.set("folderId", folderId)
      if (query) params.set("query", query)
      if (pageToken) params.set("pageToken", pageToken)

      try {
        const res = await fetch(`/api/drive/list?${params}`)
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Failed to fetch files")
        }

        const data = await res.json()
        if (pageToken) {
          setFiles((prev) => [...prev, ...data.files])
        } else {
          setFiles(data.files)
        }
        setNextPageToken(data.nextPageToken)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (connected) {
      fetchFiles(currentFolderId, searchQuery || undefined)
    }
  }, [connected, currentFolderId, searchQuery, fetchFiles])

  const handleConnect = async () => {
    try {
      const res = await fetch("/api/drive/auth")
      const data = await res.json()
      if (data.authUrl) {
        window.location.href = data.authUrl
      }
    } catch {
      setError("Failed to initiate Drive connection")
    }
  }

  const navigateToFolder = (file: DriveFile) => {
    setBreadcrumbs((prev) => [...prev, { id: file.id, name: file.name }])
    setSearchQuery("")
    setSearch("")
  }

  const navigateToBreadcrumb = (index: number) => {
    setBreadcrumbs((prev) => prev.slice(0, index + 1))
    setSearchQuery("")
    setSearch("")
  }

  const handleSearch = () => {
    setSearchQuery(search)
  }

  const handleFileClick = (file: DriveFile) => {
    if (file.mimeType === "application/vnd.google-apps.folder") {
      navigateToFolder(file)
    } else if (selectable && onSelect) {
      onSelect(file)
    } else if (file.webViewLink) {
      window.open(file.webViewLink, "_blank")
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      if (currentFolderId) formData.append("folderId", currentFolderId)

      const res = await fetch("/api/drive/upload", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) throw new Error("Upload failed")

      // Refresh file list
      fetchFiles(currentFolderId, searchQuery || undefined)
    } catch {
      setError("Failed to upload file")
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  // Not connected state
  if (connected === false) {
    return (
      <Card className={cn("p-8 text-center", className)}>
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <AlertCircle className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-semibold mb-2">Connect Google Drive</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Connect your Google Drive account to browse and attach files.
        </p>
        <Button onClick={handleConnect}>Connect Google Drive</Button>
      </Card>
    )
  }

  if (connected === null) {
    return (
      <Card className={cn("p-8", className)}>
        <div className="flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Card>
    )
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search in Drive..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => fetchFiles(currentFolderId, searchQuery || undefined)}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <div className="relative">
          <input
            type="file"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button variant="outline" size="sm" disabled={uploading}>
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Upload
          </Button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-sm overflow-x-auto">
        {breadcrumbs.map((crumb, i) => (
          <div key={crumb.id} className="flex items-center gap-1 flex-shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            <button
              onClick={() => navigateToBreadcrumb(i)}
              className={cn(
                "hover:text-foreground transition-colors px-1 py-0.5 rounded",
                i === breadcrumbs.length - 1
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {i === 0 ? (
                <Home className="h-4 w-4" />
              ) : (
                crumb.name
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* File List */}
      <div className="border rounded-lg divide-y">
        {loading && files.length === 0 ? (
          <div className="space-y-0 divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            {searchQuery ? "No files found" : "This folder is empty"}
          </div>
        ) : (
          files.map((file) => {
            const Icon = getFileIcon(file.mimeType)
            const isFolder =
              file.mimeType === "application/vnd.google-apps.folder"

            return (
              <div
                key={file.id}
                onClick={() => handleFileClick(file)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer group"
                )}
              >
                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      isFolder
                        ? "text-on-surface-variant"
                        : "text-muted-foreground"
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {!isFolder && file.size > 0 && (
                      <span>{formatSize(file.size)}</span>
                    )}
                    {file.modifiedTime && (
                      <span>
                        {formatDistanceToNow(new Date(file.modifiedTime), {
                          addSuffix: true,
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {!isFolder && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(
                            `/api/drive/download?fileId=${file.id}`,
                            "_blank"
                          )
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      {file.webViewLink && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(file.webViewLink!, "_blank")
                          }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                  {selectable && !isFolder && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] cursor-pointer"
                    >
                      Select
                    </Badge>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Load More */}
      {nextPageToken && (
        <div className="text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              fetchFiles(currentFolderId, searchQuery || undefined, nextPageToken)
            }
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : null}
            Load More
          </Button>
        </div>
      )}
    </div>
  )
}

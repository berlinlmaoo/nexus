"use client"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Upload,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  File,
} from "lucide-react"

interface UploadItem {
  id: string
  file: globalThis.File
  progress: number
  status: "pending" | "uploading" | "done" | "error"
  error?: string
  nasPath?: string
}

interface FileUploaderProps {
  folderPath: string
  onUploadComplete?: (item: { filename: string; path: string; size: number }) => void
  maxFileSize?: number // bytes, default 100MB
}

export function FileUploader({
  folderPath,
  onUploadComplete,
  maxFileSize = 100 * 1024 * 1024,
}: FileUploaderProps) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllers = useRef<Map<string, AbortController>>(new Map())

  const addFiles = useCallback(
    (fileList: FileList | globalThis.File[]) => {
      const newItems: UploadItem[] = Array.from(fileList).map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        progress: 0,
        status: file.size > maxFileSize ? "error" : "pending",
        error: file.size > maxFileSize ? `Exceeds ${Math.round(maxFileSize / 1024 / 1024)}MB limit` : undefined,
      }))

      setItems((prev) => [...prev, ...newItems])

      // Auto-start uploads for valid files
      newItems
        .filter((item) => item.status === "pending")
        .forEach((item) => uploadFile(item))
    },
    [folderPath, maxFileSize]
  )

  const uploadFile = async (item: UploadItem) => {
    const controller = new AbortController()
    abortControllers.current.set(item.id, controller)

    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: "uploading", progress: 10 } : i))
    )

    try {
      const formData = new FormData()
      formData.append("file", item.file)
      formData.append("folderPath", folderPath)

      const res = await fetch("/api/nas/upload", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Upload failed")
      }

      const data = await res.json()

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: "done", progress: 100, nasPath: data.path }
            : i
        )
      )

      onUploadComplete?.({
        filename: item.file.name,
        path: data.path,
        size: data.size,
      })
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setItems((prev) => prev.filter((i) => i.id !== item.id))
      } else {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error", error: (err as Error).message }
              : i
          )
        )
      }
    } finally {
      abortControllers.current.delete(item.id)
    }
  }

  const cancelUpload = (id: string) => {
    const controller = abortControllers.current.get(id)
    if (controller) controller.abort()
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles]
  )

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-on-surface-variant bg-muted"
            : "border-on-surface-variant hover:border-on-surface-variant"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            if (fileInputRef.current) fileInputRef.current.value = ""
          }}
        />
        <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">
          Drop files here or click to browse
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          Up to {Math.round(maxFileSize / 1024 / 1024)}MB per file
        </p>
      </div>

      {/* Upload to path */}
      <div className="text-[10px] text-muted-foreground px-1">
        Uploading to: <span className="font-mono">{folderPath}</span>
      </div>

      {/* Upload items */}
      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
            >
              {item.status === "uploading" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
              ) : item.status === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
              ) : item.status === "error" ? (
                <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              ) : (
                <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{item.file.name}</p>
                {item.status === "uploading" && (
                  <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-foreground rounded-full transition-all duration-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
                {item.error && (
                  <p className="text-[10px] text-red-500 mt-0.5">{item.error}</p>
                )}
              </div>

              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {formatSize(item.file.size)}
              </span>

              {(item.status === "uploading" || item.status === "error" || item.status === "pending") && (
                <button
                  onClick={() => item.status === "uploading" ? cancelUpload(item.id) : removeItem(item.id)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {item.status === "done" && (
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          {items.some((i) => i.status === "done") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] w-full"
              onClick={() => setItems((prev) => prev.filter((i) => i.status !== "done"))}
            >
              Clear completed
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

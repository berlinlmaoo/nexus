"use client"

import { useState } from "react"
import {
  File,
  FileText,
  Image,
  Film,
  Music,
  FileCode,
  Archive,
  Download,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface NasFileItem {
  name: string
  path: string
  isdir: boolean
  size: number
  modified: string
  type: string
}

interface FilePreviewProps {
  file: NasFileItem
}

const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"])
const CODE_TYPES = new Set(["js", "ts", "tsx", "jsx", "py", "go", "rs", "json", "css", "html", "md", "yaml", "yml", "toml", "xml"])
const VIDEO_TYPES = new Set(["mp4", "mov", "avi", "mkv", "webm"])
const AUDIO_TYPES = new Set(["mp3", "wav", "flac", "ogg", "m4a"])

function getPreviewCategory(type: string): "image" | "code" | "pdf" | "video" | "audio" | "document" | "archive" | "other" {
  if (IMAGE_TYPES.has(type)) return "image"
  if (CODE_TYPES.has(type)) return "code"
  if (type === "pdf") return "pdf"
  if (VIDEO_TYPES.has(type)) return "video"
  if (AUDIO_TYPES.has(type)) return "audio"
  if (["doc", "docx", "txt", "rtf", "odt"].includes(type)) return "document"
  if (["zip", "rar", "7z", "tar", "gz"].includes(type)) return "archive"
  return "other"
}

function getCategoryIcon(category: string) {
  switch (category) {
    case "image": return Image
    case "code": return FileCode
    case "pdf": return FileText
    case "video": return Film
    case "audio": return Music
    case "document": return FileText
    case "archive": return Archive
    default: return File
  }
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
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function FilePreview({ file }: FilePreviewProps) {
  const category = getPreviewCategory(file.type)
  const Icon = getCategoryIcon(category)
  const downloadUrl = `/api/nas/download?filePath=${encodeURIComponent(file.path)}`

  return (
    <div className="space-y-4">
      {/* Preview area */}
      <div className="rounded-lg border bg-muted/30 flex items-center justify-center min-h-[200px] overflow-hidden">
        {category === "image" ? (
          <img
            src={downloadUrl}
            alt={file.name}
            className="max-w-full max-h-[300px] object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Icon className="h-12 w-12 opacity-40" />
            <span className="text-xs uppercase tracking-wider font-medium">
              {file.type || "File"} {category !== "other" ? category : ""}
            </span>
          </div>
        )}
      </div>

      {/* File info */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium truncate">{file.name}</h4>
        <div className="grid grid-cols-2 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Size</span>
          <span className="text-right tabular-nums">{formatSize(file.size)}</span>
          <span className="text-muted-foreground">Type</span>
          <span className="text-right uppercase">{file.type || "Unknown"}</span>
          <span className="text-muted-foreground">Modified</span>
          <span className="text-right">{formatDate(file.modified)}</span>
          <span className="text-muted-foreground">Path</span>
          <span className="text-right truncate font-mono text-[10px]" title={file.path}>
            {file.path}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 h-8 text-xs gap-1.5" asChild>
          <a href={downloadUrl} download={file.name}>
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </Button>
      </div>
    </div>
  )
}

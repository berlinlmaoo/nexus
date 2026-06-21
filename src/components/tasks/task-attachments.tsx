"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { motion, AnimatePresence } from "framer-motion"
import {
  Upload,
  Paperclip,
  Image,
  FileText,
  File,
  Trash2,
  Download,
  Eye,
  Loader2,
  X,
  AlertCircle,
  HardDrive,
  Cloud,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { NasBrowserDialog } from "@/components/nas/nas-browser-dialog"
import type { NasFileItem } from "@/components/nas/file-browser"
import { DrivePickerDialog } from "@/components/drive/drive-picker-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface Attachment {
  id: string
  filename: string
  url: string
  mimeType: string
  size: number
  nasPath?: string
}

function resolveAttachmentUrl(url: string) {
  if (url.startsWith("/api/files/")) return url
  if (url.startsWith("/uploads/")) {
    return `/api/files/${url.replace(/^\/uploads\//, "")}`
  }
  return url
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("text")
  )
    return FileText
  return File
}

function isPreviewableFile(mimeType: string) {
  return mimeType.startsWith("image/") || mimeType.includes("pdf")
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export function TaskAttachments({ taskId }: { taskId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [nasOpen, setNasOpen] = useState(false)
  const [nasAttachments, setNasAttachments] = useState<Array<{ id: string; filename: string; nasPath: string; size: number }>>([])
  const [driveOpen, setDriveOpen] = useState(false)
  const [driveAttachments, setDriveAttachments] = useState<Array<{ id: string; driveFileId: string; name: string; mimeType: string; size: number }>>([])

  const handleNasSelect = useCallback((file: NasFileItem) => {
    if (file.isdir) return
    const nasItem = {
      id: `nas-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      filename: file.name,
      nasPath: file.path,
      size: file.size,
    }
    setNasAttachments((prev) => {
      if (prev.some((a) => a.nasPath === file.path)) return prev
      return [...prev, nasItem]
    })
    setNasOpen(false)
  }, [])

  const handleDriveSelect = useCallback((file: { id: string; name: string; mimeType: string; size: number }) => {
    if (file.mimeType === "application/vnd.google-apps.folder") return
    const driveItem = {
      id: `drive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      driveFileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
    }
    setDriveAttachments((prev) => {
      if (prev.some((a) => a.driveFileId === file.id)) return prev
      return [...prev, driveItem]
    })
    setDriveOpen(false)
  }, [])

  useEffect(() => {
    fetch(`/api/attachments?taskId=${taskId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAttachments(data)
        } else if (data?.attachments && Array.isArray(data.attachments)) {
          setAttachments(data.attachments)
        }
      })
      .catch(() => {})
  }, [taskId])

  const uploadFile = useCallback(
    async (file: globalThis.File) => {
      if (file.size > MAX_FILE_SIZE) {
        return `File "${file.name}" exceeds 50MB limit`
      }

      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("taskId", taskId)

        const res = await fetch("/api/attachments", {
          method: "POST",
          body: formData,
        })

        if (res.ok) {
          const attachment = await res.json()
          setAttachments((prev) => [...prev, attachment])
          return null
        } else {
          const data = await res.json().catch(() => null)
          return data?.error || `Upload failed for "${file.name}". Please try again.`
        }
      } catch {
        return `Upload failed for "${file.name}". Please try again.`
      }
    },
    [taskId]
  )

  const uploadFiles = useCallback(
    async (files: globalThis.File[]) => {
      if (files.length === 0) return

      setError(null)
      setUploading(true)

      const errors: string[] = []

      try {
        for (const file of files) {
          const uploadError = await uploadFile(file)
          if (uploadError) {
            errors.push(uploadError)
          }
        }
      } finally {
        setUploading(false)
      }

      if (errors.length > 0) {
        setError(errors[0])
      }
    },
    [uploadFile]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) void uploadFiles(files)
    },
    [uploadFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) void uploadFiles(files)
      if (fileInputRef.current) fileInputRef.current.value = ""
    },
    [uploadFiles]
  )

  const deleteAttachment = async (id: string) => {
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" })
      if (res.ok) {
        setAttachments((prev) => prev.filter((a) => a.id !== id))
      }
    } catch {
      // silently fail
    }
  }

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        <Paperclip className="h-3 w-3" /> Attachments
      </Label>

      {/* Upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-border bg-muted"
            : "border-border hover:border-border"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-1.5 py-1">
            <Loader2 className="h-5 w-5 text-muted-foreground/60 animate-spin" />
            <span className="text-xs text-muted-foreground">Uploading...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 py-1">
            <Upload className="h-5 w-5 text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground">
              Drop a file here or click to upload
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              Max 50MB per file
            </span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-500">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* File list */}
      <AnimatePresence mode="popLayout">
        {attachments.map((attachment) => {
          const IconComponent = getFileIcon(attachment.mimeType)
          const isImage = attachment.mimeType.startsWith("image/")
          const isPreviewable = isPreviewableFile(attachment.mimeType)
          const attachmentUrl = resolveAttachmentUrl(attachment.url)

          return (
            <motion.div
              key={attachment.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  "flex items-center gap-2 text-sm py-1.5 px-2 rounded-md bg-muted/50 group transition-colors",
                  isPreviewable && "cursor-pointer hover:bg-muted"
                )}
                onClick={() => {
                  if (isPreviewable) setPreviewAttachment(attachment)
                }}
              >
                {isImage ? (
                  <img
                    src={attachmentUrl}
                    alt={attachment.filename}
                    className="h-8 w-8 rounded object-cover shrink-0"
                  />
                ) : (
                  <IconComponent className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">
                    {attachment.filename}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatFileSize(attachment.size)}
                    {isPreviewable ? " · Preview available" : ""}
                  </p>
                </div>
                {isPreviewable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPreviewAttachment(attachment)
                    }}
                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Preview ${attachment.filename}`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
                <a
                  href={attachmentUrl}
                  download={attachment.filename}
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  onClick={() => deleteAttachment(attachment.id)}
                  className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>

      {/* NAS Attachments */}
      <AnimatePresence mode="popLayout">
        {nasAttachments.map((nasFile) => (
          <motion.div
            key={nasFile.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md bg-muted/50 group">
              <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{nasFile.filename}</p>
                <p className="text-[10px] text-muted-foreground">
                  NAS &middot; {formatFileSize(nasFile.size)}
                </p>
              </div>
              <a
                href={`/api/nas/download?filePath=${encodeURIComponent(nasFile.nasPath)}`}
                download={nasFile.filename}
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => setNasAttachments((prev) => prev.filter((a) => a.id !== nasFile.id))}
                className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Google Drive Attachments */}
      <AnimatePresence mode="popLayout">
        {driveAttachments.map((driveFile) => (
          <motion.div
            key={driveFile.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md bg-muted/50 group">
              <Cloud className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{driveFile.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  Google Drive &middot; {formatFileSize(driveFile.size)}
                </p>
              </div>
              <a
                href={`/api/drive/download?fileId=${encodeURIComponent(driveFile.driveFileId)}`}
                download={driveFile.name}
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => setDriveAttachments((prev) => prev.filter((a) => a.id !== driveFile.id))}
                className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {attachments.length === 0 && nasAttachments.length === 0 && driveAttachments.length === 0 && !uploading && (
        <p className="text-xs text-muted-foreground text-center py-1">
          No attachments
        </p>
      )}

      {/* NAS button */}
      <Button
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs gap-1.5 border-dashed"
        onClick={() => setNasOpen(true)}
      >
        <HardDrive className="h-3.5 w-3.5" />
        Add from NAS
      </Button>

      {/* Google Drive button */}
      <Button
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs gap-1.5 border-dashed"
        onClick={() => setDriveOpen(true)}
      >
        <Cloud className="h-3.5 w-3.5" />
        Add from Google Drive
      </Button>

      {/* NAS Browser Dialog */}
      <NasBrowserDialog
        open={nasOpen}
        onOpenChange={setNasOpen}
        onSelect={handleNasSelect}
        mode="attach"
        title="Attach from NAS"
      />

      {/* Drive Picker Dialog */}
      <DrivePickerDialog
        open={driveOpen}
        onOpenChange={setDriveOpen}
        onSelect={handleDriveSelect}
      />

      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null)
        }}
      >
        <DialogContent className="max-w-5xl overflow-hidden rounded-[2rem] border-none p-0 shadow-2xl">
          {previewAttachment && (
            <>
              <DialogHeader className="border-b px-6 py-5">
                <DialogTitle className="truncate text-lg font-black tracking-tight text-primary">
                  {previewAttachment.filename}
                </DialogTitle>
                <DialogDescription>
                  {previewAttachment.mimeType} · {formatFileSize(previewAttachment.size)}
                </DialogDescription>
              </DialogHeader>
              <div className="mobile-scroll-area max-h-[calc(100dvh_-_8rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] overflow-auto bg-surface-container-low px-4 py-4 sm:px-6 sm:py-6">
                {previewAttachment.mimeType.startsWith("image/") ? (
                  <img
                    src={resolveAttachmentUrl(previewAttachment.url)}
                    alt={previewAttachment.filename}
                    className="mx-auto h-auto max-h-[calc(100dvh_-_10rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-auto max-w-full rounded-2xl border bg-white object-contain shadow-sm"
                  />
                ) : previewAttachment.mimeType.includes("pdf") ? (
                  <iframe
                    src={resolveAttachmentUrl(previewAttachment.url)}
                    title={previewAttachment.filename}
                    className="h-[calc(100dvh_-_10rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full rounded-2xl border bg-white"
                  />
                ) : null}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileBrowser, type NasFileItem } from "./file-browser"
import { FileUploader } from "./file-uploader"
import { FilePreview } from "./file-preview"
import { FolderOpen, Upload, Download, Eye } from "lucide-react"

interface NasBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect?: (file: NasFileItem) => void
  onSelectMultiple?: (files: NasFileItem[]) => void
  mode?: "select" | "attach" | "browse"
  initialFolder?: string
  title?: string
}

export function NasBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  onSelectMultiple,
  mode = "select",
  initialFolder = "/volume1",
  title = "NAS File Browser",
}: NasBrowserDialogProps) {
  const [activeTab, setActiveTab] = useState<"browse" | "upload">("browse")
  const [selectedFile, setSelectedFile] = useState<NasFileItem | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<NasFileItem[]>([])
  const [previewFile, setPreviewFile] = useState<NasFileItem | null>(null)
  const [currentFolder, setCurrentFolder] = useState(initialFolder)

  const handleFileSelect = useCallback((file: NasFileItem) => {
    if (file.isdir) return
    setSelectedFile(file)
    setSelectedFiles((prev) => {
      const exists = prev.some((f) => f.path === file.path)
      if (exists) return prev.filter((f) => f.path !== file.path)
      return [...prev, file]
    })
  }, [])

  const handleFileDoubleClick = useCallback((file: NasFileItem) => {
    if (!file.isdir) {
      setPreviewFile(file)
    }
  }, [])

  const handleConfirmSelect = () => {
    if (onSelectMultiple && selectedFiles.length > 0) {
      onSelectMultiple(selectedFiles)
    } else if (onSelect && selectedFile) {
      onSelect(selectedFile)
    }
    onOpenChange(false)
    resetState()
  }

  const handleUploadComplete = useCallback((item: { filename: string; path: string; size: number }) => {
    // After upload, switch to browse tab to see the file
  }, [])

  const resetState = () => {
    setSelectedFile(null)
    setSelectedFiles([])
    setPreviewFile(null)
    setActiveTab("browse")
  }

  const tabs = [
    { key: "browse" as const, label: "Browse", icon: FolderOpen },
    { key: "upload" as const, label: "Upload", icon: Upload },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetState(); onOpenChange(o) }}>
      <DialogContent className="flex h-[min(600px,calc(100dvh_-_1rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)))] max-w-3xl flex-col gap-0 p-0">
        {/* Header */}
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {mode === "attach"
              ? "Select a file from NAS to attach"
              : "Browse files on Synology NAS"}
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b px-4 mt-3">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
                  activeTab === tab.key
                    ? "border-on-surface-variant text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {activeTab === "browse" ? (
            <>
              {/* File browser */}
              <div className={cn(
                "flex-1 overflow-hidden flex flex-col",
                previewFile && "border-r"
              )}>
                <FileBrowser
                  initialFolder={initialFolder}
                  onSelect={handleFileSelect}
                  onDoubleClickFile={handleFileDoubleClick}
                  selectedFiles={selectedFiles}
                />
              </div>

              {/* Preview sidebar */}
              {previewFile && (
                <div className="mobile-scroll-area hidden w-64 overflow-y-auto p-3 sm:block">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-muted-foreground">Preview</span>
                    <button
                      onClick={() => setPreviewFile(null)}
                      className="text-muted-foreground hover:text-foreground text-xs"
                    >
                      &times;
                    </button>
                  </div>
                  <FilePreview file={previewFile} />
                </div>
              )}
            </>
          ) : (
            <div className="mobile-scroll-area flex-1 overflow-y-auto p-4">
              <FileUploader
                folderPath={currentFolder}
                onUploadComplete={handleUploadComplete}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[10px] text-muted-foreground">
            {selectedFiles.length > 0
              ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected`
              : "No files selected"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10 flex-1 text-xs sm:h-8 sm:flex-none"
              onClick={() => { resetState(); onOpenChange(false) }}
            >
              Cancel
            </Button>
            {(mode === "select" || mode === "attach") && (
              <Button
                size="sm"
                className="h-10 flex-1 text-xs sm:h-8 sm:flex-none"
                disabled={selectedFiles.length === 0}
                onClick={handleConfirmSelect}
              >
                {mode === "attach" ? "Attach" : "Select"}{" "}
                {selectedFiles.length > 0 && `(${selectedFiles.length})`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

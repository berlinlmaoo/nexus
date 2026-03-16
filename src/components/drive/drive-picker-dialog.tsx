"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DriveBrowser } from "./drive-browser"

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

interface DrivePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (file: DriveFile) => void
  title?: string
}

export function DrivePickerDialog({
  open,
  onOpenChange,
  onSelect,
  title = "Select from Google Drive",
}: DrivePickerDialogProps) {
  const handleSelect = (file: DriveFile) => {
    onSelect(file)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          <DriveBrowser selectable onSelect={handleSelect} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

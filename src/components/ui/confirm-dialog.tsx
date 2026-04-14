"use client"

import type { ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: "danger" | "default"
  icon?: ReactNode
  isLoading?: boolean
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  icon,
  isLoading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-4">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl",
              tone === "danger"
                ? "bg-red-500/10 text-red-600"
                : "bg-primary/10 text-primary"
            )}
          >
            {icon ?? <AlertTriangle className="h-5 w-5" />}
          </div>
          <div className="space-y-2">
            <DialogTitle className="text-xl">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="rounded-2xl"
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={isLoading}
            className={cn(
              "rounded-2xl",
              tone === "danger"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {isLoading ? "Please wait..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

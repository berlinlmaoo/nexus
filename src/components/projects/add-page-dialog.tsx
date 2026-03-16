"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const PAGE_TYPES = [
  { type: "tasks", label: "Tasks", icon: "💻", description: "Task list and board views" },
  { type: "calendar", label: "Calendar", icon: "📅", description: "Calendar view of tasks" },
  { type: "documents", label: "Documents", icon: "📁", description: "Document collection" },
  { type: "todo", label: "To Do List", icon: "⭐", description: "Simple checklist" },
  { type: "board", label: "Board", icon: "📋", description: "Kanban board view" },
  { type: "custom", label: "Custom Page", icon: "📄", description: "Free-form block editor" },
  { type: "database", label: "Database", icon: "🗃️", description: "Inline database table" },
]

const EMOJI_OPTIONS = ["📄", "💻", "📅", "📁", "⭐", "📋", "🗃️", "📝", "🎯", "🚀", "💡", "🔧", "📊", "🎨", "📌", "🏷️"]

interface AddPageDialogProps {
  projectId: string
  parentId?: string
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCreated?: () => void
}

export function AddPageDialog({
  projectId,
  parentId,
  children,
  open: controlledOpen,
  onOpenChange,
  onCreated,
}: AddPageDialogProps) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const [name, setName] = useState("")
  const [selectedType, setSelectedType] = useState("custom")
  const [selectedIcon, setSelectedIcon] = useState("📄")
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          icon: selectedIcon,
          pageType: selectedType,
          parentId: parentId || null,
        }),
      })
      if (res.ok) {
        const page = await res.json()
        setOpen(false)
        setName("")
        setSelectedType("custom")
        setSelectedIcon("📄")
        onCreated?.()
        router.push(`/projects/${projectId}/pages/${page.id}`)
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create page:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleTypeSelect = (type: string, icon: string) => {
    setSelectedType(type)
    setSelectedIcon(icon)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{parentId ? "Add Sub-page" : "Add Page"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Name + Icon */}
          <div className="space-y-2">
            <Label>Page Name</Label>
            <div className="flex gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/50 text-lg hover:bg-muted transition-colors"
                >
                  {selectedIcon}
                </button>
                {showEmojiPicker && (
                  <>
                    <div className="fixed inset-0 z-50" onClick={() => setShowEmojiPicker(false)} />
                    <div className="absolute left-0 top-full z-50 mt-1 grid grid-cols-8 gap-1 rounded-lg border bg-background p-2 shadow-lg">
                      {EMOJI_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => { setSelectedIcon(emoji); setShowEmojiPicker(false) }}
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-muted transition-colors",
                            selectedIcon === emoji && "bg-muted ring-1 ring-ring"
                          )}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Input
                placeholder="Page name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleCreate() }}
                autoFocus
              />
            </div>
          </div>

          {/* Page Type */}
          <div className="space-y-2">
            <Label>Page Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {PAGE_TYPES.map((pt) => (
                <button
                  key={pt.type}
                  onClick={() => handleTypeSelect(pt.type, pt.icon)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-all duration-150",
                    selectedType === pt.type
                      ? "border-foreground bg-muted"
                      : "border-border hover:border-border hover:bg-muted/50"
                  )}
                >
                  <span className="text-lg mt-0.5">{pt.icon}</span>
                  <div>
                    <p className="text-sm font-medium">{pt.label}</p>
                    <p className="text-[11px] text-muted-foreground">{pt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="w-full bg-foreground hover:bg-foreground/90"
          >
            {loading ? "Creating..." : "Create Page"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

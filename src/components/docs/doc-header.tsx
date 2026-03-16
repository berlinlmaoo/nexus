"use client"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  Image as ImageIcon,
  Smile,
  X,
  Loader2,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface DocHeaderProps {
  docId: string
  title: string
  icon: string | null
  coverImage: string | null
  breadcrumbs?: { id: string; title: string }[]
  projectName?: string
  projectColor?: string | null
  onTitleChange: (title: string) => void
  onTitleBlur: () => void
  onUpdate: (updates: Record<string, any>) => void
}

const PRESET_GRADIENTS = [
  "linear-gradient(135deg, #18181b 0%, #27272a 100%)",
  "linear-gradient(135deg, #27272a 0%, #3f3f46 100%)",
  "linear-gradient(135deg, #3f3f46 0%, #52525b 100%)",
  "linear-gradient(135deg, #52525b 0%, #71717a 100%)",
  "linear-gradient(135deg, #71717a 0%, #a1a1aa 100%)",
  "linear-gradient(135deg, #18181b 0%, #52525b 100%)",
]

const EMOJI_LIST = [
  "📄", "📝", "📋", "📌", "📎", "🔖", "📚", "📓",
  "💡", "🎯", "🚀", "⚡", "🔧", "🛠️", "📊", "📈",
  "🏗️", "🎨", "🧩", "🔑", "🗂️", "📂", "🗃️", "💻",
]

export function DocHeader({
  docId,
  title,
  icon,
  coverImage,
  breadcrumbs,
  projectName,
  projectColor,
  onTitleChange,
  onTitleBlur,
  onUpdate,
}: DocHeaderProps) {
  const [showCoverPicker, setShowCoverPicker] = useState(false)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [coverUrl, setCoverUrl] = useState(coverImage)
  const [selectedIcon, setSelectedIcon] = useState(icon)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCoverSelect = (gradient: string) => {
    setCoverUrl(gradient)
    setShowCoverPicker(false)
    onUpdate({ coverImage: gradient })
  }

  const handleCoverRemove = () => {
    setCoverUrl(null)
    setShowCoverPicker(false)
    onUpdate({ coverImage: null })
  }

  const handleIconSelect = (emoji: string) => {
    setSelectedIcon(emoji)
    setShowIconPicker(false)
    onUpdate({ icon: emoji })
  }

  const handleIconRemove = () => {
    setSelectedIcon(null)
    setShowIconPicker(false)
    onUpdate({ icon: null })
  }

  return (
    <div className="space-y-4">
      {/* Cover image */}
      {coverUrl ? (
        <div className="relative h-48 rounded-xl overflow-hidden group">
          <div
            className="w-full h-full"
            style={
              coverUrl.startsWith("linear-gradient")
                ? { background: coverUrl }
                : { backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
            }
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
          <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setShowCoverPicker(!showCoverPicker)}
              className="flex items-center gap-1.5 rounded-md bg-black/30 px-2.5 py-1.5 text-xs text-white/80 hover:bg-black/50 hover:text-white transition-all backdrop-blur-sm"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Change
            </button>
            <button
              onClick={handleCoverRemove}
              className="flex items-center gap-1.5 rounded-md bg-black/30 px-2.5 py-1.5 text-xs text-white/80 hover:bg-black/50 hover:text-white transition-all backdrop-blur-sm"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => setShowCoverPicker(!showCoverPicker)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Add cover
          </button>
          {!selectedIcon && (
            <button
              onClick={() => setShowIconPicker(!showIconPicker)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Smile className="h-3.5 w-3.5" />
              Add icon
            </button>
          )}
        </div>
      )}

      {/* Cover picker dropdown */}
      {showCoverPicker && (
        <div className="rounded-lg border bg-background p-3 shadow-lg animate-scale-in">
          <p className="text-xs font-medium mb-2">Choose Cover</p>
          <div className="grid grid-cols-3 gap-2">
            {PRESET_GRADIENTS.map((gradient, i) => (
              <button
                key={i}
                onClick={() => handleCoverSelect(gradient)}
                className="h-16 rounded-md transition-all hover:scale-105 hover:ring-2 hover:ring-ring"
                style={{ background: gradient }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Icon + Title */}
      <div className="flex items-start gap-3">
        {/* Icon */}
        {selectedIcon ? (
          <div className="relative">
            <button
              onClick={() => setShowIconPicker(!showIconPicker)}
              className="text-4xl hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg p-1 transition-colors"
            >
              {selectedIcon}
            </button>
          </div>
        ) : coverUrl ? (
          <button
            onClick={() => setShowIconPicker(!showIconPicker)}
            className="text-muted-foreground hover:text-foreground transition-colors mt-2"
          >
            <Smile className="h-5 w-5" />
          </button>
        ) : null}

        {/* Icon picker */}
        {showIconPicker && (
          <div className="absolute z-20 rounded-lg border bg-background p-3 shadow-lg animate-scale-in mt-14">
            <p className="text-xs font-medium mb-2">Choose Icon</p>
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleIconSelect(emoji)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-muted transition-all",
                    selectedIcon === emoji && "bg-muted ring-1 ring-ring"
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {selectedIcon && (
              <button
                onClick={handleIconRemove}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3 w-3" />
                Remove icon
              </button>
            )}
          </div>
        )}

        {/* Title */}
        <div className="flex-1">
          {/* Breadcrumbs */}
          {(breadcrumbs || projectName) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              {projectName && (
                <>
                  <span
                    className="font-medium"
                    style={projectColor ? { color: projectColor } : {}}
                  >
                    {projectName}
                  </span>
                  {breadcrumbs && breadcrumbs.length > 0 && (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </>
              )}
              {breadcrumbs?.map((crumb, i) => (
                <span key={crumb.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" />}
                  <span>{crumb.title}</span>
                </span>
              ))}
            </div>
          )}
          <input
            className="w-full text-3xl font-bold bg-transparent border-none outline-none focus:ring-0 p-0"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onTitleBlur}
            placeholder="Untitled"
          />
        </div>
      </div>
    </div>
  )
}

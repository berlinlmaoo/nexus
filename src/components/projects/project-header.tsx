"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Smile,
  Palette,
  Image as ImageIcon,
  Check,
  Pencil,
  Upload,
  X,
  Loader2,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ProjectIcon, isUploadedIcon } from "./project-icon"

interface ProjectHeaderProps {
  project: {
    id: string
    name: string
    description: string | null
    color: string
    icon: string
  }
}

const PRESET_COLORS = [
  "#18181b", "#27272a", "#3f3f46", "#52525b",
  "#71717a", "#a1a1aa", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
]

const PRESET_ICONS = [
  "folder", "rocket", "star", "zap", "target",
  "briefcase", "code", "globe", "heart", "shield",
  "layers", "box", "cpu", "database", "feather",
  "flag",
]

const ICON_MAP: Record<string, string> = {
  folder: "📁", rocket: "🚀", star: "⭐", zap: "⚡", target: "🎯",
  briefcase: "💼", code: "💻", globe: "🌍", heart: "❤️", shield: "🛡️",
  layers: "📚", box: "📦", cpu: "🔧", database: "🗄️", feather: "✏️",
  flag: "🏁",
}

const PRESET_GRADIENTS = [
  "from-zinc-800 to-zinc-900",
  "from-zinc-700 to-zinc-950",
  "from-zinc-600 to-zinc-900",
  "from-gray-700 to-gray-900",
  "from-neutral-700 to-neutral-900",
  "from-stone-700 to-stone-900",
]

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"]
const MAX_FILE_SIZE = 5 * 1024 * 1024

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const router = useRouter()
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showCoverPicker, setShowCoverPicker] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [projectName, setProjectName] = useState(project.name)
  const [editingDescription, setEditingDescription] = useState(false)
  const [description, setDescription] = useState(project.description || "")
  const [selectedIcon, setSelectedIcon] = useState(project.icon || "folder")
  const [selectedColor, setSelectedColor] = useState(project.color)
  const [coverGradient, setCoverGradient] = useState(PRESET_GRADIENTS[0])

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateProject = async (updates: Record<string, string>) => {
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      router.refresh()
    } catch (error) {
      console.error("Failed to update project:", error)
    }
  }

  const handleIconSelect = (icon: string) => {
    setSelectedIcon(icon)
    setShowIconPicker(false)
    updateProject({ icon })
  }

  const handleColorSelect = (color: string) => {
    setSelectedColor(color)
    setShowColorPicker(false)
    updateProject({ color })
  }

  const handleNameSave = () => {
    const trimmed = projectName.trim()
    if (trimmed && trimmed !== project.name) {
      updateProject({ name: trimmed })
    } else {
      setProjectName(project.name)
    }
    setEditingName(false)
  }

  const handleDescriptionSave = () => {
    setEditingDescription(false)
    updateProject({ description })
  }

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return "Invalid file type. Use PNG, JPG, SVG, or WEBP."
    }
    if (file.size > MAX_FILE_SIZE) {
      return "File too large. Maximum size is 5MB."
    }
    return null
  }

  const handleFileSelect = useCallback((file: File) => {
    setUploadError(null)
    const error = validateFile(file)
    if (error) {
      setUploadError(error)
      return
    }
    setUploadFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setUploadPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const handleUploadConfirm = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const formData = new FormData()
      formData.append("file", uploadFile)
      formData.append("projectId", project.id)

      const res = await fetch("/api/upload/project-icon", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Upload failed")
      }

      const { url } = await res.json()
      setSelectedIcon(url)
      setShowIconPicker(false)
      setUploadPreview(null)
      setUploadFile(null)
      updateProject({ icon: url })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveUploadedIcon = () => {
    setSelectedIcon("folder")
    setShowIconPicker(false)
    setUploadPreview(null)
    setUploadFile(null)
    updateProject({ icon: "folder" })
  }

  const clearUploadState = () => {
    setUploadPreview(null)
    setUploadFile(null)
    setUploadError(null)
  }

  const hasUploadedIcon = isUploadedIcon(selectedIcon)

  return (
    <div className="space-y-4 animate-fade-in px-6 pt-6 overflow-hidden">
      {/* Cover gradient */}
      <div className={cn("relative h-36 rounded-xl bg-gradient-to-r overflow-hidden transition-all duration-500", coverGradient)}>
        <button
          onClick={() => setShowCoverPicker(!showCoverPicker)}
          className="absolute top-3 right-3 flex items-center gap-1.5 rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-white/80 hover:bg-black/50 hover:text-white transition-all duration-200 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          Cover
        </button>

        {showCoverPicker && (
          <div className="absolute top-12 right-3 z-10 rounded-lg border bg-background p-3 shadow-lg animate-scale-in">
            <p className="text-xs font-medium mb-2">Select Cover</p>
            <div className="grid grid-cols-3 gap-2">
              {PRESET_GRADIENTS.map((gradient) => (
                <button
                  key={gradient}
                  onClick={() => { setCoverGradient(gradient); setShowCoverPicker(false) }}
                  className={cn(
                    "h-10 rounded-md bg-gradient-to-r transition-all duration-200 hover:scale-105",
                    gradient,
                    coverGradient === gradient && "ring-2 ring-white ring-offset-2"
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Project info row */}
      <div className="flex items-start gap-4 -mt-10 ml-6 relative z-10">
        {/* Icon */}
        <div className="relative">
          <button
            onClick={() => { setShowIconPicker(!showIconPicker); clearUploadState() }}
            className="flex h-16 w-16 items-center justify-center rounded-xl border-4 border-background bg-background text-2xl shadow-sm transition-all duration-200 hover:shadow-md hover:scale-105 active:scale-95 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={!hasUploadedIcon ? { backgroundColor: selectedColor + "15" } : undefined}
          >
            {hasUploadedIcon ? (
              <Image
                src={selectedIcon}
                alt="Project icon"
                fill
                className="object-cover"
                sizes="64px"
              />
            ) : (
              ICON_MAP[selectedIcon] || "📁"
            )}
          </button>

          <Dialog open={showIconPicker} onOpenChange={(open) => { setShowIconPicker(open); if (!open) clearUploadState() }}>
            <DialogContent className="sm:max-w-[340px] p-0">
              <DialogHeader className="px-4 pt-4 pb-0">
                <DialogTitle className="text-sm font-medium">Change Icon</DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="emoji" className="w-full">
                <div className="px-4">
                  <TabsList className="w-full h-9">
                    <TabsTrigger value="emoji" className="flex-1 text-xs gap-1.5">
                      <Smile className="h-3.5 w-3.5" />
                      Emoji
                    </TabsTrigger>
                    <TabsTrigger value="upload" className="flex-1 text-xs gap-1.5">
                      <Upload className="h-3.5 w-3.5" />
                      Upload
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Emoji Tab */}
                <TabsContent value="emoji" className="px-4 pb-4">
                  <div className="grid grid-cols-8 gap-1">
                    {PRESET_ICONS.map((icon) => (
                      <button
                        key={icon}
                        onClick={() => handleIconSelect(icon)}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-md text-sm hover:bg-muted transition-all duration-150",
                          selectedIcon === icon && "bg-muted ring-1 ring-ring"
                        )}
                      >
                        {ICON_MAP[icon]}
                      </button>
                    ))}
                  </div>
                  {hasUploadedIcon && (
                    <button
                      onClick={handleRemoveUploadedIcon}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove uploaded icon
                    </button>
                  )}
                </TabsContent>

                {/* Upload Tab */}
                <TabsContent value="upload" className="px-4 pb-4">
                  {uploadPreview ? (
                    <div className="space-y-3">
                      {/* Preview */}
                      <div className="flex flex-col items-center gap-3">
                        <div className="relative h-20 w-20 overflow-hidden rounded-full border-2 border-border">
                          <Image
                            src={uploadPreview}
                            alt="Preview"
                            fill
                            className="object-cover"
                            sizes="80px"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground truncate max-w-full">
                          {uploadFile?.name}
                        </p>
                      </div>

                      {uploadError && (
                        <p className="text-xs text-red-500 text-center">{uploadError}</p>
                      )}

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-xs"
                          onClick={clearUploadState}
                          disabled={uploading}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 text-xs bg-foreground text-background hover:bg-foreground/90"
                          onClick={handleUploadConfirm}
                          disabled={uploading}
                        >
                          {uploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Drop zone */}
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-6 cursor-pointer transition-all duration-200",
                          dragOver
                            ? "border-ring bg-muted"
                            : "border-border hover:border-border hover:bg-accent"
                        )}
                      >
                        <div className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-full bg-muted transition-all duration-200",
                          dragOver && "bg-muted scale-110"
                        )}>
                          <Upload className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="text-center">
                          <p className="text-xs font-medium text-muted-foreground">
                            Drop image here or click to browse
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            PNG, JPG, SVG, WEBP · Max 5MB
                          </p>
                        </div>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.svg,.webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleFileSelect(file)
                          e.target.value = ""
                        }}
                      />

                      {uploadError && (
                        <p className="text-xs text-red-500 text-center">{uploadError}</p>
                      )}

                      {hasUploadedIcon && (
                        <button
                          onClick={handleRemoveUploadedIcon}
                          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove uploaded icon
                        </button>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        </div>

        {/* Name and description */}
        <div className="flex-1 pt-6">
          <div className="flex items-center gap-3">
            {editingName ? (
              <input
                autoFocus
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleNameSave(); if (e.key === "Escape") { setProjectName(project.name); setEditingName(false) } }}
                onBlur={handleNameSave}
                className="text-2xl font-bold tracking-tight bg-transparent border-b-2 border-foreground/30 outline-none focus:border-foreground px-0 py-0 transition-colors"
              />
            ) : (
              <h1
                className="text-2xl font-bold tracking-tight cursor-pointer hover:bg-muted/50 rounded-md px-1.5 -mx-1.5 py-0.5 transition-colors duration-200"
                onClick={() => setEditingName(true)}
              >
                {projectName}
              </h1>
            )}

            {/* Color picker trigger */}
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-all duration-200"
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedColor }} />
                <Palette className="h-3 w-3" />
              </button>

              {showColorPicker && (
                <div className="absolute top-full left-0 mt-1 z-20 rounded-lg border bg-background p-3 shadow-lg animate-scale-in">
                  <p className="text-xs font-medium mb-2">Project Color</p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => handleColorSelect(color)}
                        className="relative flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 hover:scale-110"
                        style={{ backgroundColor: color }}
                      >
                        {selectedColor === color && (
                          <Check className="h-3.5 w-3.5 text-white" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="mt-2">
            {editingDescription ? (
              <div className="flex items-center gap-2 animate-fade-in">
                <input
                  autoFocus
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleDescriptionSave(); if (e.key === "Escape") setEditingDescription(false) }}
                  className="flex-1 rounded-md border px-2 py-1 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-all"
                  placeholder="Add a project description..."
                />
                <Button size="sm" variant="outline" onClick={handleDescriptionSave}>
                  Save
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setEditingDescription(true)}
                className="group flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                <span className="text-sm">
                  {description || "Add a description..."}
                </span>
                <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

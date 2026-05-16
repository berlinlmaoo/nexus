"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { UserAvatar } from "@/components/ui/user-avatar"
import {
  Smile,
  Palette,
  Image as ImageIcon,
  Check,
  Pencil,
  Upload,
  Loader2,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { isUploadedIcon } from "./project-icon"
import { ProjectCustomFieldsManager } from "./project-custom-fields-manager"
import { ProjectFormsManager } from "./project-forms-manager"

interface ProjectHeaderProps {
  project: {
    id: string
    name: string
    description: string | null
    color: string
    icon: string
    enableTaskBatchDuplicate: boolean
    autoAssignEnabled: boolean
    autoAssignAssigneeIds: string[]
    members: {
      id: string
      name: string
      avatar: string | null
      role: string
    }[]
  }
  onProjectChange?: (project: {
    id: string
    name: string
    description: string | null
    color: string
    icon: string
    enableTaskBatchDuplicate: boolean
    autoAssignEnabled: boolean
    autoAssignAssigneeIds: string[]
  }) => void
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

export function ProjectHeader({ project, onProjectChange }: ProjectHeaderProps) {
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
  const [enableTaskBatchDuplicate, setEnableTaskBatchDuplicate] = useState(project.enableTaskBatchDuplicate)
  const [autoAssignEnabled, setAutoAssignEnabled] = useState(project.autoAssignEnabled)
  const [autoAssignAssigneeIds, setAutoAssignAssigneeIds] = useState(project.autoAssignAssigneeIds)
  const [autoAssignError, setAutoAssignError] = useState<string | null>(null)
  const [coverGradient, setCoverGradient] = useState(PRESET_GRADIENTS[0])
  const [coverImage] = useState<string | null>(null)

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setProjectName(project.name)
    setDescription(project.description || "")
    setSelectedIcon(project.icon || "folder")
    setSelectedColor(project.color)
    setEnableTaskBatchDuplicate(project.enableTaskBatchDuplicate)
    setAutoAssignEnabled(project.autoAssignEnabled)
    setAutoAssignAssigneeIds(project.autoAssignAssigneeIds)
    setAutoAssignError(null)
  }, [
    project.name,
    project.description,
    project.icon,
    project.color,
    project.enableTaskBatchDuplicate,
    project.autoAssignEnabled,
    project.autoAssignAssigneeIds,
  ])

  const updateProject = async (updates: Record<string, string | boolean | string[] | null>) => {
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        throw new Error("Failed to update project")
      }

      const updatedProject = await res.json()
      const nextProject = {
        id: updatedProject.id ?? project.id,
        name: updatedProject.name ?? project.name,
        description: updatedProject.description ?? project.description,
        color: updatedProject.color ?? project.color,
        icon: updatedProject.icon ?? project.icon,
        enableTaskBatchDuplicate: updatedProject.enableTaskBatchDuplicate ?? project.enableTaskBatchDuplicate,
        autoAssignEnabled: updatedProject.autoAssignEnabled ?? project.autoAssignEnabled,
        autoAssignAssigneeIds: updatedProject.autoAssignAssigneeIds ?? project.autoAssignAssigneeIds,
      }

      onProjectChange?.(nextProject)

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("project-updated", {
            detail: { project: nextProject },
          })
        )
      }

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

  const handleBatchDuplicateToggle = (checked: boolean) => {
    setEnableTaskBatchDuplicate(checked)
    updateProject({ enableTaskBatchDuplicate: checked })
  }

  const handleAutoAssignToggle = async (checked: boolean) => {
    if (checked && autoAssignAssigneeIds.length === 0) {
      setAutoAssignError("Select at least one project member before enabling auto assign.")
      return
    }

    setAutoAssignError(null)
    setAutoAssignEnabled(checked)
    await updateProject({ autoAssignEnabled: checked })
  }

  const handleAutoAssignMemberToggle = async (memberId: string, checked: boolean) => {
    const nextAssigneeIds = checked
      ? [...autoAssignAssigneeIds, memberId]
      : autoAssignAssigneeIds.filter((id) => id !== memberId)

    const dedupedAssigneeIds = Array.from(new Set(nextAssigneeIds))
    const nextEnabled = dedupedAssigneeIds.length > 0

    setAutoAssignError(null)
    setAutoAssignAssigneeIds(dedupedAssigneeIds)
    setAutoAssignEnabled(nextEnabled)

    await updateProject({
      autoAssignEnabled: nextEnabled,
      autoAssignAssigneeIds: dedupedAssigneeIds,
    })
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
    <div className="space-y-3 animate-fade-in px-4 pt-4">
      {/* Cover gradient — only show when there's a custom cover image */}
      {coverImage && <div className={cn("relative rounded-xl bg-gradient-to-r overflow-hidden transition-all duration-500", coverGradient, "h-36")}>
        <button
          onClick={() => setShowCoverPicker(!showCoverPicker)}
          className={cn(
            "absolute right-3 flex items-center gap-1.5 rounded-lg bg-black/30 text-xs text-white/80 hover:bg-black/50 hover:text-white transition-all duration-200 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
            coverImage ? "top-3 px-2.5 py-1.5" : "top-1 px-2 py-0.5"
          )}
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
      </div>}

      {/* Project info row */}
      <div className={cn("flex items-start gap-4 relative z-10", coverImage ? "-mt-10" : "mt-0")}>
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
        <div className="flex-1 pt-2">
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
            <Popover open={showColorPicker} onOpenChange={setShowColorPicker}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-all duration-200"
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedColor }} />
                  <Palette className="h-3 w-3" />
                </button>
              </PopoverTrigger>

              <PopoverContent align="start" sideOffset={8} className="w-auto rounded-xl border bg-background p-3 shadow-lg">
                <p className="mb-2 text-xs font-medium">Project Color</p>
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
              </PopoverContent>
            </Popover>
          </div>

          {/* Description */}
          <div className="mt-1">
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

      <div className="rounded-2xl border bg-card/80 px-4 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Task duplicate mode</p>
            <p className="text-xs text-muted-foreground">
              Turn on multi-select duplicate with a due date popup for repeating task sets like PATS Socials.
            </p>
          </div>
          <Switch
            checked={enableTaskBatchDuplicate}
            onCheckedChange={handleBatchDuplicateToggle}
            aria-label="Enable task batch duplicate"
          />
        </div>
      </div>

      <div className="rounded-2xl border bg-card/80 px-4 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Auto assign</p>
            <p className="text-xs text-muted-foreground">
              Automatically assign selected project members to newly created tasks in this project.
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              Only applies to new tasks created in this project. If someone chooses assignees manually while creating a task, auto assign will be skipped.
            </p>
          </div>
          <Switch
            checked={autoAssignEnabled}
            onCheckedChange={handleAutoAssignToggle}
            aria-label="Enable auto assign for new tasks"
            disabled={!autoAssignEnabled && autoAssignAssigneeIds.length === 0}
          />
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-dashed bg-background/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Default Assignees
            </p>
            <div className="mt-3 grid gap-2">
              {project.members.map((member) => {
                const checked = autoAssignAssigneeIds.includes(member.id)

                return (
                  <label
                    key={member.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors",
                      checked ? "border-foreground/20 bg-muted/50" : "border-border bg-background hover:bg-muted/30"
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => handleAutoAssignMemberToggle(member.id, value === true)}
                      aria-label={`Auto assign ${member.name}`}
                    />
                    <UserAvatar user={{ name: member.name, avatar: member.avatar }} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{member.role}</p>
                    </div>
                    {checked && (
                      <span className="rounded-full bg-foreground px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-background">
                        Default
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>

          {autoAssignError ? (
            <p className="text-xs text-red-500">{autoAssignError}</p>
          ) : autoAssignAssigneeIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Select at least one project member to enable auto assign.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {autoAssignEnabled
                ? `${autoAssignAssigneeIds.length} default assignee${autoAssignAssigneeIds.length > 1 ? "s" : ""} will be added to new tasks automatically.`
                : "Default assignees are saved, but auto assign is currently turned off. Turn on the toggle to activate it."}
            </p>
          )}
        </div>
      </div>

      <ProjectCustomFieldsManager projectId={project.id} />
      <ProjectFormsManager projectId={project.id} />
    </div>
  )
}

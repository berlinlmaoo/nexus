"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Folder,
  LayoutGrid,
  Code,
  Briefcase,
  Rocket,
  Star,
  Zap,
  Plus,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

const PRESET_COLORS = [
  "#18181B",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#06B6D4",
  "#84CC16",
  "#F97316",
]

const ICONS = [
  { id: "folder", icon: Folder, label: "Folder" },
  { id: "grid", icon: LayoutGrid, label: "Grid" },
  { id: "code", icon: Code, label: "Code" },
  { id: "briefcase", icon: Briefcase, label: "Briefcase" },
  { id: "rocket", icon: Rocket, label: "Rocket" },
  { id: "star", icon: Star, label: "Star" },
  { id: "zap", icon: Zap, label: "Zap" },
]

interface CreateProjectDialogProps {
  workspaceId: string
  children?: React.ReactNode
}

export function CreateProjectDialog({
  workspaceId,
  children,
}: CreateProjectDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [icon, setIcon] = useState("folder")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          color,
          icon,
          workspaceId,
        }),
      })

      if (res.ok) {
        setOpen(false)
        setName("")
        setDescription("")
        setColor(PRESET_COLORS[0])
        setIcon("folder")
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to create project:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Add a new project to your workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                placeholder="e.g. Website Redesign"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="project-description">Description</Label>
              <textarea
                id="project-description"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                placeholder="Describe your project..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      "h-8 w-8 rounded-full transition-all duration-150 ring-offset-background",
                      color === c
                        ? "ring-2 ring-offset-2 ring-[#18181B] scale-110"
                        : "hover:scale-105"
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-2">
                {ICONS.map((item) => {
                  const IconComp = item.icon
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg border transition-all duration-150",
                        icon === item.id
                          ? "border-[#18181B] bg-[#18181B]/10 text-[#18181B]"
                          : "border-input hover:border-[#18181B]/50 hover:bg-accent"
                      )}
                      onClick={() => setIcon(item.id)}
                      title={item.label}
                    >
                      <IconComp className="h-5 w-5" />
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

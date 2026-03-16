"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Save, Loader2, Check, Copy } from "lucide-react"

const STORAGE_KEY = "nexus-project-templates"

interface TemplateSection {
  name: string
  position: number
  taskCount: number
}

interface ProjectTemplate {
  id: string
  name: string
  description: string
  createdAt: string
  sourceProjectId: string
  sections: TemplateSection[]
  structure: {
    taskLists: Array<{
      id: string
      name: string
      position: number
      tasks: Array<{
        title: string
        status: string
        priority: string
        position: number
        tags: string[]
      }>
    }>
    customFields?: Array<{
      name: string
      type: string
    }>
  }
}

interface SaveTemplateDialogProps {
  project: { id: string; name: string }
  children: React.ReactNode
}

export function SaveTemplateDialog({
  project,
  children,
}: SaveTemplateDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return

    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`)
      if (!res.ok) throw new Error("Failed to fetch project")

      const projectData = await res.json()

      const sections: TemplateSection[] = (projectData.taskLists || []).map(
        (tl: { name: string; position: number; tasks?: unknown[] }) => ({
          name: tl.name,
          position: tl.position,
          taskCount: tl.tasks?.length || 0,
        })
      )

      const structure = {
        taskLists: (projectData.taskLists || []).map(
          (tl: {
            id: string
            name: string
            position: number
            tasks?: Array<{
              title: string
              status: string
              priority: string
              position: number
              tags?: string[]
            }>
          }) => ({
            id: tl.id,
            name: tl.name,
            position: tl.position,
            tasks: (tl.tasks || []).map((t) => ({
              title: t.title,
              status: t.status,
              priority: t.priority,
              position: t.position,
              tags: t.tags || [],
            })),
          })
        ),
        customFields: projectData.customFields || [],
      }

      const template: ProjectTemplate = {
        id: crypto.randomUUID(),
        name: name.trim(),
        description: description.trim(),
        createdAt: new Date().toISOString(),
        sourceProjectId: project.id,
        sections,
        structure,
      }

      const existing = getTemplates()
      existing.push(template)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))

      setSuccess(true)
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
        setName("")
        setDescription("")
      }, 1500)
    } catch (error) {
      console.error("Failed to save template:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        {success ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground mb-4 animate-in zoom-in-50 duration-300">
              <Check className="h-8 w-8 text-background" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Template Saved
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              You can now create new projects from this template.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Copy className="h-5 w-5 text-muted-foreground" />
                Save as Template
              </DialogTitle>
              <DialogDescription>
                Save the structure of &ldquo;{project.name}&rdquo; as a
                reusable template.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="template-name">Template Name</Label>
                <Input
                  id="template-name"
                  placeholder="e.g. Sprint Planning Template"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="focus-visible:ring-ring"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="template-description">Description</Label>
                <Textarea
                  id="template-description"
                  placeholder="Describe what this template is useful for..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[80px] resize-none focus-visible:ring-ring"
                />
              </div>

              <div className="rounded-lg border border-border bg-muted p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  What will be saved:
                </p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                    Task list structure and names
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                    Task titles, statuses, and priorities
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                    Custom field definitions
                  </li>
                </ul>
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
              <Button
                onClick={handleSave}
                disabled={loading || !name.trim()}
                className="bg-foreground hover:bg-foreground/90"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Template
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function getTemplates(): ProjectTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ProjectTemplate[]
  } catch {
    return []
  }
}

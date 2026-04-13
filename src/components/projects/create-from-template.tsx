"use client"

import { useState, useEffect, useCallback } from "react"
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
  Copy,
  Loader2,
  Trash2,
  ArrowLeft,
  Calendar,
  FolderOpen,
  Layers,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

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
      position?: number
      options?: unknown
    }>
  }
}

interface CreateFromTemplateDialogProps {
  children: React.ReactNode
  onCreated?: () => void
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

function deleteTemplate(id: string) {
  const templates = getTemplates().filter((t) => t.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export function CreateFromTemplateDialog({
  children,
  onCreated,
}: CreateFromTemplateDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] =
    useState<ProjectTemplate | null>(null)
  const [projectName, setProjectName] = useState("")
  const [startDate, setStartDate] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      setTemplates(getTemplates())
      setSelectedTemplate(null)
      setProjectName("")
      setStartDate("")
    }
  }, [open])

  const handleSelectTemplate = useCallback((template: ProjectTemplate) => {
    setSelectedTemplate(template)
    setProjectName(`${template.name} Project`)
  }, [])

  const handleBack = useCallback(() => {
    setSelectedTemplate(null)
    setProjectName("")
    setStartDate("")
  }, [])

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      deleteTemplate(id)
      setTemplates(getTemplates())
      if (selectedTemplate?.id === id) {
        setSelectedTemplate(null)
      }
    },
    [selectedTemplate]
  )

  const handleCreate = async () => {
    if (!selectedTemplate || !projectName.trim()) return

    setCreating(true)
    try {
      // Get workspaceId from current URL or use a default
      const workspaceId = getWorkspaceId()

      // Create the project
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          description: `Created from template: ${selectedTemplate.name}`,
          workspaceId,
        }),
      })

      if (!res.ok) throw new Error("Failed to create project")

      const project = await res.json()

      if (selectedTemplate.structure.customFields?.length) {
        for (const field of selectedTemplate.structure.customFields) {
          await fetch("/api/custom-fields", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: field.name,
              type: field.type,
              options: field.options,
              projectId: project.id,
            }),
          })
        }
      }

      // The project is created with default task lists (To Do, In Progress, Done).
      // If the template has different sections, we could create additional task lists.
      // For now, the template structure is preserved in the project description
      // and the default task lists are used as the starting point.

      // Create tasks from template structure in existing task lists
      if (
        selectedTemplate.structure.taskLists.length > 0 &&
        project.taskLists?.length > 0
      ) {
        const templateLists = selectedTemplate.structure.taskLists
        const projectLists = project.taskLists as Array<{
          id: string
          name: string
          position: number
        }>

        for (const templateList of templateLists) {
          // Match template list to project list by position, or use first available
          const targetList =
            projectLists.find((pl) => pl.position === templateList.position) ||
            projectLists[0]

          if (targetList && templateList.tasks) {
            for (const task of templateList.tasks) {
              await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: task.title,
                  status: task.status,
                  priority: task.priority,
                  position: task.position,
                  projectId: project.id,
                  taskListId: targetList.id,
                  tags: task.tags || [],
                  ...(startDate && { startDate }),
                }),
              })
            }
          }
        }
      }

      setOpen(false)
      router.refresh()
      onCreated?.()
    } catch (error) {
      console.error("Failed to create project from template:", error)
    } finally {
      setCreating(false)
    }
  }

  const totalTasks = selectedTemplate
    ? selectedTemplate.sections.reduce((sum, s) => sum + s.taskCount, 0)
    : 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[540px]">
        <AnimatePresence mode="wait">
          {selectedTemplate ? (
            <motion.div
              key="customize"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBack}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div>
                    <DialogTitle>Customize Project</DialogTitle>
                    <DialogDescription>
                      Using template: {selectedTemplate.name}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="project-name">Project Name</Label>
                  <Input
                    id="project-name"
                    placeholder="Enter project name"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="focus-visible:ring-ring"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="start-date" className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    Start Date
                  </Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="focus-visible:ring-ring"
                  />
                </div>

                <div className="rounded-lg border border-border bg-muted p-4">
                  <p className="text-sm font-medium text-muted-foreground mb-3">
                    Template Structure
                  </p>
                  <div className="space-y-2">
                    {selectedTemplate.sections.map((section, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground/60" />
                          {section.name}
                        </div>
                        <span className="text-xs text-muted-foreground/60">
                          {section.taskCount}{" "}
                          {section.taskCount === 1 ? "task" : "tasks"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {selectedTemplate.sections.length} lists
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {totalTasks} total tasks
                    </span>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleBack}>
                  Back
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={creating || !projectName.trim()}
                  className="bg-foreground hover:bg-foreground/90"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Create Project
                </Button>
              </DialogFooter>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Copy className="h-5 w-5 text-muted-foreground" />
                  Create from Template
                </DialogTitle>
                <DialogDescription>
                  Choose a saved template to create a new project.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4">
                {templates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                      <FolderOpen className="h-7 w-7 text-muted-foreground/60" />
                    </div>
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      No templates yet
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
                      Save an existing project as a template to reuse its
                      structure for new projects.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                    {templates.map((template) => (
                      <motion.div
                        key={template.id}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        transition={{ duration: 0.15 }}
                      >
                        <button
                          className="w-full text-left rounded-lg border border-border p-4 hover:border-border hover:bg-accent transition-all duration-200 group"
                          onClick={() => handleSelectTemplate(template)}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-foreground truncate">
                                {template.name}
                              </h4>
                              {template.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {template.description}
                                </p>
                              )}
                              <div className="flex items-center gap-3 mt-2">
                                <span className="text-[11px] text-muted-foreground/60">
                                  {template.sections.length} lists
                                </span>
                                <span className="text-[11px] text-muted-foreground/60">
                                  {template.sections.reduce(
                                    (sum, s) => sum + s.taskCount,
                                    0
                                  )}{" "}
                                  tasks
                                </span>
                                <span className="text-[11px] text-muted-foreground/60">
                                  {new Date(
                                    template.createdAt
                                  ).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => handleDelete(e, template.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-muted-foreground transition-all duration-200"
                              title="Delete template"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {templates.length > 0 && (
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                </DialogFooter>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}

function getWorkspaceId(): string {
  // Try to extract workspaceId from the current URL path
  if (typeof window !== "undefined") {
    const match = window.location.pathname.match(
      /\/workspaces\/([^/]+)/
    )
    if (match) return match[1]

    // Fallback: try localStorage
    try {
      const stored = localStorage.getItem("nexus-active-workspace")
      if (stored) return stored
    } catch {}
  }
  return ""
}

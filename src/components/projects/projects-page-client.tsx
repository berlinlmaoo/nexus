"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { ProjectCard, type ProjectCardData } from "./project-card"
import { CreateProjectDialog } from "./create-project-dialog"
import { CreateFromTemplateDialog } from "./create-from-template"
import { Button } from "@/components/ui/button"
import { Search, FolderOpen, FileStack } from "lucide-react"

interface ProjectsPageClientProps {
  projects: ProjectCardData[]
  workspaceId: string
}

export function ProjectsPageClient({
  projects,
  workspaceId,
}: ProjectsPageClientProps) {
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!search.trim()) return projects
    const q = search.toLowerCase()
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
    )
  }, [projects, search])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Manage and track all your projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CreateFromTemplateDialog onCreated={() => window.location.reload()}>
            <Button variant="outline" className="transition-all duration-200 active:scale-95">
              <FileStack className="h-4 w-4 mr-2" />
              From Template
            </Button>
          </CreateFromTemplateDialog>
          <CreateProjectDialog workspaceId={workspaceId} />
        </div>
      </div>

      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">No projects found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {search
              ? "Try a different search term"
              : "Create your first project to get started"}
          </p>
        </div>
      )}
    </div>
  )
}

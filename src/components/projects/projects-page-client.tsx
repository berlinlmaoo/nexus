"use client"

import { useState, useMemo } from "react"
import { ProjectCard, type ProjectCardData } from "./project-card"
import { CreateProjectDialog } from "./create-project-dialog"
import { CreateFromTemplateDialog } from "./create-from-template"
import { Button } from "@/components/ui/button"
import { Search, FolderOpen, FileStack, Plus, LayoutGrid } from "lucide-react"
import { cn } from "@/lib/utils"

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
    <div className="max-w-[1600px] mx-auto space-y-12 animate-fade-in pb-20">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-headline font-black tracking-tighter text-primary">
            Workspace Projects
          </h1>
          <p className="text-on-surface-variant/60 font-medium text-lg flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Managing {projects.length} active initiatives
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-surface-container-low p-1.5 rounded-2xl">
          <CreateFromTemplateDialog onCreated={() => window.location.reload()}>
            <Button variant="ghost" className="rounded-xl font-bold text-[11px] uppercase tracking-widest text-on-surface-variant/60 hover:text-primary hover:bg-surface-container transition-all">
              <FileStack className="h-4 w-4 mr-2" />
              Templates
            </Button>
          </CreateFromTemplateDialog>
          <div className="h-6 w-[1px] bg-on-surface-variant/10" />
          <CreateProjectDialog workspaceId={workspaceId} />
        </div>
      </div>

      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative w-full sm:max-w-md group">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/30 group-focus-within:text-primary transition-colors" />
          <input
            placeholder="Find projects by designation..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-12 bg-surface-container-low border-none rounded-2xl pl-12 pr-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all"
          />
        </div>
        
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-surface-container-low text-on-surface-variant/40 hover:text-primary hover:bg-surface-container">
            <LayoutGrid className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center bg-surface-container-low/20 rounded-[3rem] border-2 border-dashed border-on-surface-variant/5">
          <div className="w-20 h-20 rounded-3xl bg-surface-container flex items-center justify-center text-on-surface-variant/20 mb-6">
            <FolderOpen className="h-10 w-10" />
          </div>
          <h3 className="text-2xl font-headline font-black text-primary tracking-tight">No projects found</h3>
          <p className="text-on-surface-variant/40 mt-2 max-w-xs mx-auto">
            {search
              ? "Your search query yielded no results in this workspace."
              : "This workspace is currently at rest. Initiate a new project to begin."}
          </p>
        </div>
      )}
    </div>
  )
}

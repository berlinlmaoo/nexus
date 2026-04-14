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
    <div className="mx-auto max-w-[1600px] space-y-8 animate-fade-in pb-24 sm:space-y-12">
      {/* Header Section */}
      <div className="flex flex-col justify-between gap-4 sm:gap-8 md:flex-row md:items-end">
        <div className="space-y-2">
          <h1 className="text-3xl font-headline font-black tracking-tighter text-primary sm:text-5xl">
            Workspace Projects
          </h1>
          <p className="flex items-center gap-3 text-sm font-medium text-on-surface-variant/60 sm:text-lg">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Managing {projects.length} active initiatives
          </p>
        </div>
        
        <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-container-low p-1.5 md:w-auto md:flex-nowrap md:justify-start">
          <CreateFromTemplateDialog onCreated={() => window.location.reload()}>
            <Button variant="ghost" className="flex-1 rounded-xl font-bold text-[11px] uppercase tracking-widest text-on-surface-variant/60 transition-all hover:bg-surface-container hover:text-primary md:flex-none">
              <FileStack className="h-4 w-4 mr-2" />
              Templates
            </Button>
          </CreateFromTemplateDialog>
          <div className="hidden h-6 w-[1px] bg-on-surface-variant/10 md:block" />
          <CreateProjectDialog workspaceId={workspaceId} />
        </div>
      </div>

      {/* Control Bar */}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
        <div className="relative w-full sm:max-w-md group">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/30 group-focus-within:text-primary transition-colors" />
          <input
            placeholder="Find projects by designation..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-12 bg-surface-container-low border-none rounded-2xl pl-12 pr-4 text-sm font-bold text-primary placeholder:text-on-surface-variant/20 focus:ring-2 focus:ring-primary/5 focus:bg-surface-container-lowest transition-all"
          />
        </div>
        
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-surface-container-low text-on-surface-variant/40 hover:text-primary hover:bg-surface-container">
            <LayoutGrid className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2 xl:grid-cols-3 xl:gap-8">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-[2rem] border-2 border-dashed border-on-surface-variant/5 bg-surface-container-low/20 py-20 text-center sm:rounded-[3rem] sm:py-32">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-container text-on-surface-variant/20 sm:h-20 sm:w-20">
            <FolderOpen className="h-10 w-10" />
          </div>
          <h3 className="text-xl font-headline font-black tracking-tight text-primary sm:text-2xl">No projects found</h3>
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

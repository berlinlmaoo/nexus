"use client"

import Link from "next/link"
import { FolderOpen, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface ProjectSummary {
  id: string
  name: string
  color: string
  totalTasks: number
  completedTasks: number
  overdueTasks: number
  progress: number
}

interface ProjectSummaryWidgetProps {
  data?: {
    projects?: ProjectSummary[]
  }
}

export function ProjectSummaryWidget({ data }: ProjectSummaryWidgetProps) {
  const projects = data?.projects ?? []

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{projects.length} projects</span>
      </div>

      {projects.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No active projects
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group rounded-lg border p-3 hover:shadow-sm transition-all duration-200"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="h-2.5 w-2.5 rounded flex-shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <h4 className="font-medium text-sm truncate group-hover:text-muted-foreground transition-colors">
                  {project.name}
                </h4>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${project.progress}%`,
                    backgroundColor: project.color,
                  }}
                />
              </div>

              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-muted-foreground">
                  {project.completedTasks}/{project.totalTasks} tasks
                </span>
                <div className="flex items-center gap-2">
                  {project.overdueTasks > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-red-500 font-medium">
                      <AlertCircle className="h-3 w-3" />
                      {project.overdueTasks}
                    </span>
                  )}
                  <span className="text-[11px] font-medium">
                    {project.progress}%
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

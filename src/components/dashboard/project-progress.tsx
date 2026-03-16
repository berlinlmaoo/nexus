"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface ProjectData {
  id: string
  name: string
  color: string
  totalTasks: number
  completedTasks: number
  progress: number
}

interface ProjectProgressProps {
  projects: ProjectData[]
}

export function ProjectProgress({ projects }: ProjectProgressProps) {
  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Projects</CardTitle>
          <Link
            href="/projects"
            className="text-sm text-foreground hover:text-muted-foreground transition-colors"
          >
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {projects.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No active projects
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group rounded-lg border p-4 hover:shadow-md transition-all duration-200"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className="h-3 w-3 rounded flex-shrink-0"
                    style={{ backgroundColor: project.color }}
                  />
                  <h3 className="font-medium text-sm truncate group-hover:text-muted-foreground transition-colors">
                    {project.name}
                  </h3>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${project.progress}%`,
                      backgroundColor: project.color,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">
                    {project.completedTasks} / {project.totalTasks} tasks
                  </span>
                  <span className="text-xs font-medium">{project.progress}%</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

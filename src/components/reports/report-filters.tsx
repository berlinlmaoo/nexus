"use client"

import { Button } from "@/components/ui/button"
import { Filter, X } from "lucide-react"
import { useState } from "react"

interface Project {
  id: string
  name: string
}

interface ReportFiltersProps {
  projects: Project[]
  members: { id: string; name: string }[]
  selectedProjects: string[]
  selectedMembers: string[]
  dateRange: string
  onProjectsChange: (ids: string[]) => void
  onMembersChange: (ids: string[]) => void
  onDateRangeChange: (range: string) => void
}

export function ReportFilters({
  projects,
  members,
  selectedProjects,
  selectedMembers,
  dateRange,
  onProjectsChange,
  onMembersChange,
  onDateRangeChange,
}: ReportFiltersProps) {
  const [showFilters, setShowFilters] = useState(false)

  const hasFilters = selectedProjects.length > 0 || selectedMembers.length > 0

  const clearFilters = () => {
    onProjectsChange([])
    onMembersChange([])
  }

  const toggleProject = (id: string) => {
    onProjectsChange(
      selectedProjects.includes(id)
        ? selectedProjects.filter((p) => p !== id)
        : [...selectedProjects, id]
    )
  }

  const toggleMember = (id: string) => {
    onMembersChange(
      selectedMembers.includes(id)
        ? selectedMembers.filter((m) => m !== id)
        : [...selectedMembers, id]
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date range selector */}
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
          {[
            { label: "30d", value: "30" },
            { label: "60d", value: "60" },
            { label: "90d", value: "90" },
          ].map(({ label, value }) => (
            <button
              key={value}
              onClick={() => onDateRangeChange(value)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                dateRange === value
                  ? "bg-white dark:bg-zinc-700 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className={hasFilters ? "border-zinc-900 dark:border-zinc-100" : ""}
        >
          <Filter className="h-4 w-4 mr-1" />
          Filters
          {hasFilters && (
            <span className="ml-1 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full w-5 h-5 text-xs flex items-center justify-center">
              {selectedProjects.length + selectedMembers.length}
            </span>
          )}
        </Button>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {showFilters && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border">
          {/* Projects */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Projects</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {projects.map((project) => (
                <label
                  key={project.id}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded px-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={selectedProjects.includes(project.id)}
                    onChange={() => toggleProject(project.id)}
                    className="rounded border-border"
                  />
                  {project.name}
                </label>
              ))}
              {projects.length === 0 && (
                <p className="text-xs text-muted-foreground">No projects</p>
              )}
            </div>
          </div>

          {/* Members */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Team Members</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {members.map((member) => (
                <label
                  key={member.id}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded px-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(member.id)}
                    onChange={() => toggleMember(member.id)}
                    className="rounded border-border"
                  />
                  {member.name}
                </label>
              ))}
              {members.length === 0 && (
                <p className="text-xs text-muted-foreground">No members</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

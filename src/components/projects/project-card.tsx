"use client"

import { useRouter } from "next/navigation"
import { UserAvatar } from "@/components/ui/user-avatar"
import {
  Folder,
  LayoutGrid,
  Code,
  Briefcase,
  Rocket,
  Star,
  Zap,
  Users,
  ListTodo,
  ArrowRight,
} from "lucide-react"
import { ProjectIcon, isUploadedIcon } from "./project-icon"
import { cn } from "@/lib/utils"

export interface ProjectCardData {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  status: string
  taskCount: number
  doneTaskCount: number
  memberCount: number
  members: {
    id: string
    name: string
    avatar: string | null
  }[]
}

interface ProjectCardProps {
  project: ProjectCardData
}

const iconMap: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  folder: Folder,
  grid: LayoutGrid,
  code: Code,
  briefcase: Briefcase,
  rocket: Rocket,
  star: Star,
  zap: Zap,
}

export function ProjectCard({ project }: ProjectCardProps) {
  const router = useRouter()
  const IconComponent = iconMap[project.icon] || Folder
  const progress =
    project.taskCount > 0
      ? Math.round((project.doneTaskCount / project.taskCount) * 100)
      : 0

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-[2rem] border border-on-surface-variant/5 bg-surface-container-lowest p-5 shadow-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5 sm:rounded-[2.5rem] sm:p-8 sm:hover:-translate-y-2"
      onClick={() => router.push(`/projects/${project.id}`)}
    >
      {/* Background Accent Gradient */}
      <div 
        className="absolute top-0 right-0 w-32 h-32 blur-[80px] opacity-10 group-hover:opacity-20 transition-opacity"
        style={{ backgroundColor: project.color }}
      />

      <div className="relative space-y-5 sm:space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div 
            className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg shadow-primary/5 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3 sm:h-14 sm:w-14"
            style={{ backgroundColor: `${project.color}15` }}
          >
            {isUploadedIcon(project.icon) ? (
              <ProjectIcon icon={project.icon} size="md" />
            ) : (
              <IconComponent
                className="h-7 w-7"
                style={{ color: project.color }}
              />
            )}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-container-low rounded-full border border-on-surface-variant/5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: project.color }} />
            <span className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/60">{project.status}</span>
          </div>
        </div>

        {/* Title & Desc */}
        <div className="space-y-2">
          <h3 className="text-xl font-headline font-black tracking-tight text-primary transition-colors group-hover:text-tertiary-new sm:text-2xl">
            {project.name}
          </h3>
          <p className="text-sm text-on-surface-variant/60 font-medium line-clamp-2 leading-relaxed">
            {project.description || "No tactical description provided for this initiative."}
          </p>
        </div>

        {/* Progress System */}
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/30">Initiative Progress</p>
            <span className="text-sm font-black text-primary">{progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-container overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_rgba(0,0,0,0.1)]"
              style={{
                width: `${progress}%`,
                backgroundColor: project.color,
              }}
            />
          </div>
        </div>

        {/* Footer Meta */}
        <div className="flex items-center justify-between gap-3 border-t border-on-surface-variant/5 pt-2">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="flex -space-x-2.5">
              {project.members.slice(0, 3).map((member) => (
                <UserAvatar
                  key={member.id}
                  user={{ name: member.name, image: member.avatar }}
                  size="xs"
                  className="h-7 w-7 border-2 border-surface-container-lowest ring-1 ring-on-surface-variant/5"
                />
              ))}
              {project.memberCount > 3 && (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container text-[9px] font-black text-on-surface-variant/60 border-2 border-surface-container-lowest">
                  +{project.memberCount - 3}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/40">
              <span className="flex items-center gap-1.5">
                <ListTodo className="h-3 w-3" />
                {project.taskCount}
              </span>
            </div>
          </div>
          
          <div className="h-8 w-8 rounded-full bg-surface-container-low flex items-center justify-center text-on-surface-variant/20 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>
  )
}

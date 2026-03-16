"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
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
} from "lucide-react"
import { ProjectIcon, isUploadedIcon } from "./project-icon"

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
    <Card
      className="group cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-1 overflow-hidden"
      onClick={() => router.push(`/projects/${project.id}`)}
    >
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: project.color }}
      />
      <CardContent className="p-5">
        <div className="flex items-start gap-3 mb-3">
          {isUploadedIcon(project.icon) ? (
            <ProjectIcon icon={project.icon} size="md" />
          ) : (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${project.color}20` }}
            >
              <IconComponent
                className="h-5 w-5"
                style={{ color: project.color }}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base truncate group-hover:text-[#18181B] transition-colors">
              {project.name}
            </h3>
            {project.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                {project.description}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Progress</span>
            <span className="text-xs font-medium">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary">
            <div
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                backgroundColor: project.color,
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <ListTodo className="h-3.5 w-3.5" />
              {project.taskCount} tasks
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {project.memberCount}
            </span>
          </div>

          {/* Member avatars */}
          <div className="flex -space-x-2">
            {project.members.slice(0, 3).map((member) => (
              <UserAvatar
                key={member.id}
                user={{ name: member.name, avatar: member.avatar }}
                size="xs"
                className="h-6 w-6 border-2 border-background"
              />
            ))}
            {project.memberCount > 3 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium">
                +{project.memberCount - 3}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

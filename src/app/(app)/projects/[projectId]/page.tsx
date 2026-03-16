import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ProjectDetailClient } from "@/components/projects/project-detail-client"
import type { TaskCardData } from "@/components/tasks/task-card"

interface ProjectDetailPageProps {
  params: { projectId: string }
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, avatar: true },
          },
        },
      },
      taskLists: {
        orderBy: { position: "asc" },
        include: {
          tasks: {
            where: { parentId: null },
            orderBy: { position: "asc" },
            include: {
              assignees: {
                include: {
                  user: {
                    select: { id: true, name: true, avatar: true },
                  },
                },
              },
              subtasks: {
                select: { id: true, status: true },
              },
            },
          },
        },
      },
      pages: {
        where: { parentId: null },
        orderBy: { position: "asc" },
        select: { id: true, name: true, icon: true, pageType: true },
      },
    },
  })

  if (!project) notFound()

  // Verify user is a member
  const isMember = project.members.some((m) => m.user.id === session.user!.id)
  if (!isMember) redirect("/projects")

  const projectData = {
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    icon: project.icon,
    members: project.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      avatar: m.user.avatar,
      role: m.role,
    })),
    taskLists: project.taskLists.map((tl) => ({
      id: tl.id,
      name: tl.name,
      tasks: tl.tasks.map(
        (t): TaskCardData => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate?.toISOString() || null,
          tags: t.tags,
          position: t.position,
          taskListId: t.taskListId,
          taskListName: tl.name,
          assignees: t.assignees.map((a) => ({
            id: a.user.id,
            name: a.user.name,
            avatar: a.user.avatar,
          })),
          subtaskCount: t.subtasks.length,
          subtaskDoneCount: t.subtasks.filter((s) => s.status === "DONE")
            .length,
        })
      ),
    })),
    pages: project.pages,
  }

  return (
    <div className="p-6">
      <ProjectDetailClient project={projectData} />
    </div>
  )
}

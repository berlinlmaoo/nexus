import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ProjectsPageClient } from "@/components/projects/projects-page-client"
import type { ProjectCardData } from "@/components/projects/project-card"

export default async function ProjectsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const userId = session.user.id

  // Get user's workspace (first one)
  const workspaceMember = await prisma.workspaceMember.findFirst({
    where: { userId },
    select: { workspaceId: true },
  })

  if (!workspaceMember) redirect("/login")

  const workspaceId = workspaceMember.workspaceId

  // Fetch projects user is a member of
  const projects = await prisma.project.findMany({
    where: {
      workspaceId,
      members: { some: { userId } },
    },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, avatar: true },
          },
        },
        take: 4,
      },
      taskLists: {
        include: {
          tasks: {
            select: { id: true, status: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  })

  const projectCards: ProjectCardData[] = projects.map((p) => {
    const allTasks = p.taskLists.flatMap((tl) => tl.tasks)
    const doneCount = allTasks.filter((t) => t.status === "DONE").length
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      icon: p.icon,
      status: p.status,
      taskCount: allTasks.length,
      doneTaskCount: doneCount,
      memberCount: p.members.length,
      members: p.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
      })),
    }
  })

  return (
    <div className="p-6">
      <ProjectsPageClient projects={projectCards} workspaceId={workspaceId} />
    </div>
  )
}

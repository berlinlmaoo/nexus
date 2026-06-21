import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { PageViewClient } from "@/components/projects/page-view-client"
import type { TaskCardData } from "@/components/tasks/task-card"
import { isSystemAdminUser } from "@/lib/rbac"

interface PageViewProps {
  params: Promise<{ projectId: string; pageId: string }>
}

export const dynamic = "force-dynamic"

export default async function ProjectPageView({ params }: PageViewProps) {
  const { projectId, pageId } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const isSystemAdmin = await isSystemAdminUser(session.user.id)

  const page = await prisma.projectPage.findUnique({
    where: { id: pageId },
    include: {
      children: {
        include: { children: true },
        orderBy: { position: "asc" },
      },
      parent: {
        select: { id: true, name: true, icon: true },
      },
      project: {
        select: {
          id: true,
          name: true,
          icon: true,
          color: true,
          workspace: {
            select: {
              members: {
                where: { userId: session.user.id },
                select: { role: true },
                take: 1,
              },
            },
          },
          members: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
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
                      user: { select: { id: true, name: true, avatar: true } },
                    },
                  },
                  subtasks: { select: { id: true, status: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!page || page.projectId !== projectId) notFound()

  const workspaceRole = page.project.workspace.members[0]?.role
  const hasWorkspaceAccess =
    isSystemAdmin || workspaceRole === "BOD" || workspaceRole === "MANAGER" || workspaceRole === "ONE_ABOVE_ALL"
  const isDirectProjectMember = page.project.members.some(
    (m) => m.user.id === session.user!.id
  )

  if (!hasWorkspaceAccess && !isDirectProjectMember) redirect("/projects")

  const tasks: TaskCardData[] = page.project.taskLists.flatMap((tl) =>
    tl.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate?.toISOString() || null,
      tags: t.tags,
      position: t.position,
      projectId: page.project.id,
      taskListId: t.taskListId,
      taskListName: tl.name,
      assignees: t.assignees.map((a) => ({
        id: a.user.id,
        name: a.user.name,
        avatar: a.user.avatar,
      })),
      subtaskCount: t.subtasks.length,
      subtaskDoneCount: t.subtasks.filter((s) => s.status === "DONE").length,
    }))
  )

  const pageData = {
    id: page.id,
    name: page.name,
    icon: page.icon,
    pageType: page.pageType,
    content: page.content as Record<string, unknown> | null,
    parent: page.parent,
    children: page.children.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      pageType: c.pageType,
    })),
    project: {
      id: page.project.id,
      name: page.project.name,
      icon: page.project.icon,
      color: page.project.color,
      members: page.project.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
        role: m.role,
      })),
      taskLists: page.project.taskLists.map((tl) => ({
        id: tl.id,
        name: tl.name,
      })),
    },
  }

  return (
    <div className="p-6">
      <PageViewClient page={pageData} tasks={tasks} />
    </div>
  )
}

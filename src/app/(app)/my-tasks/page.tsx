import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { MyTasksClient } from "./my-tasks-client"

export default async function MyTasksPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const tasks = await prisma.task.findMany({
    where: {
      assignees: { some: { userId: session.user.id } },
      status: { not: "CANCELLED" },
    },
    include: {
      assignees: {
        include: {
          user: { select: { id: true, name: true, avatar: true } },
        },
      },
      taskList: {
        include: {
          project: { select: { id: true, name: true, color: true } },
        },
      },
    },
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
  })

  const formatted = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate?.toISOString() || null,
    tags: t.tags,
    position: t.position,
    taskListId: t.taskListId,
    project: {
      id: t.taskList.project.id,
      name: t.taskList.project.name,
      color: t.taskList.project.color,
    },
    assignees: t.assignees.map((a) => ({
      id: a.user.id,
      name: a.user.name,
      avatar: a.user.avatar,
    })),
  }))

  return <MyTasksClient tasks={formatted} />
}

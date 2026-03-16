import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { TaskFullPage } from "./task-full-page"

interface TaskPageProps {
  params: { taskId: string }
}

export default async function TaskPage({ params }: TaskPageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    include: {
      assignees: {
        include: {
          user: {
            select: { id: true, name: true, avatar: true },
          },
        },
      },
      subtasks: {
        orderBy: { position: "asc" },
        select: { id: true, title: true, status: true },
      },
      taskList: {
        include: {
          project: {
            select: { id: true, name: true, icon: true },
          },
        },
      },
      creator: {
        select: { id: true, name: true, avatar: true },
      },
    },
  })

  if (!task) notFound()

  const taskData = {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString() || null,
    tags: task.tags,
    position: task.position,
    taskListId: task.taskListId,
    taskType: task.taskType as "TASK" | "MILESTONE" | "APPROVAL",
    isRecurring: task.isRecurring,
    assignees: task.assignees.map((a) => ({
      id: a.user.id,
      name: a.user.name,
      avatar: a.user.avatar,
    })),
    subtasks: task.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED",
    })),
    project: task.taskList.project
      ? {
          id: task.taskList.project.id,
          name: task.taskList.project.name,
          icon: task.taskList.project.icon,
        }
      : null,
    creator: task.creator
      ? { id: task.creator.id, name: task.creator.name, avatar: task.creator.avatar }
      : null,
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <TaskFullPage task={taskData} />
    </div>
  )
}

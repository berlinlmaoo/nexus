import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { GoalDetailClient } from "./goal-detail-client"

export default async function GoalDetailPage({ params }: { params: { goalId: string } }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const goal = await prisma.goal.findUnique({
    where: { id: params.goalId },
    include: {
      owner: { select: { id: true, name: true, avatar: true } },
      milestones: { orderBy: { dueDate: 'asc' } },
      goalProjects: { include: { project: { select: { id: true, name: true, color: true, status: true } } } },
      goalTasks: {
        include: {
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              dueDate: true,
              taskList: { select: { project: { select: { id: true, name: true, color: true } } } },
            },
          },
        },
      },
    },
  })
  if (!goal) notFound()

  // Fetch workspace projects and tasks for linking
  const workspaceProjects = await prisma.project.findMany({
    where: { workspaceId: goal.workspaceId, status: "ACTIVE" },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  })

  const workspaceTasks = await prisma.task.findMany({
    where: {
      taskList: { project: { workspaceId: goal.workspaceId } },
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      title: true,
      status: true,
      taskList: { select: { project: { select: { id: true, name: true, color: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  const totalTasks = goal.goalTasks.length
  const completedTasks = goal.goalTasks.filter(gt => gt.task.status === "DONE").length

  const serialized = {
    ...goal,
    linkedProjects: goal.goalProjects.map(gp => gp.project),
    linkedTasks: goal.goalTasks.map(gt => ({
      ...gt.task,
      project: gt.task.taskList?.project || null,
    })),
    taskStats: { total: totalTasks, completed: completedTasks },
  }

  return (
    <GoalDetailClient
      goal={JSON.parse(JSON.stringify(serialized))}
      workspaceProjects={JSON.parse(JSON.stringify(workspaceProjects))}
      workspaceTasks={JSON.parse(JSON.stringify(workspaceTasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        project: t.taskList?.project || null,
      }))))}
    />
  )
}

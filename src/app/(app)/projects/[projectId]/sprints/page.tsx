import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { SprintsClient } from "./sprints-client"

export default async function SprintsPage({ params }: { params: { projectId: string } }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const project = await prisma.project.findUnique({ where: { id: params.projectId }, select: { id: true, name: true, color: true } })
  if (!project) notFound()
  const sprints = await prisma.sprint.findMany({
    where: { projectId: params.projectId },
    include: { tasks: { include: { task: { select: { id: true, title: true, status: true, priority: true, assignees: { include: { user: { select: { id: true, name: true } } } } } } } } },
    orderBy: { startDate: 'desc' },
  })
  const availableTasks = await prisma.task.findMany({
    where: { taskList: { projectId: params.projectId }, sprintTasks: { none: {} } },
    select: { id: true, title: true, status: true, priority: true },
    take: 100,
  })
  return <SprintsClient project={project} sprints={JSON.parse(JSON.stringify(sprints))} availableTasks={availableTasks} />
}

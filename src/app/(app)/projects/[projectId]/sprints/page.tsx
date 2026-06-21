import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { SprintsClient } from "./sprints-client"

export const dynamic = "force-dynamic"

export default async function SprintsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, color: true } })
  if (!project) notFound()
  const sprints = await prisma.sprint.findMany({
    where: { projectId },
    include: { tasks: { include: { task: { select: { id: true, title: true, status: true, priority: true, assignees: { include: { user: { select: { id: true, name: true } } } } } } } } },
    orderBy: { startDate: 'desc' },
  })
  const availableTasks = await prisma.task.findMany({
    where: { taskList: { projectId }, sprintTasks: { none: {} } },
    select: { id: true, title: true, status: true, priority: true },
    take: 100,
  })
  return <SprintsClient project={project} sprints={JSON.parse(JSON.stringify(sprints))} availableTasks={availableTasks} />
}

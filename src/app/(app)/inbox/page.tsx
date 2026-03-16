import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { InboxClient } from "./inbox-client"

export default async function InboxPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // Fetch project names for grouping
  const projectIds = [...new Set(notifications.map(n => n.projectId).filter(Boolean))] as string[]
  const projects = projectIds.length > 0
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true, color: true },
      })
    : []
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))

  return <InboxClient notifications={JSON.parse(JSON.stringify(notifications))} projectMap={projectMap} />
}

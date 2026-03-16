import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { GoalsPageClient } from "./goals-client"

export default async function GoalsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const workspace = await prisma.workspace.findFirst({ where: { members: { some: { userId: session.user.id } } } })
  const goals = await prisma.goal.findMany({
    where: workspace ? { workspaceId: workspace.id } : {},
    include: { owner: { select: { id: true, name: true, avatar: true } }, milestones: true },
    orderBy: { createdAt: 'desc' },
  })
  return <GoalsPageClient goals={JSON.parse(JSON.stringify(goals))} workspaceId={workspace?.id || ''} />
}

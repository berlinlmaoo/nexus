import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { GoalDetailClient } from "./goal-detail-client"

export default async function GoalDetailPage({ params }: { params: { goalId: string } }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const goal = await prisma.goal.findUnique({
    where: { id: params.goalId },
    include: { owner: { select: { id: true, name: true, avatar: true } }, milestones: { orderBy: { dueDate: 'asc' } } },
  })
  if (!goal) notFound()
  return <GoalDetailClient goal={JSON.parse(JSON.stringify(goal))} />
}

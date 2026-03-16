import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { AutomationsClient } from "./automations-client"

export const dynamic = "force-dynamic"

export default async function AutomationsPage({ params }: { params: { projectId: string } }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const project = await prisma.project.findUnique({ where: { id: params.projectId }, select: { id: true, name: true } })
  if (!project) notFound()
  const automations = await prisma.automation.findMany({ where: { projectId: params.projectId }, orderBy: { name: 'asc' } })
  return <AutomationsClient project={project} automations={JSON.parse(JSON.stringify(automations))} />
}

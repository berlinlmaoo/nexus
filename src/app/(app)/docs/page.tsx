import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { DocsPageClient } from "./docs-client"

export const metadata = { title: "Documents | Nexus" }

export const dynamic = "force-dynamic"

export default async function DocsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const docs = await prisma.doc.findMany({
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      owner: { select: { id: true, name: true, avatar: true } },
      project: { select: { id: true, name: true, color: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  const projects = await prisma.project.findMany({
    where: { members: { some: { userId: session.user.id } } },
    select: { id: true, name: true, color: true },
  })
  return (
    <DocsPageClient
      docs={JSON.parse(JSON.stringify(docs))}
      projects={projects}
      currentUserId={session.user.id}
    />
  )
}

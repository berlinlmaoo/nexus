import { redirect, notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { DocEditorPage } from "./doc-editor-page"

export default async function DocDetailPage({ params }: { params: { docId: string } }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const doc = await prisma.doc.findUnique({
    where: { id: params.docId },
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      owner: { select: { id: true, name: true, avatar: true } },
      project: { select: { id: true, name: true, color: true } },
    },
  })
  if (!doc) notFound()
  return <DocEditorPage doc={JSON.parse(JSON.stringify(doc))} />
}

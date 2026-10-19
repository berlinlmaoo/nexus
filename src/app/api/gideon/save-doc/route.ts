export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { nextDocPosition } from "@/lib/doc-position"
import { checkProjectAccess } from "@/lib/rbac"
import { markdownToTipTap } from "@/lib/tiptap-utils"
import { docToText, sanitizeDoc } from "@/lib/blockdoc"

/**
 * "Save as doc" from a GIDEON answer (12 Oct 2026): a new page in a project, written by the person (they
 * pressed the button), with the answer as its body. Needs the same access as creating a page by hand.
 * POST { projectId, title, markdown } → { doc: { id, title, url } }
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; title?: unknown; markdown?: unknown }
  const projectId = typeof body.projectId === "string" ? body.projectId : ""
  const markdown = typeof body.markdown === "string" ? body.markdown.slice(0, 60000) : ""
  const title = (typeof body.title === "string" ? body.title : "").replace(/\s+/g, " ").trim().slice(0, 200) || "GIDEON answer"
  if (!projectId) return NextResponse.json({ error: "Pick a project" }, { status: 400 })
  if (!markdown.trim()) return NextResponse.json({ error: "Nothing to save" }, { status: 400 })
  if (!(await checkProjectAccess(session.user.id, projectId, ["MEMBER"])).allowed) return NextResponse.json({ error: "You can't add pages to this project." }, { status: 403 })
  const content = sanitizeDoc(markdownToTipTap(markdown))
  if (!content) return NextResponse.json({ error: "That answer is too long to save as a page." }, { status: 400 })
  const doc = await prisma.doc.create({
    data: { title, content: content as never, contentText: docToText(content) || null, projectId, authorId: session.user.id, ownerId: session.user.id, position: await nextDocPosition(projectId, null) },
    select: { id: true, title: true },
  })
  return NextResponse.json({ doc: { ...doc, url: `/docs/${doc.id}` } })
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { notifyMention } from "@/lib/notification-service"
import { resolveSheetAccess } from "@/lib/project-sheets"

const BODY_MAX = 2000

// GET /api/sheets/[sheetId]/comments — every comment on the sheet in one call.
//
// One request for the whole sheet, not one per cell: the grid needs to know which cells have a
// comment before anyone clicks anything, and a per-cell fetch would be hundreds of requests.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["VIEWER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const rows = await prisma.sheetComment.findMany({
      where: { sheetId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, rowId: true, columnId: true, body: true, resolvedAt: true, createdAt: true,
        authorId: true,
        author: { select: { id: true, name: true, avatar: true } },
      },
    })

    // A comment on a deleted column would render against a column that no longer exists, so it's
    // filtered out here rather than shown floating.
    const live = new Set(access.sheet.columns.map((c) => c.id))
    // currentUserId so the client can show "delete" only on your own comments without a second
    // round-trip — same shape the task comments endpoint returns.
    return NextResponse.json({
      comments: rows.filter((c) => live.has(c.columnId)),
      currentUserId: session.user.id,
    })
  } catch (error) {
    console.error("Error listing sheet comments:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST — { rowId, columnId, body }
export async function POST(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = (await req.json().catch(() => ({}))) as { rowId?: unknown; columnId?: unknown; body?: unknown }
    const rowId = typeof body.rowId === "string" ? body.rowId : ""
    const columnId = typeof body.columnId === "string" ? body.columnId : ""
    const text = String(body.body ?? "").trim().slice(0, BODY_MAX)
    if (!rowId || !columnId || !text) {
      return NextResponse.json({ error: "rowId, columnId, dan isi komentar wajib." }, { status: 422 })
    }
    if (!access.sheet.columns.some((c) => c.id === columnId)) {
      return NextResponse.json({ error: "Kolomnya nggak ada di sheet ini." }, { status: 422 })
    }
    // Scoped by sheetId so a rowId borrowed from another sheet can't anchor a comment here.
    const row = await prisma.sheetRow.findFirst({ where: { id: rowId, sheetId }, select: { id: true } })
    if (!row) return NextResponse.json({ error: "Barisnya nggak ketemu." }, { status: 404 })

    const comment = await prisma.sheetComment.create({
      data: { sheetId, rowId, columnId, body: text, authorId: session.user.id },
      select: {
        id: true, rowId: true, columnId: true, body: true, resolvedAt: true, createdAt: true,
        authorId: true,
        author: { select: { id: true, name: true, avatar: true } },
      },
    })

    // @mentions, same matching the task comments use.
    const mentioned = new Set<string>()
    const re = /@(\S+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { name: { contains: m[1], mode: "insensitive" } },
            { email: { startsWith: m[1].toLowerCase() } },
          ],
        },
        select: { id: true },
      })
      if (user) mentioned.add(user.id)
    }
    // Everyone already in this cell's thread gets pulled in — a reply nobody sees is a dead thread.
    const others = await prisma.sheetComment.findMany({
      where: { rowId, columnId, authorId: { not: session.user.id } },
      select: { authorId: true },
      distinct: ["authorId"],
    })
    for (const o of others) mentioned.add(o.authorId)
    mentioned.delete(session.user.id)

    const project = await prisma.projectSheet.findUnique({
      where: { id: sheetId },
      select: { name: true, project: { select: { id: true, name: true } } },
    })
    for (const uid of mentioned) {
      notifyMention({
        mentionedUserId: uid,
        mentionedByName: session.user.name || "Seseorang",
        // The notification links to the project; the sheet has no route of its own yet.
        taskId: project?.project.id ?? "",
        taskTitle: `Spreadsheet ${project?.name ?? ""} · ${project?.project.name ?? ""}`.trim(),
        commentSnippet: text.slice(0, 200),
        projectId: project?.project.id,
      }).catch((err) => console.error("Sheet comment mention failed:", err))
    }

    return NextResponse.json(comment, { status: 201 })
  } catch (error) {
    console.error("Error creating sheet comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH — { commentId, body? , resolved? } · DELETE — ?commentId=
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = (await req.json().catch(() => ({}))) as { commentId?: unknown; body?: unknown; resolved?: unknown }
    const commentId = typeof body.commentId === "string" ? body.commentId : ""
    if (!commentId) return NextResponse.json({ error: "commentId wajib." }, { status: 400 })

    const existing = await prisma.sheetComment.findFirst({
      where: { id: commentId, sheetId }, select: { authorId: true },
    })
    if (!existing) return NextResponse.json({ error: "Komentarnya nggak ketemu." }, { status: 404 })

    const data: { body?: string; resolvedAt?: Date | null; resolvedById?: string | null } = {}
    if (typeof body.body === "string") {
      // Editing the text is the author's alone; resolving is anyone's, because closing a thread is
      // a team action, not an ownership one.
      if (existing.authorId !== session.user.id) {
        return NextResponse.json({ error: "Cuma yang nulis yang boleh ngedit komentarnya." }, { status: 403 })
      }
      const text = body.body.trim().slice(0, BODY_MAX)
      if (!text) return NextResponse.json({ error: "Komentar nggak boleh kosong." }, { status: 422 })
      data.body = text
    }
    if (typeof body.resolved === "boolean") {
      data.resolvedAt = body.resolved ? new Date() : null
      data.resolvedById = body.resolved ? session.user.id : null
    }
    if (!Object.keys(data).length) return NextResponse.json({ error: "Nggak ada yang diubah." }, { status: 400 })

    const updated = await prisma.sheetComment.update({
      where: { id: commentId },
      data,
      select: {
        id: true, rowId: true, columnId: true, body: true, resolvedAt: true, createdAt: true,
        authorId: true,
        author: { select: { id: true, name: true, avatar: true } },
      },
    })
    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating sheet comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sheetId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sheetId } = await params

    const access = await resolveSheetAccess(session.user.id, sheetId, ["MEMBER"])
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status })

    const commentId = (req.nextUrl.searchParams.get("commentId") ?? "").trim()
    if (!commentId) return NextResponse.json({ error: "commentId wajib." }, { status: 400 })

    const existing = await prisma.sheetComment.findFirst({
      where: { id: commentId, sheetId }, select: { authorId: true },
    })
    if (!existing) return NextResponse.json({ error: "Komentarnya nggak ketemu." }, { status: 404 })

    // Author, or a project lead cleaning up.
    const isAuthor = existing.authorId === session.user.id
    if (!isAuthor) {
      const lead = await resolveSheetAccess(session.user.id, sheetId, ["LEAD"])
      if (!lead.allowed) {
        return NextResponse.json({ error: "Cuma yang nulis (atau lead) yang boleh hapus." }, { status: 403 })
      }
    }

    await prisma.sheetComment.delete({ where: { id: commentId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting sheet comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

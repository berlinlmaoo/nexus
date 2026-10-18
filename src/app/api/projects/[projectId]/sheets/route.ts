export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkProjectAccess } from "@/lib/rbac"
import {
  DEFAULT_ROW_COUNT, DEFAULT_SHEET_COLUMNS, ensureProjectSheet, ensureSheetFormattingColumns, readSheetSettings,
} from "@/lib/project-sheets"
import { copySheet } from "@/lib/sheet-structure"
import { emitSheetStructure } from "@/lib/socket-emitter"

// GET /api/projects/[projectId]/sheets — the project's spreadsheets (the tabs at the bottom).
//
// Seeds the default sheet on the way through, which is how the ~70 projects that predate this
// feature get one without a backfill migration.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["VIEWER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    await ensureProjectSheet(projectId, session.user.id)

    const sheets = await prisma.projectSheet.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, position: true, settings: true, _count: { select: { rows: true } } },
    })
    return NextResponse.json({
      sheets: sheets.map((s) => {
        const st = readSheetSettings(s.settings)
        return {
          id: s.id, name: s.name, position: s.position, rowCount: s._count.rows,
          tabColor: st.tabColor ?? null,
          // View › Hidden sheets: the web hides the tab; older clients simply keep showing it.
          ...(st.hidden ? { hidden: true } : {}),
          ...(st.pivot ? { pivot: true } : {}),
        }
      }),
    })
  } catch (error) {
    console.error("Error listing project sheets:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST — a new sheet: { name? } for a blank grid (same 10 × 50 as the default sheet, like a new
// Sheets tab — it used to start with no columns and no rows at all), or { duplicateOf: sheetId }
// for a full copy placed right after the original.
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    await ensureSheetFormattingColumns()

    const body = (await req.json().catch(() => ({}))) as { name?: unknown; duplicateOf?: unknown }
    // (projectId, position) is unique: two quick "Add sheet" clicks used to race for the same slot
    // and the loser got a 500 (bughunt S-BUG-17). The loser now takes the next slot.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await createSheetAt(projectId, body, session.user.id)
      } catch (error) {
        // Up to 12 tries with a short random pause: six clicks/tabs at once used to exhaust 4 tries (QA final 19 Oct).
        if (attempt < 12 && (error as { code?: string })?.code === "P2002") {
          await new Promise((r) => setTimeout(r, 5 + Math.random() * 40))
          continue
        }
        throw error
      }
    }
  } catch (error) {
    console.error("Error creating project sheet:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

async function createSheetAt(projectId: string, body: { name?: unknown; duplicateOf?: unknown }, userId: string) {
  {
    const session = { user: { id: userId } }
    const last = await prisma.projectSheet.findFirst({
      where: { projectId }, orderBy: { position: "desc" }, select: { position: true },
    })
    const position = (last?.position ?? -1) + 1

    if (typeof body.duplicateOf === "string") {
      const source = await prisma.projectSheet.findFirst({
        where: { id: body.duplicateOf, projectId }, select: { id: true, name: true },
      })
      if (!source) return NextResponse.json({ error: "Sheet-nya nggak ketemu." }, { status: 404 })
      const name = String(body.name ?? "").trim().slice(0, 80) || `${source.name} (copy)`.slice(0, 80)
      const copy = await copySheet(source.id, { projectId, name, position, createdById: session.user.id })
      return NextResponse.json({ id: copy.id, name, position }, { status: 201 })
    }

    const name = String(body?.name ?? "").trim().slice(0, 80) || "Sheet baru"
    const sheet = await prisma.$transaction(async (tx) => {
      const created = await tx.projectSheet.create({
        data: { projectId, name, position, columns: DEFAULT_SHEET_COLUMNS as unknown as object, createdById: session.user.id },
        select: { id: true, name: true, position: true },
      })
      await tx.sheetRow.createMany({
        data: Array.from({ length: DEFAULT_ROW_COUNT }, (_, i) => ({ sheetId: created.id, position: i })),
      })
      return created
    })
    return NextResponse.json(sheet, { status: 201 })
  }
}

// PATCH — reorder the tabs: { order: sheetId[] } (every sheet of the project, new order).
// The first tab is the default sheet (the one that can't be deleted), like before.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { projectId } = await params

    const { allowed } = await checkProjectAccess(session.user.id, projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = (await req.json().catch(() => ({}))) as { order?: unknown }
    const order = Array.isArray(body.order) ? body.order.filter((x): x is string => typeof x === "string") : []
    const existing = await prisma.projectSheet.findMany({ where: { projectId }, select: { id: true } })
    const ids = new Set(existing.map((s) => s.id))
    if (order.length !== ids.size || new Set(order).size !== order.length || !order.every((id) => ids.has(id))) {
      return NextResponse.json({ error: "Urutan sheet nggak lengkap." }, { status: 422 })
    }
    // Two steps because (projectId, position) is unique: park everything out of the way first.
    await prisma.$transaction([
      ...order.map((id, i) => prisma.projectSheet.update({ where: { id }, data: { position: -1000 - i } })),
      ...order.map((id, i) => prisma.projectSheet.update({ where: { id }, data: { position: i } })),
    ])
    for (const id of order) emitSheetStructure(id, session.user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error reordering project sheets:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

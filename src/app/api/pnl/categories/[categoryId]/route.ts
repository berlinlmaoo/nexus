export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkPnlAccess } from "@/lib/pnl"

const HEX = /^#[0-9a-fA-F]{6}$/

async function gateCategory(userId: string, categoryId: string) {
  const category = await prisma.pnlCategory.findUnique({ where: { id: categoryId }, select: { id: true, projectId: true } })
  if (!category) return { ok: false as const, status: 404 as const, error: "Category not found", category: null }
  const gate = await checkPnlAccess(userId, category.projectId)
  if (!gate.allowed) return { ok: false as const, status: gate.status, error: gate.error, category: null }
  return { ok: true as const, status: 200 as const, error: null, category }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { categoryId } = await params
    const gate = await gateCategory(session.user.id, categoryId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const body = await request.json()
    const data: { name?: string; color?: string; order?: number } = {}
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 })
      data.name = body.name.trim().slice(0, 60)
    }
    if (body.color !== undefined) {
      if (typeof body.color !== "string" || !HEX.test(body.color)) return NextResponse.json({ error: "color must be #rrggbb" }, { status: 400 })
      data.color = body.color
    }
    if (body.order !== undefined) {
      if (!Number.isInteger(body.order) || body.order < 0 || body.order > 9999) return NextResponse.json({ error: "Invalid order" }, { status: 400 })
      data.order = body.order
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 })

    const category = await prisma.pnlCategory.update({ where: { id: categoryId }, data })

    logAudit({ action: "update", entityType: "pnl_category", entityId: categoryId, entityName: category.name, userId: session.user.id, request })

    return NextResponse.json(category)
  } catch (error) {
    console.error("Error updating P&L category:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { categoryId } = await params
    const gate = await gateCategory(session.user.id, categoryId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    // Expenses keep their amounts; they just become "tanpa kategori" (categoryId SetNull).
    await prisma.pnlCategory.delete({ where: { id: categoryId } })

    logAudit({ action: "delete", entityType: "pnl_category", entityId: categoryId, userId: session.user.id, request })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting P&L category:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

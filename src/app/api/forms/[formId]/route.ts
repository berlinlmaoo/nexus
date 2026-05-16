import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { generateUniqueFormSlug } from "@/lib/form-slugs"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { formId } = await params

    const form = await prisma.form.findUnique({
      where: { id: formId },
      include: {
        submissions: { orderBy: { createdAt: "desc" } },
        _count: { select: { submissions: true } },
      },
    })

    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, form.projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    return NextResponse.json(form)
  } catch (error) {
    console.error("Error fetching form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { formId } = await params
    const body = await request.json()
    const { name, description, fields, isPublic } = body

    const existing = await prisma.form.findUnique({
      where: { id: formId },
      select: { id: true, name: true, slug: true, projectId: true },
    })

    if (!existing) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, existing.projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const slug = existing.slug ?? await generateUniqueFormSlug(prisma, name ?? existing.name, existing.id)

    const form = await prisma.form.update({
      where: { id: formId },
      data: {
        ...(name !== undefined && { name }),
        ...(!existing.slug && { slug }),
        ...(description !== undefined && { description }),
        ...(fields !== undefined && { fields }),
        ...(isPublic !== undefined && { isPublic }),
      },
    })

    logAudit({ action: "update", entityType: "form", entityId: formId, entityName: form.name, userId: session.user.id, request, metadata: { changes: Object.keys(body) } })

    return NextResponse.json(form)
  } catch (error) {
    console.error("Error updating form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { formId } = await params

    const existing = await prisma.form.findUnique({
      where: { id: formId },
      select: { projectId: true },
    })

    if (!existing) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    const { allowed } = await checkProjectAccess(session.user.id, existing.projectId, ["MEMBER"])
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    await prisma.form.delete({ where: { id: formId } })

    logAudit({ action: "delete", entityType: "form", entityId: formId, userId: session.user.id, request })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

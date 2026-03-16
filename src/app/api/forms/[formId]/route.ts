import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

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

    const form = await prisma.form.update({
      where: { id: formId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(fields !== undefined && { fields }),
        ...(isPublic !== undefined && { isPublic }),
      },
    })

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

    await prisma.form.delete({ where: { id: formId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

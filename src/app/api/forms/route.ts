import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const projectId = request.nextUrl.searchParams.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const forms = await prisma.form.findMany({
      where: { projectId },
      include: { _count: { select: { submissions: true } } },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(forms)
  } catch (error) {
    console.error("Error fetching forms:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { name, description, fields, isPublic, projectId } = await request.json()

    if (!name || !projectId || !fields) {
      return NextResponse.json({ error: "name, projectId, and fields are required" }, { status: 400 })
    }

    const form = await prisma.form.create({
      data: { name, description, fields, isPublic: isPublic ?? false, projectId },
      include: { _count: { select: { submissions: true } } },
    })

    return NextResponse.json(form, { status: 201 })
  } catch (error) {
    console.error("Error creating form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

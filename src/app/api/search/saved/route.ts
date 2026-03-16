import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const savedSearches = await prisma.savedSearch.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(savedSearches)
  } catch (error) {
    console.error("Error fetching saved searches:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { name, query } = body

    if (!name?.trim() || !query) {
      return NextResponse.json({ error: "name and query are required" }, { status: 400 })
    }

    const savedSearch = await prisma.savedSearch.create({
      data: {
        name: name.trim(),
        query,
        userId: session.user.id,
      },
    })

    return NextResponse.json(savedSearch, { status: 201 })
  } catch (error) {
    console.error("Error creating saved search:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const saved = await prisma.savedSearch.findUnique({ where: { id } })
    if (!saved || saved.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await prisma.savedSearch.delete({ where: { id } })

    return NextResponse.json({ message: "Saved search deleted" })
  } catch (error) {
    console.error("Error deleting saved search:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

// In-memory store for dashboard layouts (per user)
// In production, this should be stored in the database
const layoutStore = new Map<string, object>()

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const layout = layoutStore.get(session.user.id as string)
    if (!layout) {
      return NextResponse.json({ layout: null })
    }

    return NextResponse.json({ layout })
  } catch (error) {
    console.error("Dashboard layout GET error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { widgets, layouts } = body

    if (!widgets || !layouts) {
      return NextResponse.json(
        { error: "Missing widgets or layouts" },
        { status: 400 }
      )
    }

    // Store layout for user
    layoutStore.set(session.user.id as string, { widgets, layouts })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Dashboard layout POST error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

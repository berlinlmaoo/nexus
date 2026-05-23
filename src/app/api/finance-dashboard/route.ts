import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  FINANCE_DASHBOARD_COOKIE,
  getAccessibleFinanceProject,
  verifyFinanceDashboardToken,
} from "@/lib/finance-dashboard-auth"
import { getFinanceDashboardData } from "@/lib/finance-dashboard-data"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const projectId = request.nextUrl.searchParams.get("projectId") ?? ""
  const project = await getAccessibleFinanceProject(session.user.id, projectId)
  if (!project) {
    return NextResponse.json({ error: "Finance project not found" }, { status: 404 })
  }

  const token = request.cookies.get(FINANCE_DASHBOARD_COOKIE)?.value
  const unlocked = verifyFinanceDashboardToken(token, session.user.id, project.id)
  if (!unlocked) {
    return NextResponse.json({ error: "Dashboard locked" }, { status: 401 })
  }

  try {
    const data = await getFinanceDashboardData()
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    })
  } catch (error) {
    console.error("Finance dashboard data error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load finance dashboard data" },
      { status: 502 }
    )
  }
}

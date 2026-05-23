import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  createFinanceDashboardToken,
  financeDashboardCookieOptions,
  FINANCE_DASHBOARD_COOKIE,
  getAccessibleFinanceProject,
  isFinanceDashboardPasswordConfigured,
  verifyFinanceDashboardPassword,
} from "@/lib/finance-dashboard-auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const projectId = String(body?.projectId ?? "")
  const password = String(body?.password ?? "")

  if (!isFinanceDashboardPasswordConfigured()) {
    return NextResponse.json(
      { error: "Finance dashboard password is not configured" },
      { status: 503 }
    )
  }

  const project = await getAccessibleFinanceProject(session.user.id, projectId)
  if (!project) {
    return NextResponse.json({ error: "Finance project not found" }, { status: 404 })
  }

  const valid = await verifyFinanceDashboardPassword(password)
  if (!valid) {
    return NextResponse.json({ error: "Invalid dashboard password" }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(
    FINANCE_DASHBOARD_COOKIE,
    createFinanceDashboardToken(session.user.id, project.id),
    financeDashboardCookieOptions()
  )
  response.cookies.set("nexus_finance_dashboard", "", {
    ...financeDashboardCookieOptions(),
    path: "/",
    maxAge: 0,
  })
  response.headers.set("Cache-Control", "no-store")

  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(FINANCE_DASHBOARD_COOKIE, "", {
    ...financeDashboardCookieOptions(),
    maxAge: 0,
  })
  response.cookies.set("nexus_finance_dashboard", "", {
    ...financeDashboardCookieOptions(),
    path: "/",
    maxAge: 0,
  })
  response.headers.set("Cache-Control", "no-store")
  return response
}

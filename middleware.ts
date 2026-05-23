import { NextRequest, NextResponse } from "next/server"

const DASHBOARD_HOSTS = new Set([
  "dashboard.nexus.patsgroup.id",
  "dashboard-nexus.patsgroup.id",
])

export function middleware(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = (forwardedHost ?? request.headers.get("host"))?.split(":")[0]?.toLowerCase()
  const { pathname } = request.nextUrl

  if (host && DASHBOARD_HOSTS.has(host)) {
    if (pathname === "/") {
      const url = request.nextUrl.clone()
      url.pathname = "/ops-dashboard"
      return NextResponse.rewrite(url)
    }

    if (pathname === "/dashboard") {
      const url = request.nextUrl.clone()
      url.pathname = "/ops-dashboard"
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/", "/dashboard"],
}

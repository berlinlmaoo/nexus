import { NextRequest, NextResponse } from "next/server"
import { appUpgradeGate } from "@/lib/version-policy"

const DASHBOARD_HOSTS = new Set([
  "dashboard.nexus.patsgroup.id",
  "dashboard-nexus.patsgroup.id",
])

export async function middleware(request: NextRequest) {
  // The minimum-version gate (lib/version-policy.ts). iOS builds below the minimum get 426:
  // with the X-Nexus-Client header (0.1.6+) on every /api call except /api/app/version-policy and
  // /api/health; without it (0.1.5 and older, known by `User-Agent: NEXUS/<build>`) only on
  // attendance writes. Android (`X-Nexus-Client: android/x.y.z/…`) below its own minimum
  // (NEXUS_ANDROID_MIN_VERSION, unset = nobody) gets the same 426 as header iOS. Requests with neither — the web (`web/1`), browsers, curl, scripts — are
  // NEVER blocked: they cannot be told apart safely, and refusing them would lock out people who
  // have no way to tell the server is the problem.
  const { pathname } = request.nextUrl
  if (pathname.startsWith("/api/")) {
    const upgrade = await appUpgradeGate(request, pathname)
    if (upgrade) {
      // 426 is not in the Cloudflare down-worker's UNREACHABLE set (502–504, 520–527, 530), so it
      // reaches the app untouched and never trips the app's offline queue.
      return NextResponse.json(upgrade.body, { status: upgrade.status, headers: { "Cache-Control": "no-store" } })
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = (forwardedHost ?? request.headers.get("host"))?.split(":")[0]?.toLowerCase()

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
  // Node.js runtime (stable in Next 15.5): the version gate reads the policy from Postgres
  // (AppReleaseSeen, cached in memory), which the edge runtime cannot.
  runtime: "nodejs",
  matcher: [
    "/",
    "/dashboard",
    // Only requests that can be refused ever enter the middleware; the web, browsers and curl
    // never do. Split on the body because once middleware runs on a request with one, Next
    // buffers it in memory and hands the route only the first 10 MB
    // (experimental.middlewareClientMaxBodySize): bodies must stay under that, so only bodiless
    // requests and a Content-Length of at most 7 digits (< 10,000,000 bytes) match. A bigger or
    // chunked upload passes ungated — the app's next ordinary call is refused anyway.
    // Values must stay literals: Next reads this object statically at build time.
    //
    // iOS with X-Nexus-Client (0.1.6+): all of /api.
    {
      source: "/api/:path*",
      has: [{ type: "header", key: "x-nexus-client", value: "[iI][oO][sS]/.*" }],
      missing: [{ type: "header", key: "content-length" }, { type: "header", key: "transfer-encoding" }],
    },
    {
      source: "/api/:path*",
      has: [
        { type: "header", key: "x-nexus-client", value: "[iI][oO][sS]/.*" },
        { type: "header", key: "content-length", value: "\\d{1,7}" },
      ],
      missing: [{ type: "header", key: "transfer-encoding" }],
    },
    // Android (every build sends X-Nexus-Client: android/<versionName>/<versionCode>): all of /api.
    {
      source: "/api/:path*",
      has: [{ type: "header", key: "x-nexus-client", value: "[aA][nN][dD][rR][oO][iI][dD]/.*" }],
      missing: [{ type: "header", key: "content-length" }, { type: "header", key: "transfer-encoding" }],
    },
    {
      source: "/api/:path*",
      has: [
        { type: "header", key: "x-nexus-client", value: "[aA][nN][dD][rR][oO][iI][dD]/.*" },
        { type: "header", key: "content-length", value: "\\d{1,7}" },
      ],
      missing: [{ type: "header", key: "transfer-encoding" }],
    },
    // iOS without the header (0.1.5 and older, `User-Agent: NEXUS/<build> CFNetwork/…`): attendance only.
    {
      source: "/api/attendance/:path*",
      has: [{ type: "header", key: "user-agent", value: "NEXUS/\\d+.*" }],
      missing: [
        { type: "header", key: "x-nexus-client" },
        { type: "header", key: "content-length" },
        { type: "header", key: "transfer-encoding" },
      ],
    },
    {
      source: "/api/attendance/:path*",
      has: [
        { type: "header", key: "user-agent", value: "NEXUS/\\d+.*" },
        { type: "header", key: "content-length", value: "\\d{1,7}" },
      ],
      missing: [{ type: "header", key: "x-nexus-client" }, { type: "header", key: "transfer-encoding" }],
    },
  ],
}

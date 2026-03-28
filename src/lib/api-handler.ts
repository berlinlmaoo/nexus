import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { validateApiVersion, withVersionHeaders } from "@/lib/api-version"
import type { Session } from "next-auth"

interface ApiHandlerOptions {
  /** Rate limit: max requests per window (default: 60) */
  rateLimit?: number
  /** Rate limit window in seconds (default: 60) */
  rateLimitWindow?: number
  /** Allow unauthenticated access (default: false) */
  public?: boolean
}

interface AuthenticatedContext {
  params: Record<string, string>
  session: Session
  userId: string
}

/**
 * Wraps an API route handler with auth + rate limiting.
 *
 * Usage:
 *   export const GET = apiHandler(async (req, { session, userId, params }) => {
 *     return NextResponse.json({ data })
 *   })
 */
export function apiHandler(
  handler: (req: NextRequest, ctx: AuthenticatedContext) => Promise<NextResponse>,
  options: ApiHandlerOptions = {}
) {
  const { rateLimit = 60, rateLimitWindow = 60 } = options

  return async (req: NextRequest, routeCtx: { params: Record<string, string> }) => {
    // 0. API version check
    const versionError = validateApiVersion(req)
    if (versionError) return versionError

    // 1. Auth check
    const session = await auth()
    if (!options.public && !session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session?.user?.id ?? ""

    // 2. Rate limit (keyed by user if authenticated, IP if public)
    const { allowed, resetAt } = checkRateLimit(req, userId || undefined, {
      limit: rateLimit,
      windowSeconds: rateLimitWindow,
    })
    if (!allowed) return rateLimitResponse(resetAt)

    // 3. Execute handler
    const response = await handler(req, {
      params: routeCtx.params,
      session: session!,
      userId,
    })

    // 4. Add version headers
    return withVersionHeaders(response)
  }
}

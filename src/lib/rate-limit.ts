import { NextRequest, NextResponse } from "next/server"

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  store.forEach((entry, key) => {
    if (entry.resetAt < now) store.delete(key)
  })
}, 5 * 60 * 1000)

interface RateLimitOptions {
  /** Max requests per window */
  limit?: number
  /** Window size in seconds */
  windowSeconds?: number
}

function normalizeCustomKey(key: string): string {
  return key.trim().toLowerCase()
}

function getClientKey(req: NextRequest, userId?: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  return userId ? `user:${userId}` : `ip:${ip}`
}

export function checkRateLimit(
  req: NextRequest,
  userId?: string,
  options: RateLimitOptions = {}
): { allowed: boolean; remaining: number; resetAt: number } {
  const { limit = 60, windowSeconds = 60 } = options
  const key = `${req.nextUrl.pathname}:${getClientKey(req, userId)}`
  return checkRateLimitForKey(key, options)
}

export function checkRateLimitByKey(
  scope: string,
  key: string,
  options: RateLimitOptions = {}
): { allowed: boolean; remaining: number; resetAt: number } {
  return checkRateLimitForKey(`${scope}:${normalizeCustomKey(key)}`, options)
}

function checkRateLimitForKey(
  key: string,
  options: RateLimitOptions = {}
): { allowed: boolean; remaining: number; resetAt: number } {
  const { limit = 60, windowSeconds = 60 } = options
  const now = Date.now()
  const windowMs = windowSeconds * 1000

  let entry = store.get(key)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    store.set(key, entry)
  }

  entry.count++

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  }
}

export function rateLimitResponse(resetAt: number): NextResponse {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
      },
    }
  )
}

/**
 * Wrapper for API route handlers with rate limiting.
 * Usage:
 *   export const GET = withRateLimit(async (req) => { ... }, { limit: 30 })
 */
export function withRateLimit(
  handler: (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<NextResponse>,
  options: RateLimitOptions = {}
) {
  return async (req: NextRequest, ctx: { params: Record<string, string> }) => {
    const { allowed, resetAt } = checkRateLimit(req, undefined, options)
    if (!allowed) return rateLimitResponse(resetAt)
    return handler(req, ctx)
  }
}

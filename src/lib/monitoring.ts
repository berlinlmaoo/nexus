import { createLogger } from "@/lib/logger"

const log = createLogger("monitoring")

interface ErrorContext {
  userId?: string
  action?: string
  route?: string
  metadata?: Record<string, unknown>
}

/**
 * Capture and report errors to monitoring service.
 * Supports Sentry when SENTRY_DSN is configured, otherwise logs locally.
 *
 * To enable Sentry:
 * 1. npm install @sentry/nextjs
 * 2. Set SENTRY_DSN in .env
 * 3. Run npx @sentry/wizard@latest -i nextjs
 */
export function captureError(error: Error | unknown, context?: ErrorContext) {
  const err = error instanceof Error ? error : new Error(String(error))

  log.error(err.message, {
    stack: err.stack?.split("\n").slice(0, 3).join(" | "),
    ...context,
  })

  // Sentry integration (lazy-loaded when available)
  // To enable: npm install @sentry/nextjs && set SENTRY_DSN in .env
  if (process.env.SENTRY_DSN) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require("@sentry/nextjs") as {
        captureException: (err: Error, opts?: Record<string, unknown>) => void
      }
      Sentry.captureException(err, {
        extra: context?.metadata,
        user: context?.userId ? { id: context.userId } : undefined,
        tags: {
          action: context?.action,
          route: context?.route,
        },
      })
    } catch {
      // Sentry not installed — that's fine
    }
  }
}

/**
 * Track performance of an async operation.
 */
export async function trackPerformance<T>(
  name: string,
  fn: () => Promise<T>,
  context?: ErrorContext
): Promise<T> {
  const start = performance.now()
  try {
    const result = await fn()
    const duration = Math.round(performance.now() - start)
    if (duration > 1000) {
      log.warn(`Slow operation: ${name}`, { duration, ...context })
    }
    return result
  } catch (error) {
    captureError(error, { ...context, action: name })
    throw error
  }
}

import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { emitAttendanceChanged } from "@/lib/socket-emitter"

/**
 * C-17 (QA final 19 Oct 2026, owner: approving on one device updates the approver's other devices live).
 *
 * Wraps an attendance write route: after a 2xx answer, `attendance-changed` { kind, id } goes to the actor's own
 * `user:<id>` room. Other approvers already hear about a decision through the requester's notification; the
 * person who decided got nothing, so their second tab/phone kept offering Approve/Reject (409 on tap).
 * `id` is the route's own [param] when it has one. Never fails the write.
 */
export function pingActorAfter<A extends unknown[], R extends Response | undefined>(
  kind: string,
  handler: (req: NextRequest, ...rest: A) => Promise<R>,
): (req: NextRequest, ...rest: A) => Promise<R> {
  return async (req: NextRequest, ...rest: A) => {
    const res = await handler(req, ...rest)
    if (res && res.status >= 200 && res.status < 300) {
      try {
        const session = await auth()
        const ctx = rest[0] as { params?: Promise<Record<string, unknown>> } | undefined
        const params = ctx?.params ? await ctx.params : null
        const id = params ? Object.values(params).find((v): v is string => typeof v === "string") ?? null : null
        if (session?.user?.id) emitAttendanceChanged([session.user.id], kind, id)
      } catch {
        // a ping is never worth failing a write that already succeeded
      }
    }
    return res
  }
}

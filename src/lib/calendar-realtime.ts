/**
 * `calendar-changed` (owner, 19 Oct 2026, QA B-12): the Calendar showed another person's new or changed task
 * only on its 60 s poll. The socket server now folds every change the Calendar shows into one ping to the
 * company workspace's room (`workspace:<company id>`, which every member's socket joins on connect):
 *
 *   calendar-changed { kinds: ("tasks" | "bookings" | "projects")[], actorId: string | null }
 *
 * A ping, never data: whoever has a calendar open refetches its items through the normal API, which applies
 * the calendar's visibility rules. Only changes in the company workspace's projects count (the Calendar is
 * the company's; a personal workspace's tasks never reach it). A burst (a bulk move, an automation, a
 * form that makes tasks) goes out once, CALENDAR_PING_COALESCE_MS after its first change.
 */
export const CALENDAR_PING_COALESCE_MS = 1000
export type CalendarChangeKind = "tasks" | "bookings" | "projects"
export type CalendarChangedPayload = { kinds: CalendarChangeKind[]; actorId: string | null }

const WORKSPACE_TTL_MS = 10 * 60_000

/**
 * The folding and the project → workspace lookup, apart from Socket.IO so it can be tested. `emit` sends one
 * payload; `workspaceOf` looks a project's workspace up (cached here for WORKSPACE_TTL_MS: a project
 * changing workspace is rare, and the cost of a stale entry is one ping too many or too few).
 */
export function createCalendarPinger(opts: {
  companyWorkspaceId: string
  emit: (payload: CalendarChangedPayload) => void
  workspaceOf: (projectId: string) => Promise<string | null>
  delayMs?: number
  now?: () => number
}) {
  const now = opts.now ?? Date.now
  const cache = new Map<string, { ws: string | null; at: number }>()
  const kinds = new Set<CalendarChangeKind>()
  const actors = new Set<string | null>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (kinds.size === 0) return
    const payload: CalendarChangedPayload = { kinds: [...kinds].sort(), actorId: actors.size === 1 ? ([...actors][0] ?? null) : null }
    kinds.clear()
    actors.clear()
    opts.emit(payload)
  }
  const queue = (kind: CalendarChangeKind, actorId: string | null = null) => {
    kinds.add(kind)
    actors.add(actorId)
    if (!timer) {
      timer = setTimeout(flush, opts.delayMs ?? CALENDAR_PING_COALESCE_MS)
      ;(timer as { unref?: () => void }).unref?.()
    }
  }
  const workspaceOf = async (projectId: string): Promise<string | null> => {
    const hit = cache.get(projectId)
    if (hit && now() - hit.at < WORKSPACE_TTL_MS) return hit.ws
    const ws = await opts.workspaceOf(projectId).catch(() => null)
    cache.set(projectId, { ws, at: now() })
    if (cache.size > 5000) cache.delete(cache.keys().next().value as string)
    return ws
  }
  return {
    /** A task of this project was created, changed or deleted. */
    async task(projectId: string | null | undefined, actorId: string | null = null) {
      if (typeof projectId !== "string" || !projectId) return
      if ((await workspaceOf(projectId)) === opts.companyWorkspaceId) queue("tasks", actorId)
    },
    /** A `workspace-changed` ping: room bookings or projects of the company workspace moved. */
    workspace(workspaceId: string | null | undefined, kind: unknown, actorId: unknown) {
      if (workspaceId !== opts.companyWorkspaceId) return
      const actor = typeof actorId === "string" ? actorId : null
      if (kind === "bookings") queue("bookings", actor)
      else if (kind === "projects" || kind === "folders") queue("projects", actor)
    },
    flush,
  }
}

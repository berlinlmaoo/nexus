import prisma from "@/lib/prisma"
import { isValidTimeZone, nextOccurrence } from "@/lib/gideon-triggers"

/** Shapes shared by /api/gideon/schedules* and /api/gideon/runs* (12 Oct 2026). */

type ScheduleRow = {
  id: string
  projectId: string
  kind: string
  enabled: boolean
  weekdays: number[]
  time: string
  timezone: string
  language: string
  instructions: string | null
  createdById: string
  lastRunAt: Date | null
  lastRunId: string | null
  lastStatus: string | null
  nextRunAt: Date | null
}

export async function scheduleView(row: ScheduleRow) {
  const owner = await prisma.user.findUnique({ where: { id: row.createdById }, select: { id: true, name: true } })
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    enabled: row.enabled,
    weekdays: row.weekdays,
    time: row.time,
    timezone: row.timezone,
    language: row.language,
    instructions: row.instructions,
    runsAs: owner ? { id: owner.id, name: owner.name } : null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunId: row.lastRunId,
    lastStatus: row.lastStatus,
    nextRunAt: row.enabled ? row.nextRunAt?.toISOString() ?? null : null,
  }
}

/** Validate a create/patch body. `current` = the row being patched (missing fields keep its values). */
export function validateScheduleInput(body: Record<string, unknown>, current: ScheduleRow | null):
  | { data: { enabled: boolean; weekdays: number[]; time: string; timezone: string; language: string; instructions: string | null; nextRunAt: Date | null } }
  | { error: string } {
  const weekdays = Array.isArray(body.weekdays)
    ? [...new Set(body.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : current?.weekdays ?? [1]
  if (!weekdays.length) return { error: "Pick at least one day" }
  const time = typeof body.time === "string" ? body.time.trim() : current?.time ?? "09:00"
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Time must be HH:MM" }
  const timezone = typeof body.timezone === "string" ? body.timezone.trim() : current?.timezone ?? "Asia/Jakarta"
  if (!isValidTimeZone(timezone)) return { error: "Unknown time zone" }
  const language = body.language === "en" ? "en" : body.language === "id" ? "id" : current?.language ?? "id"
  const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 500) || null : body.instructions === null ? null : current?.instructions ?? null
  const enabled = typeof body.enabled === "boolean" ? body.enabled : current?.enabled ?? true
  return { data: { enabled, weekdays, time, timezone, language, instructions, nextRunAt: enabled ? nextOccurrence(weekdays, time, timezone) : null } }
}

type RunRow = {
  id: string
  userId: string | null
  trigger: string
  status: string
  approvalMode: string
  tier: string | null
  title: string | null
  projectId: string | null
  taskId: string | null
  scheduleId: string | null
  toolsUsed: string[]
  toolCalls: number
  tokens: number | null
  error: string | null
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
}

export function runRowView(r: RunRow, users: Array<{ id: string; name: string | null; avatar: string | null }>, viewerId: string) {
  const who = users.find((u) => u.id === r.userId)
  const privateChat = r.trigger === "CHAT" && r.userId !== viewerId
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    approvalMode: r.approvalMode,
    tier: r.tier,
    title: privateChat ? null : r.title,
    titleHidden: privateChat,
    user: who ? { id: who.id, name: who.name, avatar: who.avatar } : null,
    projectId: r.projectId,
    taskId: r.taskId,
    scheduleId: r.scheduleId,
    toolsUsed: r.toolsUsed,
    toolCalls: r.toolCalls,
    tokens: r.tokens,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
  }
}

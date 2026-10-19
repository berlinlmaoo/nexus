import prisma from "@/lib/prisma"
import { formatAttendanceDateKey } from "@/lib/attendance"
import { emitAttendanceBoardChanged, emitAttendanceChanged } from "@/lib/socket-emitter"
import { createLogger } from "@/lib/logger"

const log = createLogger("attendance-broadcast")

/**
 * Attendance realtime (owner, 19 Oct 2026: "is all attendance realtime?").
 *
 * A write that changes what someone's attendance looks like (check-in, check-out, an automatic check-out, an
 * offsite verdict, a record edit or override, a request decision, a day-off grant or deduction) tells two
 * audiences, ids only — never coordinates, selfies, reasons or names:
 *
 *   1. the person themselves: `attendance-changed` { kind, id, userId, date } to `user:<person>` (their other
 *      devices: today card, history), at once;
 *   2. whoever may SEE that person's attendance: `attendance-board-changed` { userIds, dates } to each viewer's
 *      `user:<id>` room, folded per viewer to at most one per second (pages/api/socket.ts).
 *
 * Who may see it is the rule the board / history / Reports-per-crew already apply (getAttendanceWorkspaceContext,
 * reportableUserIds), worked out here at send time from the database, never from a room joined earlier:
 *   - BoD / One Above All of the person's workspace — when that workspace is the viewer's primary one (oldest
 *     joinedAt), the workspace their attendance screens show;
 *   - the person's approver in the Bagan Approval (WorkspaceMember.approverId) — same primary-workspace rule;
 *   - nobody else. A Staff member with no one under them never hears about anybody but themselves.
 */
export type AttendanceChangeKind =
  | "check_in"
  | "check_out"
  | "auto_check_out"
  | "offsite"
  | "record"
  | "override"
  | "request"
  | "correction"
  | "dayoff"
  | "dayoff_bonus"
  | "deduction"
  | "suspect"

const VIEWER_ROLES = ["BOD", "ONE_ABOVE_ALL"] as const

/** Everyone, besides the person, who may see `personId`'s attendance. The ONLY place that answers it for realtime. */
export async function attendanceViewerIds(personId: string): Promise<string[]> {
  const mine = await prisma.workspaceMember.findMany({
    where: { userId: personId },
    select: { workspaceId: true, approverId: true },
  })
  if (!mine.length) return []
  const workspaceIds = [...new Set(mine.map((m) => m.workspaceId))]
  const managers = await prisma.workspaceMember.findMany({
    where: { workspaceId: { in: workspaceIds }, role: { in: [...VIEWER_ROLES] } },
    select: { userId: true, workspaceId: true },
  })
  // viewer → the workspaces through which they see this person
  const through = new Map<string, Set<string>>()
  const add = (viewer: string, ws: string) => {
    if (!viewer || viewer === personId) return
    const set = through.get(viewer) ?? new Set<string>()
    set.add(ws)
    through.set(viewer, set)
  }
  for (const m of managers) add(m.userId, m.workspaceId)
  for (const m of mine) if (m.approverId) add(m.approverId, m.workspaceId)
  if (!through.size) return []

  // A viewer's attendance screens show their PRIMARY workspace only (getAttendanceWorkspaceContext).
  const rows = await prisma.workspaceMember.findMany({
    where: { userId: { in: [...through.keys()] }, user: { deactivatedAt: null } },
    select: { userId: true, workspaceId: true },
    orderBy: { joinedAt: "asc" },
  })
  const primary = new Map<string, string>()
  for (const r of rows) if (!primary.has(r.userId)) primary.set(r.userId, r.workspaceId)
  return [...through].filter(([viewer, ws]) => ws.has(primary.get(viewer) ?? "")).map(([viewer]) => viewer)
}

/** "YYYY-MM-DD" of an attendance day (stored as UTC midnight of the day) or of a moment (office time). */
export function attendanceDateKeyOf(date: Date | string | null | undefined): string | null {
  if (!date) return null
  if (typeof date === "string") return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null
  if (Number.isNaN(date.getTime())) return null
  const iso = date.toISOString()
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : formatAttendanceDateKey(date)
}

/**
 * Tell the person and their viewers that this person's attendance changed. Fire-and-forget: never throws, never
 * delays the caller's answer (the viewer lookup runs after it returns). Call AFTER the write committed.
 */
export function noteAttendanceChanged(
  personIds: string | Array<string | null | undefined>,
  kind: AttendanceChangeKind,
  id: string | null,
  date?: Date | string | null,
): void {
  try {
    const people = [...new Set((Array.isArray(personIds) ? personIds : [personIds]).filter((u): u is string => typeof u === "string" && u.length > 0))]
    if (!people.length) return
    const dateKey = attendanceDateKeyOf(date ?? null)
    for (const userId of people) emitAttendanceChanged([userId], kind, id, { userId, date: dateKey })
    setTimeout(() => {
      void (async () => {
        for (const userId of people) {
          try {
            const viewers = await attendanceViewerIds(userId)
            if (viewers.length) emitAttendanceBoardChanged(viewers, userId, dateKey)
          } catch (error) {
            log.warn("viewer lookup failed", { userId, error: String(error) })
          }
        }
      })()
    }, 0).unref?.()
  } catch {
    // a ping is never worth failing a write that already succeeded
  }
}

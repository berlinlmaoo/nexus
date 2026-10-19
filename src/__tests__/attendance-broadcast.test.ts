// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// Attendance realtime scoping (19 Oct 2026): who hears that a person's attendance moved. Mirrors the board /
// history / Reports-per-crew rule (getAttendanceWorkspaceContext + reportableUserIds): BoD/OAA of the person's
// workspace and their approver — each only when that workspace is the viewer's primary one — and nobody else.

type Row = { userId: string; workspaceId: string; role: string; approverId: string | null; joinedAt: Date; deactivated?: boolean }
const m = vi.hoisted(() => ({ rows: [] as Row[] }))

vi.mock("@/lib/prisma", () => {
  type Where = { userId?: string | { in: string[] }; workspaceId?: { in: string[] }; role?: { in: string[] }; user?: { deactivatedAt: null } }
  const match = (r: Row, w: Where) => {
    if (typeof w.userId === "string" && r.userId !== w.userId) return false
    if (w.userId && typeof w.userId === "object" && !w.userId.in.includes(r.userId)) return false
    if (w.workspaceId && !w.workspaceId.in.includes(r.workspaceId)) return false
    if (w.role && !w.role.in.includes(r.role)) return false
    if (w.user && r.deactivated) return false
    return true
  }
  return {
    default: {
      workspaceMember: {
        findMany: async ({ where, orderBy }: { where: Where; orderBy?: unknown }) => {
          const out = m.rows.filter((r) => match(r, where))
          if (orderBy) out.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
          return out.map((r) => ({ ...r }))
        },
      },
    },
  }
})

import { attendanceViewerIds, attendanceDateKeyOf, noteAttendanceChanged } from "@/lib/attendance-broadcast"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"

const d = (n: number) => new Date(Date.UTC(2026, 0, n))
const ORG = "ws-org"
const OTHER = "ws-other"

beforeEach(() => {
  m.rows = [
    { userId: "oaa", workspaceId: ORG, role: "ONE_ABOVE_ALL", approverId: null, joinedAt: d(1) },
    { userId: "bod", workspaceId: ORG, role: "BOD", approverId: null, joinedAt: d(1) },
    { userId: "mgr", workspaceId: ORG, role: "MANAGER", approverId: null, joinedAt: d(2) },
    { userId: "mgr2", workspaceId: ORG, role: "MANAGER", approverId: null, joinedAt: d(2) },
    { userId: "staff", workspaceId: ORG, role: "STAFF", approverId: "mgr", joinedAt: d(3) },
    { userId: "peer", workspaceId: ORG, role: "STAFF", approverId: "mgr", joinedAt: d(3) },
    // a BoD whose PRIMARY workspace is another one: their attendance screens never show ORG
    { userId: "bod-elsewhere", workspaceId: OTHER, role: "BOD", approverId: null, joinedAt: d(1) },
    { userId: "bod-elsewhere", workspaceId: ORG, role: "BOD", approverId: null, joinedAt: d(5) },
    // offboarded BoD: never
    { userId: "bod-gone", workspaceId: ORG, role: "BOD", approverId: null, joinedAt: d(1), deactivated: true },
    // the person's personal workspace, owned by themselves
    { userId: "staff", workspaceId: "ws-personal", role: "ONE_ABOVE_ALL", approverId: null, joinedAt: d(9) },
  ]
})

describe("attendanceViewerIds", () => {
  it("a staff member's attendance reaches BoD/OAA of the workspace and their own approver only", async () => {
    const v = await attendanceViewerIds("staff")
    expect(v.sort()).toEqual(["bod", "mgr", "oaa"])
    expect(v).not.toContain("peer") // a colleague (Staff) never
    expect(v).not.toContain("mgr2") // another manager never
    expect(v).not.toContain("staff") // the person gets their own event, not this one
  })
  it("respects the viewer's primary workspace and skips offboarded viewers", async () => {
    const v = await attendanceViewerIds("staff")
    expect(v).not.toContain("bod-elsewhere")
    expect(v).not.toContain("bod-gone")
  })
  it("a manager with no approver above them is seen by BoD/OAA only", async () => {
    expect((await attendanceViewerIds("mgr")).sort()).toEqual(["bod", "oaa"])
  })
  it("a BoD's own attendance is seen by the other BoD/OAA, not by themselves through the role", async () => {
    expect((await attendanceViewerIds("bod")).sort()).toEqual(["oaa"])
  })
  it("someone in no workspace has no viewers", async () => {
    expect(await attendanceViewerIds("nobody")).toEqual([])
  })
})

describe("noteAttendanceChanged", () => {
  it("pings the person at once and their viewers after, ids only", async () => {
    const own: unknown[] = []
    const board: unknown[] = []
    const a = (x: unknown) => own.push(x)
    const b = (x: unknown) => board.push(x)
    eventBus.on(BUS_EVENTS.ATTENDANCE_CHANGED, a)
    eventBus.on(BUS_EVENTS.ATTENDANCE_BOARD_CHANGED, b)
    try {
      noteAttendanceChanged("staff", "check_in", "rec-1", new Date("2026-10-19T00:00:00.000Z"))
      expect(own).toEqual([{ userIds: ["staff"], kind: "check_in", id: "rec-1", userId: "staff", date: "2026-10-19" }])
      await vi.waitFor(() => expect(board.length).toBe(1))
      const evt = board[0] as { viewerIds: string[]; userId: string; date: string }
      expect(evt.userId).toBe("staff")
      expect(evt.date).toBe("2026-10-19")
      expect(evt.viewerIds.sort()).toEqual(["bod", "mgr", "oaa"])
      expect(Object.keys(evt).sort()).toEqual(["date", "userId", "viewerIds"])
    } finally {
      eventBus.off(BUS_EVENTS.ATTENDANCE_CHANGED, a)
      eventBus.off(BUS_EVENTS.ATTENDANCE_BOARD_CHANGED, b)
    }
  })
  it("never throws on junk input", () => {
    expect(() => noteAttendanceChanged([null, undefined, ""], "record", null)).not.toThrow()
  })
})

describe("attendanceDateKeyOf", () => {
  it("reads a stored attendance day, a key and a moment in office time", () => {
    expect(attendanceDateKeyOf(new Date("2026-10-19T00:00:00.000Z"))).toBe("2026-10-19")
    expect(attendanceDateKeyOf("2026-10-19")).toBe("2026-10-19")
    expect(attendanceDateKeyOf(new Date("2026-10-19T20:00:00.000Z"))).toBe("2026-10-20") // 03:00 WIB next day
    expect(attendanceDateKeyOf(null)).toBeNull()
  })
})

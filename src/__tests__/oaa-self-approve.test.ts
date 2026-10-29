// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// Owner, 29 Oct 2026: One Above All may approve/reject their OWN attendance requests (and offsite
// check-outs). BoD, managers and staff keep four-eyes. Both the routes' early guard
// (isForbiddenSelfReview) and the shared verdict (canUserReviewRequest) are pinned here.

type Member = { userId: string; workspaceId: string; role: string; approverId: string | null }
const m = vi.hoisted(() => ({ members: [] as Member[] }))

vi.mock("@/lib/prisma", () => {
  const db = {
    workspaceMember: {
      findUnique: async ({ where }: { where: { userId_workspaceId: { userId: string; workspaceId: string } } }) =>
        m.members.find((r) => r.userId === where.userId_workspaceId.userId && r.workspaceId === where.userId_workspaceId.workspaceId) ?? null,
      findMany: async ({ where }: { where: { workspaceId: string; role?: string; userId?: { not: string } } }) =>
        m.members
          .filter((r) => r.workspaceId === where.workspaceId && (!where.role || r.role === where.role) && (!where.userId || r.userId !== where.userId.not))
          .map((r) => ({ userId: r.userId })),
    },
  }
  return { default: db, prisma: db }
})

import { canReviewOwnAttendance, canUserReviewRequest, isForbiddenSelfReview } from "@/lib/attendance-approvers"

const WS = "ws-1"
// The context shapes getAttendanceWorkspaceContext returns for each role.
const oaa = { workspaceRole: "ONE_ABOVE_ALL", canManageAttendance: true, approvalScopeUserIds: null }
const bod = { workspaceRole: "BOD", canManageAttendance: true, approvalScopeUserIds: ["bod", "mgr", "staff"] }
const mgr = { workspaceRole: "MANAGER", canManageAttendance: false, approvalScopeUserIds: ["staff"] }
const staff = { workspaceRole: "STAFF", canManageAttendance: false, approvalScopeUserIds: [] as string[] }

beforeEach(() => {
  m.members = [
    { userId: "oaa", workspaceId: WS, role: "ONE_ABOVE_ALL", approverId: null },
    { userId: "bod", workspaceId: WS, role: "BOD", approverId: null },
    { userId: "mgr", workspaceId: WS, role: "MANAGER", approverId: "bod" },
    { userId: "staff", workspaceId: WS, role: "STAFF", approverId: "mgr" },
  ]
})

describe("four-eyes with the One Above All exception", () => {
  it("One Above All may decide their own request", async () => {
    expect(canReviewOwnAttendance(oaa)).toBe(true)
    expect(isForbiddenSelfReview("oaa", "oaa", oaa)).toBe(false)
    // Recorded as ADMIN — never as if a direct manager had approved it.
    expect(await canUserReviewRequest("oaa", "oaa", WS, oaa)).toEqual({ ok: true, source: "ADMIN" })
  })

  it("One Above All with an approver of their own still decides their own", async () => {
    m.members[0].approverId = "bod"
    expect(await canUserReviewRequest("oaa", "oaa", WS, oaa)).toEqual({ ok: true, source: "ADMIN" })
  })

  it("a BoD still cannot decide their own request", async () => {
    expect(isForbiddenSelfReview("bod", "bod", bod)).toBe(true)
    expect(await canUserReviewRequest("bod", "bod", WS, bod)).toEqual({ ok: false })
  })

  it("a manager and a staff still cannot decide their own request", async () => {
    expect(isForbiddenSelfReview("mgr", "mgr", mgr)).toBe(true)
    expect(await canUserReviewRequest("mgr", "mgr", WS, mgr)).toEqual({ ok: false })
    expect(isForbiddenSelfReview("staff", "staff", staff)).toBe(true)
    expect(await canUserReviewRequest("staff", "staff", WS, staff)).toEqual({ ok: false })
  })

  it("a context without a role is treated as not One Above All", async () => {
    expect(isForbiddenSelfReview("oaa", "oaa", { canManageAttendance: true, approvalScopeUserIds: null } as never)).toBe(true)
  })

  it("deciding someone else's request is unchanged", async () => {
    expect(isForbiddenSelfReview("bod", "mgr", bod)).toBe(false)
    expect(await canUserReviewRequest("bod", "mgr", WS, bod)).toEqual({ ok: true, source: "DIRECT_MANAGER" })
    expect(await canUserReviewRequest("mgr", "staff", WS, mgr)).toEqual({ ok: true, source: "DIRECT_MANAGER" })
    expect(await canUserReviewRequest("oaa", "staff", WS, oaa)).toEqual({ ok: true, source: "ADMIN" })
    expect(await canUserReviewRequest("staff", "mgr", WS, staff)).toEqual({ ok: false })
  })
})

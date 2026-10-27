// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// "Staff Management" (owner, 27 Oct 2026): role STAFF + WorkspaceMember.attendanceViewAll. It SEES everyone's
// attendance and changes nothing. These pin the one context every attendance route reads: the read flags turn
// on, every write flag (canManageAttendance, canReviewAttendanceRequests, approvalScopeUserIds) stays a Staff's.

type Member = { userId: string; workspaceId: string; role: string; attendanceViewAll?: boolean; approverId?: string | null; joinedAt: Date }
const m = vi.hoisted(() => ({ members: [] as Member[] }))

vi.mock("@/lib/prisma", () => {
  const ws = { id: "ws-1", name: "Org", slug: "org" }
  const db = {
    user: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id, email: `${where.id}@x.test`, avatar: null }) },
    workspaceMember: {
      findFirst: async ({ where }: { where: { userId: string } }) => {
        const row = m.members.find((r) => r.userId === where.userId)
        return row ? { ...row, attendanceRole: "NONE", workspace: ws } : null
      },
      findMany: async ({ where }: { where: { workspaceId?: string; approverId?: string } }) =>
        m.members.filter((r) => (where.approverId === undefined || r.approverId === where.approverId)).map((r) => ({ ...r })),
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  }
  return { default: db, prisma: db }
})

import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { reflectionAccess } from "@/lib/reflection-summaries"

const d = new Date("2026-01-01T00:00:00Z")
beforeEach(() => {
  m.members = [
    { userId: "sm", workspaceId: "ws-1", role: "STAFF", attendanceViewAll: true, approverId: "mgr", joinedAt: d },
    { userId: "staff", workspaceId: "ws-1", role: "STAFF", attendanceViewAll: false, approverId: "mgr", joinedAt: d },
    { userId: "mgr", workspaceId: "ws-1", role: "MANAGER", attendanceViewAll: true, approverId: null, joinedAt: d },
  ]
})

describe("getAttendanceWorkspaceContext — Staff Management", () => {
  it("a Staff with attendanceViewAll sees everyone and can change nothing", async () => {
    const c = await getAttendanceWorkspaceContext("sm")
    expect(c.canViewAllAttendance).toBe(true)
    expect(c.attendanceReadOnlyViewer).toBe(true)
    expect(c.canManageAttendance).toBe(false)
    expect(c.canReviewAttendanceRequests).toBe(false)
    expect(c.approvalScopeUserIds).toEqual([])
  })
  it("a plain Staff sees only themselves", async () => {
    const c = await getAttendanceWorkspaceContext("staff")
    expect(c.canViewAllAttendance).toBe(false)
    expect(c.attendanceReadOnlyViewer).toBe(false)
  })
  it("the flag means nothing on another role", async () => {
    const c = await getAttendanceWorkspaceContext("mgr")
    expect(c.attendanceReadOnlyViewer).toBe(false)
    expect(c.canViewAllAttendance).toBe(false)
    expect(c.canManageAttendance).toBe(false)
  })
})

describe("reflectionAccess — read vs summarise", () => {
  it("Staff Management may read someone else's reflections", async () => {
    expect((await reflectionAccess("sm", "staff", { read: true })).ok).toBe(true)
  })
  it("but may not ask GIDEON to summarise them (a write)", async () => {
    const r = await reflectionAccess("sm", "staff")
    expect(r.ok).toBe(false)
  })
  it("a plain Staff reads only their own", async () => {
    expect((await reflectionAccess("staff", "sm", { read: true })).ok).toBe(false)
    expect((await reflectionAccess("staff", null, { read: true })).ok).toBe(true)
  })
})

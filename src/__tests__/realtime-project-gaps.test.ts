// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

// Project realtime gaps + tickets (19 Oct 2026): who a `complaint-changed` reaches, and that `project-changed` /
// the task announce carry ids only. The socket server's room delivery is covered by realtime-workspace.test.ts.

const m = vi.hoisted(() => ({
  complaint: { reporterId: "u-staff", workspaceId: "ws-1" } as { reporterId: string; workspaceId: string } | null,
  members: [
    { userId: "u-staff", workspaceId: "ws-1", role: "STAFF" },
    { userId: "u-other-staff", workspaceId: "ws-1", role: "STAFF" },
    { userId: "u-manager", workspaceId: "ws-1", role: "MANAGER" },
    { userId: "u-bod", workspaceId: "ws-1", role: "BOD" },
    { userId: "u-oaa", workspaceId: "ws-1", role: "ONE_ABOVE_ALL" },
    { userId: "u-bod-elsewhere", workspaceId: "ws-2", role: "BOD" },
  ],
}))

vi.mock("@/lib/prisma", () => ({ default: prismaFake() }))
vi.mock("../lib/prisma", () => ({ default: prismaFake() }))
function prismaFake() {
  return {
    complaint: { findUnique: async () => m.complaint },
    workspaceMember: {
      findMany: async ({ where }: { where: { workspaceId: string; role: { in: string[] } } }) =>
        m.members.filter((r) => r.workspaceId === where.workspaceId && where.role.in.includes(r.role)).map((r) => ({ userId: r.userId })),
    },
    task: {
      findUnique: async () => ({
        id: "t-1", title: "x", updatedAt: new Date("2026-10-19T00:00:00Z"),
        taskList: { id: "l-1", projectId: "p-home" },
        taskProjects: [{ projectId: "p-linked" }],
        assignees: [], creator: null, _count: { subtasks: 0, comments: 0 },
      }),
    },
  }
}

import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { emitComplaintChanged } from "@/lib/complaint-realtime"
import { announceTaskChanged, emitProjectContentChanged, pingTaskDetail } from "@/lib/project-realtime"

function capture(event: string) {
  const got: unknown[] = []
  const h = (d: unknown) => got.push(d)
  eventBus.on(event, h)
  return { got, off: () => eventBus.off(event, h) }
}

describe("complaint-changed", () => {
  beforeEach(() => { m.complaint = { reporterId: "u-staff", workspaceId: "ws-1" } })

  it("reaches the reporter and the workspace's BoD/OAA only", async () => {
    const c = capture(BUS_EVENTS.COMPLAINT_CHANGED)
    await emitComplaintChanged("c-1", "message")
    c.off()
    expect(c.got).toHaveLength(1)
    const d = c.got[0] as { userIds: string[]; payload: unknown }
    expect(new Set(d.userIds)).toEqual(new Set(["u-staff", "u-bod", "u-oaa"]))
    expect(d.userIds).not.toContain("u-other-staff")
    expect(d.userIds).not.toContain("u-manager")
    expect(d.userIds).not.toContain("u-bod-elsewhere")
    expect(d.payload).toEqual({ id: "c-1", kind: "message" })
  })

  it("does nothing for a ticket that is gone", async () => {
    m.complaint = null
    const c = capture(BUS_EVENTS.COMPLAINT_CHANGED)
    await emitComplaintChanged("c-x", "status")
    c.off()
    expect(c.got).toHaveLength(0)
  })
})

describe("project-changed", () => {
  it("is ids only", () => {
    const c = capture(BUS_EVENTS.PROJECT_CHANGED)
    emitProjectContentChanged("p-1", "forms", "f-1", "u-1")
    emitProjectContentChanged(null, "forms", "f-1", "u-1")
    c.off()
    expect(c.got).toEqual([{ projectId: "p-1", kind: "forms", id: "f-1", actorId: "u-1" }])
  })

  it("pings every project a task shows in", async () => {
    const c = capture(BUS_EVENTS.PROJECT_CHANGED)
    await pingTaskDetail("t-1", "u-1")
    c.off()
    expect(c.got.map((d) => (d as { projectId: string }).projectId).sort()).toEqual(["p-home", "p-linked"])
  })

  it("announces the fresh task row to its home and linked projects", async () => {
    const c = capture(BUS_EVENTS.TASK_UPDATED)
    await announceTaskChanged("t-1")
    c.off()
    expect(c.got.map((d) => (d as { projectId: string }).projectId).sort()).toEqual(["p-home", "p-linked"])
    const task = (c.got[0] as { task: Record<string, unknown> }).task
    expect(task.id).toBe("t-1")
    expect(task).not.toHaveProperty("taskProjects")
  })
})

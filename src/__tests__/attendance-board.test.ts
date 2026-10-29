// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { offboardedUserIdsAmong, withoutOffboarded } from "@/lib/attendance-board"

// Offboarded people are hidden from the attendance board (owner, 29 Oct 2026).

describe("withoutOffboarded", () => {
  const rows = [
    { id: "r1", user: { id: "active" } },
    { id: "r2", user: { id: "gone" } },
    { id: "r3", user: { id: "active" } },
  ]
  const roster = [{ user: { id: "active" } }, { user: { id: "gone" } }, { user: { id: "new" } }]

  it("drops every row and roster entry of an offboarded person, keeps everyone else in order", () => {
    const out = withoutOffboarded({ rows, roster }, new Set(["gone"]))
    expect(out.rows.map((r) => r.id)).toEqual(["r1", "r3"])
    expect(out.roster.map((m) => m.user.id)).toEqual(["active", "new"])
  })

  it("nobody offboarded: the board as it was, inputs untouched", () => {
    const board = { rows, roster }
    expect(withoutOffboarded(board, new Set())).toBe(board)
    withoutOffboarded(board, new Set(["gone"]))
    expect(rows).toHaveLength(3)
    expect(roster).toHaveLength(3)
  })
})

describe("offboardedUserIdsAmong", () => {
  const asDb = (findMany: unknown) => ({ user: { findMany } }) as unknown as Parameters<typeof offboardedUserIdsAmong>[0]
  it("asks only for deactivated accounts among the given ids, deduplicated", async () => {
    const findMany = vi.fn(async () => [{ id: "gone" }])
    const out = await offboardedUserIdsAmong(asDb(findMany), ["active", "gone", "active"])
    expect([...out]).toEqual(["gone"])
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ["active", "gone"] }, deactivatedAt: { not: null } }, select: { id: true } })
  })

  it("no ids: no query", async () => {
    const findMany = vi.fn(async () => [])
    expect((await offboardedUserIdsAmong(asDb(findMany), [])).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})

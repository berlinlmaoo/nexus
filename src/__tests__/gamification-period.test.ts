import { describe, expect, it, vi } from "vitest"

// Pure period helpers only: no database call is made, the client is a stub.
vi.mock("@/lib/prisma", () => ({ default: {} }))

import { getLeaderboardPeriodEnd, getLeaderboardPeriodStart, LEADERBOARD_RESET_DAY } from "@/lib/gamification"

// Owner, 16 Oct 2026: the leaderboard period runs from the 28th 00:00 WIB, the same 28th→27th period as attendance.
describe("leaderboard period", () => {
  it("resets on the 28th", () => {
    expect(LEADERBOARD_RESET_DAY).toBe(28)
  })

  it("starts on the previous 28th before the 28th", () => {
    // 16 Oct 2026 10:00 WIB → the period began 28 Sep 2026 00:00 WIB.
    expect(getLeaderboardPeriodStart(new Date("2026-10-16T03:00:00Z")).toISOString()).toBe("2026-09-27T17:00:00.000Z")
    // 27 Oct 23:59 WIB is still the September period.
    expect(getLeaderboardPeriodStart(new Date("2026-10-27T16:59:00Z")).toISOString()).toBe("2026-09-27T17:00:00.000Z")
  })

  it("starts a new period at 28th 00:00 WIB", () => {
    expect(getLeaderboardPeriodStart(new Date("2026-10-27T17:00:00Z")).toISOString()).toBe("2026-10-27T17:00:00.000Z")
  })

  it("rolls over the year", () => {
    // 5 Jan 2027 → 28 Dec 2026.
    expect(getLeaderboardPeriodStart(new Date("2027-01-05T03:00:00Z")).toISOString()).toBe("2026-12-27T17:00:00.000Z")
  })

  it("ends on the next 28th, February included", () => {
    expect(getLeaderboardPeriodEnd(new Date("2026-10-16T03:00:00Z")).toISOString()).toBe("2026-10-27T17:00:00.000Z")
    expect(getLeaderboardPeriodEnd(new Date("2027-02-10T03:00:00Z")).toISOString()).toBe("2027-02-27T17:00:00.000Z")
  })
})

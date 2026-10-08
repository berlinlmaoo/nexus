import { beforeEach, describe, expect, it, vi } from "vitest"

// The quota readers query two tables (three when someone has no member row: FormerMember) and the
// usage one; each is mocked with an in-memory list the mock filters the way Postgres would for the
// `where` the helper sends.
type Member = { userId: string; workspaceId: string; dayOffQuota: number | null }
type Bonus = { id: string; workspaceId: string; userId: string; periodKey: string; days: number; reason: string; revokedAt: Date | null; createdAt: Date }
type Req = { userId: string; type: string; status: string; startDate: Date; endDate: Date }

const db = vi.hoisted(() => ({ members: [] as Member[], formers: [] as Member[], bonuses: [] as Bonus[], requests: [] as Req[] }))

vi.mock("@/lib/prisma", () => {
  const inList = (v: string, cond?: { in?: string[] }) => !cond?.in || cond.in.includes(v)
  return {
    default: {
      workspaceMember: {
        findMany: vi.fn(async ({ where }: { where: { workspaceId: string; userId?: { in: string[] } } }) =>
          db.members.filter((m) => m.workspaceId === where.workspaceId && inList(m.userId, where.userId)).map((m) => ({ userId: m.userId, dayOffQuota: m.dayOffQuota })),
        ),
      },
      formerMember: {
        findMany: vi.fn(async ({ where }: { where: { workspaceId: string; userId?: { in: string[] } } }) =>
          db.formers.filter((m) => m.workspaceId === where.workspaceId && inList(m.userId, where.userId)).map((m) => ({ userId: m.userId, dayOffQuota: m.dayOffQuota })),
        ),
      },
      dayOffBonus: {
        findMany: vi.fn(async ({ where }: { where: { workspaceId: string; userId?: { in: string[] }; periodKey?: { in: string[] }; revokedAt?: null } }) =>
          db.bonuses
            .filter((b) => b.workspaceId === where.workspaceId && inList(b.userId, where.userId) && inList(b.periodKey, where.periodKey) && (where.revokedAt === null ? b.revokedAt === null : true))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        ),
      },
      attendanceRequest: {
        findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] }; OR: { startDate: { lte: Date }; endDate: { gte: Date } }[] } }) =>
          db.requests.filter(
            (r) =>
              where.userId.in.includes(r.userId) &&
              r.type === "DAY_OFF" &&
              (r.status === "PENDING" || r.status === "APPROVED") &&
              where.OR.some((w) => r.startDate <= w.startDate.lte && r.endDate >= w.endDate.gte),
          ),
        ),
      },
    },
  }
})

import { attendancePeriodKey, attendancePeriodRange } from "@/lib/attendance"
import { periodBounds, periodKeyOfDateKey, BONUS_PERIOD_CUTOFF_DAY } from "@/lib/day-off-bonus"
import { ATTENDANCE_CUTOFF_DAY } from "@/lib/attendance"
import { dayOffBalances, dayOffQuotaByUser, dayOffUsageKey, effectiveDayOffQuota, effectiveDayOffQuotas } from "@/lib/day-off-usage"

const WS = "ws1"
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
let seq = 0
const bonus = (userId: string, periodKey: string, days: number, extra: Partial<Bonus> = {}): Bonus => ({
  id: `b${++seq}`, workspaceId: WS, userId, periodKey, days, reason: `r${seq}`, revokedAt: null, createdAt: new Date(Date.UTC(2026, 8, 1, 0, seq)), ...extra,
})

beforeEach(() => {
  seq = 0
  db.members = [
    { userId: "ana", workspaceId: WS, dayOffQuota: null },
    { userId: "budi", workspaceId: WS, dayOffQuota: 9 },
    { userId: "cici", workspaceId: WS, dayOffQuota: 0 },
    { userId: "ana", workspaceId: "ws2", dayOffQuota: 6 },
  ]
  db.formers = []
  db.bonuses = []
  db.requests = []
})

describe("period math agrees with lib/attendance", () => {
  it("same cut-off day", () => {
    expect(BONUS_PERIOD_CUTOFF_DAY).toBe(ATTENDANCE_CUTOFF_DAY)
  })
  it("same period for every day of two years, and the same bounds", () => {
    for (let t = d("2026-01-01").getTime(); t <= d("2027-12-31").getTime(); t += 86_400_000) {
      const key = new Date(t).toISOString().slice(0, 10)
      expect(periodKeyOfDateKey(key)).toBe(attendancePeriodKey(key))
    }
    for (const k of ["2026-01", "2026-03", "2026-10", "2026-12", "2028-03"]) {
      const a = attendancePeriodRange(k)
      const b = periodBounds(k)
      expect(b.start.toISOString()).toBe(a.start.toISOString())
      expect(b.end.toISOString()).toBe(a.end.toISOString())
    }
  })
})

describe("effectiveDayOffQuotas", () => {
  it("no grants: the member's quota, default 4, an explicit 0 kept", async () => {
    const q = await effectiveDayOffQuotas(WS, ["ana", "budi", "cici"].map((userId) => ({ userId, periodKey: "2026-10" })))
    expect(q.get(dayOffUsageKey("ana", "2026-10"))).toMatchObject({ base: 4, bonus: 0, quota: 4, grants: [] })
    expect(q.get(dayOffUsageKey("budi", "2026-10"))).toMatchObject({ base: 9, bonus: 0, quota: 9 })
    expect(q.get(dayOffUsageKey("cici", "2026-10"))).toMatchObject({ base: 0, bonus: 0, quota: 0 })
  })

  it("adds only the grants of THAT period and workspace, skipping revoked ones", async () => {
    db.bonuses = [
      bonus("ana", "2026-10", 3),
      bonus("ana", "2026-10", 1),
      bonus("ana", "2026-10", 5, { revokedAt: new Date() }),
      bonus("ana", "2026-11", 2),
      bonus("ana", "2026-10", 7, { workspaceId: "ws2" }),
      bonus("budi", "2026-10", 2),
    ]
    const q = await effectiveDayOffQuotas(WS, [
      { userId: "ana", periodKey: "2026-10" },
      { userId: "ana", periodKey: "2026-11" },
      { userId: "ana", periodKey: "2026-09" },
      { userId: "budi", periodKey: "2026-10" },
    ])
    expect(q.get("ana|2026-10")).toEqual({ base: 4, bonus: 4, quota: 8, grants: [{ id: "b1", days: 3, reason: "r1" }, { id: "b2", days: 1, reason: "r2" }] })
    expect(q.get("ana|2026-11")).toMatchObject({ bonus: 2, quota: 6 })
    expect(q.get("ana|2026-09")).toMatchObject({ bonus: 0, quota: 4 })
    expect(q.get("budi|2026-10")).toMatchObject({ base: 9, bonus: 2, quota: 11 })
  })

  it("a non-member gets the default base (as every caller's ?? 4 did) plus any grant", async () => {
    db.bonuses = [bonus("zed", "2026-10", 2)]
    const q = await effectiveDayOffQuota(WS, "zed", "2026-10")
    expect(q).toMatchObject({ base: 4, bonus: 2, quota: 6 })
  })

  it("someone who left keeps the quota their member row had (offboarding), only in that workspace", async () => {
    db.formers = [
      { userId: "dodi", workspaceId: WS, dayOffQuota: 9 },
      { userId: "eka", workspaceId: WS, dayOffQuota: null },
      { userId: "fani", workspaceId: "ws2", dayOffQuota: 7 },
    ]
    db.bonuses = [bonus("dodi", "2026-10", 1)]
    const q = await effectiveDayOffQuotas(WS, ["dodi", "eka", "fani", "ana"].map((userId) => ({ userId, periodKey: "2026-10" })))
    expect(q.get("dodi|2026-10")).toMatchObject({ base: 9, bonus: 1, quota: 10 })
    expect(q.get("eka|2026-10")).toMatchObject({ base: 4, quota: 4 })
    expect(q.get("fani|2026-10")).toMatchObject({ base: 4, quota: 4 })
    expect(q.get("ana|2026-10")).toMatchObject({ base: 4, quota: 4 })
  })

  it("asks FormerMember only when someone has no member row", async () => {
    const prisma = (await import("@/lib/prisma")).default as unknown as { formerMember: { findMany: ReturnType<typeof vi.fn> } }
    prisma.formerMember.findMany.mockClear()
    await effectiveDayOffQuotas(WS, ["ana", "budi"].map((userId) => ({ userId, periodKey: "2026-10" })))
    expect(prisma.formerMember.findMany).not.toHaveBeenCalled()
    await effectiveDayOffQuotas(WS, [{ userId: "zed", periodKey: "2026-10" }])
    expect(prisma.formerMember.findMany).toHaveBeenCalledTimes(1)
  })

  it("empty input makes no query", async () => {
    const prisma = (await import("@/lib/prisma")).default as unknown as { workspaceMember: { findMany: ReturnType<typeof vi.fn> } }
    prisma.workspaceMember.findMany.mockClear()
    expect((await effectiveDayOffQuotas(WS, [])).size).toBe(0)
    expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
  })
})

describe("dayOffQuotaByUser (exports, sheet, history rows)", () => {
  it("is per period", async () => {
    db.bonuses = [bonus("ana", "2026-10", 3)]
    expect((await dayOffQuotaByUser(WS, ["ana", "budi"], "2026-10")).get("ana")).toBe(7)
    expect((await dayOffQuotaByUser(WS, ["ana", "budi"], "2026-11")).get("ana")).toBe(4)
    expect((await dayOffQuotaByUser(WS, ["ana", "budi"], "2026-10")).get("budi")).toBe(9)
  })
})

describe("dayOffBalances (cap figures, izin guard, absence push)", () => {
  it("the bonus raises quota and remaining; usage is counted exactly as before", async () => {
    db.bonuses = [bonus("ana", "2026-10", 3)]
    db.requests = [
      { userId: "ana", type: "DAY_OFF", status: "APPROVED", startDate: d("2026-09-29"), endDate: d("2026-09-29") },
      { userId: "ana", type: "DAY_OFF", status: "PENDING", startDate: d("2026-10-02"), endDate: d("2026-10-02") },
      { userId: "ana", type: "DAY_OFF", status: "REJECTED", startDate: d("2026-10-03"), endDate: d("2026-10-03") },
      // an auto-cut ("tidak check-in") is a DAY_OFF row like any other — still charged
      { userId: "ana", type: "DAY_OFF", status: "APPROVED", startDate: d("2026-10-05"), endDate: d("2026-10-05") },
    ]
    const b = await dayOffBalances(WS, [{ userId: "ana", periodKey: "2026-10" }])
    expect(b.get("ana|2026-10")).toEqual({ quota: 7, used: 3, remaining: 4 })
  })

  it("expired: last period's grant does nothing for this one", async () => {
    db.bonuses = [bonus("ana", "2026-09", 3)]
    db.requests = [1, 2, 3, 4, 5].map((i) => ({ userId: "ana", type: "DAY_OFF", status: "APPROVED", startDate: d(`2026-10-0${i}`), endDate: d(`2026-10-0${i}`) }))
    const b = await dayOffBalances(WS, [{ userId: "ana", periodKey: "2026-10" }])
    // Over quota: display capped at the allowance, remaining 0 — unchanged behaviour.
    expect(b.get("ana|2026-10")).toEqual({ quota: 4, used: 4, remaining: 0 })
  })
})

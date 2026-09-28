import { beforeEach, describe, expect, it, vi } from "vitest"

// The ledger (XpTransaction), the removals (XpRefund) and the running total (UserXp) as in-memory
// tables; the mock answers the exact calls lib/xp-refund and setLatePenalty make, the way Postgres
// would. $transaction runs the callback against the same tables (no rollback needed by these cases).
type Tx = { id: string; userId: string; amount: number; reason: string; createdAt: Date }
type Refund = { id: string; transactionId: string; userId: string; workspaceId: string; reason: string; amount: number; originalCreatedAt: Date; refundedById: string | null; note: string | null; createdAt: Date }
type Xp = { userId: string; totalXp: number; currentLevel: number }

const db = vi.hoisted(() => ({ txns: [] as Tx[], refunds: [] as Refund[], xp: [] as Xp[], seq: 0, failUnique: false }))

vi.mock("@/lib/prisma", () => {
  const client = {
    $executeRaw: vi.fn(async () => 0),
    xpTransaction: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.txns.find((t) => t.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: { where: { userId: string; reason: string } }) => db.txns.find((t) => t.userId === where.userId && t.reason === where.reason) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { amount: number } }) => {
        const t = db.txns.find((x) => x.id === where.id)!
        t.amount = data.amount
        return t
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; amount: number; reason: string } }) => {
        const t = { id: `tx${++db.seq}`, createdAt: new Date(), ...data }
        db.txns.push(t)
        return t
      }),
    },
    xpRefund: {
      findUnique: vi.fn(async ({ where }: { where: { transactionId: string } }) => db.refunds.find((r) => r.transactionId === where.transactionId) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<Refund, "id" | "createdAt"> }) => {
        if (db.failUnique || db.refunds.some((r) => r.transactionId === data.transactionId)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
        }
        const r = { id: `ref${++db.seq}`, createdAt: new Date(), ...data }
        db.refunds.push(r)
        return r
      }),
    },
    userXp: {
      upsert: vi.fn(async ({ where, create, update }: { where: { userId: string }; create: Xp; update: { totalXp: { increment: number } } }) => {
        let row = db.xp.find((x) => x.userId === where.userId)
        if (!row) { row = { ...create }; db.xp.push(row); return row }
        row.totalXp += update.totalXp.increment
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: { userId: string }; data: { currentLevel: number } }) => {
        const row = db.xp.find((x) => x.userId === where.userId)!
        row.currentLevel = data.currentLevel
        return row
      }),
    },
  }
  return { default: { ...client, $transaction: vi.fn(async (fn: (tx: typeof client) => unknown) => fn(client)) } }
})

import { refundXpTransaction } from "@/lib/xp-refund"
import { setLatePenalty } from "@/lib/gamification"
import { countDays, parseRecordPeriod, recordScore, recordWindow, shiftMonthKey, toneOfDay } from "@/lib/member-record"
import { attendancePeriodKey } from "@/lib/attendance"

const ana = "ana"
const total = () => db.xp.find((x) => x.userId === ana)?.totalXp

beforeEach(() => {
  db.seq = 0
  db.failUnique = false
  db.refunds = []
  db.txns = [
    { id: "late1", userId: ana, amount: -45, reason: "attendance:late:2026-09-14", createdAt: new Date("2026-09-14T09:00:00Z") },
    { id: "quest1", userId: ana, amount: 100, reason: "quest", createdAt: new Date("2026-09-15T09:00:00Z") },
    { id: "waiver1", userId: ana, amount: 0, reason: "attendance:waiver:2026-09-16", createdAt: new Date("2026-09-16T09:00:00Z") },
  ]
  db.xp = [{ userId: ana, totalXp: 955, currentLevel: 5 }]
})

describe("refundXpTransaction", () => {
  it("zeroes the row, hands back exactly its amount and records who and why", async () => {
    const r = await refundXpTransaction({ transactionId: "late1", workspaceId: "ws", actorId: "bod", note: "  Macet   parah " })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.refund.refunded).toBe(45)
    expect(r.refund.amount).toBe(-45)
    expect(r.refund.note).toBe("Macet parah")
    expect(db.txns.find((t) => t.id === "late1")!.amount).toBe(0)
    expect(total()).toBe(1000)
    expect(db.refunds).toHaveLength(1)
    expect(db.refunds[0]).toMatchObject({ transactionId: "late1", userId: ana, amount: -45, reason: "attendance:late:2026-09-14", refundedById: "bod" })
  })

  it("a second removal is 409 ALREADY_REFUNDED and changes nothing", async () => {
    await refundXpTransaction({ transactionId: "late1", workspaceId: "ws", actorId: "bod" })
    const again = await refundXpTransaction({ transactionId: "late1", workspaceId: "ws", actorId: "bod2" })
    expect(again).toMatchObject({ ok: false, status: 409, code: "ALREADY_REFUNDED" })
    expect(total()).toBe(1000)
    expect(db.refunds).toHaveLength(1)
  })

  it("two BoD at once: the unique transactionId turns the loser into 409", async () => {
    db.failUnique = true
    const r = await refundXpTransaction({ transactionId: "late1", workspaceId: "ws", actorId: "bod" })
    expect(r).toMatchObject({ ok: false, status: 409, code: "ALREADY_REFUNDED" })
  })

  it("a gain or the 0 XP waiver is 400 NOT_A_DEDUCTION", async () => {
    expect(await refundXpTransaction({ transactionId: "quest1", workspaceId: "ws", actorId: "bod" })).toMatchObject({ ok: false, status: 400, code: "NOT_A_DEDUCTION" })
    expect(await refundXpTransaction({ transactionId: "waiver1", workspaceId: "ws", actorId: "bod" })).toMatchObject({ ok: false, status: 400, code: "NOT_A_DEDUCTION" })
    expect(total()).toBe(955)
  })

  it("unknown id → 404; removed and later deleted by a whole-day clear → still 409", async () => {
    expect(await refundXpTransaction({ transactionId: "nope", workspaceId: "ws", actorId: "bod" })).toMatchObject({ ok: false, status: 404 })
    await refundXpTransaction({ transactionId: "late1", workspaceId: "ws", actorId: "bod" })
    db.txns = db.txns.filter((t) => t.id !== "late1")
    expect(await refundXpTransaction({ transactionId: "late1", workspaceId: "ws", actorId: "bod" })).toMatchObject({ ok: false, status: 409 })
  })
})

describe("setLatePenalty after a removal", () => {
  it("leaves a removed late penalty at 0 (live accrual / check-in cannot write it back)", async () => {
    await refundXpTransaction({ transactionId: "late1", workspaceId: "ws", actorId: "bod" })
    await setLatePenalty(ana, "2026-09-14", -80)
    expect(db.txns.find((t) => t.id === "late1")!.amount).toBe(0)
    expect(total()).toBe(1000)
  })

  it("still moves a late penalty nobody removed", async () => {
    await setLatePenalty(ana, "2026-09-14", -60)
    expect(db.txns.find((t) => t.id === "late1")!.amount).toBe(-60)
    expect(total()).toBe(940)
  })
})

describe("member record figures", () => {
  it("period window: 28th of the month before → 27th", () => {
    const w = recordWindow("2026-10")
    expect([w.from, w.to, w.days]).toEqual(["2026-09-28", "2026-10-27", 30])
    expect(recordWindow("2026-03").from).toBe("2026-02-28")
    expect(recordWindow("2027-01").from).toBe("2026-12-28")
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12")
  })

  it("period param: default current, YYYY-MM only, never the future", () => {
    expect(parseRecordPeriod(null)).toEqual({ ok: true, key: attendancePeriodKey() })
    expect(parseRecordPeriod("2026-9")).toMatchObject({ ok: false, code: "BAD_PERIOD" })
    expect(parseRecordPeriod(shiftMonthKey(attendancePeriodKey(), 1))).toMatchObject({ ok: false, code: "PERIOD_IN_FUTURE" })
  })

  it("counts and the board's Score (22/22 +3)", () => {
    const day = (dayType: string, lateMinutes = 0) => ({ dateKey: "2026-09-01", dayType, source: "ATTENDANCE", requestType: null, lateMinutes, earlyLeaveMinutes: 0, workedMinutes: 0, checkedOut: true, hasReflection: false }) as Parameters<typeof toneOfDay>[0] & object
    const days = [
      ...Array.from({ length: 23 }, () => day("PRESENT")), day("PRESENT", 30), day("PRESENT", 5),
      day("PERMIT_APPROVED"), day("SICK_APPROVED"), day("LEAVE_APPROVED"), day("DAY_OFF_APPROVED"), day("ABSENT"),
    ]
    const c = countDays(days)
    expect(c).toMatchObject({ present: 25, permit: 1, leave: 1, sick: 1, dayOff: 1, absent: 1, lateDays: 2, lateMinutes: 35 })
    // 30-day period, allowance 4 → 26 working days; 26 worked.
    expect(recordScore(30, 4, c)).toEqual({ worked: 26, working: 26, surplus: 0, totalWorked: 26 })
    // allowance 4 + 3 extra → 23 working days; 26 worked → 23/23 +3.
    expect(recordScore(30, 7, c)).toEqual({ worked: 23, working: 23, surplus: 3, totalWorked: 26 })
    expect(toneOfDay(day("PRESENT", 1))).toBe("L")
    expect(toneOfDay(day("PERMIT_APPROVED"))).toBe("I")
    expect(toneOfDay(undefined)).toBe("")
  })
})

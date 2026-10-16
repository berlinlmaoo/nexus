import fs from "fs"
import path from "path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { as, attendanceForm, companyWorld, formRequest, jsonRequest, openRecordToday, person, reflection, session, statusesOf } from "./world"

// Race audit 16 Oct 2026, PR 1 (fix/attendance-xp-races). Each case fires the concurrent requests the
// audit describes with Promise.all against a real Postgres and checks that exactly one effect remains.
// Every case logs what it observed, so the same file run against the previous build shows the bug.

vi.mock("@/lib/auth", async () => (await import("./world")).authMock)
vi.mock("@/lib/reverse-geocode", () => ({ reverseGeocodeCoordinates: async () => ({ displayName: null }) }))
vi.mock("@/lib/reflection-summaries", () => ({ summarizeReflectionDay: async () => {} }))
vi.mock("@/lib/notification-service", async (orig) => {
  const m = await orig<typeof import("@/lib/notification-service")>()
  const quiet = async () => {}
  return { ...m, notifyComplaintReply: quiet, notifyComplaintStatus: quiet, notifyOffsiteCheckoutPending: quiet }
})

import prisma from "@/lib/prisma"
import { POST as checkIn } from "@/app/api/attendance/check-in/route"
import { POST as checkOut } from "@/app/api/attendance/check-out/route"
import { PATCH as patchRecord } from "@/app/api/attendance/records/[recordId]/route"
import { PATCH as patchRequest } from "@/app/api/attendance/requests/[requestId]/route"
import { POST as xpAdjust } from "@/app/api/gamification/xp-adjust/route"
import { POST as claimQuest } from "@/app/api/gamification/quests/claim/route"
import { POST as decideCorrection } from "@/app/api/complaints/[id]/correction/route"
import { awardXp, awardXpOnce, setLatePenalty } from "@/lib/gamification"
import { cancelAttendancePenaltiesForDate, grantAttendanceWaiver, hasAttendanceWaiver } from "@/lib/attendance-absence"
import { formatAttendanceDateKey, getAttendanceDate, parseDateOnlyToUtc } from "@/lib/attendance"

void session
const uploads = () => {
  try { return fs.readdirSync(path.join(process.cwd(), "public", "uploads", "attendance")) } catch { return [] }
}
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)

afterAll(async () => { await prisma.$disconnect() })

describe("M2 check-in double tap", () => {
  it("two taps without a clientId: one record, one 201, one known 409, one selfie", async () => {
    const u = await person()
    const before = uploads().length
    const res = await Promise.all([1, 2].map(() => as(u, () => checkIn(formRequest("/api/attendance/check-in", attendanceForm())))))
    const out = await statusesOf(res)
    console.log("[race] M2 statuses", out.map((o) => o.status), out.map((o) => o.body?.error ?? (o.body?.duplicate ? "duplicate" : "ok")))
    expect(sorted(out.map((o) => o.status))).toEqual([201, 409])
    expect(out.find((o) => o.status === 409)!.body.error).toBe("You have already checked in today.")
    expect(await prisma.attendanceRecord.count({ where: { userId: u.id } })).toBe(1)
    expect(uploads().length - before).toBe(1)
  })

  it("a live tap racing its own offline replay (same clientId): 201 + 200 duplicate", async () => {
    const u = await person()
    const fd = () => attendanceForm({ clientId: `cid-${u.id}` })
    const res = await Promise.all([1, 2].map(() => as(u, () => checkIn(formRequest("/api/attendance/check-in", fd())))))
    const out = await statusesOf(res)
    console.log("[race] M2 clientId statuses", out.map((o) => o.status))
    expect(sorted(out.map((o) => o.status))).toEqual([200, 201])
    expect(out.find((o) => o.status === 200)!.body.duplicate).toBe(true)
    expect(await prisma.attendanceRecord.count({ where: { userId: u.id } })).toBe(1)
  })
})

describe("M1 check-out double tap", () => {
  it("one check-out wins; the other gets the record back as a duplicate; nothing overwritten", async () => {
    const u = await person()
    await openRecordToday(u.id)
    const before = uploads().length
    const res = await Promise.all(["a", "b"].map((k) => as(u, () => checkOut(formRequest("/api/attendance/check-out", attendanceForm({ reflection: reflection(k) }))))))
    const out = await statusesOf(res)
    const rec = await prisma.attendanceRecord.findFirstOrThrow({ where: { userId: u.id } })
    const fresh = out.filter((o) => o.status === 200 && !o.body?.duplicate)
    console.log("[race] M1 statuses", out.map((o) => `${o.status}${o.body?.duplicate ? " dup" : ""}`), "photos written", uploads().length - before)
    expect(out.map((o) => o.status)).toEqual([200, 200])
    expect(fresh).toHaveLength(1)
    expect(rec.checkOutPhotoUrl).toBe(fresh[0].body.record.checkOutPhotoUrl)
    expect(uploads().length - before).toBe(1)
  })
})

describe("M3 BoD correction vs a check-out", () => {
  it("a check-out that lands during a correction is never erased", async () => {
    const bod = await person("BOD", "Race BoD")
    let erased = 0
    let conflicts = 0
    for (let i = 0; i < 20; i++) {
      const u = await person()
      const rec = await openRecordToday(u.id)
      // The check-out does more work before its write than the correction does, so the correction is
      // started a little later each run to sweep its read/write window across the check-out's write.
      const [out, corr] = await Promise.all([
        as(u, () => checkOut(formRequest("/api/attendance/check-out", attendanceForm({ reflection: reflection(`m3-${i}`) })))),
        new Promise((r) => setTimeout(r, i * 3)).then(() => as(bod, () => patchRecord(jsonRequest(`/api/attendance/records/${rec.id}`, "PATCH", { notes: "fixed by BoD", correctionReason: "race test" }), { params: Promise.resolve({ recordId: rec.id }) }))),
      ])
      if (corr.status === 409) conflicts++
      expect([200, 409]).toContain(corr.status)
      expect(out.status).toBe(200)
      const after = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: rec.id } })
      if (!after.checkOutAt) erased++
    }
    console.log("[race] M3 check-outs erased:", erased, "of 20; corrections answered 409:", conflicts)
    expect(erased).toBe(0)
  })
})

describe("M4 cancel racing an approval", () => {
  it("exactly one of them wins; the other is the known 409", async () => {
    const bod = await person("BOD", "Race BoD")
    const { workspaceId } = await companyWorld()
    let bothWon = 0
    for (let i = 0; i < 8; i++) {
      const u = await person("STAFF", "Race Person", bod.id)
      const day = parseDateOnlyToUtc(`2027-0${1 + (i % 8)}-1${i % 9}`)
      const req = await prisma.attendanceRequest.create({ data: { userId: u.id, workspaceId, type: "PERMIT", status: "PENDING", startDate: day, endDate: day, reason: "race" } })
      const params = { params: Promise.resolve({ requestId: req.id }) }
      const [a, b] = await Promise.all([
        as(u, () => patchRequest(jsonRequest(`/api/attendance/requests/${req.id}`, "PATCH", { action: "cancel" }), params)),
        as(bod, () => patchRequest(jsonRequest(`/api/attendance/requests/${req.id}`, "PATCH", { action: "approve" }), { params: Promise.resolve({ requestId: req.id }) })),
      ])
      if (a.status === 200 && b.status === 200) bothWon++
      else expect(sorted([a.status, b.status])).toEqual([200, 409])
    }
    console.log("[race] M4 runs where cancel AND approve both returned 200:", bothWon, "of 8")
    expect(bothWon).toBe(0)
  })
})

describe("M5 two BoD deciding one ticket correction", () => {
  it("approve + approve: one reversal, one 409", async () => {
    const [bod1, bod2] = [await person("BOD", "Race BoD A"), await person("BOD", "Race BoD B")]
    const { workspaceId } = await companyWorld()
    let doubled = 0
    let wrongStatuses = 0
    for (let i = 0; i < 6; i++) {
      const u = await person()
      const day = parseDateOnlyToUtc(`2026-09-0${1 + i}`)
      const dateKey = formatAttendanceDateKey(day)
      await prisma.xpTransaction.create({ data: { userId: u.id, amount: -150, reason: `attendance:alpha:${dateKey}` } })
      const complaint = await prisma.complaint.create({ data: { workspaceId, reporterId: u.id, category: "ATTENDANCE", subject: "race" } })
      await prisma.attendanceCorrection.create({ data: { complaintId: complaint.id, workspaceId, userId: u.id, attendanceDate: day, reason: "race", proposedById: u.id, kind: "PENALTY_CANCELLATION", beforePenaltyXp: -150 } })
      const res = await Promise.all([bod1, bod2].map((b) => as(b, () => decideCorrection(jsonRequest(`/api/complaints/${complaint.id}/correction`, "POST", { decision: "APPROVE" }), { params: Promise.resolve({ id: complaint.id }) }))))
      const messages = await prisma.complaintMessage.count({ where: { complaintId: complaint.id, fromReviewer: true } })
      if (messages > 1) doubled++
      if (sorted(res.map((r) => r.status)).join() !== "200,409") wrongStatuses++
    }
    console.log("[race] M5 tickets with two approval messages:", doubled, "of 6; runs not answering 200+409:", wrongStatuses)
    expect(doubled).toBe(0)
    expect(wrongStatuses).toBe(0)
  })
})

describe("H4 xp-adjust double click", () => {
  it("five identical adjustments at once: one ledger row", async () => {
    const bod = await person("BOD", "Race BoD")
    const u = await person()
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => as(bod, () => xpAdjust(jsonRequest("/api/gamification/xp-adjust", "POST", { userId: u.id, amount: 25, note: "race" })))))
    const out = await statusesOf(res)
    const rows = await prisma.xpTransaction.count({ where: { userId: u.id, reason: { startsWith: "admin:adjust:" } } })
    console.log("[race] H4 statuses", out.map((o) => `${o.status}${o.body?.duplicate ? " dup" : ""}`), "ledger rows", rows)
    expect(rows).toBe(1)
    expect((await prisma.userXp.findUniqueOrThrow({ where: { userId: u.id } })).totalXp).toBe(25)
  })
})

describe("UserXp first insert", () => {
  it("thirty first awards at once for a user with no UserXp row: none lost", async () => {
    const u = await person()
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => awardXp(u.id, 7, "quest")))
    const failed = results.filter((r) => r.status === "rejected").length
    const xp = await prisma.userXp.findUnique({ where: { userId: u.id } })
    console.log("[race] UserXp first insert: failed", failed, "of 30; totalXp", xp?.totalXp)
    expect(failed).toBe(0)
    expect(xp?.totalXp).toBe(210)
  })
})

describe("Quest claim double tap", () => {
  it("one claim, one XP row, the loser is the known 409", async () => {
    const u = await person()
    const { workspaceId } = await companyWorld()
    const quest = await prisma.quest.create({ data: { workspaceId, title: "Race quest", requirementType: "task_count", requiredCount: 0, xpReward: 40, createdById: u.id } })
    const res = await Promise.all([1, 2].map(() => as(u, () => claimQuest(jsonRequest("/api/gamification/quests/claim", "POST", { questKey: quest.id })))))
    const out = await statusesOf(res)
    console.log("[race] quest claim statuses", out.map((o) => o.status))
    expect(sorted(out.map((o) => o.status))).toEqual([200, 409])
    expect(await prisma.questClaim.count({ where: { userId: u.id } })).toBe(1)
    expect(await prisma.xpTransaction.count({ where: { userId: u.id, reason: "quest" } })).toBe(1)
  })
})

describe("H1 live late accrual vs check-in", () => {
  it("the accrual's stale figure never overwrites the penalty the check-in froze", async () => {
    const { workspaceId, officeId } = await companyWorld()
    const today = getAttendanceDate()
    const dateKey = formatAttendanceDateKey(today)
    let overwritten = 0
    for (let i = 0; i < 10; i++) {
      const u = await person()
      // The accrual read "not checked in" a moment ago (accrueLatePenalties) and now writes -30 with its
      // guard; the check-in commits its record and freezes the real lateness, -5, at the same time.
      const accrual = setLatePenalty(u.id, dateKey, -30, { guard: { workspaceId, date: today, requireNoCheckIn: true, covered: "any" } })
      const checkInPath = (async () => {
        await prisma.attendanceRecord.create({ data: { userId: u.id, workspaceId, officeLocationId: officeId, attendanceDate: today, checkInAt: new Date(), status: "CHECKED_IN" } })
        await setLatePenalty(u.id, dateKey, -5)
      })()
      await Promise.all([accrual, checkInPath])
      const row = await prisma.xpTransaction.findFirst({ where: { userId: u.id, reason: `attendance:late:${dateKey}` } })
      if (row?.amount !== -5) overwritten++
    }
    console.log("[race] H1 (concurrent) frozen penalties overwritten by the accrual:", overwritten, "of 10")
    expect(overwritten).toBe(0)
  })

  it("the losing interleaving, forced: accrual reads, check-in commits and freezes, accrual writes", async () => {
    const { workspaceId, officeId } = await companyWorld()
    const today = getAttendanceDate()
    const dateKey = formatAttendanceDateKey(today)
    const u = await person()
    // 1. accrueLatePenalties read the day: no record yet (what it checks before calling setLatePenalty).
    expect(await prisma.attendanceRecord.findFirst({ where: { userId: u.id } })).toBeNull()
    // 2. The check-in commits and freezes the real lateness.
    await prisma.attendanceRecord.create({ data: { userId: u.id, workspaceId, officeLocationId: officeId, attendanceDate: today, checkInAt: new Date(), status: "CHECKED_IN" } })
    await setLatePenalty(u.id, dateKey, -5)
    // 3. The accrual's write, computed from its stale read, lands last.
    await setLatePenalty(u.id, dateKey, -30, { guard: { workspaceId, date: today, requireNoCheckIn: true, covered: "any" } })
    const row = await prisma.xpTransaction.findFirstOrThrow({ where: { userId: u.id, reason: `attendance:late:${dateKey}` } })
    console.log("[race] H1 (forced order) late penalty after the stale accrual:", row.amount, "(check-in froze -5)")
    expect(row.amount).toBe(-5)
  })
})

describe("H2 BoD pardon vs the nightly cron", () => {
  it("a pardoned day never keeps a penalty the cron wrote between the refund and the waiver", async () => {
    const { workspaceId } = await companyWorld()
    let stuck = 0
    for (let i = 0; i < 20; i++) {
      const u = await person()
      const day = parseDateOnlyToUtc(`2026-08-${String(1 + i).padStart(2, "0")}`)
      const dateKey = formatAttendanceDateKey(day)
      const pardon = (async () => {
        // The route sequence (override CLEAR_PENALTY): refund, then the waiver. On this build both happen
        // in the refund's transaction; the trailing grant is then a no-op.
        await cancelAttendancePenaltiesForDate(u.id, workspaceId, day, dateKey, { waive: "always" })
        await grantAttendanceWaiver(u.id, dateKey)
      })()
      const cron = (async () => {
        if (await hasAttendanceWaiver(u.id, dateKey)) return
        await awardXpOnce(u.id, -150, `attendance:alpha:${dateKey}`, { guard: { workspaceId, date: day, requireNoRecordFacts: true, covered: "any" } })
      })()
      await Promise.all([pardon, cron])
      const alpha = await prisma.xpTransaction.count({ where: { userId: u.id, reason: `attendance:alpha:${dateKey}` } })
      if (alpha > 0 && (await hasAttendanceWaiver(u.id, dateKey))) stuck++
    }
    console.log("[race] H2 (concurrent) pardoned days still carrying the cron's -150:", stuck, "of 20")
    expect(stuck).toBe(0)
  })

  it("the losing interleaving, forced: cron reads 'not waived', the pardon completes, cron writes", async () => {
    const { workspaceId } = await companyWorld()
    const u = await person()
    const day = parseDateOnlyToUtc("2026-07-15")
    const dateKey = formatAttendanceDateKey(day)
    expect(await hasAttendanceWaiver(u.id, dateKey)).toBe(false) // the cron's read
    await cancelAttendancePenaltiesForDate(u.id, workspaceId, day, dateKey, { waive: "always" })
    await grantAttendanceWaiver(u.id, dateKey) // the pardon, as the routes ran it
    await awardXpOnce(u.id, -150, `attendance:alpha:${dateKey}`, { guard: { workspaceId, date: day, requireNoRecordFacts: true, covered: "any" } })
    const alpha = await prisma.xpTransaction.count({ where: { userId: u.id, reason: `attendance:alpha:${dateKey}` } })
    console.log("[race] H2 (forced order) alpha rows on the pardoned day:", alpha)
    expect(alpha).toBe(0)
  })
})

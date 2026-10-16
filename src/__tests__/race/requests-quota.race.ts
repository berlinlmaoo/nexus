import { afterAll, describe, expect, it, vi } from "vitest"
import { as, companyWorld, jsonRequest, person, statusesOf } from "./world"
import { NextRequest } from "next/server"

// Race audit 16 Oct 2026, PR 2 (fix/attendance-request-quota-lock): overlap and quota are checked, then
// the request is inserted. Each case fires the concurrent submits with Promise.all and checks that the
// per-person lock leaves exactly the requests a sequential run would have left.

vi.mock("@/lib/auth", async () => (await import("./world")).authMock)
vi.mock("@/lib/reverse-geocode", () => ({ reverseGeocodeCoordinates: async () => ({ displayName: null }) }))

import prisma from "@/lib/prisma"
import { POST as fileRequest } from "@/app/api/attendance/requests/route"
import { POST as grantDayOff } from "@/app/api/attendance/dayoffs/route"
import { POST as override } from "@/app/api/attendance/override/route"
import { POST as grantBonus } from "@/app/api/attendance/day-off-bonus/route"
import { attendancePeriodKey } from "@/lib/attendance"

afterAll(async () => { await prisma.$disconnect() })
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)

function requestForm(type: string, date: string, reason = "Keperluan keluarga di luar kota") {
  const fd = new FormData()
  fd.set("type", type)
  fd.set("startDate", date)
  fd.set("endDate", date)
  fd.set("reason", reason)
  return new NextRequest("http://race.invalid/api/attendance/requests", {
    method: "POST", body: fd, headers: { "x-nexus-client": "ios/0.1.6", "user-agent": "NEXUS/106 CFNetwork/1568 Darwin/25.0.0" },
  })
}

describe("H3 request double submit", () => {
  it("the same day-off submitted twice at once: one request, the other the known overlap 409", async () => {
    const u = await person()
    const res = await Promise.all([1, 2].map(() => as(u, () => fileRequest(requestForm("DAY_OFF", "2027-03-05")))))
    const out = await statusesOf(res)
    const rows = await prisma.attendanceRequest.count({ where: { userId: u.id } })
    console.log("[race] H3 double submit statuses", out.map((o) => o.status), "requests stored", rows)
    expect(sorted(out.map((o) => o.status))).toEqual([201, 409])
    expect(out.find((o) => o.status === 409)!.body.error).toBe("This request overlaps with another active attendance request.")
    expect(rows).toBe(1)
  })

  it("the last day of day-off quota requested for two dates at once: one fits, the other is the quota 422", async () => {
    const u = await person()
    await prisma.workspaceMember.updateMany({ where: { userId: u.id }, data: { dayOffQuota: 1 } })
    const res = await Promise.all(["2027-03-09", "2027-03-10"].map((d) => as(u, () => fileRequest(requestForm("DAY_OFF", d)))))
    const out = await statusesOf(res)
    const rows = await prisma.attendanceRequest.count({ where: { userId: u.id, type: "DAY_OFF" } })
    console.log("[race] H3 day-off quota statuses", out.map((o) => o.status), "day-offs stored", rows, "(quota 1)")
    expect(sorted(out.map((o) => o.status))).toEqual([201, 422])
    expect(rows).toBe(1)
  })

  it("the last day of annual leave requested for two dates at once: one fits, the other is LEAVE_QUOTA_EXCEEDED", async () => {
    const u = await person()
    const { workspaceId } = await companyWorld()
    // 11 of the 12 days of 2027 already taken.
    await prisma.attendanceRequest.create({ data: { userId: u.id, workspaceId, type: "LEAVE", status: "APPROVED", startDate: new Date("2027-05-03T00:00:00Z"), endDate: new Date("2027-05-13T00:00:00Z"), reason: "earlier leave" } })
    const res = await Promise.all(["2027-06-07", "2027-06-08"].map((d) => as(u, () => fileRequest(requestForm("LEAVE", d)))))
    const out = await statusesOf(res)
    const rows = await prisma.attendanceRequest.count({ where: { userId: u.id, type: "LEAVE" } })
    console.log("[race] H3 annual leave statuses", out.map((o) => `${o.status}${o.body?.code ? " " + o.body.code : ""}`), "leave rows", rows)
    expect(sorted(out.map((o) => o.status))).toEqual([201, 422])
    expect(rows).toBe(2)
  })
})

describe("H3 BoD day-off grant and status override", () => {
  it("Control Room day-off granted twice at once: one, plus the known 409", async () => {
    const bod = await person("BOD", "Race BoD")
    const u = await person()
    const res = await Promise.all([1, 2].map(() => as(bod, () => grantDayOff(jsonRequest("/api/attendance/dayoffs", "POST", { userId: u.id, date: "2027-04-06" })))))
    const rows = await prisma.attendanceRequest.count({ where: { userId: u.id } })
    console.log("[race] H3 dayoffs statuses", res.map((r) => r.status), "rows", rows)
    expect(sorted(res.map((r) => r.status))).toEqual([201, 409])
    expect(rows).toBe(1)
  })

  it("board override to DAY_OFF double-clicked: one approved request", async () => {
    const bod = await person("BOD", "Race BoD")
    const u = await person()
    const res = await Promise.all([1, 2].map(() => as(bod, () => override(jsonRequest("/api/attendance/override", "POST", { userId: u.id, date: "2026-10-01", action: "DAY_OFF" })))))
    const rows = await prisma.attendanceRequest.count({ where: { userId: u.id, status: "APPROVED" } })
    console.log("[race] H3 override statuses", res.map((r) => r.status), "approved rows", rows)
    expect(res.map((r) => r.status)).toEqual([200, 200])
    expect(rows).toBe(1)
  })
})

describe("H3 day-off bonus", () => {
  it("the same +20 grant double-clicked: granted once, the repeat handed back", async () => {
    const bod = await person("BOD", "Race BoD")
    const u = await person()
    const body = { userIds: [u.id], periodKey: attendancePeriodKey(), days: 20, reason: "Lembur event" }
    const res = (await Promise.all([1, 2].map(() => as(bod, () => grantBonus(jsonRequest("/api/attendance/day-off-bonus", "POST", body)))))) as Response[]
    const out = await statusesOf(res)
    const agg = await prisma.dayOffBonus.aggregate({ where: { userId: u.id, revokedAt: null }, _sum: { days: true } })
    console.log("[race] H3 bonus double click statuses", out.map((o) => `${o.status}${o.body?.duplicate ? " dup" : ""}`), "bonus days", agg._sum.days)
    expect(agg._sum.days).toBe(20)
  })

  it("two different +20 grants at once never pass the 31-day limit together", async () => {
    const bod = await person("BOD", "Race BoD")
    const u = await person()
    const res = (await Promise.all(["Lembur event", "Shooting luar kota"].map((reason) =>
      as(bod, () => grantBonus(jsonRequest("/api/attendance/day-off-bonus", "POST", { userIds: [u.id], periodKey: attendancePeriodKey(), days: 20, reason })))))) as Response[]
    const agg = await prisma.dayOffBonus.aggregate({ where: { userId: u.id, revokedAt: null }, _sum: { days: true } })
    console.log("[race] H3 bonus limit statuses", res.map((r) => r.status), "bonus days", agg._sum.days, "(max 31)")
    expect(sorted(res.map((r) => r.status))).toEqual([201, 422])
    expect(agg._sum.days).toBe(20)
  })
})

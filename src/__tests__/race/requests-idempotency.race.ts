import { afterAll, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { as, person, statusesOf } from "./world"

// Attendance request idempotency (race audit H3, the optional part; 16 Oct 2026), against a real Postgres with
// prisma/sql/2026-10-16-attendance-request-client-id.sql applied. A submit carries a key (form field
// clientRequestId or the Idempotency-Key header); the same key from the same person stores ONE request and every
// repeat gets that request back with 200 duplicate:true — never a second row, never a 500. Without a key the
// per-person lock behaves exactly as before (one 201, the known overlap 409).

vi.mock("@/lib/auth", async () => (await import("./world")).authMock)
vi.mock("@/lib/reverse-geocode", () => ({ reverseGeocodeCoordinates: async () => ({ displayName: null }) }))

import prisma from "@/lib/prisma"
import { POST as fileRequest } from "@/app/api/attendance/requests/route"

afterAll(async () => { await prisma.$disconnect() })
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)

function requestForm(type: string, date: string, opts: { key?: string; header?: string; reason?: string; targetUserId?: string; endDate?: string } = {}) {
  const fd = new FormData()
  fd.set("type", type)
  fd.set("startDate", date)
  fd.set("endDate", opts.endDate ?? date)
  fd.set("reason", opts.reason ?? "Keperluan keluarga di luar kota")
  if (opts.key) fd.set("clientRequestId", opts.key)
  if (opts.targetUserId) fd.set("targetUserId", opts.targetUserId)
  const headers: Record<string, string> = { "x-nexus-client": "ios/0.1.6", "user-agent": "NEXUS/106 CFNetwork/1568 Darwin/25.0.0" }
  if (opts.header) headers["idempotency-key"] = opts.header
  return new NextRequest("http://race.invalid/api/attendance/requests", { method: "POST", body: fd, headers })
}
const key = () => `k-${crypto.randomUUID()}`

describe("H3 idempotency key", () => {
  it("the index exists and is partial over (userId, clientRequestId)", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'AttendanceRequest_userId_clientRequestId_key'`
    expect(rows).toHaveLength(1)
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX .*\("userId", "clientRequestId"\) WHERE \("clientRequestId" IS NOT NULL\)/)
  })

  it("the same key five times at once: one row, one 201, four 200 duplicate:true with the same request", async () => {
    const u = await person()
    const k = key()
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => as(u, () => fileRequest(requestForm("DAY_OFF", "2027-07-05", { key: k })))))
    const out = await statusesOf(res)
    const rows = await prisma.attendanceRequest.findMany({ where: { userId: u.id } })
    console.log("[race] H3 idempotent x5 statuses", out.map((o) => `${o.status}${o.body?.duplicate ? " dup" : ""}`), "rows", rows.length)
    expect(sorted(out.map((o) => o.status))).toEqual([200, 200, 200, 200, 201])
    expect(rows).toHaveLength(1)
    expect(rows[0].clientRequestId).toBe(k)
    for (const o of out) expect(o.body.request.id).toBe(rows[0].id)
    expect(out.filter((o) => o.body.duplicate === true)).toHaveLength(4)
    expect(out.find((o) => o.status === 201)!.body.duplicate).toBeUndefined()
  })

  it("the Idempotency-Key header works the same; a later repeat (the retry after a timeout) is the original, not the overlap 409", async () => {
    const u = await person()
    const k = key()
    const first = await as(u, () => fileRequest(requestForm("DAY_OFF", "2027-07-06", { header: k })))
    expect(first.status).toBe(201)
    const again = await as(u, () => fileRequest(requestForm("DAY_OFF", "2027-07-06", { header: k })))
    const body = await again.json()
    expect(again.status).toBe(200)
    expect(body).toMatchObject({ duplicate: true, request: { id: (await first.json()).request.id } })
    expect(await prisma.attendanceRequest.count({ where: { userId: u.id } })).toBe(1)
  })

  it("the key is per person: the same key from someone else is their own request", async () => {
    const a = await person()
    const b = await person()
    const k = key()
    const res = await Promise.all([a, b].map((who) => as(who, () => fileRequest(requestForm("DAY_OFF", "2027-07-07", { key: k })))))
    expect(res.map((r) => r.status)).toEqual([201, 201])
    expect(await prisma.attendanceRequest.count({ where: { clientRequestId: k } })).toBe(2)
  })

  it("without a key (released apps) nothing changes: one 201, the known overlap 409", async () => {
    const u = await person()
    const res = await Promise.all([1, 2].map(() => as(u, () => fileRequest(requestForm("DAY_OFF", "2027-07-08")))))
    const out = await statusesOf(res)
    console.log("[race] H3 no key statuses", out.map((o) => o.status))
    expect(sorted(out.map((o) => o.status))).toEqual([201, 409])
    expect(await prisma.attendanceRequest.count({ where: { userId: u.id } })).toBe(1)
  })

  it("two different keys for the same day at once: one 201, the other the overlap 409 (a key never bypasses a rule)", async () => {
    const u = await person()
    const res = await Promise.all([key(), key()].map((k) => as(u, () => fileRequest(requestForm("DAY_OFF", "2027-07-09", { key: k })))))
    const out = await statusesOf(res)
    expect(sorted(out.map((o) => o.status))).toEqual([201, 409])
    expect(await prisma.attendanceRequest.count({ where: { userId: u.id } })).toBe(1)
  })

  it("the database refuses a second row with the same key even outside the app's lock (P2002 → the replay)", async () => {
    const u = await person()
    const k = key()
    expect((await as(u, () => fileRequest(requestForm("DAY_OFF", "2027-07-12", { key: k })))).status).toBe(201)
    const { workspaceId } = (await prisma.workspaceMember.findFirst({ where: { userId: u.id } }))!
    await expect(prisma.attendanceRequest.create({
      data: { userId: u.id, workspaceId, type: "DAY_OFF", startDate: new Date("2027-07-13T00:00:00Z"), endDate: new Date("2027-07-13T00:00:00Z"), reason: "direct", clientRequestId: k },
    })).rejects.toMatchObject({ code: "P2002" })
    expect(await prisma.attendanceRequest.count({ where: { userId: u.id } })).toBe(1)
  })

  it("a BoD grant replays for the BoD; a malformed key is a 400 and stores nothing", async () => {
    const bod = await person("BOD", "Race BoD")
    const u = await person()
    const k = key()
    const res = await Promise.all([1, 2, 3].map(() => as(bod, () => fileRequest(requestForm("SICK", "2027-07-14", { key: k, targetUserId: u.id })))))
    const out = await statusesOf(res)
    expect(sorted(out.map((o) => o.status))).toEqual([200, 200, 201])
    expect(await prisma.attendanceRequest.count({ where: { userId: u.id } })).toBe(1)
    const bad = await as(u, () => fileRequest(requestForm("DAY_OFF", "2027-07-15", { key: "no spaces allowed" })))
    expect(bad.status).toBe(400)
    expect((await bad.json()).code).toBe("BAD_IDEMPOTENCY_KEY")
    expect(await prisma.attendanceRequest.count({ where: { userId: u.id, startDate: new Date("2027-07-15T00:00:00Z") } })).toBe(0)
  })
})

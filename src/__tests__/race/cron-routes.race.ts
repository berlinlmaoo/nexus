import { afterAll, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { companyWorld, person, statusesOf } from "./world"

// Race audit 16 Oct 2026, PR 3 (fix/cron-locks): overlapping runs of real cron routes (curl timeout +
// next tick, "run now" + timer, a slot switch). The effect must happen once.

process.env.CRON_SECRET = "race-cron-secret"
process.env.NEXUS_SINGLETON_LOCK = "0" // this process leads (lib/bluegreen.ts escape hatch)
vi.mock("@/lib/auth", async () => (await import("./world")).authMock)

import prisma from "@/lib/prisma"
import { POST as announcementRepeat } from "@/app/api/cron/announcement-repeat/route"
import { POST as escalation } from "@/app/api/cron/attendance-escalation/route"
import { POST as accrueLate } from "@/app/api/attendance/accrue-late/route"

afterAll(async () => { await prisma.$disconnect() })

const cron = (path: string) =>
  new NextRequest(`http://race.invalid${path}`, { method: "POST", body: "{}", headers: { authorization: "Bearer race-cron-secret", "content-type": "application/json" } })
const runLabel = (o: { status: number; body: { skipped?: unknown; [k: string]: unknown } | null }) =>
  typeof o.body?.skipped === "string" ? `${o.status} ${o.body.skipped}` : `${o.status} ran`

describe("cron routes", () => {
  it("announcement-repeat fired by three overlapping runs: one push per person", async () => {
    const u = await person()
    const a = await prisma.announcement.create({
      data: { title: "Race notice", body: "Wear your ID card", targetUserIds: [u.id], repeatUntil: new Date(Date.now() + 7 * 86400e3), repeatAtTime: "00:00" },
    })
    const out = await statusesOf(await Promise.all([1, 2, 3].map(() => announcementRepeat(cron("/api/cron/announcement-repeat")))))
    const sent = await prisma.notification.count({ where: { userId: u.id, link: { contains: a.id } } })
    console.log("[race] announcement-repeat runs:", out.map(runLabel), "notifications", sent)
    expect(sent).toBe(1)
  })

  it("attendance-escalation from two overlapping runs: the manager is told once", async () => {
    const { workspaceId } = await companyWorld()
    const manager = await person("MANAGER", "Race Manager")
    const u = await person("STAFF", "Race Person", manager.id)
    const old = new Date(Date.now() - 10 * 86400e3)
    await prisma.attendanceRequest.create({ data: { userId: u.id, workspaceId, type: "PERMIT", status: "PENDING", startDate: old, endDate: old, reason: "race", createdAt: old } })
    const out = await statusesOf(await Promise.all([1, 2].map(() => escalation(cron("/api/cron/attendance-escalation")))))
    const told = await prisma.notification.count({ where: { userId: manager.id, type: "attendance_request_escalated" } })
    console.log("[race] escalation runs:", out.map(runLabel), "manager notified", told)
    expect(told).toBe(1)
  })

  it("accrue-late from overlapping ticks: one run at a time", async () => {
    const out = await statusesOf(await Promise.all([1, 2].map(() => accrueLate(cron("/api/attendance/accrue-late")))))
    console.log("[race] accrue-late runs:", out.map(runLabel))
    expect(out.map((o) => o.status)).toEqual([200, 200])
    expect(out.filter((o) => o.body?.skipped === "already_running").length).toBeLessThanOrEqual(1)
  })
})

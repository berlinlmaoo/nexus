import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { companyWorld, person } from "./world"

// Notification dedupeKey (race audit LOW, 16 Oct 2026), against a real Postgres with
// prisma/sql/2026-10-16-notification-dedupe-key.sql applied (the CONCURRENTLY index). The cron writers check
// "already sent?" with a findFirst and then insert; two overlapping runs both pass the check. With the key the
// insert is ON CONFLICT DO NOTHING: one row, one push, one email, and the losing run gets nothing back.

const sent = vi.hoisted(() => ({ pushes: [] as { userId: string; type?: string }[], emails: 0 }))
vi.mock("@/lib/apns", async (orig) => ({
  ...(await orig<typeof import("@/lib/apns")>()),
  sendPushToUser: async (userId: string, payload: { type?: string }) => { sent.pushes.push({ userId, type: payload.type }) },
}))
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendEmail: async () => { sent.emails++; return true } }))
vi.mock("@/lib/socket-emitter", async (orig) => ({ ...(await orig<typeof import("@/lib/socket-emitter")>()), emitNotification: () => {} }))

import prisma from "@/lib/prisma"
import { checkDueSoonTasks, createInAppNotification, notifyAnnouncement, notifyAttendanceReminder } from "@/lib/notification-service"

afterAll(async () => { await prisma.$disconnect() })
beforeEach(() => { sent.pushes = []; sent.emails = 0 })
const rowsOf = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type } })

describe("Notification dedupeKey", () => {
  it("the index exists, is valid, unique and partial", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string; indisvalid: boolean }[]>`
      SELECT pg_get_indexdef(i.indexrelid) AS indexdef, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'Notification_dedupeKey_key'`
    expect(rows).toHaveLength(1)
    expect(rows[0].indisvalid).toBe(true)
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX .*\("dedupeKey"\) WHERE \("dedupeKey" IS NOT NULL\)/)
  })

  it("eight overlapping attendance-reminder runs: one row, one push; the others are told it was not sent", async () => {
    const u = await person()
    const out = await Promise.all(Array.from({ length: 8 }, () => notifyAttendanceReminder({ userId: u.id, kind: "checkin", attendanceDate: "2027-08-02", shiftTime: "09:00", offsetMinutes: 15 })))
    const rows = await rowsOf(u.id, "attendance_checkin_reminder")
    console.log("[race] reminder x8 results", out, "rows", rows.length, "pushes", sent.pushes.length)
    expect(rows).toHaveLength(1)
    expect(rows[0].dedupeKey).toBe(`attendance-reminder|${u.id}|checkin|2027-08-02|15`)
    expect(sent.pushes.filter((p) => p.userId === u.id)).toHaveLength(1)
    expect(out.filter(Boolean)).toHaveLength(1)
  })

  it("the same check WITHOUT the key (what the findFirst alone did): every run inserts", async () => {
    const u = await person()
    await Promise.all(Array.from({ length: 4 }, () => createInAppNotification({ userId: u.id, type: "race_no_key", title: "t", message: "m", link: "/x", push: true })))
    const rows = await rowsOf(u.id, "race_no_key")
    console.log("[race] no key x4 rows", rows.length)
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.dedupeKey === null)).toBe(true)
  })

  it("a windowed notification (dedupeWindowMs) sent five times at once: one row", async () => {
    const u = await person()
    await Promise.all(Array.from({ length: 5 }, () => createInAppNotification({ userId: u.id, type: "race_window", title: "Disk", message: "Disk 91% full", link: "/control", push: true, dedupeWindowMs: 23 * 3_600_000 })))
    const rows = await rowsOf(u.id, "race_window")
    expect(rows).toHaveLength(1)
    expect(rows[0].dedupeKey).toMatch(/^window\|race_window\|/)
    expect(sent.pushes.filter((p) => p.userId === u.id)).toHaveLength(1)
    // A different text in the same window is a different notification.
    await createInAppNotification({ userId: u.id, type: "race_window", title: "Disk", message: "Disk 97% full", link: "/control", push: true, dedupeWindowMs: 23 * 3_600_000 })
    expect(await rowsOf(u.id, "race_window")).toHaveLength(2)
  })

  it("two overlapping due-check runs: one row and one email per assignee and stage", async () => {
    const { workspaceId } = await companyWorld()
    const a = await person()
    const b = await person()
    const project = await prisma.project.create({ data: { name: "Race due", workspaceId } })
    const list = await prisma.taskList.create({ data: { name: "To Do", projectId: project.id } })
    const task = await prisma.task.create({ data: { title: "Race due task", taskListId: list.id, creatorId: a.id, status: "TODO", dueDate: new Date(Date.now() + 6 * 3_600_000) } })
    await prisma.taskAssignee.createMany({ data: [{ taskId: task.id, userId: a.id }, { taskId: task.id, userId: b.id }] })
    await Promise.all([checkDueSoonTasks(), checkDueSoonTasks(), checkDueSoonTasks()])
    const rows = await prisma.notification.findMany({ where: { taskId: task.id } })
    console.log("[race] due-check x3 rows", rows.length, "emails", sent.emails)
    expect(rows.map((r) => `${r.userId === a.id ? "a" : "b"}:${r.type}`).sort()).toEqual(["a:task_due_1d", "b:task_due_1d"])
    expect(sent.emails).toBe(2)
  })

  it("an announcement repeat run twice the same day: one row per person; a first publish has no key", async () => {
    const u = await person()
    const ann = await prisma.announcement.create({ data: { title: "Wear your ID", body: "Today and every day this week.", active: true, targetUserIds: [u.id] } })
    await Promise.all([notifyAnnouncement(ann.id, { repeatDay: "2027-08-03" }), notifyAnnouncement(ann.id, { repeatDay: "2027-08-03" })])
    expect(await rowsOf(u.id, "announcement")).toHaveLength(1)
    await notifyAnnouncement(ann.id, { repeatDay: "2027-08-04" })
    await notifyAnnouncement(ann.id)
    const rows = await rowsOf(u.id, "announcement")
    expect(rows).toHaveLength(3)
    expect(rows.filter((r) => r.dedupeKey === null)).toHaveLength(1)
  })
})

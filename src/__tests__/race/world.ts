import { randomUUID } from "crypto"
import { NextRequest } from "next/server"
import prisma from "@/lib/prisma"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { getAttendanceDate } from "@/lib/attendance"

/** The office every attendance tap in these tests is made at (a tap 0 m away is inside the radius). */
export const OFFICE = { lat: -6.2253, lng: 106.829 }

/** The company workspace + one office, created once per database. */
export async function companyWorld() {
  const ws = await prisma.workspace.upsert({
    where: { id: ORG_WORKSPACE_ID },
    update: {},
    create: { id: ORG_WORKSPACE_ID, name: "Race Co", slug: "race-co" },
  })
  const office =
    (await prisma.officeLocation.findFirst({ where: { workspaceId: ws.id } })) ??
    (await prisma.officeLocation.create({
      data: {
        name: "Race Office", latitude: OFFICE.lat, longitude: OFFICE.lng, radiusMeters: 150,
        timezone: "Asia/Jakarta", shiftStartTime: "09:00", shiftEndTime: "18:00", lateGraceMinutes: 15, workspaceId: ws.id,
      },
    }))
  return { workspaceId: ws.id, officeId: office.id }
}

/** A fresh member of the company workspace. */
export async function person(role: "STAFF" | "BOD" | "MANAGER" = "STAFF", name = "Race Person", approverId?: string) {
  const { workspaceId } = await companyWorld()
  const key = randomUUID().slice(0, 8)
  const user = await prisma.user.create({ data: { name: `${name} ${key}`, email: `${key}@race.invalid` } })
  await prisma.workspaceMember.create({
    data: { userId: user.id, workspaceId, role, joinedAt: new Date("2024-01-01T00:00:00Z"), employmentStartDate: new Date("2024-01-01T00:00:00Z"), ...(approverId ? { approverId } : {}) },
  })
  return { id: user.id, name: user.name ?? name }
}

/** The signed-in user the mocked auth() returns, read at the moment a handler calls it. */
export const session: { current: { user: { id: string; name: string } } | null } = { current: null }
export function as<T>(who: { id: string; name: string }, run: () => Promise<T>): Promise<T> {
  session.current = { user: { id: who.id, name: who.name } }
  return run()
}

const APP = { "x-nexus-client": "ios/0.1.6", "user-agent": "NEXUS/106 CFNetwork/1568 Darwin/25.0.0" }

export function attendanceForm(extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("lat", String(OFFICE.lat))
  fd.set("lng", String(OFFICE.lng))
  fd.set("selfie", new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "selfie.jpg", { type: "image/jpeg" }))
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  return fd
}

export function formRequest(pathname: string, fd: FormData) {
  return new NextRequest(`http://race.invalid${pathname}`, { method: "POST", body: fd, headers: APP })
}

export function jsonRequest(pathname: string, method: string, body: unknown) {
  return new NextRequest(`http://race.invalid${pathname}`, { method, body: JSON.stringify(body), headers: { ...APP, "content-type": "application/json" } })
}

/** An open (checked-in, not checked-out) record for today. */
export async function openRecordToday(userId: string) {
  const { workspaceId, officeId } = await companyWorld()
  const attendanceDate = getAttendanceDate()
  return prisma.attendanceRecord.create({
    data: { userId, workspaceId, officeLocationId: officeId, attendanceDate, checkInAt: new Date(Date.now() - 4 * 3600e3), status: "CHECKED_IN", checkInStatus: "ON_TIME" },
  })
}

/** A reflection the quality check accepts (≥200 chars, not padded or repeated). */
export function reflection(seed: string) {
  return (
    `Today I reviewed the quarterly sales pipeline for ${seed}, called two vendors about the late shipment, ` +
    `drafted the onboarding checklist for the new designer, fixed three broken links on the landing page, ` +
    `and agreed next week's content calendar with the social team before the afternoon stand-up meeting.`
  )
}

export async function statusesOf(responses: Response[]) {
  return Promise.all(responses.map(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })))
}

/** vi.mock("@/lib/auth") factory result: auth() answers the session set by `as()`. */
export const authMock = { auth: () => Promise.resolve(session.current) }

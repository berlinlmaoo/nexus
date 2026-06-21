import prisma from "@/lib/prisma"
import { formatAttendanceDateKey } from "@/lib/attendance"

/** UTC-midnight of a "YYYY-MM-DD" key (same convention as attendance dates). */
export function holidayDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`)
}

/** Set of holiday date-keys ("YYYY-MM-DD") for a workspace within [from, to] inclusive. */
export async function getHolidayKeys(workspaceId: string, from: Date, to: Date): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({
    where: { workspaceId, date: { gte: from, lte: to } },
    select: { date: true },
  })
  return new Set(rows.map((r) => formatAttendanceDateKey(r.date)))
}

/** True if `date` is a company holiday (tanggal merah) for the workspace. */
export async function isHoliday(workspaceId: string, date: Date): Promise<boolean> {
  const day = holidayDateFromKey(formatAttendanceDateKey(date))
  const found = await prisma.holiday.findUnique({
    where: { workspaceId_date: { workspaceId, date: day } },
    select: { id: true },
  })
  return Boolean(found)
}

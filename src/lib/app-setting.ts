import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma"

/**
 * Server-side key → JSON value (table AppSetting). For the handful of facts the server has to
 * remember about itself that belong to no user or workspace row — first user: the id of the Google
 * spreadsheet the attendance sync created, which under the drive.file scope cannot be found again
 * any other way than "the app made it". Not a feature-flag system and not for secrets.
 */

export async function getAppSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } })
  return row ? (row.value as unknown as T) : null
}

export async function setAppSetting<T>(key: string, value: T): Promise<void> {
  const json = value as unknown as Prisma.InputJsonValue
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  })
}

export async function deleteAppSetting(key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } })
}

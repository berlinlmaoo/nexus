export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

const BUNDLE_ID = "id.znetworks.nexus"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === "string" ? body.token.toLowerCase() : ""
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : ""
  const bundleId = typeof body?.bundleId === "string" ? body.bundleId : ""
  const environment = body?.environment === "sandbox" ? "sandbox" : body?.environment === "production" ? "production" : ""

  // Optional and bounded. An old build sends none of it and still registers — refusing would take
  // push away from exactly the people this list is meant to find.
  const short = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : null)
  const appVersion = short(body?.appVersion)
  const buildNumber = short(body?.buildNumber)
  const osVersion = short(body?.osVersion)
  const deviceModel = short(body?.deviceModel)
  if (!/^[a-f0-9]{32,200}$/.test(token) || !deviceId || bundleId !== BUNDLE_ID || !environment) {
    return NextResponse.json({ error: "Invalid device registration" }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.deviceInstallation.deleteMany({
      where: { userId: session.user.id!, deviceId, bundleId, token: { not: token } },
    })
    await tx.deviceInstallation.upsert({
      where: { token },
      create: { token, deviceId, bundleId, environment, userId: session.user.id!, appVersion, buildNumber, osVersion, deviceModel },
      update: {
        deviceId,
        bundleId,
        environment,
        userId: session.user.id!,
        lastSeenAt: new Date(),
        disabledAt: null,
        // Only overwritten when the app actually said something. An older build that reports nothing
        // must not erase what a newer one already recorded for the same device.
        ...(appVersion ? { appVersion } : {}),
        ...(buildNumber ? { buildNumber } : {}),
        ...(osVersion ? { osVersion } : {}),
        ...(deviceModel ? { deviceModel } : {}),
      },
    })
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === "string" ? body.token.toLowerCase() : ""
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 })
  await prisma.deviceInstallation.deleteMany({ where: { token, userId: session.user.id } })
  return NextResponse.json({ success: true })
}

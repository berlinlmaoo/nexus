export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { ANDROID_PACKAGE } from "@/lib/android-app"

const BUNDLE_ID = "id.znetworks.nexus"

// FCM registration tokens: case-sensitive, with ':' '-' '_' (about 150–170 characters today).
const FCM_TOKEN_RE = /^[A-Za-z0-9_:-]{100,4096}$/
// An Android applicationId (a debug build may carry a suffix, e.g. id.znetworks.nexus.debug).
const APP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/

/**
 * Body → the row to store, or null when it is not a valid registration.
 *   iOS (no `platform`, or anything but "android" — every iOS build so far):
 *     { token: <APNs hex>, deviceId, bundleId: "id.znetworks.nexus", environment: "sandbox"|"production", … }
 *     The token is lower-cased; checks unchanged.
 *   Android: { platform: "android", token: <FCM token>, deviceId, appId (or bundleId): <applicationId>, … }
 *     The token is kept exactly as sent (FCM tokens are case-sensitive); no environment (stored "fcm").
 */
function parseRegistration(body: Record<string, unknown> | null) {
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : ""
  if (typeof body?.platform === "string" && body.platform.trim().toLowerCase() === "android") {
    const token = typeof body.token === "string" ? body.token.trim() : ""
    const rawAppId = typeof body.appId === "string" ? body.appId.trim() : typeof body.bundleId === "string" ? body.bundleId.trim() : ""
    const appId = rawAppId || ANDROID_PACKAGE
    if (!FCM_TOKEN_RE.test(token) || !deviceId || appId.length > 150 || !APP_ID_RE.test(appId)) return null
    return { platform: "android", token, deviceId, bundleId: appId, environment: "fcm" }
  }
  const token = typeof body?.token === "string" ? body.token.toLowerCase() : ""
  const bundleId = typeof body?.bundleId === "string" ? body.bundleId : ""
  const environment = body?.environment === "sandbox" ? "sandbox" : body?.environment === "production" ? "production" : ""
  if (!/^[a-f0-9]{32,200}$/.test(token) || !deviceId || bundleId !== BUNDLE_ID || !environment) return null
  return { platform: "ios", token, deviceId, bundleId, environment }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  const registration = parseRegistration(body && typeof body === "object" ? body : null)

  // Optional and bounded. An old build sends none of it and still registers — refusing would take
  // push away from exactly the people this list is meant to find.
  const short = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : null)
  const appVersion = short(body?.appVersion)
  const buildNumber = short(body?.buildNumber)
  const osVersion = short(body?.osVersion)
  const deviceModel = short(body?.deviceModel)
  if (!registration) {
    return NextResponse.json({ error: "Invalid device registration" }, { status: 400 })
  }
  const { platform, token, deviceId, bundleId, environment } = registration

  await prisma.$transaction(async (tx) => {
    await tx.deviceInstallation.deleteMany({
      where: { userId: session.user.id!, deviceId, bundleId, token: { not: token } },
    })
    await tx.deviceInstallation.upsert({
      where: { token },
      create: { platform, token, deviceId, bundleId, environment, userId: session.user.id!, appVersion, buildNumber, osVersion, deviceModel },
      update: {
        platform,
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
  const raw = typeof body?.token === "string" ? body.token.trim() : ""
  if (!raw) return NextResponse.json({ error: "token required" }, { status: 400 })
  // APNs tokens are stored lower-cased (and iOS may send them in either case); FCM tokens are stored
  // exactly as sent and are case-sensitive. Matching both spellings covers each without knowing which.
  const token = raw.toLowerCase()
  await prisma.deviceInstallation.deleteMany({ where: { token: { in: token === raw ? [raw] : [raw, token] }, userId: session.user.id } })
  return NextResponse.json({ success: true })
}

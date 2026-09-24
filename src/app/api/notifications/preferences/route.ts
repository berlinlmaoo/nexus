export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { isLikelyPhoneNumber, normalizeIndonesianPhoneNumber } from "@/lib/phone-number"

function isMissingSchemaError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2021" || error.code === "P2022")
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const pref = await prisma.notificationPreference.findUnique({
      where: { userId: session.user.id },
    })
    const userPhoneNumber = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phoneNumber: true },
    })
      .then((user) => user?.phoneNumber ?? null)
      .catch((error) => {
        if (isMissingSchemaError(error)) return null
        throw error
      })

    // Return defaults if no preferences set
    const preferences = {
      ...(pref || {
        emailEnabled: true,
        waEnabled: false,
        slackEnabled: false,
        desktopEnabled: false,
        desktopSoundEnabled: true,
        waPhone: null,
        slackWebhook: null,
        taskAssigned: true,
        taskDueSoon: true,
        commentMention: true,
        projectInvite: true,
        statusUpdate: true,
      }),
      waPhone: pref?.waPhone ?? userPhoneNumber,
    }
    // Flat fields for the older callers, plus the same object under `preferences`, which is what
    // the SPA (apps/nexus-lovable-ui settings -> NotificationsSection) reads (method-fix 2026-09-24).
    return NextResponse.json({ ...preferences, preferences })
  } catch (error) {
    console.error("Error fetching notification preferences:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const waPhone =
      typeof body.waPhone === "string" && body.waPhone.trim()
        ? normalizeIndonesianPhoneNumber(body.waPhone)
        : null

    if (body.waPhone && !isLikelyPhoneNumber(body.waPhone)) {
      return NextResponse.json(
        { error: "Enter a valid Indonesian WhatsApp number, for example +6281234567890." },
        { status: 400 }
      )
    }

    const pref = await prisma.notificationPreference.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        emailEnabled: body.emailEnabled ?? true,
        waEnabled: body.waEnabled ?? false,
        slackEnabled: body.slackEnabled ?? false,
        desktopEnabled: body.desktopEnabled ?? false,
        desktopSoundEnabled: body.desktopSoundEnabled ?? true,
        waPhone,
        slackWebhook: body.slackWebhook || null,
        taskAssigned: body.taskAssigned ?? true,
        taskDueSoon: body.taskDueSoon ?? true,
        commentMention: body.commentMention ?? true,
        projectInvite: body.projectInvite ?? true,
        statusUpdate: body.statusUpdate ?? true,
      },
      update: {
        emailEnabled: body.emailEnabled,
        waEnabled: body.waEnabled,
        slackEnabled: body.slackEnabled,
        desktopEnabled: body.desktopEnabled,
        desktopSoundEnabled: body.desktopSoundEnabled,
        waPhone,
        slackWebhook: body.slackWebhook,
        taskAssigned: body.taskAssigned,
        taskDueSoon: body.taskDueSoon,
        commentMention: body.commentMention,
        projectInvite: body.projectInvite,
        statusUpdate: body.statusUpdate,
      },
    })

    if (waPhone) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { phoneNumber: waPhone },
      })
        .catch((error) => {
          if (!isMissingSchemaError(error)) throw error
        })
    }

    logAudit({ action: "update", entityType: "notificationPreference", entityId: pref.id, userId: session.user.id, request: req })

    return NextResponse.json(pref)
  } catch (error) {
    console.error("Preferences API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH = partial update (method-fix 2026-09-24).
// The web settings screen sends only the toggle that changed, e.g. { desktopEnabled: true }.
// PUT cannot serve that: it rewrites every column, and a body without waPhone would null the
// user's WhatsApp number. PATCH writes ONLY the keys present in the body; everything else keeps
// its stored value (or the schema default, which equals DEFAULT_PREFS in notification-service,
// when the row is created here for the first time).
const PATCHABLE_BOOLEANS = [
  "emailEnabled",
  "waEnabled",
  "slackEnabled",
  "desktopEnabled",
  "desktopSoundEnabled",
  "taskAssigned",
  "taskDueSoon",
  "commentMention",
  "projectInvite",
  "statusUpdate",
] as const

type PreferencePatch = Partial<Record<(typeof PATCHABLE_BOOLEANS)[number], boolean>> & {
  waPhone?: string | null
  slackWebhook?: string | null
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 })
  const input = body as Record<string, unknown>

  const data: PreferencePatch = {}
  for (const key of PATCHABLE_BOOLEANS) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== "boolean")
      return NextResponse.json({ error: `${key} must be true or false` }, { status: 400 })
    data[key] = value
  }

  if (input.waPhone !== undefined) {
    const raw = input.waPhone
    if (raw !== null && typeof raw !== "string")
      return NextResponse.json({ error: "waPhone must be a string or null" }, { status: 400 })
    if (typeof raw === "string" && raw.trim()) {
      // Same rule and message as PUT.
      if (!isLikelyPhoneNumber(raw)) {
        return NextResponse.json(
          { error: "Enter a valid Indonesian WhatsApp number, for example +6281234567890." },
          { status: 400 }
        )
      }
      data.waPhone = normalizeIndonesianPhoneNumber(raw)
    } else {
      // Explicit null / "" clears it - only when the caller actually sent the key.
      data.waPhone = null
    }
  }

  if (input.slackWebhook !== undefined) {
    const raw = input.slackWebhook
    if (raw !== null && typeof raw !== "string")
      return NextResponse.json({ error: "slackWebhook must be a string or null" }, { status: 400 })
    data.slackWebhook = raw || null
  }

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "No preference fields to update" }, { status: 400 })

  try {
    const pref = await prisma.notificationPreference.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, ...data },
      update: data,
    })

    // Same side effect as PUT: a newly set WhatsApp number is also stored on the user.
    if (data.waPhone) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { phoneNumber: data.waPhone },
      })
        .catch((error) => {
          if (!isMissingSchemaError(error)) throw error
        })
    }

    logAudit({
      action: "update",
      entityType: "notificationPreference",
      entityId: pref.id,
      userId: session.user.id,
      metadata: { fields: Object.keys(data) },
      request: req,
    })

    // PUT's flat shape, plus `preferences` like GET.
    return NextResponse.json({ ...pref, preferences: pref })
  } catch (error) {
    console.error("Preferences API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

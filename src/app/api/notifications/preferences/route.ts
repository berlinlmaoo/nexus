export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { isSlackWebhookUrl } from "@/lib/notification-service"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const pref = await prisma.notificationPreference.findUnique({
      where: { userId: session.user.id },
    })

    // Return defaults if no preferences set. (The WhatsApp channel — waEnabled / waPhone — was removed
    // on 12 Oct 2026; no released app reads those keys.)
    const preferences = pref || {
      emailEnabled: true,
      slackEnabled: false,
      desktopEnabled: false,
      desktopSoundEnabled: true,
      slackWebhook: null,
      taskAssigned: true,
      taskDueSoon: true,
      commentMention: true,
      projectInvite: true,
      statusUpdate: true,
      automation: true,
    }
    // Flat fields for the older callers, plus the same object under `preferences`, which is what
    // the SPA (apps/web settings -> NotificationsSection) reads (method-fix 2026-09-24).
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
    // waEnabled / waPhone from an old client are ignored: the WhatsApp channel was removed (12 Oct 2026).
    const body = await req.json()

    const pref = await prisma.notificationPreference.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        emailEnabled: body.emailEnabled ?? true,
        slackEnabled: body.slackEnabled ?? false,
        desktopEnabled: body.desktopEnabled ?? false,
        desktopSoundEnabled: body.desktopSoundEnabled ?? true,
        slackWebhook: isSlackWebhookUrl(body.slackWebhook) ? body.slackWebhook : null,
        taskAssigned: body.taskAssigned ?? true,
        taskDueSoon: body.taskDueSoon ?? true,
        commentMention: body.commentMention ?? true,
        projectInvite: body.projectInvite ?? true,
        statusUpdate: body.statusUpdate ?? true,
        automation: body.automation ?? true,
      },
      update: {
        emailEnabled: body.emailEnabled,
        slackEnabled: body.slackEnabled,
        desktopEnabled: body.desktopEnabled,
        desktopSoundEnabled: body.desktopSoundEnabled,
        slackWebhook: body.slackWebhook === null || body.slackWebhook === "" ? null : isSlackWebhookUrl(body.slackWebhook) ? body.slackWebhook : undefined,
        taskAssigned: body.taskAssigned,
        taskDueSoon: body.taskDueSoon,
        commentMention: body.commentMention,
        projectInvite: body.projectInvite,
        statusUpdate: body.statusUpdate,
        // Released apps PUT without this key: undefined leaves it as it is.
        automation: typeof body.automation === "boolean" ? body.automation : undefined,
      },
    })

    logAudit({ action: "update", entityType: "notificationPreference", entityId: pref.id, userId: session.user.id, request: req })

    return NextResponse.json(pref)
  } catch (error) {
    console.error("Preferences API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PATCH = partial update (method-fix 2026-09-24).
// The web settings screen sends only the toggle that changed, e.g. { desktopEnabled: true }.
// PUT cannot serve that: it rewrites every column. PATCH writes ONLY the keys present in the body; everything else keeps
// its stored value (or the schema default, which equals DEFAULT_PREFS in notification-service,
// when the row is created here for the first time).
const PATCHABLE_BOOLEANS = [
  "emailEnabled",
  "slackEnabled",
  "desktopEnabled",
  "desktopSoundEnabled",
  "taskAssigned",
  "taskDueSoon",
  "commentMention",
  "projectInvite",
  "statusUpdate",
  "automation",
] as const

type PreferencePatch = Partial<Record<(typeof PATCHABLE_BOOLEANS)[number], boolean>> & {
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

  if (input.slackWebhook !== undefined) {
    const raw = input.slackWebhook
    if (raw !== null && typeof raw !== "string")
      return NextResponse.json({ error: "slackWebhook must be a string or null" }, { status: 400 })
    if (raw && !isSlackWebhookUrl(raw))
      return NextResponse.json({ error: "slackWebhook must be a https://hooks.slack.com/services/… URL" }, { status: 400 })
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

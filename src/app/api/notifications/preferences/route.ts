export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { isLikelyPhoneNumber, normalizeIndonesianPhoneNumber } from "@/lib/phone-number"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const pref = await prisma.notificationPreference.findUnique({
      where: { userId: session.user.id },
    })
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phoneNumber: true },
    })

    // Return defaults if no preferences set
    return NextResponse.json({
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
      waPhone: pref?.waPhone ?? user?.phoneNumber ?? null,
    })
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
    }

    logAudit({ action: "update", entityType: "notificationPreference", entityId: pref.id, userId: session.user.id, request: req })

    return NextResponse.json(pref)
  } catch (error) {
    console.error("Preferences API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

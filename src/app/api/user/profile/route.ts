export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { rememberUiLanguage, setUiLanguage } from "@/lib/notification-text"
import { logAudit } from "@/lib/audit"
import { orgRoleOf } from "@/lib/org"
import { isLikelyPhoneNumber, normalizeIndonesianPhoneNumber } from "@/lib/phone-number"

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // The web's interface language, for the notifications made for this person later (notification-text.ts).
    void rememberUiLanguage(session.user.id, req.headers)

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, avatar: true, phoneNumber: true, dndUntil: true, onboardedAt: true, googleWorkspaceEmail: true, uiLanguage: true },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // `role` is the retired system flag (16 Oct 2026). Kept for clients that still read it, derived from
    // the company role: "ADMIN" for the company's One Above All, "MEMBER" for everyone else.
    const orgRole = await orgRoleOf(user.id)
    return NextResponse.json({ user: { ...user, role: orgRole === "ONE_ABOVE_ALL" ? "ADMIN" : "MEMBER" } })
  } catch (error) {
    console.error("Error fetching profile:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { name, phoneNumber, dndUntil, markOnboarded, uiLanguage } = body

    // The language the person picked in the app or on the web (13 Oct 2026): notifications and pushes
    // are written in it; English when never picked. "en" | "id" | null (null = back to the default).
    let languageSet = false
    if (uiLanguage !== undefined) {
      if (uiLanguage !== null && uiLanguage !== "en" && uiLanguage !== "id") {
        return NextResponse.json({ error: "uiLanguage must be \"en\", \"id\" or null", code: "BAD_LANGUAGE" }, { status: 400 })
      }
      await setUiLanguage(session.user.id, uiLanguage)
      languageSet = true
    }

    const data: { name?: string; phoneNumber?: string | null; dndUntil?: Date | null; onboardedAt?: Date } = {}
    if (typeof name === "string" && name.trim()) {
      data.name = name.trim()
    }
    if (markOnboarded === true) {
      data.onboardedAt = new Date()
    }
    if (phoneNumber !== undefined) {
      if (phoneNumber === null || phoneNumber === "") {
        data.phoneNumber = null
      } else if (typeof phoneNumber === "string" && isLikelyPhoneNumber(phoneNumber)) {
        data.phoneNumber = normalizeIndonesianPhoneNumber(phoneNumber)
      } else {
        return NextResponse.json(
          { error: "Enter a valid Indonesian phone number, for example +6281234567890." },
          { status: 400 }
        )
      }
    }
    if (dndUntil !== undefined) {
      data.dndUntil = dndUntil ? new Date(dndUntil) : null
    }

    if (Object.keys(data).length === 0) {
      if (languageSet) return NextResponse.json({ ok: true, uiLanguage })
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      )
    }

    // Only the name is recorded old → new. The other fields (phone, DND, onboarding) are logged by
    // name only: the phone number is personal data and the rest is noise.
    const previousName = data.name !== undefined
      ? (await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } }))?.name ?? null
      : null

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: { id: true, name: true, email: true, avatar: true, phoneNumber: true, dndUntil: true, onboardedAt: true, googleWorkspaceEmail: true, uiLanguage: true },
    })

    logAudit({
      action: "update",
      entityType: "user_profile",
      entityId: session.user.id,
      entityName: user.name,
      userId: session.user.id,
      request,
      metadata: {
        fields: Object.keys(data),
        ...(data.name !== undefined && data.name !== previousName
          ? { changes: { name: { from: previousName, to: data.name } } }
          : {}),
      },
    })

    const orgRole = await orgRoleOf(user.id)
    return NextResponse.json({ user: { ...user, role: orgRole === "ONE_ABOVE_ALL" ? "ADMIN" : "MEMBER" } })
  } catch (error) {
    console.error("Error updating profile:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

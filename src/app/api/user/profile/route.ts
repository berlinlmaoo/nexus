export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { isLikelyPhoneNumber, normalizeIndonesianPhoneNumber } from "@/lib/phone-number"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, avatar: true, phoneNumber: true, dndUntil: true },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({ user })
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
    const { name, phoneNumber, dndUntil } = body

    const data: { name?: string; phoneNumber?: string | null; dndUntil?: Date | null } = {}
    if (typeof name === "string" && name.trim()) {
      data.name = name.trim()
    }
    if (phoneNumber !== undefined) {
      if (phoneNumber === null || phoneNumber === "") {
        data.phoneNumber = null
      } else if (typeof phoneNumber === "string" && isLikelyPhoneNumber(phoneNumber)) {
        data.phoneNumber = normalizeIndonesianPhoneNumber(phoneNumber)
      } else {
        return NextResponse.json(
          { error: "Enter a valid Indonesian WhatsApp number, for example +6281234567890." },
          { status: 400 }
        )
      }
    }
    if (dndUntil !== undefined) {
      data.dndUntil = dndUntil ? new Date(dndUntil) : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      )
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: { id: true, name: true, email: true, avatar: true, phoneNumber: true, dndUntil: true },
    })

    logAudit({ action: "update", entityType: "user_profile", entityId: session.user.id, userId: session.user.id, request })

    return NextResponse.json({ user })
  } catch (error) {
    console.error("Error updating profile:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { createOfficeLocationSchema, validateBody } from "@/lib/validations"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const offices = await prisma.officeLocation.findMany({
      where: { workspaceId: context.workspace.id },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    })

    return NextResponse.json({
      offices,
      canManage: context.canManageAttendance,
    })
  } catch (error) {
    console.error("Error fetching attendance offices:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace || !context.canManageAttendance) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const validation = validateBody(createOfficeLocationSchema, body)
    if (!validation.success) return validation.error

    const office = await prisma.officeLocation.create({
      data: {
        workspaceId: context.workspace.id,
        name: validation.data.name.trim(),
        address: validation.data.address?.trim() || null,
        latitude: validation.data.latitude,
        longitude: validation.data.longitude,
        radiusMeters: validation.data.radiusMeters,
        timezone: validation.data.timezone?.trim() || "Asia/Jakarta",
        workdays: validation.data.workdays ?? [1, 2, 3, 4, 5, 6, 7],
        shiftStartTime: validation.data.shiftStartTime ?? "09:00",
        shiftEndTime: validation.data.shiftEndTime ?? "18:00",
        lateGraceMinutes: validation.data.lateGraceMinutes ?? 0, // default: no grace (strict). Set explicitly per office if tolerance is wanted.
        earlyLeaveGraceMinutes: validation.data.earlyLeaveGraceMinutes ?? 0,
        isActive: validation.data.isActive ?? true,
      },
    })

    await logAudit({
      action: "create",
      entityType: "attendance_office",
      entityId: office.id,
      entityName: office.name,
      userId: session.user.id,
      request,
      metadata: {
        workspaceId: context.workspace.id,
        radiusMeters: office.radiusMeters,
        address: office.address,
        timezone: office.timezone,
      },
    })

    return NextResponse.json({ office }, { status: 201 })
  } catch (error) {
    console.error("Error creating attendance office:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

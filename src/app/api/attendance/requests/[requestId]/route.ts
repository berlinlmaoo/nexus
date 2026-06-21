export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { getAttendanceWorkspaceContext, serializeAttendanceRequest } from "@/lib/attendance"
import { clearLeaveCoveredOpenRecords } from "@/lib/attendance-absence"
import { attendanceRequestPatchSchema } from "@/lib/validations"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const context = await getAttendanceWorkspaceContext(session.user.id)
    if (!context.workspace) {
      return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
    }

    const payload = await request.json()
    const validation = attendanceRequestPatchSchema.safeParse(payload)
    if (!validation.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const attendanceRequest = await prisma.attendanceRequest.findUnique({
      where: { id: (await params).requestId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!attendanceRequest || attendanceRequest.workspaceId !== context.workspace.id) {
      return NextResponse.json({ error: "Attendance request not found." }, { status: 404 })
    }

    if (validation.data.action === "cancel") {
      if (attendanceRequest.userId !== session.user.id) {
        return NextResponse.json({ error: "Only the requester can cancel this attendance request." }, { status: 403 })
      }
      if (attendanceRequest.status !== "PENDING") {
        return NextResponse.json({ error: "Only pending attendance requests can be canceled." }, { status: 409 })
      }

      const updated = await prisma.attendanceRequest.update({
        where: { id: attendanceRequest.id },
        data: {
          status: "CANCELED",
        },
        include: {
          user: { select: { id: true, name: true, email: true, avatar: true } },
          reviewedBy: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      })

      await logAudit({
        action: "update",
        entityType: "attendance_request",
        entityId: updated.id,
        entityName: `${updated.type}:${updated.user.name}`,
        userId: session.user.id,
        request,
        metadata: {
          status: updated.status,
        },
      })

      return NextResponse.json({ request: serializeAttendanceRequest(updated) })
    }

    if (attendanceRequest.status !== "PENDING") {
      return NextResponse.json({ error: "Only pending attendance requests can be reviewed." }, { status: 409 })
    }

    // A team-scoped MANAGER may review a request when its REQUESTER belongs to a team they lead
    // (checked by team membership, not the request's teamId, which can be null).
    const isTeamHead =
      context.teamLeadTeamIds.length > 0 &&
      (await prisma.teamMember.count({
        where: { userId: attendanceRequest.userId, teamId: { in: context.teamLeadTeamIds } },
      })) > 0

    if (!context.canManageAttendance && !isTeamHead) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const approvalSource = context.canManageAttendance
      ? context.isAttendanceSupervisor
        ? "ATTENDANCE_SUPERVISOR"
        : "ADMIN"
      : "TEAM_HEAD"

    const nextStatus = validation.data.action === "approve" ? "APPROVED" : "REJECTED"

    const updated = await prisma.attendanceRequest.update({
      where: { id: attendanceRequest.id },
      data: {
        status: nextStatus,
        reviewNote: validation.data.reviewNote?.trim() || null,
        reviewedAt: new Date(),
        reviewedById: session.user.id,
        approvalSource,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    })

    // Approving a leave/day-off that covers a day the staff already checked into leaves a stuck open
    // record (can't check out, blocks next day's check-in). Clear it here so it never enters that loop.
    if (nextStatus === "APPROVED") {
      try { await clearLeaveCoveredOpenRecords(updated.userId, updated.workspaceId) } catch (err) { console.error("clearLeaveCoveredOpenRecords (approve) failed:", err) }
    }

    await logAudit({
      action: "update",
      entityType: "attendance_request",
      entityId: updated.id,
      entityName: `${updated.type}:${updated.user.name}`,
      userId: session.user.id,
      request,
      metadata: {
        status: updated.status,
        approvalSource,
      },
    })

    return NextResponse.json({ request: serializeAttendanceRequest(updated) })
  } catch (error) {
    console.error("Error updating attendance request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

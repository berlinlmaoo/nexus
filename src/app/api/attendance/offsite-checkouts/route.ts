export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"

// Offsite-checkout approval queue (BoD only). Lists checkouts made outside the office geofence.
// ?status=PENDING (default) | APPROVED | REJECTED | ALL
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const context = await getAttendanceWorkspaceContext(session.user.id)
  if (!context.workspace) return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })
  if (!context.canManageAttendance) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const statusParam = (request.nextUrl.searchParams.get("status") || "PENDING").toUpperCase()
  const approvalFilter = ["PENDING", "APPROVED", "REJECTED"].includes(statusParam) ? statusParam : null

  const records = await prisma.attendanceRecord.findMany({
    where: {
      workspaceId: context.workspace.id,
      checkOutOffsite: true,
      ...(approvalFilter ? { checkOutApproval: approvalFilter } : {}),
    },
    select: {
      id: true,
      attendanceDate: true,
      checkOutAt: true,
      checkOutReason: true,
      checkOutAddress: true,
      checkOutLat: true,
      checkOutLng: true,
      checkOutDistanceMeters: true,
      checkOutPhotoUrl: true,
      checkOutStatus: true,
      checkOutApproval: true,
      checkOutApprovedAt: true,
      checkOutApprovedById: true,
      user: { select: { id: true, name: true, email: true, avatar: true } },
      officeLocation: { select: { name: true } },
    },
    orderBy: [{ checkOutApproval: "asc" }, { checkOutAt: "desc" }],
    take: 200,
  })

  // Resolve approver names (checkOutApprovedById has no relation, so look them up in one query).
  const approverIds = [...new Set(records.map((r) => r.checkOutApprovedById).filter((id): id is string => !!id))]
  const approvers = approverIds.length
    ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } })
    : []
  const approverNameById = new Map(approvers.map((a) => [a.id, a.name]))

  const items = records.map((r) => ({
    id: r.id,
    attendanceDate: r.attendanceDate.toISOString(),
    checkOutAt: r.checkOutAt?.toISOString() ?? null,
    reason: r.checkOutReason,
    address: r.checkOutAddress,
    lat: r.checkOutLat,
    lng: r.checkOutLng,
    distanceMeters: r.checkOutDistanceMeters,
    photoUrl: r.checkOutPhotoUrl,
    checkOutStatus: r.checkOutStatus,
    approval: r.checkOutApproval,
    approvedAt: r.checkOutApprovedAt?.toISOString() ?? null,
    approverName: r.checkOutApprovedById ? approverNameById.get(r.checkOutApprovedById) ?? null : null,
    officeName: r.officeLocation?.name ?? null,
    user: r.user,
  }))

  const pendingCount = approvalFilter === "PENDING" ? items.length : await prisma.attendanceRecord.count({ where: { workspaceId: context.workspace.id, checkOutOffsite: true, checkOutApproval: "PENDING" } })

  return NextResponse.json({ items, pendingCount })
}

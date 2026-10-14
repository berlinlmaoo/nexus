export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { personalScope } from "@/lib/personal-visibility"

/**
 * Bagan Approval — semua orang beserta tepinya, dalam satu panggilan. Klien yang menyusun pohonnya.
 *
 * Bukan lagi tiga tingkat tetap. Rantai bebas (owner: willy → gerro → riri), jadi bentuknya
 * hutan: akar = orang tanpa approver. Akar yang BoD/OAA memang puncak; akar yang Staff/Manager
 * berarti "belum ditaruh" — request-nya jatuh ke kelompok BoD sampai ditaruh.
 */
export async function GET() {
  try {
    const { context } = await getAdminSessionContext()
    if (!context?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!context.canAccessUserManagement) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const me = await prisma.workspaceMember.findFirst({
      where: { userId: context.user.id },
      orderBy: { joinedAt: "asc" },
      select: { workspaceId: true },
    })
    if (!me) return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })

    const rows = await prisma.workspaceMember.findMany({
      where: { workspaceId: me.workspaceId },
      select: {
        id: true, role: true, approverId: true,
        attendanceShiftStartTime: true, attendanceShiftEndTime: true, flexiTimeEnabled: true, noGeofenceMode: true,
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { user: { name: "asc" } },
    })
    const ids = new Set(rows.map((r) => r.user.id))
    // Shift hours and the Flexi / no-geofence modes are personal (owner, 13 Oct 2026): a Manager sees them
    // on their own chain only; BoD / One Above All on everyone (lib/personal-visibility.ts).
    const personal = await personalScope(context.user.id, me.workspaceId)
    const people = rows.map((r) => ({
      userId: r.user.id, memberId: r.id, name: r.user.name, email: r.user.email, avatar: r.user.avatar, role: r.role,
      // Tepi ke orang yang sudah keluar workspace tidak berarti apa-apa; tampilkan sebagai kosong.
      approverId: r.approverId && ids.has(r.approverId) ? r.approverId : null,
      // Jam kerja per orang (null = ikut jam kantor/tim) + dua mode absensi. Digambar di kartu
      // bagan supaya "anak buah gue jam berapa" terjawab tanpa membuka tiap orang.
      ...(personal.canSee(r.user.id)
        ? { shiftStart: r.attendanceShiftStartTime, shiftEnd: r.attendanceShiftEndTime, flexi: r.flexiTimeEnabled, mobile: r.noGeofenceMode }
        : { shiftStart: null, shiftEnd: null, flexi: false, mobile: false, personalHidden: true }),
    }))
    const unassigned = people.filter((p) => !p.approverId && (p.role === "STAFF" || p.role === "MANAGER"))

    return NextResponse.json({
      workspaceId: me.workspaceId,
      people,
      stats: {
        total: people.length,
        withApprover: people.filter((p) => !!p.approverId).length,
        unassigned: unassigned.length,
        bod: people.filter((p) => p.role === "BOD" || p.role === "ONE_ABOVE_ALL").length,
      },
    })
  } catch (error) {
    console.error("[admin/approval-chart]", error)
    return NextResponse.json({ error: "Failed to load approval chart" }, { status: 500 })
  }
}

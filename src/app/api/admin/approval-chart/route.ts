export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"

/**
 * Bagan Approval — seluruh pohon dalam satu panggilan.
 *
 *   oaa        One Above All (tingkat teratas, digambar sendiri)
 *   bod        semua BoD — satu kelompok, bukan target seret; request manager masuk ke sini
 *   managers   tiap manager dengan `reports` = staff yang ditaruh di bawahnya (boleh kosong —
 *              kolom kosong adalah informasi: ada manager yang belum punya siapa-siapa)
 *   unassigned staff tanpa approver → request-nya jatuh ke BoD sampai ditaruh
 *
 * Satu query, digabung di sini — pola yang sama dengan /api/admin/users/memberships.
 */
type Person = { userId: string; memberId: string; name: string | null; email: string; avatar: string | null; role: string }

export async function GET() {
  try {
    const { context } = await getAdminSessionContext()
    if (!context?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!context.canAccessUserManagement) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Workspace si pemanggil, bukan "semua workspace": dua akun NEXUS Demo tidak boleh ikut.
    const me = await prisma.workspaceMember.findFirst({
      where: { userId: context.user.id },
      orderBy: { joinedAt: "asc" },
      select: { workspaceId: true },
    })
    if (!me) return NextResponse.json({ error: "No workspace membership found" }, { status: 404 })

    const rows = await prisma.workspaceMember.findMany({
      where: { workspaceId: me.workspaceId },
      select: {
        id: true,
        role: true,
        approverId: true,
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { user: { name: "asc" } },
    })

    const person = (r: (typeof rows)[number]): Person => ({
      userId: r.user.id, memberId: r.id, name: r.user.name, email: r.user.email, avatar: r.user.avatar, role: r.role,
    })

    const oaa = rows.filter((r) => r.role === "ONE_ABOVE_ALL").map(person)
    const bod = rows.filter((r) => r.role === "BOD").map(person)
    const managers = rows
      .filter((r) => r.role === "MANAGER")
      .map((m) => ({
        ...person(m),
        reports: rows.filter((r) => r.role === "STAFF" && r.approverId === m.user.id).map(person),
      }))
    const managerIds = new Set(managers.map((m) => m.userId))
    // "Belum ditaruh" termasuk staff yang approverId-nya menunjuk orang yang sudah bukan Manager —
    // tepi seperti itu tidak berarti apa-apa untuk routing, dan menyembunyikannya di bawah kartu
    // yang tidak ada berarti staff itu hilang dari bagan.
    const unassigned = rows
      .filter((r) => r.role === "STAFF" && (!r.approverId || !managerIds.has(r.approverId)))
      .map(person)

    return NextResponse.json({
      workspaceId: me.workspaceId,
      oaa, bod, managers, unassigned,
      stats: {
        staff: rows.filter((r) => r.role === "STAFF").length,
        assigned: rows.filter((r) => r.role === "STAFF").length - unassigned.length,
        unassigned: unassigned.length,
        managers: managers.length,
        bod: bod.length + oaa.length,
      },
    })
  } catch (error) {
    console.error("[admin/approval-chart]", error)
    return NextResponse.json({ error: "Failed to load approval chart" }, { status: 500 })
  }
}

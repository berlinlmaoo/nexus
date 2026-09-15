export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"

/**
 * Siapa masuk project mana — untuk dropdown per orang di Control Room → Users.
 *
 * Satu panggilan untuk SELURUH daftar, bukan satu per baris. Halaman itu menggambar 49 baris;
 * versi per-baris berarti 49 query dan layar yang terbuka dalam hitungan detik. Pola yang sama
 * sudah dipakai daftar akun Google di halaman itu, dan alasannya sama.
 *
 * Dua sumber keanggotaan project, dan perbedaannya penting untuk dilihat:
 *   - "direct"      — ditambahkan langsung ke project itu.
 *   - "team:{id}"   — ikut karena timnya ditautkan ke project (lihat src/lib/team-sync.ts).
 * Mencabut yang kedua lewat halaman project TIDAK bertahan: sinkronisasi tim menuliskannya lagi.
 * Karena itu barisnya menyebut nama tim asalnya, supaya jelas ke mana harus pergi.
 */
export async function GET() {
  try {
    const { context } = await getAdminSessionContext()
    if (!context?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!context.canAccessUserManagement) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const [projectMembers, teamMembers, teamLinks] = await Promise.all([
      prisma.projectMember.findMany({
        select: {
          userId: true,
          role: true,
          source: true,
          project: { select: { id: true, name: true, icon: true, color: true, status: true } },
        },
      }),
      prisma.teamMember.findMany({
        select: {
          userId: true,
          role: true,
          team: {
            select: {
              id: true,
              name: true,
              color: true,
              division: { select: { id: true, name: true, color: true } },
            },
          },
        },
      }),
      // Hanya untuk menerjemahkan "team:{id}" menjadi nama yang bisa dibaca orang.
      prisma.team.findMany({ select: { id: true, name: true } }),
    ])

    const teamNameById = new Map(teamLinks.map((t) => [t.id, t.name]))

    type Entry = {
      projects: Array<{
        id: string
        name: string
        icon: string | null
        color: string | null
        status: string | null
        role: string
        /** null = ditambahkan langsung; berisi nama tim = ikut lewat tim itu. */
        viaTeam: string | null
      }>
      teams: Array<{ id: string; name: string; color: string | null; role: string; division: string | null }>
    }
    const byUser: Record<string, Entry> = {}
    const bucket = (userId: string): Entry => (byUser[userId] ??= { projects: [], teams: [] })

    for (const pm of projectMembers) {
      if (!pm.project) continue
      const viaTeamId = pm.source?.startsWith("team:") ? pm.source.slice(5) : null
      bucket(pm.userId).projects.push({
        id: pm.project.id,
        name: pm.project.name,
        icon: pm.project.icon,
        color: pm.project.color,
        status: pm.project.status ?? null,
        role: pm.role,
        viaTeam: viaTeamId ? (teamNameById.get(viaTeamId) ?? "tim yang sudah dihapus") : null,
      })
    }

    for (const tm of teamMembers) {
      if (!tm.team) continue
      bucket(tm.userId).teams.push({
        id: tm.team.id,
        name: tm.team.name,
        color: tm.team.color,
        role: tm.role,
        division: tm.team.division?.name ?? null,
      })
    }

    for (const entry of Object.values(byUser)) {
      entry.projects.sort((a, b) => a.name.localeCompare(b.name))
      entry.teams.sort((a, b) => a.name.localeCompare(b.name))
    }

    return NextResponse.json({ byUser })
  } catch (error) {
    console.error("[admin/users/memberships]", error)
    return NextResponse.json({ error: "Failed to load memberships" }, { status: 500 })
  }
}

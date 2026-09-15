export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getAdminSessionContext } from "@/lib/admin-access"
import { directoryConfigured, listDirectoryAccounts } from "@/lib/google-directory"

// GET /api/admin/google-workspace/accounts
//
// Isi pemilih di layar profil: akun Google Workspace yang nyata, bukan kotak teks.
// Alamat yang diketik tangan akan salah ketik suatu hari, dan tautan ke alamat yang tidak ada
// terlihat persis sama dengan tautan yang benar sampai ada yang mencoba mengirim surat.
//
// Setiap akun membawa `linkedTo`: profil NEXUS yang sudah memakainya, atau null. Dihitung di
// sini supaya UI bisa menampilkan akun yang sudah terpakai sebagai tidak-bisa-dipilih, alih-alih
// membiarkan orang memilihnya lalu ditolak indeks unik dengan pesan database.
export async function GET() {
  try {
    const { context } = await getAdminSessionContext()
    if (!context?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!context.canAccessUserManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (!directoryConfigured()) {
      // Dijawab 200, bukan 500: "belum dikonfigurasi" adalah keadaan yang sah dan UI perlu
      // menjelaskannya, bukan menampilkan kegagalan yang terlihat seperti kerusakan.
      return NextResponse.json({
        configured: false,
        accounts: [],
        error: "Google Workspace belum disambungkan (GOOGLE_DIRECTORY_* belum diisi).",
      })
    }

    const [accounts, linked] = await Promise.all([
      listDirectoryAccounts(),
      prisma.user.findMany({
        where: { googleWorkspaceEmail: { not: null } },
        select: { id: true, name: true, googleWorkspaceEmail: true },
      }),
    ])

    const byEmail = new Map(
      linked.map((u) => [String(u.googleWorkspaceEmail).toLowerCase(), { id: u.id, name: u.name }]),
    )

    return NextResponse.json({
      configured: true,
      accounts: accounts.map((a) => ({ ...a, linkedTo: byEmail.get(a.email.toLowerCase()) ?? null })),
    })
  } catch (error) {
    console.error("[google-workspace] list accounts failed:", error)
    // Pesan Google dibawa apa adanya: "Not Authorized to access this resource" dan
    // "unauthorized_client" berarti dua hal yang sangat berbeda (impersonasi vs delegasi), dan
    // menggantinya dengan "gagal memuat" membuang satu-satunya petunjuk yang berguna.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal membaca direktori Google" },
      { status: 502 },
    )
  }
}

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getAdminSessionContext } from "@/lib/admin-access"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import {
  directoryConfigured,
  listDirectoryAccounts,
  getDirectoryAccount,
  createDirectoryUser,
  normalizeLocalPart,
  domainsFrom,
} from "@/lib/google-directory"

// POST /api/admin/google-workspace/users
//
// Membuat mailbox Google Workspace BARU, lalu langsung menautkannya ke profil NEXUS.
//
// Satu-satunya endpoint di NEXUS yang mengeluarkan uang: tiap akun baru mengisi satu seat
// lisensi. Karena itu ia lebih ketat daripada endpoint admin lain — `canAccessUserManagement`
// saja tidak cukup, harus BoD ke atas.
export async function POST(request: NextRequest) {
  try {
    const { session, context } = await getAdminSessionContext()
    if (!context?.user || !session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!context.canAccessUserManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    // Sengaja LEBIH ketat dari sekadar akses manajemen user. Mengubah peran orang bisa
    // dibatalkan; membuat mailbox mengisi seat berbayar dan meninggalkan identitas baru di
    // domain perusahaan, dan itu bukan tombol yang pantas dipegang setiap admin sistem.
    const orgRole = await getUserOrgRole(session.user.id)
    if (!isBodPlus(orgRole)) {
      return NextResponse.json(
        { error: "Cuma BoD yang bisa membuat email kantor baru." },
        { status: 403 },
      )
    }
    if (!directoryConfigured()) {
      return NextResponse.json({ error: "Google Workspace belum disambungkan." }, { status: 409 })
    }

    const body = await request.json().catch(() => null)
    const userId = typeof body?.userId === "string" ? body.userId : ""
    const givenName = String(body?.givenName ?? "").trim().slice(0, 60)
    const familyName = String(body?.familyName ?? "").trim().slice(0, 60)
    const domain = String(body?.domain ?? "").trim().toLowerCase()
    const localPart = normalizeLocalPart(String(body?.localPart ?? ""))

    if (!userId) return NextResponse.json({ error: "userId wajib diisi" }, { status: 400 })
    if (!givenName) return NextResponse.json({ error: "Nama depan wajib diisi" }, { status: 400 })
    if (!familyName) return NextResponse.json({ error: "Nama belakang wajib diisi" }, { status: 400 })
    if (!localPart) {
      return NextResponse.json(
        { error: "Bagian sebelum @ tidak sah. Pakai huruf, angka, titik, garis bawah, atau strip." },
        { status: 400 },
      )
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, googleWorkspaceEmail: true },
    })
    if (!target) return NextResponse.json({ error: "User tidak ada" }, { status: 404 })
    if (target.googleWorkspaceEmail) {
      return NextResponse.json(
        { error: `${target.name} sudah tertaut ke ${target.googleWorkspaceEmail}.` },
        { status: 409 },
      )
    }

    // Domain dibatasi ke yang benar-benar dipakai Workspace ini. Google akan menolak domain
    // asing juga, tapi pesannya berupa galat API yang tidak menyebut daftar yang sah.
    const existing = await listDirectoryAccounts()
    const domains = domainsFrom(existing)
    if (!domains.includes(domain)) {
      return NextResponse.json(
        { error: `Domain ${domain || "(kosong)"} tidak dikenal. Yang tersedia: ${domains.join(", ")}.` },
        { status: 400 },
      )
    }

    const email = `${localPart}@${domain}`
    // Diperiksa dulu supaya jawabannya menyebut alamatnya, bukan galat 409 dari Google yang
    // berbunyi "Entity already exists" tanpa menyebut entity yang mana.
    if (await getDirectoryAccount(email)) {
      return NextResponse.json({ error: `${email} sudah ada di Google Workspace.` }, { status: 409 })
    }

    const created = await createDirectoryUser({ localPart, domain, givenName, familyName })

    // Penautan menyusul pembuatan. Kalau langkah ini gagal, akunnya SUDAH terbuat di Google —
    // jadi kegagalannya dilaporkan apa adanya beserta alamat yang terlanjur dibuat, bukan
    // ditelan. Menautkannya belakangan cukup lewat pemilih yang sudah ada.
    try {
      await prisma.user.update({
        where: { id: target.id },
        data: { googleWorkspaceEmail: created.email },
      })
    } catch (error) {
      console.error("[google-workspace] created but link failed:", error)
      return NextResponse.json(
        {
          created: true,
          linked: false,
          account: created,
          error: `Akun ${created.email} BERHASIL dibuat di Google, tapi gagal ditautkan ke profil. Tautkan manual lewat tombol Google di baris orangnya.`,
        },
        { status: 207 },
      )
    }

    logAudit({
      action: "create",
      entityType: "google_workspace_account",
      entityId: target.id,
      entityName: created.email,
      userId: session.user.id,
      request,
      // Sandi sementara TIDAK ikut dicatat. Audit log dibaca lebih banyak orang daripada yang
      // berhak masuk ke mailbox itu.
      metadata: { forUser: target.name, forEmail: target.email, domain, createdEmail: created.email },
    }).catch(() => {})

    return NextResponse.json({ created: true, linked: true, account: created }, { status: 201 })
  } catch (error) {
    console.error("[google-workspace] create user failed:", error)
    // Pesan Google dibawa apa adanya: "Domain not found", "Entity already exists" dan kuota
    // habis adalah tiga hal berbeda, dan mengganti semuanya dengan "gagal" membuang satu-satunya
    // petunjuk yang berguna.
    const message = error instanceof Error ? error.message : "Gagal membuat akun"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

import { google } from "googleapis"

// ─────────────────────────────────────────────────────────────────────────────
// Google Workspace Directory.
//
// Dipakai untuk dua hal: menampilkan akun yang SUDAH ada supaya BoD bisa menautkannya ke
// profil NEXUS, dan nanti membuat mailbox baru.
//
// Kredensialnya SENGAJA memakai nama sendiri (GOOGLE_DIRECTORY_*), bukan menumpang
// GOOGLE_SERVICE_ACCOUNT_* yang sudah ada. Dua nama itu milik `finance-dashboard-data.ts`
// untuk membaca spreadsheet PnL; emailnya sekarang kosong sehingga kode itu jatuh ke jalur
// OAuth dan berjalan. Mengisinya dengan service account ini akan membuat dashboard finance
// memakai JWT yang tidak punya akses ke spreadsheet itu — dashboard mati, dan penyebabnya
// adalah fitur yang sama sekali tidak berhubungan.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Satu scope untuk membaca DAN membuat.
 *
 * Sempat dipisah menjadi `admin.directory.user.readonly` untuk jalur baca, dan itu GAGAL
 * dengan `unauthorized_client: Client is unauthorized ... or client not authorized for any
 * of the scopes requested`. Domain-wide delegation mencocokkan string scope PERSIS: yang
 * didaftarkan di Admin Console adalah `admin.directory.user`, jadi meminta `.readonly` —
 * meski lebih sempit — bukan bagian dari yang diizinkan dan ditolak mentah-mentah.
 *
 * Memakai satu scope juga berarti tidak ada jalur baca yang bisa mati sendirian gara-gara
 * seseorang mendaftarkan satu scope dan lupa yang lain. Kalau `.readonly` nanti ikut
 * didaftarkan, jalur baca boleh dipersempit ke sana.
 */
const SCOPE = "https://www.googleapis.com/auth/admin.directory.user"
const SCOPE_READ = SCOPE
const SCOPE_WRITE = SCOPE

export interface DirectoryAccount {
  email: string
  fullName: string
  suspended: boolean
  isAdmin: boolean
  /** Domain-nya sendiri: satu Workspace ini memuat znetworks.id, pats.group DAN intoo.id. */
  domain: string
}

export function directoryConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DIRECTORY_CLIENT_EMAIL &&
      process.env.GOOGLE_DIRECTORY_PRIVATE_KEY &&
      process.env.GOOGLE_DIRECTORY_SUBJECT,
  )
}

function authFor(scope: string) {
  const email = process.env.GOOGLE_DIRECTORY_CLIENT_EMAIL
  const key = process.env.GOOGLE_DIRECTORY_PRIVATE_KEY?.replace(/\\n/g, "\n")
  const subject = process.env.GOOGLE_DIRECTORY_SUBJECT
  if (!email || !key || !subject) {
    throw new Error("Google Directory belum dikonfigurasi (GOOGLE_DIRECTORY_* kosong)")
  }
  // `subject` adalah bagian yang paling sering terlewat. Service account tidak punya hak admin
  // atas nama dirinya sendiri — ia harus MENYAMAR jadi super admin. Tanpa ini setiap panggilan
  // balas 403, dan 403 itu hampir selalu disalahartikan sebagai "domain-wide delegation gagal"
  // padahal delegasinya benar dan yang kurang justru baris ini.
  return new google.auth.JWT({ email, key, scopes: [scope], subject })
}

/**
 * Semua akun di Workspace, termasuk yang suspended.
 *
 * Yang suspended tetap dikembalikan (ditandai) dan tidak disaring di sini: profil NEXUS yang
 * sudah tertaut ke akun yang belakangan di-suspend harus tetap bisa menampilkan tautannya,
 * kalau tidak tautannya terlihat "hilang" tanpa penjelasan. Penyaringan urusan pemanggil.
 */
export async function listDirectoryAccounts(): Promise<DirectoryAccount[]> {
  const admin = google.admin({ version: "directory_v1", auth: authFor(SCOPE_READ) })
  const out: DirectoryAccount[] = []
  let pageToken: string | undefined

  do {
    const res = await admin.users.list({
      customer: "my_customer",
      maxResults: 200,
      orderBy: "email",
      projection: "basic",
      pageToken,
    })
    for (const u of res.data.users ?? []) {
      const email = u.primaryEmail ?? ""
      if (!email) continue
      out.push({
        email,
        fullName: u.name?.fullName ?? "",
        suspended: Boolean(u.suspended),
        isAdmin: Boolean(u.isAdmin),
        domain: email.split("@")[1] ?? "",
      })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return out
}

/** Satu akun, atau null kalau tidak ada. Dipakai untuk memastikan alamat yang ditautkan NYATA. */
export async function getDirectoryAccount(email: string): Promise<DirectoryAccount | null> {
  const admin = google.admin({ version: "directory_v1", auth: authFor(SCOPE_READ) })
  try {
    const res = await admin.users.get({ userKey: email, projection: "basic" })
    const u = res.data
    const primary = u.primaryEmail ?? email
    return {
      email: primary,
      fullName: u.name?.fullName ?? "",
      suspended: Boolean(u.suspended),
      isAdmin: Boolean(u.isAdmin),
      domain: primary.split("@")[1] ?? "",
    }
  } catch (error) {
    const status = (error as { code?: number })?.code
    if (status === 404) return null
    throw error
  }
}

export { SCOPE_WRITE }

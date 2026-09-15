import { randomBytes } from "crypto"
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

// ─────────────────────────────────────────────────────────────────────────────
// Membuat mailbox baru.
//
// Ini satu-satunya fungsi di berkas ini yang MENGUBAH sesuatu di luar NEXUS, dan yang
// mengeluarkan uang: tiap akun baru mengisi satu seat lisensi Workspace. Pemanggilnya wajib
// membatasi ke BoD dan mencatatnya ke audit — bukan tugas fungsi ini, tapi kalau baris ini
// pernah dipanggil dari tempat lain, itu yang harus diperiksa lebih dulu.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateAccountInput {
  localPart: string
  domain: string
  givenName: string
  familyName: string
}

export interface CreatedAccount {
  email: string
  fullName: string
  /** Ditampilkan SEKALI. Tidak disimpan di mana pun — tidak di database, tidak di log. */
  temporaryPassword: string
}

/** Bagian sebelum @: huruf, angka, titik, garis bawah, strip. Google lebih longgar dari ini,
 *  tapi alamat yang bisa diketik ulang orang dengan benar lewat telepon lebih berharga
 *  daripada kebebasan memakai tanda kutip di alamat surat. */
export function normalizeLocalPart(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64)
}

/** Sandi sementara yang kuat, dibuat di server.
 *
 *  Sengaja TIDAK memakai pola yang mudah diingat. Ini sandi sekali pakai — akun dipaksa
 *  menggantinya saat login pertama — jadi yang berharga bukan kemudahannya diingat, melainkan
 *  bahwa ia tidak bisa ditebak oleh siapa pun yang melihat satu sandi lain buatan sistem ini. */
function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = randomBytes(20)
  let out = ""
  for (const b of bytes) out += alphabet[b % alphabet.length]
  // Satu simbol dan satu angka dijamin ada, supaya tidak tertolak kebijakan sandi domain yang
  // mensyaratkannya — kegagalan yang pesannya dari Google sulit dihubungkan ke sebabnya.
  return `${out.slice(0, 16)}#${out.slice(16, 19)}7`
}

export async function createDirectoryUser(input: CreateAccountInput): Promise<CreatedAccount> {
  const admin = google.admin({ version: "directory_v1", auth: authFor(SCOPE_WRITE) })
  const email = `${input.localPart}@${input.domain}`
  const password = temporaryPassword()

  await admin.users.insert({
    requestBody: {
      primaryEmail: email,
      name: { givenName: input.givenName, familyName: input.familyName },
      password,
      // Wajib ganti saat login pertama. Sandi yang dibuat sistem dan dikirim lewat chat tidak
      // boleh jadi sandi permanen siapa pun.
      changePasswordAtNextLogin: true,
    },
  })

  return {
    email,
    fullName: `${input.givenName} ${input.familyName}`.trim(),
    temporaryPassword: password,
  }
}

/** Domain yang benar-benar dipakai di Workspace ini.
 *
 *  Diturunkan dari alamat akun yang ada, bukan dari `domains.list`: endpoint itu butuh scope
 *  `admin.directory.domain.readonly` yang TIDAK didelegasikan, dan menambah scope berarti
 *  meminta Berlin kembali ke Admin Console. Konsekuensinya jujur dan kecil — domain yang
 *  terdaftar tapi belum punya satu pun akun tidak akan muncul di pilihan. */
export function domainsFrom(accounts: { domain: string }[]): string[] {
  return Array.from(new Set(accounts.map((a) => a.domain).filter(Boolean))).sort()
}

export { SCOPE_WRITE }

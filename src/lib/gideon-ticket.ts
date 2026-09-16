import path from "path"
import { readFile } from "fs/promises"
import sharp from "sharp"
import prisma from "@/lib/prisma"
import { formatAttendanceDateKey } from "@/lib/attendance"
import { getGideonUserId, GIDEON_EMAIL } from "@/lib/gideon-identity"

/**
 * GIDEON's first pass over a support ticket it is allowed to touch.
 *
 * It reads what was filed, looks at the photo, checks the day against the attendance record, and
 * proposes ONE OF TWO remedies — or explains why neither fits and says what should happen instead. It
 * never applies either: the proposal lands on the ticket and a BoD decides. That boundary is the whole
 * design, not a caution — neither tool has a counterpart that writes.
 *
 * The two remedies, and why there had to be two:
 *   propose_attendance_correction   — the recorded TIMES are wrong.
 *   propose_penalty_cancellation    — the times are right and the penalty is still unearned: a
 *                                     leave/permit/sick request covers the day, or NEXUS was down.
 *
 * With only the first, every case got shaped into "propose a time", and two real tickets show what
 * that costs. A man docked 120 XP with a permit still awaiting approval was handed a proposal to set
 * his check-in to the time already on his record — a change of nothing. A man who could not check in
 * because NEXUS was serving Cloudflare Error 1033 was handed the timestamp off his own error
 * screenshot, a time at which he was still late, so the deduction he filed about would have survived
 * his complaint being upheld. Neither was a bad reading of the evidence; both were the only shape the
 * available tool had.
 *
 * Three categories reach it, and they are NOT the same job:
 *   ATTENDANCE — read the evidence, may propose either remedy.
 *   EXP        — the XP deduction is downstream of the day, so the fix is the day: either the record
 *                was wrong (correction) or the penalty was (cancellation). Both attach here.
 *   DAY_OFF    — triage and answer only. GIDEON must never touch what the person themselves cannot
 *                change, and a day-off quota is exactly that: restoring one needs its own
 *                propose→approve flow, which does not exist. The prompt says so and BOTH propose
 *                functions refuse the category outright, so a model that tries anyway gets an error
 *                instead of a proposal.
 *
 * Runs as the REPORTER, so GIDEON sees exactly what they see and nothing else.
 */

const BODY_MAX = 4000

/**
 * The ticket categories GIDEON takes a first pass at. Everything else (PAYROLL, HR, LEADERSHIP, …)
 * it stays out of — those are human conversations with no record it can read.
 */
export const GIDEON_TICKET_CATEGORIES = ["ATTENDANCE", "EXP", "DAY_OFF"] as const
export type GideonTicketCategory = (typeof GIDEON_TICKET_CATEGORIES)[number]

/** Used by the two hook sites so "which tickets does GIDEON answer" is written down once. */
export function isGideonTicketCategory(category: string | null | undefined): category is GideonTicketCategory {
  return Boolean(category) && (GIDEON_TICKET_CATEGORIES as readonly string[]).includes(category as string)
}

/** The evidence, small enough to travel and large enough to read. */
async function loadEvidence(url: string | null): Promise<string | null> {
  if (!url) return null
  // Files land in public/uploads/complaints and are served through /api/files/complaints/<name>.
  // Reading from disk skips an authenticated round trip to our own server for a file we already have.
  const name = path.basename(url)
  if (!name || name.includes("..")) return null
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "uploads", "complaints", name))
    const shrunk = await sharp(raw)
      .rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    return shrunk.toString("base64")
  } catch (error) {
    console.error("gideon-ticket: evidence unreadable", { url, error })
    return null
  }
}

/**
 * Which day is being argued about.
 *
 * Written down as rules because the model got this exactly backwards on a real ticket: the photo's
 * date was obscured, so it declined to call the attendance tool AT ALL — "agar tidak salah tanggal" —
 * and answered on the photo alone. The ticket itself was dated, and the reporter's −150 alpha for that
 * date was sitting in the database, readable, unread. An unreadable photo is a reason to lean HARDER
 * on the record, never a reason to skip it.
 */
const DATE_RULES = (filedDateKey: string) => [
  `- Tanggal acuan = ${filedDateKey} — tanggal tiket ini dibuat, waktu Jakarta. Mulai dari situ.`,
  `- Kalau pelapor menyebut tanggal lain secara eksplisit di teks tiketnya, pakai tanggal itu.`,
  `- Foto TIDAK PERNAH jadi sumber tanggal. Foto itu bukti pendukung, bukan penentu hari.`,
  `- "Tanggal di foto tidak terbaca" BUKAN alasan untuk tidak memanggil tool. Panggil catatannya pakai`,
  `  tanggal acuan dulu, baru nilai apakah fotonya mendukung.`,
]

/**
 * The remedy chooser. The order matters: cover first, outage second, wrong times third, and only then
 * "genuinely late". Read the other way round, every case looks like lateness — which is exactly the
 * failure this replaces.
 */
const REMEDY_STEPS = (complaintId: string) => [
  `1. Tentukan tanggal acuan (lihat "Aturan tanggal" di bawah).`,
  `2. Panggil nexus_get_attendance_day untuk tanggal itu. SELALU, tanpa kecuali. Sekali panggil kamu dapat:`,
  `   catatan absennya, jam shift orang ini di tanggal itu, apakah hari itu tercatat NEXUS down (plus berapa`,
  `   orang lain kena potongan di tanggal sama), pengajuan izin/cuti/sakit yang menutupi tanggal itu beserta`,
  `   statusnya, dan potongan XP yang benar-benar kena.`,
  `3. Pilih SATU penyelesaian dari hasil tool itu — bukan dari foto:`,
  `   a. coveredByRequest = true (ada izin/cuti/sakit yang menutupi hari itu, PENDING maupun APPROVED)`,
  `      → panggil nexus_propose_penalty_cancellation dengan complaintId "${complaintId}". JANGAN mengusulkan jam.`,
  `      Jamnya memang segitu; yang keliru adalah potongannya. Izin yang masih menunggu approval tetap dihitung.`,
  `   b. outage.recordedByNexus = true (hari NEXUS down penuh) ATAU outage.coversShiftStart = true (ada outage`,
  `      tercatat yang jendelanya menelan JAM MASUK orang ini — sebut jendelanya dari outage.window)`,
  `      → panggil nexus_propose_penalty_cancellation. Sama: jangan mengusulkan jam.`,
  `   c. outage.recordedByNexus = false TAPI bukti atau keluhannya menunjuk sistem yang error (Error 1033,`,
  `      tunnel, halaman tidak bisa dibuka, tombol check-in gagal, lokasi/kamera ditolak browser)`,
  `      → syaratnya BUKTI atau keluhan itu — KELUHAN TEKS SAJA SUDAH CUKUP untuk MENGUSULKAN. Kamu tidak`,
  `      memutuskan; BoD yang memutuskan, dan BoD lebih suka menolak usulan daripada tidak diberi apa-apa.`,
  `      Tulis di reason bahwa klaimnya belum terverifikasi. outage.sameDaySignal SENDIRIAN TIDAK PERNAH CUKUP:`,
  `      workspace ini memang menghukum belasan orang setiap hari, jadi angka "sekian dari sekian kena`,
  `      potongan" itu hari kerja biasa, bukan tanda gangguan. Pakai angka itu HANYA sebagai penguat, dan`,
  `      hanya kalau sameDaySignal.aboveNormal = true (sudah dibandingkan dengan normalPenalizedPerDay).`,
  `      Kalau aboveNormal = false, JANGAN menyebutnya sebagai bukti sama sekali.`,
  `      Yang JUSTRU bukti kuat: checkInPattern.unusuallyLateStart = true — artinya hari itu tidak ada`,
  `      seorang pun yang berhasil check-in sampai jauh lewat jam biasa (lihat firstCheckIn vs`,
  `      normalFirstCheckIn). Kalau itu true, sebut angkanya dan ajukan ke BoD sebagai dugaan hari down`,
  `      yang belum tercatat. Kalau false, itu TIDAK membantah gangguan sore/malam — sinyal itu cuma`,
  `      melihat pagi, jadi jangan dipakai untuk menyimpulkan "berarti tidak ada gangguan".`,

  `      → tetap panggil nexus_propose_penalty_cancellation, dan di reason sebutkan angkanya apa adanya`,
  `      ("X dari Y anggota kena potongan absen di tanggal itu"). Bilang terus terang bahwa tanggal ini BELUM`,
  `      tercatat sebagai hari down dan itu keputusan BoD, bukan keputusanmu.`,
  `   c2. shiftCheck.penaltyContradictsCurrentShift = true (menurut shift yang berlaku SEKARANG orang ini`,
  `      tidak telat; penalti dihitung dengan shift lama)`,
  `      → panggil nexus_propose_penalty_cancellation. JANGAN koreksi jam: jam yang tercatat memang jam dia absen,`,
  `      dan mengubahnya berarti memalsukan catatan untuk memperbaiki penalti yang bisa dibatalkan langsung.`,
  `   d. Catatan waktunya yang keliru — jam di catatan tidak cocok dengan kenyataan, atau check-in tidak`,
  `      pernah masuk padahal orangnya hadir`,
  `      → panggil nexus_propose_attendance_correction dengan complaintId "${complaintId}". Kalau kamu`,
  `      mengusulkan jam masuk, pakai shift.shiftStartTime dari tool. JANGAN jam yang tertera di foto error.`,
  `   e. Telat beneran: tidak ada izin yang menutupi, tidak ada tanda sistem down, catatannya sudah benar`,
  `      → JANGAN mengusulkan apa pun. Katakan apa adanya — lalu tutup sesuai "Aturan penutup".`,
  `4. Kalau xpPenalties.hasPenaltyToCancel = false, tidak ada potongan yang bisa dibatalkan. JANGAN`,
  `   mengusulkan pembatalan — tool-nya akan menolak. Bilang potongan hari itu SUDAH dikembalikan (tanpa`,
  `   angka: baris ledger-nya sudah dihapus, kamu memang tidak bisa melihatnya lagi). Kalau`,
  `   xpPenalties.alreadyWaived = true, sebutkan hari itu sudah bebas potongan permanen. LALU:`,
  `   4a. Kalau HARI ITU TIDAK PUNYA CATATAN ABSENSI (record kosong) padahal pelapor bilang dia hadir,`,
  `       di kantor, atau bekerja di luar (shooting, dinas, event) → panggil nexus_propose_attendance_correction`,
  `       dengan jam shift dari tool sebagai check-in (dan jam selesai shift sebagai check-out), supaya`,
  `       harinya TERCATAT HADIR — tanpa itu rekap bulanannya tetap membaca hari itu sebagai absen`,
  `       walaupun potongannya sudah kembali. Sebut terus terang bahwa ini mencatat kehadiran, bukan XP.`,
  `   4b. Kalau catatannya sudah ada dan tidak ada yang tersisa → panggil nexus_resolve_ticket dengan`,
  `       complaintId "${complaintId}", tanggalnya, dan satu kalimat penutup. Server memeriksa ulang bahwa`,
  `       memang tidak ada yang tersisa; kalau ditolak, jangan diulang — laporkan alasannya.`,
  `   "Yang tersisa cuma BoD menutup tiket ini" BUKAN penutup yang boleh kamu tulis lagi: kalau memang`,
  `   selesai, kamu yang menutupnya (4b); kalau belum, ada yang harus diusulkan (4a).`,
]

/** The lines that stop the two failures this whole change is about: proposing the screenshot's clock,
 *  and reading an empty outage register as proof that nothing broke. */
const REMEDY_RULES = [
  `- Kamu TIDAK mengubah absensi, TIDAK mengubah XP, TIDAK mengembalikan jatah day off. Semua yang kamu`,
  `  buat cuma USULAN yang menunggu BoD. Jangan pernah bilang "sudah saya perbaiki".`,
  `- Jam yang tertera di foto error itu jam orang tersebut MENYERAH mencoba, bukan jam dia seharusnya masuk.`,
  `  Jangan pernah mengusulkannya sebagai jam check-in. Kalau memang perlu jam, pakai jam shift dari tool.`,
  `- outage.recordedByNexus = false artinya BELUM TERCATAT, bukan TIDAK TERJADI. Daftar hari down diisi`,
  `  manual dan sering ketinggalan. Jangan pernah menyimpulkan "tidak ada gangguan" cuma dari field itu.`,
  `- Kamu tidak bisa menambahkan tanggal ke daftar hari NEXUS down. Ajukan ke BoD; jangan mengklaim sudah.`,
  `- Satu tiket cuma boleh punya satu usulan hidup. Kalau tool menolak karena sudah ada usulan yang menunggu,`,
  `  jangan diulang — laporkan apa adanya.`,
  `- Jangan menjanjikan berapa XP yang akan kembali. Kamu tidak menghitung XP.`,
  `- Jangan menyebut angka atau jam yang tidak kamu lihat sendiri, baik dari tool maupun dari foto.`,
  `- Absen di NEXUS wajib selfie. Jangan menyarankan cara absen yang melewati foto.`,
]

/**
 * The reporter's own device is a whole class of ticket, and it is the one class GIDEON can actually
 * FIX rather than adjudicate. A real answer ended "Tidak ada usulan koreksi yang dibuat" to someone
 * whose screenshot said, in English, that her browser had denied location access — a setting she could
 * have changed in under a minute if anyone had told her where it was.
 */
const CLIENT_FIX_HELP = [
  `Kalau masalahnya di perangkat pelapor — lokasi tidak terdeteksi, izin lokasi/kamera ditolak, halaman`,
  `tidak mau memuat — kasih langkah nyata, jangan cuma menilai:`,
  `- iOS Safari punya DUA lapis izin lokasi. Settings → Privacy & Security → Location Services (Safari`,
  `  harus hidup), LALU Settings → Safari → Location diset "Ask" atau "Allow". Kalau yang kedua masih`,
  `  "Deny", situsnya tidak akan pernah bisa minta izin, sebanyak apa pun dicoba ulang.`,
  `- Aplikasi NEXUS iOS pakai izin lokasi asli, jadi tidak kena batasan per-situs itu. Kalau lewat browser`,
  `  gagal berulang kali, arahkan ke aplikasinya.`,
  `- Chrome/Android: ikon gembok di address bar → Permissions → Location → Allow.`,
  `Dan tetap usulkan penyelesaian absennya. Izin browser yang menolak itu bukan salah pelapor, jadi`,
  `tiketnya tetap butuh koreksi atau pembatalan potongan — bukan cuma tips.`,
]

/** Nobody's ticket may end in a shrug. */
const CLOSING_RULES = [
  `Aturan penutup — balasanmu WAJIB berakhir dengan salah satu dari empat ini:`,
  `  (a) usulan koreksi absen yang sudah kamu buat,`,
  `  (b) usulan pembatalan potongan yang sudah kamu buat,`,
  `  (c) langkah perbaikan konkret yang bisa pelapor kerjakan sekarang, atau`,
  `  (d) eskalasi eksplisit ke BoD: sebut apa yang harus diputuskan dan atas dasar apa (angka, tanggal).`,
  `"Tidak ada usulan yang dibuat" saja BUKAN jawaban. Kalau kamu tidak mengusulkan apa pun, kamu wajib`,
  `memberi (c) atau (d) — dan biasanya keduanya.`,
]

/**
 * What changes between categories: the opening framing, the ordered steps, the hard rules, and what
 * the closing paragraph should contain. Everything else in the prompt is shared — the date rules, the
 * device-side fixes, and the four ways a reply may end.
 *
 * The DAY_OFF entry deliberately never names either propose tool as something to call — only as
 * something that will be refused. A prompt that pitches a tool the ticket cannot have is how you get a
 * model promising a fix it did not file.
 */
const FRAMING: Record<
  GideonTicketCategory,
  { opening: string; steps: (complaintId: string) => string[]; rules: string[]; closing: string[] }
> = {
  ATTENDANCE: {
    opening: [
      "Kamu menangani tiket absensi di NEXUS sebagai support.",
      "",
      "Kamu punya DUA penyelesaian, dan memilih yang salah sama saja dengan tidak menolong:",
      "  - koreksi absen  → dipakai kalau JAM yang tercatat memang salah.",
      "  - pembatalan potongan → dipakai kalau jamnya sudah benar tapi potongannya tidak adil: ada izin/cuti/",
      "    sakit yang menutupi hari itu, atau NEXUS-nya yang down sehingga orangnya tidak bisa absen.",
      "Mengusulkan jam untuk kasus jenis kedua tidak memperbaiki apa pun — potongannya tetap jalan.",
    ].join("\n"),
    steps: (complaintId) => REMEDY_STEPS(complaintId),
    rules: [
      ...REMEDY_RULES,
      `- Kalau catatan absennya ternyata sudah benar DAN tidak ada yang menutupi harinya, katakan begitu.`,
    ],
    closing: [
      `Balas ringkas dalam Bahasa Indonesia, maksimal 8 kalimat: apa kata catatan absensinya, apa yang kamu`,
      `lihat di bukti, dan penyelesaian mana yang kamu pilih beserta alasannya. Kalau kamu mengusulkan`,
      `sesuatu, sebutkan usulannya dan tegaskan absennya belum berubah sampai BoD menyetujui.`,
    ],
  },

  EXP: {
    opening: [
      "Kamu menangani tiket XP di NEXUS sebagai support.",
      "",
      "Hampir semua tiket XP sebetulnya masalah absensi: XP-nya kepotong KARENA hari itu. XP tidak diedit",
      "langsung dan kamu tidak punya cara mengubahnya. Ada DUA jalan memperbaikinya, dan keduanya lewat BoD:",
      "  - kalau catatan absennya yang salah → usulkan koreksi absen; potongannya dihitung ulang saat disetujui.",
      "  - kalau catatan absennya sudah benar tapi potongannya tidak adil (ada izin/cuti/sakit yang menutupi",
      "    hari itu, atau NEXUS-nya down) → usulkan PEMBATALAN POTONGAN. Jamnya tidak diubah sama sekali.",
      "",
      "Salah memilih di antara keduanya adalah kegagalan yang paling sering terjadi di sini: mengusulkan jam",
      "untuk hari yang sebenarnya tertutup izin cuma menghasilkan usulan yang tidak mengembalikan XP apa pun.",
    ].join("\n"),
    steps: (complaintId) => REMEDY_STEPS(complaintId),
    rules: [
      ...REMEDY_RULES,
      `- Kalau potongannya ternyata bukan dari absensi sama sekali, jangan mengusulkan apa pun — jelaskan`,
      `  apa yang kamu lihat dan eskalasikan ke BoD.`,
    ],
    closing: [
      `Balas ringkas dalam Bahasa Indonesia, maksimal 8 kalimat: apa kata catatan absensinya, apakah potongan`,
      `XP-nya berasal dari situ, dan penyelesaian mana yang kamu pilih. Kalau kamu mengusulkan sesuatu,`,
      `sebutkan usulannya dan sebutkan bahwa XP-nya baru bergerak setelah BoD menyetujui.`,
    ],
  },

  DAY_OFF: {
    opening: [
      "Kamu menangani tiket day off di NEXUS sebagai support.",
      "",
      "Hampir semua jatah day off yang 'kepotong' adalah POTONGAN OTOMATIS cron malam: tidak check-in (alpha)",
      "atau telat >120 menit. Potongan itu adalah penalti absensi — dan pembatalan potongan absensi",
      "MENGEMBALIKAN jatah day off itu bersama XP-nya saat BoD menyetujui. Jadi di tiket ini kamu punya SATU",
      "penyelesaian: nexus_propose_penalty_cancellation, dan HANYA kalau tool menunjukkan ada potongan",
      "otomatis (xpPenalties.autoDayOffs > 0 atau hasPenaltyToCancel = true) DAN alasannya sah: ada izin/cuti/",
      "sakit yang menutupi hari itu (termasuk yang dibatalkan lalu ternyata sakit, kalau ada bukti), atau",
      "NEXUS down (outage.recordedByNexus atau outage.coversShiftStart), atau bukti kuat orangnya memang",
      "berhalangan sah. Day off yang orangnya AJUKAN SENDIRI lalu disetujui bukan potongan — tidak ada yang",
      "bisa dibatalkan, dan tool akan menolak.",
    ].join("\n"),
    steps: (complaintId) => [
      `1. Tentukan tanggal acuan (lihat "Aturan tanggal" di bawah) dan apa persisnya yang kepotong.`,
      `2. Panggil nexus_get_attendance_day untuk tanggal itu. SELALU. Lihat xpPenalties (autoDayOffs,`,
      `   hasPenaltyToCancel), coveringRequests (termasuk yang CANCELED — sebutkan), outage, dan buktinya.`,
      `3. Kalau autoDayOffs > 0 atau hasPenaltyToCancel = true, DAN ada alasan sah (izin/sakit dengan bukti,`,
      `   outage yang menelan jam masuk, atau orangnya hadir tapi tidak tercatat) → panggil`,
      `   nexus_propose_penalty_cancellation dengan complaintId "${complaintId}". Di reason, sebut buktinya`,
      `   dan tegaskan bahwa yang dikembalikan adalah jatah day off + XP hari itu, jam absen tidak diubah.`,
      `4. Kalau tidak ada potongan otomatis (day off-nya diajukan sendiri), atau tidak ada alasan sah →`,
      `   JANGAN mengusulkan. Jelaskan duduk perkaranya dan eskalasi ke BoD dengan satu pertanyaan.`,
      `5. Kalau potongannya SUDAH dikembalikan (autoDayOffs = 0 dan hasPenaltyToCancel = false): bilang begitu,`,
      `   lalu — kalau hari itu tidak punya catatan absensi padahal orangnya bekerja (di kantor / di luar) →`,
      `   nexus_propose_attendance_correction dengan jam shift supaya harinya tercatat hadir; kalau catatannya`,
      `   sudah ada → nexus_resolve_ticket dengan complaintId "${complaintId}". Jangan menyerahkan penutupan ke BoD.`,
    ],
    rules: [
      ...REMEDY_RULES,
      `- JANGAN memanggil nexus_propose_attendance_correction di tiket ini — koreksi JAM tidak berlaku untuk`,
      `  jatah day off. Yang berlaku hanya pembatalan potongan.`,
      `- Pembatalan potongan mengembalikan jatah day off HANYA untuk potongan otomatis. Kalau tool menolak`,
      `  karena tidak ada yang bisa dibatalkan, laporkan apa adanya — jangan bilang "sudah saya ajukan".`,
    ],
    closing: [
      `Balas ringkas dalam Bahasa Indonesia, maksimal 8 kalimat: apa kata catatan absensinya, apa yang kamu`,
      `pahami dari keluhannya, dan penyelesaianmu. Kalau kamu mengusulkan pembatalan, sebutkan bahwa jatah`,
      `day off dan XP-nya baru kembali setelah BoD menyetujui.`,
    ],
  },
}

function buildPrompt(input: {
  complaintId: string
  category: GideonTicketCategory
  reporterName: string
  subject: string
  body: string
  filedAt: Date
  /** The Jakarta calendar day the ticket was filed — the default day under discussion, and the one
   *  fact that stops an unreadable photo from taking the whole investigation down with it. */
  filedDateKey: string
  hasImage: boolean
  /** Everything said after the opening message, oldest first. Empty on the first pass. */
  history: { who: string; text: string }[]
}): string {
  const filed = input.filedAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
  const framing = FRAMING[input.category]
  const conversation = input.history.length
    ? [
        ``,
        `Percakapan sejauh ini:`,
        ...input.history.map((h) => `  ${h.who}: ${h.text}`),
        ``,
        `Pesan terakhir belum kamu jawab. Jawab itu — jangan mengulang analisis yang sudah kamu tulis`,
        `sebelumnya kecuali ada informasi baru yang mengubahnya.`,
      ].join("\n")
    : ""
  return [
    `${framing.opening} Tiket ini dibuka oleh ${input.reporterName} pada ${filed}.`,
    ``,
    `ID tiket: ${input.complaintId}`,
    `Judul: ${input.subject}`,
    `Isi: ${input.body}`,
    `Tanggal acuan: ${input.filedDateKey} (Asia/Jakarta) — tanggal tiket ini dibuat.`,
    input.hasImage
      ? `Ada foto bukti terlampir. Baca apa yang terlihat di dalamnya, tapi jangan ambil tanggalnya dari situ.`
      : `Tidak ada foto bukti yang bisa dibaca. Itu tidak mengubah apa pun: catatannya tetap kamu panggil.`,
    ``,
    `Yang harus kamu lakukan, berurutan:`,
    ...framing.steps(input.complaintId),
    ``,
    `Aturan tanggal:`,
    ...DATE_RULES(input.filedDateKey),
    ``,
    `Aturan yang tidak boleh dilanggar:`,
    ...framing.rules,
    ``,
    ...CLIENT_FIX_HELP,
    ``,
    conversation,
    ...CLOSING_RULES,
    ``,
    ...framing.closing,
  ].join("\n")
}

/**
 * Fire-and-forget from the create route. Never throws into the caller: a ticket that was filed
 * successfully must not report failure because an assistant could not read the photo.
 */
/**
 * `force` exists for ONE job: re-reviewing tickets GIDEON already answered badly.
 *
 * The two self-answer guards below are right for every automatic trigger — without them GIDEON
 * replies to its own reply forever. But they also mean a ticket whose last message is GIDEON's can
 * never be reconsidered, and after the remedy rules changed there were 13 such tickets carrying
 * answers written by the old, wrong prompt. Only a human-triggered sweep passes force; nothing on the
 * automatic paths (ticket created, new message) does, and nothing should.
 */
export async function reviewSupportTicket(complaintId: string, opts?: { force?: boolean }): Promise<void> {
  const url = process.env.GIDEON_CHAT_URL
  const secret = process.env.ORACLE_LLM_SECRET || ""
  if (!url) return

  try {
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      select: {
        id: true, subject: true, category: true, evidenceUrl: true, createdAt: true,
        reporter: { select: { id: true, name: true, email: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          take: 12,
          select: { body: true, authorId: true, fromReviewer: true, createdAt: true, author: { select: { name: true, email: true } } },
        },
      },
    })
    if (!complaint || !isGideonTicketCategory(complaint.category)) return
    const category: GideonTicketCategory = complaint.category

    const thread = complaint.messages
    const last = thread[thread.length - 1]
    // Never answer itself. Two guards rather than one because they fail differently: the first stops
    // a loop where GIDEON's own message would prompt another, the second stops a burst where several
    // replies land while it is still thinking about the first.
    if (!opts?.force) {
      if (last && (last.author as { email?: string } | null)?.email === GIDEON_EMAIL) return
      const lastGideon = [...thread].reverse().find((m) => (m.author as { email?: string } | null)?.email === GIDEON_EMAIL)
      if (lastGideon && Date.now() - lastGideon.createdAt.getTime() < 60_000) return
    }

    const imageBase64 = await loadEvidence(complaint.evidenceUrl)
    const prompt = buildPrompt({
      complaintId: complaint.id,
      category,
      reporterName: complaint.reporter?.name || "seorang anggota",
      subject: complaint.subject,
      body: thread[0]?.body || "",
      filedAt: complaint.createdAt,
      // The Jakarta day, not the UTC one: a ticket filed at 01:30 WIB is still that day's ticket, and
      // toISOString() would hand the model yesterday.
      filedDateKey: formatAttendanceDateKey(complaint.createdAt),
      hasImage: Boolean(imageBase64),
      history: thread.slice(1).map((m) => ({
        who: (m.author as { email?: string } | null)?.email === GIDEON_EMAIL
          ? "GIDEON"
          : m.fromReviewer
            ? "BoD"
            : (m.author?.name ?? "Pelapor"),
        text: m.body.slice(0, 500),
      })),
    })

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-oracle-secret": secret },
      body: JSON.stringify({
        prompt,
        // Luna, deliberately, and not the local tier: Experimental has been measured returning a
        // wrong count for a table it could query. Somebody's attendance is not where that belongs.
        model: "luna",
        user: complaint.reporter?.name || "",
        // As the reporter — GIDEON must not see further than the person who filed the ticket.
        actorEmail: complaint.reporter?.email || complaint.reporter?.id || "",
        ...(imageBase64 ? { imageBase64, imageType: "jpg" } : {}),
      }),
      signal: AbortSignal.timeout(280000),
    })
    if (!res.ok) {
      console.error("gideon-ticket: shim refused", { complaintId, status: res.status })
      return
    }
    const reply = ((await res.json()) as { reply?: string }).reply?.trim()
    if (!reply) {
      // Balasan kosong dari shim hampir selalu berarti agen di baliknya gagal (login provider
      // kedaluwarsa, OOM, dsb.) — bukan "tidak ada yang perlu dijawab". Diam di sini pernah berarti
      // GIDEON mati berhari-hari tanpa satu baris pun yang menyebutnya. Kalimatnya sengaja mudah
      // di-grep: "gideon-ticket: balasan kosong".
      console.error("gideon-ticket: balasan kosong dari shim — agen Hermes kemungkinan gagal (cek journal gideon-shim di VM agents)", { complaintId, category })
      return
    }

    // Posted under GIDEON's own name, on the reviewer side of the thread — it is answering the
    // reporter, not speaking as them.
    const gideonId = await getGideonUserId()
    await prisma.$transaction(async (tx) => {
      await tx.complaintMessage.create({
        data: {
          complaintId,
          authorId: gideonId,
          fromReviewer: true,
          body: reply.slice(0, BODY_MAX),
        },
      })
      await tx.complaint.update({ where: { id: complaintId }, data: { lastMessageAt: new Date() } })
      // Say on the ticket that it has been answered, WITHOUT pretending a director picked it up.
      // AWAITING_DECISION keeps the ticket in the BoD inbox (COMPLAINT_INBOX_STATUSES) and only adds
      // "there is something here to decide". IN_REVIEW would take it out of the queue and claim a
      // human is on it — that is the one transition this module must never make.
      //
      // Guarded in the WHERE rather than by a status read before the model was called: this lands up
      // to 280 seconds after the ticket was looked at, and a director may have taken it on in the
      // meantime. If so it stays theirs, and GIDEON just adds a message.
      const bumped = await tx.complaint.updateMany({
        where: { id: complaintId, status: "OPEN" },
        data: { status: "AWAITING_DECISION" },
      })
      if (bumped.count > 0) {
        await tx.complaintEvent.create({
          data: { complaintId, action: "status", fromStatus: "OPEN", toStatus: "AWAITING_DECISION", actorId: gideonId },
        })
      }
    })
  } catch (error) {
    console.error("gideon-ticket: review failed", { complaintId, error })
  }
}

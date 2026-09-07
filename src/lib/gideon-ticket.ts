import path from "path"
import { readFile } from "fs/promises"
import sharp from "sharp"
import prisma from "@/lib/prisma"
import { getGideonUserId, GIDEON_EMAIL } from "@/lib/gideon-identity"

/**
 * GIDEON's first pass over a support ticket it is allowed to touch.
 *
 * It reads what was filed, looks at the photo, checks the day against the attendance record, and
 * either proposes a correction or explains why it cannot. It never applies one: the proposal lands
 * on the ticket and a BoD decides. That boundary is the whole design, not a caution — see
 * propose_attendance_correction, which has no counterpart that writes an AttendanceRecord.
 *
 * Three categories reach it, and they are NOT the same job:
 *   ATTENDANCE — read the evidence, may propose a correction.
 *   EXP        — the XP deduction is downstream of a wrong attendance record, so the fix is the
 *                record; may propose a correction against the same day.
 *   DAY_OFF    — triage and answer only. GIDEON must never touch what the person themselves cannot
 *                change, and a day-off quota is exactly that: restoring one needs its own
 *                propose→approve flow, which does not exist. The prompt says so and
 *                proposeAttendanceCorrection refuses the category outright, so a model that tries
 *                anyway gets an error instead of a proposal.
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
 * What changes between categories: the opening framing, the ordered steps, the hard rules, and what
 * the closing paragraph should contain. Everything else in the prompt is shared.
 *
 * The DAY_OFF entry deliberately never names propose_attendance_correction as something to call —
 * only as something that will be refused. A prompt that pitches a tool the ticket cannot have is how
 * you get a model promising a fix it did not file.
 */
const FRAMING: Record<
  GideonTicketCategory,
  { opening: string; steps: (complaintId: string) => string[]; rules: string[]; closing: string[] }
> = {
  ATTENDANCE: {
    opening: "Kamu menangani tiket absensi di NEXUS sebagai support.",
    steps: (complaintId) => [
      `1. Tentukan tanggal yang dipermasalahkan.`,
      `2. Panggil tool NEXUS untuk melihat catatan absensi orang ini pada tanggal itu. Jangan menebak isinya.`,
      `3. Bandingkan dengan buktinya.`,
      `4. Kalau — dan hanya kalau — buktinya benar-benar mendukung, panggil propose_attendance_correction`,
      `   dengan complaintId "${complaintId}", tanggalnya, jam yang diusulkan, dan alasan singkat.`,
    ],
    rules: [
      `- Kamu TIDAK mengubah absensi. Kamu mengusulkan; BoD yang menyetujui.`,
      `- Kalau tanggal atau jam di foto tidak terbaca jelas, katakan begitu dan JANGAN mengusulkan apa pun.`,
      `- Jangan menyebut angka atau jam yang tidak kamu lihat sendiri, baik di foto maupun dari tool.`,
      `- Kalau catatan absensinya ternyata sudah benar, katakan begitu.`,
    ],
    closing: [
      `Balas ringkas dalam Bahasa Indonesia, maksimal 6 kalimat: apa yang kamu lihat di bukti, apa kata`,
      `catatan absensinya, dan kesimpulanmu. Kalau kamu mengusulkan koreksi, sebutkan usulannya.`,
    ],
  },

  EXP: {
    opening: [
      "Kamu menangani tiket XP di NEXUS sebagai support.",
      "",
      "Hampir semua tiket XP sebetulnya masalah absensi: XP-nya kepotong KARENA catatan absen hari itu",
      "salah — telat yang bukan telat, check-in yang tidak masuk, check-out yang gagal. XP tidak diedit",
      "langsung dan kamu tidak punya cara mengubahnya. Jalan memperbaiki XP-nya adalah memperbaiki",
      "catatan absen yang jadi sebabnya; potongannya dihitung ulang saat BoD menyetujui koreksi itu.",
    ].join("\n"),
    steps: (complaintId) => [
      `1. Tentukan tanggal yang XP-nya kepotong.`,
      `2. Panggil tool NEXUS untuk melihat catatan absensi orang ini pada tanggal itu. Jangan menebak isinya.`,
      `3. Bandingkan dengan buktinya, dan putuskan apakah potongan XP-nya berasal dari catatan absen yang salah.`,
      `4. Kalau — dan hanya kalau — buktinya benar-benar mendukung bahwa catatan absennya salah, panggil`,
      `   propose_attendance_correction dengan complaintId "${complaintId}", tanggalnya, jam yang diusulkan,`,
      `   dan alasan singkat. Tiket XP ini memang boleh dipakai untuk usulan koreksi absen.`,
      `5. Kalau potongannya ternyata bukan dari absensi, jangan mengusulkan apa pun — jelaskan apa yang kamu`,
      `   lihat dan serahkan ke BoD.`,
    ],
    rules: [
      `- Kamu TIDAK mengubah absensi dan TIDAK mengubah XP. Kamu mengusulkan koreksi absen; BoD yang menyetujui.`,
      `- Jangan menjanjikan berapa XP yang akan kembali. Kamu tidak menghitung XP.`,
      `- Kalau tanggal atau jam di foto tidak terbaca jelas, katakan begitu dan JANGAN mengusulkan apa pun.`,
      `- Jangan menyebut angka atau jam yang tidak kamu lihat sendiri, baik di foto maupun dari tool.`,
      `- Kalau catatan absensinya ternyata sudah benar, katakan begitu — berarti potongannya bukan dari situ.`,
    ],
    closing: [
      `Balas ringkas dalam Bahasa Indonesia, maksimal 6 kalimat: apa yang kamu lihat di bukti, apa kata`,
      `catatan absensinya, dan apakah potongan XP-nya berasal dari catatan itu. Kalau kamu mengusulkan`,
      `koreksi absen, sebutkan usulannya dan sebutkan bahwa XP-nya menyusul setelah koreksinya disetujui.`,
    ],
  },

  DAY_OFF: {
    opening: [
      "Kamu menangani tiket day off di NEXUS sebagai support.",
      "",
      "Di tiket ini kamu HANYA menjawab. Kamu tidak punya cara apa pun untuk mengubah atau mengembalikan",
      "jatah day off, dan tidak ada usulan yang bisa kamu ajukan untuk itu. Yang bisa kamu lakukan adalah",
      "membuat duduk perkaranya jelas supaya BoD bisa memutuskan cepat.",
    ].join("\n"),
    steps: () => [
      `1. Tentukan tanggal yang dipermasalahkan dan apa persisnya yang kepotong atau ditolak.`,
      `2. Kalau keluhannya menyangkut kehadiran di tanggal itu, kamu boleh memanggil tool NEXUS untuk melihat`,
      `   catatan absensi orang ini pada tanggal itu supaya ceritanya lengkap. Jangan menebak isinya.`,
      `3. Rangkum: apa kata bukti, apa kata catatan absennya kalau kamu lihat, dan bagian mana yang masih kurang.`,
      `4. Kalau ada satu hal yang paling menentukan dan belum jelas, tanyakan itu — satu pertanyaan, bukan daftar.`,
    ],
    rules: [
      `- JANGAN memanggil propose_attendance_correction di tiket ini. Usulan koreksi cuma berlaku untuk catatan`,
      `  absensi, bukan jatah day off, dan panggilanmu akan ditolak.`,
      `- Kamu TIDAK bisa mengembalikan jatah day off. Jangan menjanjikannya, jangan bilang "sudah saya ajukan".`,
      `- Yang bisa mengembalikan jatah day off cuma BoD, dan manual. Katakan itu apa adanya.`,
      `- Jangan menyebut angka atau tanggal yang tidak kamu lihat sendiri, baik di foto maupun dari tool.`,
    ],
    closing: [
      `Balas ringkas dalam Bahasa Indonesia, maksimal 6 kalimat: apa yang kamu lihat di bukti, apa yang kamu`,
      `pahami dari keluhannya, dan apa yang perlu diputuskan BoD. Jangan menjanjikan apa pun yang bukan kamu`,
      `yang mengerjakannya.`,
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
    input.hasImage ? `Ada foto bukti terlampir. Baca tanggal dan jam yang terlihat di dalamnya.` : `Tidak ada foto bukti yang bisa dibaca.`,
    ``,
    `Yang harus kamu lakukan, berurutan:`,
    ...framing.steps(input.complaintId),
    ``,
    `Aturan yang tidak boleh dilanggar:`,
    ...framing.rules,
    ``,
    conversation,
    ...framing.closing,
  ].join("\n")
}

/**
 * Fire-and-forget from the create route. Never throws into the caller: a ticket that was filed
 * successfully must not report failure because an assistant could not read the photo.
 */
export async function reviewSupportTicket(complaintId: string): Promise<void> {
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
    if (last && (last.author as { email?: string } | null)?.email === GIDEON_EMAIL) return
    const lastGideon = [...thread].reverse().find((m) => (m.author as { email?: string } | null)?.email === GIDEON_EMAIL)
    if (lastGideon && Date.now() - lastGideon.createdAt.getTime() < 60_000) return

    const imageBase64 = await loadEvidence(complaint.evidenceUrl)
    const prompt = buildPrompt({
      complaintId: complaint.id,
      category,
      reporterName: complaint.reporter?.name || "seorang anggota",
      subject: complaint.subject,
      body: thread[0]?.body || "",
      filedAt: complaint.createdAt,
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
    if (!reply) return

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

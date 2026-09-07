import path from "path"
import { readFile } from "fs/promises"
import sharp from "sharp"
import prisma from "@/lib/prisma"
import { getGideonUserId } from "@/lib/gideon-identity"

/**
 * GIDEON's first pass over an attendance ticket.
 *
 * It reads what was filed, looks at the photo, checks the day against the attendance record, and
 * either proposes a correction or explains why it cannot. It never applies one: the proposal lands
 * on the ticket and a BoD decides. That boundary is the whole design, not a caution — see
 * propose_attendance_correction, which has no counterpart that writes an AttendanceRecord.
 *
 * Runs as the REPORTER, so GIDEON sees exactly what they see and nothing else.
 */

const BODY_MAX = 4000

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

function buildPrompt(input: {
  complaintId: string
  reporterName: string
  subject: string
  body: string
  filedAt: Date
  hasImage: boolean
}): string {
  const filed = input.filedAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
  return [
    `Kamu menangani tiket absensi di NEXUS sebagai support. Tiket ini dibuka oleh ${input.reporterName} pada ${filed}.`,
    ``,
    `ID tiket: ${input.complaintId}`,
    `Judul: ${input.subject}`,
    `Isi: ${input.body}`,
    input.hasImage ? `Ada foto bukti terlampir. Baca tanggal dan jam yang terlihat di dalamnya.` : `Tidak ada foto bukti yang bisa dibaca.`,
    ``,
    `Yang harus kamu lakukan, berurutan:`,
    `1. Tentukan tanggal yang dipermasalahkan.`,
    `2. Panggil tool NEXUS untuk melihat catatan absensi orang ini pada tanggal itu. Jangan menebak isinya.`,
    `3. Bandingkan dengan buktinya.`,
    `4. Kalau — dan hanya kalau — buktinya benar-benar mendukung, panggil propose_attendance_correction`,
    `   dengan complaintId "${input.complaintId}", tanggalnya, jam yang diusulkan, dan alasan singkat.`,
    ``,
    `Aturan yang tidak boleh dilanggar:`,
    `- Kamu TIDAK mengubah absensi. Kamu mengusulkan; BoD yang menyetujui.`,
    `- Kalau tanggal atau jam di foto tidak terbaca jelas, katakan begitu dan JANGAN mengusulkan apa pun.`,
    `- Jangan menyebut angka atau jam yang tidak kamu lihat sendiri, baik di foto maupun dari tool.`,
    `- Kalau catatan absensinya ternyata sudah benar, katakan begitu.`,
    ``,
    `Balas ringkas dalam Bahasa Indonesia, maksimal 6 kalimat: apa yang kamu lihat di bukti, apa kata`,
    `catatan absensinya, dan kesimpulanmu. Kalau kamu mengusulkan koreksi, sebutkan usulannya.`,
  ].join("\n")
}

/**
 * Fire-and-forget from the create route. Never throws into the caller: a ticket that was filed
 * successfully must not report failure because an assistant could not read the photo.
 */
export async function reviewAttendanceTicket(complaintId: string): Promise<void> {
  const url = process.env.GIDEON_CHAT_URL
  const secret = process.env.ORACLE_LLM_SECRET || ""
  if (!url) return

  try {
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      select: {
        id: true, subject: true, category: true, evidenceUrl: true, createdAt: true,
        reporter: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: "asc" }, take: 1, select: { body: true } },
      },
    })
    if (!complaint || complaint.category !== "ATTENDANCE") return

    const imageBase64 = await loadEvidence(complaint.evidenceUrl)
    const prompt = buildPrompt({
      complaintId: complaint.id,
      reporterName: complaint.reporter?.name || "seorang anggota",
      subject: complaint.subject,
      body: complaint.messages[0]?.body || "",
      filedAt: complaint.createdAt,
      hasImage: Boolean(imageBase64),
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
    await prisma.$transaction(async (tx) => {
      await tx.complaintMessage.create({
        data: {
          complaintId,
          authorId: await getGideonUserId(),
          fromReviewer: true,
          body: reply.slice(0, BODY_MAX),
        },
      })
      await tx.complaint.update({ where: { id: complaintId }, data: { lastMessageAt: new Date() } })
    })
  } catch (error) {
    console.error("gideon-ticket: review failed", { complaintId, error })
  }
}

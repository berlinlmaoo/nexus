import prisma from "@/lib/prisma"

/**
 * Siapa yang menyetujui request absensi siapa — Bagan Approval.
 *
 * Rantai bebas, tanpa fallback ke tim. Berlin: "willy approve anak-anaknya, willy ke gerro,
 * gerro ke riri" — jadi tepinya tidak terikat peran:
 *
 *   siapa pun dengan approverId  → approver-nya saja, apa pun peran keduanya
 *   siapa pun tanpa approverId   → semua BoD/OAA (dikurangi dirinya) — jaring pengaman
 *
 * Yang menjaga rantai tetap waras ada di PATCH /api/workspaces/members: tidak boleh diri sendiri,
 * dan tidak boleh membentuk lingkaran. BoD tetap bisa mereview apa pun sebagai override.
 *
 * Logika ini pernah disalin di lima tempat (izin review, daftar pending, notifikasi in-app,
 * offsite checkout, WhatsApp) dan sudah saling berbeda — offsite checkout tidak pernah memberi
 * tahu manager sama sekali. Kalau kamu menulis `role: { in: ["BOD", "ONE_ABOVE_ALL"] }` di luar
 * berkas ini untuk urusan approval, berhenti dan panggil fungsi di sini.
 *
 * Lead tim SENGAJA tidak ada di sini. Ia dihapus bersama Bagan Approval.
 */

export type ApproverResolution = {
  /** Yang dinotifikasi dan boleh menyetujui. Pemohon sendiri tidak pernah ada di sini. */
  userIds: string[]
  /** DIRECT_MANAGER = satu orang dari bagan; BOD_GROUP = kelompok BoD. */
  mode: "DIRECT_MANAGER" | "BOD_GROUP"
}

async function bodGroup(workspaceId: string, exceptUserId: string): Promise<string[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: { in: ["BOD", "ONE_ABOVE_ALL"] }, userId: { not: exceptUserId } },
    select: { userId: true },
  })
  return rows.map((r) => r.userId)
}

export async function resolveAttendanceApprovers(requesterUserId: string, workspaceId: string): Promise<ApproverResolution> {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: requesterUserId, workspaceId } },
    select: { role: true, approverId: true },
  })
  if (member?.approverId && member.approverId !== requesterUserId) {
    return { userIds: [member.approverId], mode: "DIRECT_MANAGER" }
  }
  return { userIds: await bodGroup(workspaceId, requesterUserId), mode: "BOD_GROUP" }
}

export type ReviewVerdict =
  | { ok: true; source: "DIRECT_MANAGER" | "ADMIN" }
  | { ok: false }

/**
 * Bolehkah `viewerId` mereview request milik `requesterUserId`?
 *
 * BoD/OAA (`canManageAttendance`) boleh mereview APA PUN — termasuk request staff yang sudah punya
 * manager. Itu override yang disengaja: manager cuti tidak boleh jadi jalan buntu. Sumbernya
 * dicatat `ADMIN` supaya di riwayat kelihatan itu override, bukan jalur biasa.
 *
 * Four-eyes (tidak boleh mereview request sendiri) TIDAK dicek di sini — pemanggilnya sudah
 * melakukannya lebih dulu dengan pesan yang lebih spesifik, dan letaknya harus sesudah cabang
 * `cancel` (menarik request sendiri itu sah).
 */
export async function canUserReviewRequest(
  viewerId: string,
  requesterUserId: string,
  workspaceId: string,
  ctx: { canManageAttendance: boolean },
): Promise<ReviewVerdict> {
  if (ctx.canManageAttendance) return { ok: true, source: "ADMIN" }
  const r = await resolveAttendanceApprovers(requesterUserId, workspaceId)
  if (r.mode === "DIRECT_MANAGER" && r.userIds.includes(viewerId)) return { ok: true, source: "DIRECT_MANAGER" }
  return { ok: false }
}

/** userId semua orang yang approver-nya `userId` — untuk scope daftar request & riwayat. */
export async function directReportIdsOf(userId: string, workspaceId: string): Promise<string[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId, approverId: userId },
    select: { userId: true },
  })
  return rows.map((r) => r.userId)
}

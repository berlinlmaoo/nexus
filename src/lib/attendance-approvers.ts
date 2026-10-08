import prisma from "@/lib/prisma"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { formerMembersOf, isExemptRole } from "@/lib/former-recaps"

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

/** Who decides for someone with nobody above them: One Above All only (owner, 30 Sep 2026 —
 *  was every BoD). The name stays: `mode: "BOD_GROUP"` is part of what clients already read. */
async function bodGroup(workspaceId: string, exceptUserId: string): Promise<string[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: "ONE_ABOVE_ALL", userId: { not: exceptUserId } },
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
  ctx: { canManageAttendance: boolean; approvalScopeUserIds?: string[] | null },
): Promise<ReviewVerdict> {
  const r = await resolveAttendanceApprovers(requesterUserId, workspaceId)
  const direct = r.mode === "DIRECT_MANAGER" && r.userIds.includes(viewerId)
  // Owner, 30 Sep 2026: One Above All decides anything; a BoD anything in their own tree (their
  // approvalScopeUserIds); everyone else only the people directly under them.
  if (ctx.approvalScopeUserIds === undefined) {
    if (ctx.canManageAttendance) return { ok: true, source: direct ? "DIRECT_MANAGER" : "ADMIN" }
  } else if (ctx.approvalScopeUserIds === null) {
    return { ok: true, source: direct ? "DIRECT_MANAGER" : "ADMIN" }
  } else if (ctx.approvalScopeUserIds.includes(requesterUserId)) {
    return { ok: true, source: direct ? "DIRECT_MANAGER" : "ADMIN" }
  }
  if (direct) return { ok: true, source: "DIRECT_MANAGER" }
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

export type ReportScope = {
  viewerId: string
  /** The viewer's primary workspace (oldest joinedAt — same rule as getAttendanceWorkspaceContext). */
  workspaceId: string | null
  /**
   * ALL            — system ADMIN / BoD / One Above All: everyone in the workspace.
   * DIRECT_REPORTS — anyone with people under them in the Bagan Approval: those people, ONE level
   *                  (WorkspaceMember.approverId), never their reports' reports. Owner's decision.
   * SELF           — everyone else: only themselves. No peers, no rank, no team median.
   */
  mode: "ALL" | "DIRECT_REPORTS" | "SELF"
  /** Every userId whose report the viewer may open. Always includes the viewer. */
  userIds: string[]
  /** The viewer's direct reports (empty unless mode is DIRECT_REPORTS), former ones included. */
  directReportIds: string[]
  /** BoD / One Above All of the workspace — left out of workspace-wide lists by default, as on the
   *  attendance board and the leaderboard (they are exempt from attendance). Former ones included. */
  exemptUserIds: string[]
  /**
   * The people in `userIds` who LEFT the workspace (offboarding, 8 Oct 2026) → their last working day.
   * They stay in scope so the periods they were part of can still be opened; a list of a period drops
   * those who left before it began.
   */
  formerLeftAt: Map<string, Date>
}

/**
 * Whose Reports-per-crew figures may `viewerId` see? The ONLY place that answers this. A userId
 * outside `userIds` is a 403, and client-supplied member lists are never trusted — they can only be
 * narrowed against this set.
 */
export async function reportableUserIds(viewerId: string): Promise<ReportScope> {
  const context = await getAttendanceWorkspaceContext(viewerId)
  const workspaceId = context.workspace?.id ?? null
  const base = { viewerId, workspaceId, directReportIds: [] as string[], exemptUserIds: [] as string[], formerLeftAt: new Map<string, Date>() }
  if (!workspaceId) return { ...base, mode: "SELF", userIds: [viewerId] }

  // People who left keep their past: BoD sees every former member, a manager those whose approver they
  // were when they left (FormerMember.approverId). Approval itself never reads this — it is history only.
  if (context.canManageAttendance) {
    const [members, formers] = await Promise.all([
      prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true } }),
      formerMembersOf(workspaceId),
    ])
    return {
      ...base,
      mode: "ALL",
      userIds: [...new Set([viewerId, ...members.map((m) => m.userId), ...formers.map((f) => f.userId)])],
      exemptUserIds: [...members, ...formers].filter((m) => isExemptRole(m.role)).map((m) => m.userId),
      formerLeftAt: new Map(formers.map((f) => [f.userId, f.leftAt])),
    }
  }

  const formerDirect = (await formerMembersOf(workspaceId, { approverId: viewerId })).filter((f) => f.userId !== viewerId)
  const direct = [...new Set([...context.directReportIds, ...formerDirect.map((f) => f.userId)])].filter((id) => id !== viewerId)
  if (direct.length > 0) {
    return {
      ...base,
      mode: "DIRECT_REPORTS",
      userIds: [viewerId, ...direct],
      directReportIds: direct,
      formerLeftAt: new Map(formerDirect.map((f) => [f.userId, f.leftAt])),
    }
  }
  return { ...base, mode: "SELF", userIds: [viewerId] }
}

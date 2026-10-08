import { Prisma } from "@/generated/prisma/client"
import type { WorkspaceRole } from "@/generated/prisma/client"
import { formatAttendanceDateKey } from "@/lib/attendance"
import { asMemberAsOf } from "@/lib/former-members"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { WORKSPACE_HIERARCHY } from "@/lib/rbac"

/**
 * Offboarding (owner, 8 Oct 2026): someone resigned, their contract ended, or they were let go.
 *
 * It is exactly "remove member" — the WorkspaceMember rows are DELETED, so every operational list,
 * cron, picker and approver lookup skips them with no change anywhere — plus three things:
 *  - a FormerMember row per workspace, keeping what the member row said and `leftAt` (the last
 *    working day, 00:00 UTC of that Jakarta date, like AttendanceRecord.attendanceDate), so recaps of
 *    periods they were still part of can include them (lib/former-members.ts);
 *  - User.deactivatedAt: the account can no longer sign in anywhere (lib/auth.ts, credentials-auth,
 *    passkeys, socket, MCP, GIDEON, WhatsApp) and gets no notifications;
 *  - every way back in is removed (the same list as POST /api/user/account/delete).
 *
 * NOTHING of theirs is deleted: attendance records, requests, corrections, XP, tasks they created or are
 * assigned to (open tasks stay assigned to them, owner's decision), projects, comments, messages.
 *
 * Both functions take the transaction client and do all their reads and writes through it, so the
 * guards and the writes are one atomic step, and the whole thing can be run against a copy of the
 * database: `prisma.$transaction((tx) => offboardUser(input, tx), { timeout: 30000 })`.
 */

export const OFFBOARD_REASONS = ["RESIGNED", "CONTRACT_ENDED", "DISMISSED", "OTHER"] as const
export type OffboardReason = (typeof OFFBOARD_REASONS)[number]

export function isOffboardReason(value: unknown): value is OffboardReason {
  return typeof value === "string" && (OFFBOARD_REASONS as readonly string[]).includes(value)
}

export type OffboardRefusalCode =
  | "NOT_FOUND"
  | "SELF"
  | "RANK"
  | "BAD_DATE"
  | "BAD_REASON"
  | "NOT_MEMBER"
  | "ALREADY_OFFBOARDED"
  | "NOT_OFFBOARDED"

/** A refusal meant for the person (Indonesian `message`, like the neighbouring admin routes). */
export class OffboardRefused extends Error {
  constructor(
    public readonly status: number,
    public readonly code: OffboardRefusalCode,
    message: string,
  ) {
    super(message)
  }
}

const NOTE_MAX = 500

/** "YYYY-MM-DD" that is a real calendar date, or null. */
export function parseDateKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null
}

export type OffboardInput = {
  userId: string
  actorId: string
  /** Jakarta date "YYYY-MM-DD": today or earlier, not before they joined the company workspace. */
  lastWorkingDay: string
  reason: OffboardReason
  note?: string | null
  /** "Now" for the not-after-today check. Tests only; defaults to the real clock. */
  now?: Date
}

export type OffboardResult = {
  user: { id: string; name: string }
  leftAt: Date
  lastWorkingDay: string
  workspaces: { id: string; name: string }[]
  /** People whose approver (Bagan Approval) was the leaver; they fall back to the BoD safety net. */
  approverEdgesCleared: { id: string; name: string }[]
  /** Their own attendance requests still PENDING (left for an approver to decide). */
  pendingRequests: number
  /** Automatic deductions dated after leftAt, set CANCELED (never deleted). */
  autoDeductionsCanceled: number
  /** Tasks assigned to them that are not done (left assigned to them). */
  openTasks: number
  removed: {
    projectMemberships: number
    teamMemberships: number
    oauthAccounts: number
    passkeys: number
    sessions: number
    apiTokens: number
    devices: number
  }
}

/**
 * Offboard `userId` from every workspace they are in. Throws OffboardRefused for anything the caller
 * should tell the person (unknown user, already offboarded, no membership, bad date or reason); the
 * caller's own authority (who may offboard whom) is checked by the route before this runs.
 */
export async function offboardUser(input: OffboardInput, tx: Prisma.TransactionClient): Promise<OffboardResult> {
  const { userId, actorId } = input
  if (userId === actorId) throw new OffboardRefused(400, "SELF", "Gak bisa offboard akun kamu sendiri.")
  if (!isOffboardReason(input.reason)) {
    throw new OffboardRefused(400, "BAD_REASON", "Alasan harus salah satu dari RESIGNED, CONTRACT_ENDED, DISMISSED, OTHER.")
  }
  const note = typeof input.note === "string" ? input.note.trim().slice(0, NOTE_MAX) || null : null

  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, deactivatedAt: true } })
  if (!user) throw new OffboardRefused(404, "NOT_FOUND", "Akun tidak ditemukan.")
  if (user.deactivatedAt) throw new OffboardRefused(409, "ALREADY_OFFBOARDED", `${user.name} sudah di-offboard.`)

  const memberships = await tx.workspaceMember.findMany({
    where: { userId },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  })
  if (memberships.length === 0) {
    throw new OffboardRefused(409, "NOT_MEMBER", `${user.name} bukan anggota workspace mana pun.`)
  }

  // The last working day. Not after today (Jakarta): an offboarding takes effect now, a date in the
  // future would lock someone out who is still working. Not before they joined the company.
  const lastWorkingDay = parseDateKey(input.lastWorkingDay)
  if (!lastWorkingDay) throw new OffboardRefused(400, "BAD_DATE", "Hari kerja terakhir harus tanggal YYYY-MM-DD.")
  const today = formatAttendanceDateKey(input.now ?? new Date())
  if (lastWorkingDay > today) {
    throw new OffboardRefused(400, "BAD_DATE", "Hari kerja terakhir tidak boleh setelah hari ini.")
  }
  const anchor = memberships.find((m) => m.workspaceId === ORG_WORKSPACE_ID) ?? memberships[0]
  const joinedKey = formatAttendanceDateKey(anchor.joinedAt)
  if (lastWorkingDay < joinedKey) {
    throw new OffboardRefused(400, "BAD_DATE", `Hari kerja terakhir tidak boleh sebelum tanggal bergabung (${joinedKey}).`)
  }
  const leftAt = new Date(`${lastWorkingDay}T00:00:00.000Z`)
  const offboardedAt = input.now ?? new Date()

  // The account first, and conditionally: the row lock makes a second offboarding of the same person
  // running at the same moment wait for this one, then find deactivatedAt set and stop here. Every
  // live session ends (lib/session-version.ts); WhatsApp is unlinked.
  const deactivated = await tx.user.updateMany({
    where: { id: userId, deactivatedAt: null },
    data: {
      deactivatedAt: offboardedAt,
      deactivatedById: actorId,
      sessionVersion: { increment: 1 },
      whatsappId: null,
      waLinkCode: null,
      waLinkExpiresAt: null,
    },
  })
  if (deactivated.count !== 1) throw new OffboardRefused(409, "ALREADY_OFFBOARDED", `${user.name} sudah di-offboard.`)

  // 1. What each member row said, kept. The whole row as JSON (shifts, flags…), plus the columns the
  //    recaps read directly. An upsert: a FormerMember left over for the same workspace is replaced.
  for (const m of memberships) {
    const { workspace: _workspace, ...row } = m
    const snapshot = JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue
    const data = {
      role: m.role,
      joinedAt: m.joinedAt,
      leftAt,
      reason: input.reason,
      note,
      approverId: m.approverId,
      restDays: m.restDays,
      dayOffQuota: m.dayOffQuota,
      employmentStartDate: m.employmentStartDate,
      member: snapshot,
      offboardedById: actorId,
      offboardedAt,
    }
    await tx.formerMember.upsert({
      where: { userId_workspaceId: { userId, workspaceId: m.workspaceId } },
      create: { userId, workspaceId: m.workspaceId, ...data },
      update: data,
    })
  }

  // 2. Approver edges pointing AT them (Bagan Approval). null = "falls back to BoD", the chart's
  //    safety net; the names go back to the caller so a new approver can be set.
  const reports = await tx.workspaceMember.findMany({
    where: { approverId: userId, userId: { not: userId } },
    select: { userId: true, user: { select: { name: true } } },
  })
  if (reports.length) {
    await tx.workspaceMember.updateMany({ where: { approverId: userId }, data: { approverId: null } })
  }
  const lostApprover = new Map<string, string>()
  for (const r of reports) lostApprover.set(r.userId, r.user.name)

  // 3. Rosters. No model has a relation to these rows, so deleting them cascades nothing; history
  //    points at the User. Projects and teams: stops auto-assign and pickers; tasks stay.
  await tx.workspaceMember.deleteMany({ where: { userId } })
  const projects = await tx.projectMember.deleteMany({ where: { userId } })
  const teams = await tx.teamMember.deleteMany({ where: { userId } })

  // 4. Every way back in (same list as POST /api/user/account/delete).
  const accounts = await tx.account.deleteMany({ where: { userId } })
  const passkeys = await tx.passkey.deleteMany({ where: { userId } })
  await tx.passkeyChallenge.deleteMany({ where: { userId } })
  const sessions = await tx.userSession.deleteMany({ where: { userId } })
  const apiTokens = await tx.apiToken.deleteMany({ where: { userId } })
  await tx.oAuthAuthCode.deleteMany({ where: { userId } })
  const devices = await tx.deviceInstallation.deleteMany({ where: { userId } })

  // 5. Automatic deductions for days after they left are not theirs to carry: CANCELED, never deleted.
  //    The where clause is isAutoDeduction (lib/attendance-absence.ts) in SQL.
  const canceled = await tx.attendanceRequest.updateMany({
    where: {
      userId,
      startDate: { gt: leftAt },
      status: { in: ["APPROVED", "PENDING"] },
      approvalSource: "ADMIN",
      reviewedById: null,
      reason: { startsWith: "Auto:" },
    },
    data: { status: "CANCELED" },
  })

  // 6. What is left for someone to decide: their pending requests, and the tasks still on them.
  const pendingRequests = await tx.attendanceRequest.count({ where: { userId, status: "PENDING" } })
  const openTasks = await tx.taskAssignee.count({
    where: { userId, task: { status: { notIn: ["DONE", "CANCELLED"] } } },
  })

  return {
    user: { id: user.id, name: user.name },
    leftAt,
    lastWorkingDay,
    workspaces: memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name })),
    approverEdgesCleared: Array.from(lostApprover, ([id, name]) => ({ id, name })),
    pendingRequests,
    autoDeductionsCanceled: canceled.count,
    openTasks,
    removed: {
      projectMemberships: projects.count,
      teamMemberships: teams.count,
      oauthAccounts: accounts.count,
      passkeys: passkeys.count,
      sessions: sessions.count,
      apiTokens: apiTokens.count,
      devices: devices.count,
    },
  }
}

export type ReinstateInput = { userId: string; actorId: string }

export type ReinstateResult = {
  user: { id: string; name: string }
  /** Workspaces they are a member of again. */
  workspaces: { id: string; name: string }[]
  /** Workspaces where a member row already existed (re-added by hand meanwhile): left as it is. */
  alreadyMember: { id: string; name: string }[]
  /** Their own approver, when it could not be restored because that person is no longer in the workspace. */
  approverDropped: { workspaceId: string; approverId: string }[]
}

/**
 * Undo an offboarding: the member rows come back from FormerMember.member (same role, settings and
 * joinedAt — and the same row id when it is still free), the FormerMember rows go, the account is
 * active again. NOT restored: projects, teams, passkeys, devices, sessions, the WhatsApp link, and the
 * approver edges of people who reported to them (those were cleared; set them again in the chart).
 */
export async function reinstateUser(input: ReinstateInput, tx: Prisma.TransactionClient): Promise<ReinstateResult> {
  const { userId } = input
  if (userId === input.actorId) throw new OffboardRefused(400, "SELF", "Gak bisa mengaktifkan ulang akun kamu sendiri.")

  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, deactivatedAt: true } })
  if (!user) throw new OffboardRefused(404, "NOT_FOUND", "Akun tidak ditemukan.")
  if (!user.deactivatedAt) throw new OffboardRefused(409, "NOT_OFFBOARDED", `${user.name} tidak sedang di-offboard.`)

  // Conditional, for the same reason as in offboardUser: a double click reinstates once.
  const reactivated = await tx.user.updateMany({
    where: { id: userId, deactivatedAt: { not: null } },
    data: { deactivatedAt: null, deactivatedById: null },
  })
  if (reactivated.count !== 1) throw new OffboardRefused(409, "NOT_OFFBOARDED", `${user.name} tidak sedang di-offboard.`)

  const formers = await tx.formerMember.findMany({
    where: { userId },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  })

  const workspaces: ReinstateResult["workspaces"] = []
  const alreadyMember: ReinstateResult["alreadyMember"] = []
  const approverDropped: ReinstateResult["approverDropped"] = []

  for (const f of formers) {
    const existing = await tx.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: f.workspaceId } },
      select: { id: true },
    })
    if (existing) {
      alreadyMember.push({ id: f.workspace.id, name: f.workspace.name })
      continue
    }
    const was = asMemberAsOf(f)

    // Their approver only if that person is still in the workspace (the chart's rule). No cycle is
    // possible: every edge pointing at the leaver was cleared when they left, and none can be added
    // while they are not a member.
    let approverId: string | null = was.approverId
    if (approverId) {
      const approver = await tx.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: approverId, workspaceId: f.workspaceId } },
        select: { id: true },
      })
      if (!approver) {
        approverDropped.push({ workspaceId: f.workspaceId, approverId })
        approverId = null
      }
    }

    // The original row id when it is still free, so audit rows naming the membership still match.
    const idFree = was.id && !(await tx.workspaceMember.findUnique({ where: { id: was.id }, select: { id: true } }))

    await tx.workspaceMember.create({
      data: {
        ...(idFree ? { id: was.id } : {}),
        userId,
        workspaceId: f.workspaceId,
        role: f.role,
        attendanceRole: was.attendanceRole,
        joinedAt: f.joinedAt,
        attendanceShiftStartTime: was.attendanceShiftStartTime,
        attendanceShiftEndTime: was.attendanceShiftEndTime,
        attendanceShiftByDay:
          was.attendanceShiftByDay === null ? Prisma.DbNull : (was.attendanceShiftByDay as Prisma.InputJsonValue),
        dayOffQuota: was.dayOffQuota,
        employmentStartDate: was.employmentStartDate,
        flexiTimeEnabled: was.flexiTimeEnabled,
        restDays: was.restDays,
        noGeofenceMode: was.noGeofenceMode,
        approverId,
      },
    })
    workspaces.push({ id: f.workspace.id, name: f.workspace.name })
  }

  await tx.formerMember.deleteMany({ where: { userId } })

  return { user: { id: user.id, name: user.name }, workspaces, alreadyMember, approverDropped }
}

/**
 * Who may offboard or reinstate whom (both routes). A system ADMIN may; otherwise BoD or One Above All
 * of the COMPANY workspace (the same people who may delete an account). Never yourself. Never someone
 * of equal or higher company role unless you are a system ADMIN or One Above All. A system admin
 * account is only touched by another system admin.
 *
 * `targetCompanyRole`: their role in the company workspace (for a reinstatement, the role they had).
 * Returns null when allowed.
 */
export function offboardAuthorityError(args: {
  action: "offboard" | "reinstate"
  actorId: string
  actorIsSystemAdmin: boolean
  actorCompanyRole: string | null
  targetId: string
  targetSystemRole: string
  targetCompanyRole: string | null
}): { status: number; code: "FORBIDDEN" | "SELF" | "RANK"; error: string } | null {
  const actorTier = args.actorIsSystemAdmin
    ? WORKSPACE_HIERARCHY.ONE_ABOVE_ALL
    : (WORKSPACE_HIERARCHY[args.actorCompanyRole as WorkspaceRole] ?? 0)
  const verb = args.action === "offboard" ? "offboard" : "mengaktifkan ulang"
  if (actorTier < WORKSPACE_HIERARCHY.BOD) {
    return { status: 403, code: "FORBIDDEN", error: `Hanya system admin / BoD yang bisa ${verb} akun.` }
  }
  if (args.actorId === args.targetId) {
    return { status: 400, code: "SELF", error: `Gak bisa ${verb} akun kamu sendiri.` }
  }
  if (args.targetSystemRole === "ADMIN" && !args.actorIsSystemAdmin) {
    return { status: 403, code: "RANK", error: `Akun ini system admin — cuma sesama system admin yang bisa ${verb}.` }
  }
  const targetTier = WORKSPACE_HIERARCHY[args.targetCompanyRole as WorkspaceRole] ?? 0
  if (actorTier !== WORKSPACE_HIERARCHY.ONE_ABOVE_ALL && targetTier >= actorTier) {
    return { status: 403, code: "RANK", error: `Kamu tidak bisa ${verb} orang yang setara atau di atas level kamu.` }
  }
  return null
}

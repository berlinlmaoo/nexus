export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'
import { isSystemAdminUser, WORKSPACE_HIERARCHY } from '@/lib/rbac'
import { isLikelyPhoneNumber, normalizeIndonesianPhoneNumber } from '@/lib/phone-number'
import { Prisma } from '@/generated/prisma/client'
import type { WorkspaceRole } from '@/generated/prisma/client'

// Caller's effective tier (system super-admin = top). Used to gate who can assign which role.
function callerTier(role: string | null | undefined, isSystemAdmin: boolean) {
  return isSystemAdmin ? 4 : (WORKSPACE_HIERARCHY[role as WorkspaceRole] ?? 0)
}
// You can assign a role strictly below your tier; One Above All (4) can assign any (incl One Above All/BoD).
function canAssign(tier: number, targetRole: string) {
  return tier === 4 || tier > (WORKSPACE_HIERARCHY[targetRole as WorkspaceRole] ?? 99)
}
const ASSIGNABLE_ROLES = ['ONE_ABOVE_ALL', 'BOD', 'MANAGER', 'STAFF']

async function canManageTeamInWorkspace(userId: string, workspaceId: string, teamId?: string) {
  if (!teamId) return false

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      workspaceId: true,
      members: {
        where: { userId },
        select: { id: true },
      },
    },
  })

  return Boolean(team && team.workspaceId === workspaceId && team.members.length > 0)
}

async function getWorkspaceAndRole(userId: string, workspaceId?: string) {
  const member = await prisma.workspaceMember.findFirst({
    where: {
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  })
  return member
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requestedWorkspaceId = req.nextUrl.searchParams.get('workspaceId') || undefined
    const includeRegistered = req.nextUrl.searchParams.get('includeRegistered') === '1'
    const teamId = req.nextUrl.searchParams.get('teamId') || undefined

    const member = await getWorkspaceAndRole(session.user.id, requestedWorkspaceId)
    if (!member) return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: member.workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true, phoneNumber: true } },
      },
      orderBy: { joinedAt: 'asc' },
    })

    const payload: {
      workspaceId: string
      role: string
      members: Array<{
        id: string
        userId: string
        name: string
        email: string
        avatar: string | null
        phoneNumber: string | null
        role: string
        attendanceRole: string
        attendanceShiftStartTime: string | null
        attendanceShiftEndTime: string | null
        attendanceShiftByDay: unknown
        flexiTimeEnabled: boolean
        noGeofenceMode: boolean
        joinedAt: Date
      }>
      availableUsers?: Array<{
        id: string
        name: string
        email: string
        avatar: string | null
      }>
    } = {
      workspaceId: member.workspaceId,
      role: member.role,
      members: members.map(m => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatar: m.user.avatar,
        phoneNumber: m.user.phoneNumber,
        role: m.role,
        attendanceRole: m.attendanceRole,
        attendanceShiftStartTime: m.attendanceShiftStartTime,
        attendanceShiftEndTime: m.attendanceShiftEndTime,
        attendanceShiftByDay: m.attendanceShiftByDay ?? null,
        flexiTimeEnabled: m.flexiTimeEnabled,
        noGeofenceMode: m.noGeofenceMode,
        joinedAt: m.joinedAt,
      })),
    }

    const canSeeRegistered =
      isSystemAdmin ||
      member.role === 'BOD' ||
      member.role === 'MANAGER' || member.role === 'ONE_ABOVE_ALL' ||
      await canManageTeamInWorkspace(session.user.id, member.workspaceId, teamId)

    if (includeRegistered && canSeeRegistered) {
      const availableUsers = await prisma.user.findMany({
        where: {
          NOT: {
            workspaceMembers: {
              some: { workspaceId: member.workspaceId },
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      payload.availableUsers = availableUsers
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error("Error fetching workspace members:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { email, role = 'STAFF', attendanceRole = 'NONE', workspaceId } = await req.json()

    const currentMember = await getWorkspaceAndRole(session.user.id, workspaceId)
    if (!currentMember) return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)
    const tier = callerTier(currentMember.role, isSystemAdmin)
    if (tier < 3) {
      return NextResponse.json({ error: 'Only One Above All / BoD can invite members' }, { status: 403 })
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (!canAssign(tier, role)) {
      return NextResponse.json({ error: 'Kamu tidak bisa memberikan role itu (di atas level kamu).' }, { status: 403 })
    }
    const effectiveRole = role

    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

    // Check if user already exists
    let user = await prisma.user.findUnique({ where: { email } })

    if (!user) {
      // Create placeholder user
      const hashedPassword = await bcrypt.hash(Math.random().toString(36).slice(2) + 'Aa1!', 12)
      user = await prisma.user.create({
        data: {
          email,
          name: email.split('@')[0],
          password: hashedPassword,
        },
      })
    }

    // Check if already a member
    const existing = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: currentMember.workspaceId } },
    })
    if (existing) {
      return NextResponse.json({ error: 'User is already a workspace member' }, { status: 409 })
    }

    const newMember = await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: currentMember.workspaceId,
        role: effectiveRole,
        attendanceRole,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true, phoneNumber: true } },
      },
    })

    logAudit({ action: "create", entityType: "workspace_member", entityId: newMember.id, entityName: email, userId: session.user.id, request: req, metadata: { role, attendanceRole, workspaceId: currentMember.workspaceId } })

    return NextResponse.json({
      member: {
        id: newMember.id,
        userId: newMember.user.id,
        name: newMember.user.name,
        email: newMember.user.email,
        avatar: newMember.user.avatar,
        role: newMember.role,
        attendanceRole: newMember.attendanceRole,
        joinedAt: newMember.joinedAt,
      },
    }, { status: 201 })
  } catch (error) {
    console.error("Error inviting workspace member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { memberId, role, attendanceRole, workspaceId, attendanceShiftStartTime, attendanceShiftEndTime, attendanceShiftByDay, phoneNumber, flexiTimeEnabled, noGeofenceMode } = await req.json()

    // Per-person shift times: "HH:mm", or null/"" to clear (inherit team/office shift).
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
    const normalizeShift = (v: unknown): string | null | undefined => {
      if (v === undefined) return undefined // not being changed
      if (v === null || v === "") return null // explicit clear
      return typeof v === "string" && TIME_RE.test(v.trim()) ? v.trim() : "__invalid__"
    }
    const shiftStart = normalizeShift(attendanceShiftStartTime)
    const shiftEnd = normalizeShift(attendanceShiftEndTime)
    if (shiftStart === "__invalid__" || shiftEnd === "__invalid__") {
      return NextResponse.json({ error: 'Format jam shift harus HH:mm (contoh 09:00).' }, { status: 400 })
    }

    // Per-weekday overrides: a map keyed by ISO weekday "1".."7" → { start, end } (HH:mm). The whole
    // map is replaced on save; omit a day to use the default, send {} or null to clear all overrides.
    const WEEKDAY_KEYS = new Set(["1", "2", "3", "4", "5", "6", "7"])
    const normalizeShiftByDay = (v: unknown): "skip" | "clear" | "invalid" | Record<string, { start: string; end: string }> => {
      if (v === undefined) return "skip"
      if (v === null) return "clear"
      if (typeof v !== "object" || Array.isArray(v)) return "invalid"
      const entries = Object.entries(v as Record<string, unknown>)
      if (entries.length === 0) return "clear"
      if (entries.length > 7) return "invalid"
      const out: Record<string, { start: string; end: string }> = {}
      for (const [k, val] of entries) {
        if (!WEEKDAY_KEYS.has(k) || !val || typeof val !== "object") return "invalid"
        const start = (val as Record<string, unknown>).start
        const end = (val as Record<string, unknown>).end
        if (typeof start !== "string" || typeof end !== "string") return "invalid"
        const s = start.trim()
        const e = end.trim()
        if (!TIME_RE.test(s) || !TIME_RE.test(e) || s === e) return "invalid"
        out[k] = { start: s, end: e }
      }
      return out
    }
    const byDay = normalizeShiftByDay(attendanceShiftByDay)
    if (byDay === "invalid") {
      return NextResponse.json({ error: 'Shift per-hari tidak valid (format HH:mm, jam masuk ≠ keluar).' }, { status: 400 })
    }
    // Shift is a pair: when touched, both must be provided together (both set OR both cleared).
    // Prevents an orphaned half-config (which would be invisible in the UI) via direct API calls.
    if (attendanceShiftStartTime !== undefined || attendanceShiftEndTime !== undefined) {
      const bothCleared = shiftStart === null && shiftEnd === null
      const bothSet = typeof shiftStart === "string" && typeof shiftEnd === "string"
      if (!bothCleared && !bothSet) {
        return NextResponse.json({ error: 'Isi jam masuk & keluar dua-duanya (atau kosongin dua-duanya).' }, { status: 400 })
      }
      if (bothSet) {
        const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
        // Overnight/cross-midnight shifts (start > end, e.g. 15:00 → 00:00) are valid — the shift
        // window adds 24h. Only identical start==end (zero-length / ambiguous 24h) is rejected.
        if (toMin(shiftStart) === toMin(shiftEnd)) {
          return NextResponse.json({ error: 'Jam masuk & keluar tidak boleh sama.' }, { status: 400 })
        }
      }
    }

    const currentMember = await getWorkspaceAndRole(session.user.id, workspaceId)
    if (!currentMember) return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)
    const tier = callerTier(currentMember.role, isSystemAdmin)
    // Managing members requires BoD+ (tier ≥ 3); Manager/Staff cannot.
    if (tier < 3) {
      return NextResponse.json({ error: 'Only One Above All / BoD can manage members' }, { status: 403 })
    }

    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (attendanceRole !== undefined && !['NONE', 'SUPERVISOR'].includes(attendanceRole)) {
      return NextResponse.json({ error: 'Invalid attendance role' }, { status: 400 })
    }
    if (flexiTimeEnabled !== undefined && typeof flexiTimeEnabled !== 'boolean') {
      return NextResponse.json({ error: 'flexiTimeEnabled must be boolean' }, { status: 400 })
    }
    if (noGeofenceMode !== undefined && typeof noGeofenceMode !== 'boolean') {
      return NextResponse.json({ error: 'noGeofenceMode must be boolean' }, { status: 400 })
    }

    const targetMember = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
    })

    if (!targetMember || targetMember.workspaceId !== currentMember.workspaceId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // You can only assign a role you outrank, and can't modify someone at/above your own tier.
    if (role !== undefined) {
      if (!canAssign(tier, role)) {
        return NextResponse.json({ error: 'Kamu tidak bisa memberikan role itu (di atas level kamu).' }, { status: 403 })
      }
      const targetTier = callerTier(targetMember.role, false)
      if (tier !== 4 && targetTier >= tier) {
        return NextResponse.json({ error: 'Kamu tidak bisa mengubah role member yang setara/di atas kamu.' }, { status: 403 })
      }
    }

    // BoD+ can set this member's WhatsApp/phone number (notif target + WA-bot fallback identity).
    if (phoneNumber !== undefined) {
      let normalized: string | null = null
      if (phoneNumber !== null && phoneNumber !== "") {
        if (typeof phoneNumber !== "string" || !isLikelyPhoneNumber(phoneNumber)) {
          return NextResponse.json({ error: 'Nomor HP tidak valid.' }, { status: 400 })
        }
        normalized = normalizeIndonesianPhoneNumber(phoneNumber)
      }
      await prisma.user.update({ where: { id: targetMember.userId }, data: { phoneNumber: normalized } })
    }

    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        ...(role !== undefined ? { role } : {}),
        ...(attendanceRole !== undefined ? { attendanceRole } : {}),
        ...(shiftStart !== undefined ? { attendanceShiftStartTime: shiftStart } : {}),
        ...(shiftEnd !== undefined ? { attendanceShiftEndTime: shiftEnd } : {}),
        ...(byDay === "skip" ? {} : { attendanceShiftByDay: byDay === "clear" ? Prisma.DbNull : byDay }),
        ...(flexiTimeEnabled !== undefined ? { flexiTimeEnabled } : {}),
        ...(noGeofenceMode !== undefined ? { noGeofenceMode } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true, phoneNumber: true } },
      },
    })

    logAudit({ action: "update", entityType: "workspace_member", entityId: memberId, userId: session.user.id, request: req, metadata: { newRole: role, attendanceRole, attendanceShiftStartTime: shiftStart, attendanceShiftEndTime: shiftEnd } })

    return NextResponse.json({
      member: {
        id: updated.id,
        userId: updated.user.id,
        name: updated.user.name,
        email: updated.user.email,
        avatar: updated.user.avatar,
        phoneNumber: updated.user.phoneNumber,
        role: updated.role,
        attendanceRole: updated.attendanceRole,
        attendanceShiftStartTime: updated.attendanceShiftStartTime,
        attendanceShiftEndTime: updated.attendanceShiftEndTime,
        attendanceShiftByDay: updated.attendanceShiftByDay ?? null,
        flexiTimeEnabled: updated.flexiTimeEnabled,
        noGeofenceMode: updated.noGeofenceMode,
        joinedAt: updated.joinedAt,
      },
    })
  } catch (error) {
    console.error("Error updating workspace member role:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const requestedWorkspaceId = req.nextUrl.searchParams.get('workspaceId') || undefined
    const currentMember = await getWorkspaceAndRole(session.user.id, requestedWorkspaceId)
    if (!currentMember) return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    const isSystemAdmin = await isSystemAdminUser(session.user.id)
    if (!isSystemAdmin && currentMember.role !== 'BOD' && currentMember.role !== 'MANAGER' && currentMember.role !== 'ONE_ABOVE_ALL') {
      return NextResponse.json({ error: 'Only owners and admins can remove members' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const memberId = searchParams.get('memberId')
    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })

    // Prevent removing yourself
    const targetMember = await prisma.workspaceMember.findUnique({ where: { id: memberId } })
    if (!targetMember || targetMember.workspaceId !== currentMember.workspaceId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (targetMember.userId === session.user.id) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
    }
    // Prevent non-owners from removing owners
    if (targetMember.role === 'BOD' && currentMember.role !== 'BOD') {
      return NextResponse.json({ error: 'Only owners can remove other owners' }, { status: 403 })
    }

    await prisma.workspaceMember.delete({ where: { id: memberId } })

    logAudit({ action: "delete", entityType: "workspace_member", entityId: memberId, userId: session.user.id, request: req })

    return NextResponse.json({ message: 'Member removed' })
  } catch (error) {
    console.error("Error removing workspace member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

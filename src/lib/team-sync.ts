import prisma from "./prisma"
import { Prisma } from "../generated/prisma"

/**
 * Team ↔ Project access propagation.
 *
 * When a project is linked to a team, all team members receive ProjectMember
 * records. When a member is added to a team, they get access to all the team's
 * linked projects. Source is tracked as "team:{teamId}" so revocation knows
 * which records were team-propagated vs. directly assigned.
 */

const ROLE_HIERARCHY: Record<string, number> = {
  LEAD: 4,
  MEMBER: 3,
  VIEWER: 2,
  GUEST: 1,
}

type DbClient = Prisma.TransactionClient | typeof prisma

/**
 * Grant all members of `teamId` MEMBER access to `projectId`.
 * Skips users who already have equal or higher access.
 */
export async function syncTeamProjectAccess(teamId: string, projectId: string, db: DbClient = prisma): Promise<void> {
  const teamMembers = await db.teamMember.findMany({
    where: { teamId },
    select: { userId: true },
  })

  if (teamMembers.length === 0) return

  const existingAccess = await db.projectMember.findMany({
    where: {
      projectId,
      userId: { in: teamMembers.map((m) => m.userId) },
    },
    select: { userId: true, role: true },
  })

  const existingMap = new Map(existingAccess.map((a) => [a.userId, a.role]))
  const toCreate: { userId: string; projectId: string; role: "MEMBER"; source: string }[] = []

  for (const member of teamMembers) {
    const currentRole = existingMap.get(member.userId)
    if (currentRole && (ROLE_HIERARCHY[currentRole] ?? 0) >= ROLE_HIERARCHY.MEMBER) {
      continue // Already has equal or higher access
    }
    if (!currentRole) {
      toCreate.push({
        userId: member.userId,
        projectId,
        role: "MEMBER",
        source: `team:${teamId}`,
      })
    }
    // If user has lower access (VIEWER/GUEST), upgrade them
    if (currentRole && (ROLE_HIERARCHY[currentRole] ?? 0) < ROLE_HIERARCHY.MEMBER) {
      await db.projectMember.updateMany({
        where: { userId: member.userId, projectId },
        data: { role: "MEMBER", source: `team:${teamId}` },
      })
    }
  }

  if (toCreate.length > 0) {
    await db.projectMember.createMany({
      data: toCreate,
      skipDuplicates: true,
    })
  }
}

/**
 * Grant a single user MEMBER access to all projects linked to `teamId`.
 */
export async function syncTeamMemberAccess(teamId: string, userId: string, db: DbClient = prisma): Promise<void> {
  const teamProjects = await db.teamProject.findMany({
    where: { teamId },
    select: { projectId: true },
  })

  if (teamProjects.length === 0) return

  const existingAccess = await db.projectMember.findMany({
    where: {
      userId,
      projectId: { in: teamProjects.map((tp) => tp.projectId) },
    },
    select: { projectId: true, role: true },
  })

  const existingMap = new Map(existingAccess.map((a) => [a.projectId, a.role]))
  const toCreate: { userId: string; projectId: string; role: "MEMBER"; source: string }[] = []

  for (const tp of teamProjects) {
    const currentRole = existingMap.get(tp.projectId)
    if (currentRole && (ROLE_HIERARCHY[currentRole] ?? 0) >= ROLE_HIERARCHY.MEMBER) {
      continue
    }
    if (!currentRole) {
      toCreate.push({
        userId,
        projectId: tp.projectId,
        role: "MEMBER",
        source: `team:${teamId}`,
      })
    }
    if (currentRole && (ROLE_HIERARCHY[currentRole] ?? 0) < ROLE_HIERARCHY.MEMBER) {
      await db.projectMember.updateMany({
        where: { userId, projectId: tp.projectId },
        data: { role: "MEMBER", source: `team:${teamId}` },
      })
    }
  }

  if (toCreate.length > 0) {
    await db.projectMember.createMany({
      data: toCreate,
      skipDuplicates: true,
    })
  }
}

/**
 * Revoke project access for team members who have no other access path.
 * Only removes records with source "team:{teamId}".
 */
export async function revokeTeamProjectAccess(teamId: string, projectId: string, db: DbClient = prisma): Promise<void> {
  const teamMembers = await db.teamMember.findMany({
    where: { teamId },
    select: { userId: true },
  })

  if (teamMembers.length === 0) return

  // Only remove ProjectMember records that were team-propagated
  await db.projectMember.deleteMany({
    where: {
      projectId,
      userId: { in: teamMembers.map((m) => m.userId) },
      source: `team:${teamId}`,
    },
  })
}

/**
 * Revoke a single user's team-propagated access when removed from a team.
 * Only removes records with source "team:{teamId}".
 */
export async function revokeTeamMemberAccess(teamId: string, userId: string, db: DbClient = prisma): Promise<void> {
  const teamProjects = await db.teamProject.findMany({
    where: { teamId },
    select: { projectId: true },
  })

  if (teamProjects.length === 0) return

  await db.projectMember.deleteMany({
    where: {
      userId,
      projectId: { in: teamProjects.map((tp) => tp.projectId) },
      source: `team:${teamId}`,
    },
  })
}

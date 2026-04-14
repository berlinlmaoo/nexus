import { Prisma } from "../generated/prisma"
import prisma from "./prisma"
import { getPrimaryWorkspaceDefaults } from "./workspace-defaults"

export const PRIMARY_TEAM_NAME = "PATS Group"
export const PRIMARY_TEAM_COLOR = "#0c1427"

type DbClient = Prisma.TransactionClient | typeof prisma

function normalizeName(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ""
}

export function isPrimaryTeamName(name: string | null | undefined) {
  return normalizeName(name) === normalizeName(PRIMARY_TEAM_NAME)
}

export function isPrimaryWorkspace(workspace: { slug?: string | null; name?: string | null } | null | undefined) {
  const defaults = getPrimaryWorkspaceDefaults()

  return Boolean(
    workspace &&
      (workspace.slug === defaults.slug || normalizeName(workspace.name) === normalizeName(defaults.name))
  )
}

export async function ensurePrimaryTeam(db: DbClient) {
  const defaults = getPrimaryWorkspaceDefaults()

  const workspace = await db.workspace.upsert({
    where: { slug: defaults.slug },
    update: {
      name: defaults.name,
      description: defaults.description,
    },
    create: defaults,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
    },
  })

  const existingTeam = await db.team.findFirst({
    where: {
      workspaceId: workspace.id,
      name: {
        equals: PRIMARY_TEAM_NAME,
        mode: "insensitive",
      },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      color: true,
    },
  })

  if (existingTeam) {
    return { workspace, team: existingTeam }
  }

  const team = await db.team.create({
    data: {
      name: PRIMARY_TEAM_NAME,
      color: PRIMARY_TEAM_COLOR,
      workspaceId: workspace.id,
    },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      color: true,
    },
  })

  return { workspace, team }
}

export async function ensureUserInPrimaryWorkspaceTeam(db: DbClient, userId: string) {
  const { workspace, team } = await ensurePrimaryTeam(db)

  const workspaceMembership = await db.workspaceMember.upsert({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId: workspace.id,
      },
    },
    update: {},
    create: {
      userId,
      workspaceId: workspace.id,
      role: "MEMBER",
    },
  })

  const teamMembership = await db.teamMember.upsert({
    where: {
      teamId_userId: {
        teamId: team.id,
        userId,
      },
    },
    update: {},
    create: {
      teamId: team.id,
      userId,
      role: "MEMBER",
    },
  })

  return { workspace, team, workspaceMembership, teamMembership }
}

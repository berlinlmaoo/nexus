import "dotenv/config"
import pg from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/generated/prisma"
import { ensureUserInPrimaryWorkspaceTeam } from "../src/lib/primary-team"
import { syncTeamMemberAccess } from "../src/lib/team-sync"

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL is required")
}

const pool = new pg.Pool({ connectionString })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  })

  let addedWorkspaceMemberships = 0
  let addedTeamMemberships = 0

  for (const user of users) {
    const [existingWorkspaceMembership, existingTeamMembership] = await Promise.all([
      prisma.workspaceMember.findFirst({
        where: {
          userId: user.id,
          workspace: { slug: "pats-group" },
        },
        select: { id: true },
      }),
      prisma.teamMember.findFirst({
        where: {
          userId: user.id,
          team: {
            name: {
              equals: "PATS Group",
              mode: "insensitive",
            },
            workspace: { slug: "pats-group" },
          },
        },
        select: { id: true },
      }),
    ])

    const { team } = await ensureUserInPrimaryWorkspaceTeam(prisma, user.id)
    await syncTeamMemberAccess(team.id, user.id, prisma)

    if (!existingWorkspaceMembership) {
      addedWorkspaceMemberships += 1
    }

    if (!existingTeamMembership) {
      addedTeamMemberships += 1
    }

    console.log(`Synced ${user.email} to ${team.name}`)
  }

  console.log(
    `Done. users=${users.length}, workspace memberships added=${addedWorkspaceMemberships}, team memberships added=${addedTeamMemberships}`
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })

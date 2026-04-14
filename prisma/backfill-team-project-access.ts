import "dotenv/config"
import pg from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/generated/prisma"
import { syncTeamMemberAccess } from "../src/lib/team-sync"

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL is required")
}

const pool = new pg.Pool({ connectionString })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

type MissingAccess = {
  userId: string
  userEmail: string
  userName: string
  teamId: string
  teamName: string
  projectId: string
  projectName: string
}

async function collectMissingAccess(): Promise<MissingAccess[]> {
  const [teamMembers, projectMembers] = await Promise.all([
    prisma.teamMember.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        team: {
          include: {
            projects: {
              include: {
                project: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ team: { name: "asc" } }, { user: { email: "asc" } }],
    }),
    prisma.projectMember.findMany({
      select: { userId: true, projectId: true },
    }),
  ])

  const existingAccess = new Set(
    projectMembers.map((membership) => `${membership.userId}:${membership.projectId}`)
  )

  const missing: MissingAccess[] = []

  for (const membership of teamMembers) {
    for (const linkedProject of membership.team.projects) {
      const key = `${membership.userId}:${linkedProject.projectId}`
      if (existingAccess.has(key)) continue

      missing.push({
        userId: membership.userId,
        userEmail: membership.user.email,
        userName: membership.user.name,
        teamId: membership.teamId,
        teamName: membership.team.name,
        projectId: linkedProject.projectId,
        projectName: linkedProject.project.name,
      })
    }
  }

  return missing
}

async function main() {
  const missingBefore = await collectMissingAccess()

  if (missingBefore.length === 0) {
    console.log("No missing team-linked project access found.")
    return
  }

  const syncJobs = new Map<
    string,
    { userId: string; teamId: string; userEmail: string; teamName: string }
  >()

  for (const entry of missingBefore) {
    syncJobs.set(`${entry.userId}:${entry.teamId}`, {
      userId: entry.userId,
      teamId: entry.teamId,
      userEmail: entry.userEmail,
      teamName: entry.teamName,
    })
  }

  console.log(
    `Found ${missingBefore.length} missing project memberships across ${syncJobs.size} team-member pairs.`
  )

  for (const job of Array.from(syncJobs.values())) {
    await syncTeamMemberAccess(job.teamId, job.userId, prisma)
    console.log(`Synced ${job.userEmail} via team ${job.teamName}`)
  }

  const missingAfter = await collectMissingAccess()

  console.log(
    JSON.stringify(
      {
        missingBefore: missingBefore.length,
        syncedPairs: syncJobs.size,
        remainingAfter: missingAfter.length,
        remainingSample: missingAfter.slice(0, 20),
      },
      null,
      2
    )
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

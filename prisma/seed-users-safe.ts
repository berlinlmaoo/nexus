import 'dotenv/config'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma'
import { hashSync } from 'bcryptjs'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const pool = new pg.Pool({ connectionString })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const demoUsers = [
  {
    name: 'Berlin Taufik',
    email: 'berlin@patsgroup.id',
    password: 'password123',
    systemRole: 'ADMIN' as const,
    workspaceRole: 'OWNER' as const,
  },
  {
    name: 'Anya Putri',
    email: 'anya@patsgroup.id',
    password: 'password123',
    systemRole: 'MEMBER' as const,
    workspaceRole: 'MEMBER' as const,
  },
  {
    name: 'Rizky Pratama',
    email: 'rizky@patsgroup.id',
    password: 'password123',
    systemRole: 'MEMBER' as const,
    workspaceRole: 'MEMBER' as const,
  },
  {
    name: 'Sari Dewi',
    email: 'sari@patsgroup.id',
    password: 'password123',
    systemRole: 'MEMBER' as const,
    workspaceRole: 'MEMBER' as const,
  },
  {
    name: 'Fajar Nugroho',
    email: 'fajar@patsgroup.id',
    password: 'password123',
    systemRole: 'MEMBER' as const,
    workspaceRole: 'MEMBER' as const,
  },
]

async function main() {
  console.log('Seeding demo users without deleting existing data...')

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'pats-group' },
    update: {
      name: 'PATS Group',
      description: 'Default workspace for PATS Group',
    },
    create: {
      name: 'PATS Group',
      slug: 'pats-group',
      description: 'Default workspace for PATS Group',
    },
  })

  let createdUsers = 0
  let updatedUsers = 0
  let createdMemberships = 0
  let updatedMemberships = 0

  for (const demoUser of demoUsers) {
    const password = hashSync(demoUser.password, 10)
    const existingUser = await prisma.user.findUnique({
      where: { email: demoUser.email },
      select: { id: true, role: true },
    })

    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {
        name: demoUser.name,
        password,
        role: demoUser.systemRole,
      },
      create: {
        name: demoUser.name,
        email: demoUser.email,
        password,
        role: demoUser.systemRole,
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    })

    if (existingUser) updatedUsers += 1
    else createdUsers += 1

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: workspace.id,
        },
      },
      select: { id: true, role: true },
    })

    if (!membership) {
      await prisma.workspaceMember.create({
        data: {
          userId: user.id,
          workspaceId: workspace.id,
          role: demoUser.workspaceRole,
        },
      })
      createdMemberships += 1
    } else if (membership.role !== demoUser.workspaceRole) {
      await prisma.workspaceMember.update({
        where: { id: membership.id },
        data: { role: demoUser.workspaceRole },
      })
      updatedMemberships += 1
    }

    console.log(`Ready user ${user.email} (${user.role})`)
  }

  console.log(
    `Done. users created=${createdUsers}, updated=${updatedUsers}; memberships created=${createdMemberships}, updated=${updatedMemberships}`
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

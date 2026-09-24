import { PrismaClient } from '@/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000', 10),
  })
  const adapter = new PrismaPg(pool)
  // Secrets never leave the database by accident: 14 routes use `include: { user: true }` and used to
  // hand every signed-in caller the bcrypt hash of whoever they included. Omitted globally; the two
  // places that must read the hash (credentials-auth, user/password) ask with an explicit `select`.
  return new PrismaClient({ adapter, omit: { user: { password: true, waLinkCode: true } } })
}

const prismaClient = globalForPrisma.prisma ?? createPrismaClient()

export const prisma: PrismaClient = prismaClient

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaClient

export default prismaClient

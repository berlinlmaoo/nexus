import { PrismaClient } from '@/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { RETIRED_PROJECT_FLAGS } from '@/lib/project-retired-flags'
import { dbIdleTimeoutMs, dbPoolMax, registerDbPool } from '@/lib/db-pool'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; __nexusPgPool?: pg.Pool }

/**
 * ONE connection pool per process, in production too (realtime bug 3, 13 Oct 2026). The App Router routes,
 * the Pages API socket server and instrumentation are separate bundles, each with its own copy of this
 * module; each used to open its own pool of DB_POOL_MAX connections, so one process could hold several
 * pools' worth and two blue-green slots side by side ran Postgres out of connections ("too many clients")
 * during a switch. The POOL is shared through globalThis; the PrismaClient stays per bundle, because a
 * client must only ever see the `Prisma.sql` / `Prisma.join` fragments of its own bundle's runtime (a
 * client shared across bundles turned those fragments into bind parameters: "syntax error at or near $3").
 */
function sharedPool(): pg.Pool {
  if (globalForPrisma.__nexusPgPool) return globalForPrisma.__nexusPgPool
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    max: dbPoolMax(),
    idleTimeoutMillis: dbIdleTimeoutMs(),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000', 10),
    // Who holds the connections, by slot, in pg_stat_activity (deploy/bluegreen/RUNBOOK.md "Connections").
    application_name: `nexus-app-${process.env.NEXUS_SLOT || 'single'}`,
  })
  // An idle client that dies (Postgres restart, network blip) must not crash the process.
  pool.on('error', (err) => console.warn('[db] idle connection error', String(err)))
  registerDbPool(pool)
  globalForPrisma.__nexusPgPool = pool
  return pool
}

function createPrismaClient() {
  const adapter = new PrismaPg(sharedPool())
  // Secrets never leave the database by accident: 14 routes use `include: { user: true }` and used to
  // hand every signed-in caller the bcrypt hash of whoever they included. Omitted globally; the two
  // places that must read the hash (credentials-auth, user/password) ask with an explicit `select`.
  // Typed as the plain client on purpose: helpers across the codebase take `PrismaClient`, and the
  // omit-specialised type is not assignable to it. The omission still happens at runtime.
  const base = new PrismaClient({ adapter, omit: { user: { password: true } } })
  // The retired "Customize project" switches (owner, 11 Oct 2026; see lib/project-retired-flags.ts) read
  // as their fixed values wherever a project is returned, whatever the row still holds, so released apps
  // that decode them behave the same before and after the backfill SQL runs.
  const fixed = <V extends boolean>(value: V) => ({ needs: {}, compute: () => value })
  return base.$extends({
    result: {
      project: {
        enableTaskBatchDuplicate: fixed(RETIRED_PROJECT_FLAGS.enableTaskBatchDuplicate),
        enablePnlDashboard: fixed(RETIRED_PROJECT_FLAGS.enablePnlDashboard),
        financeEnabled: fixed(RETIRED_PROJECT_FLAGS.financeEnabled),
        requireAttachmentForDone: fixed(RETIRED_PROJECT_FLAGS.requireAttachmentForDone),
        disableTaskStatus: fixed(RETIRED_PROJECT_FLAGS.disableTaskStatus),
      },
    },
  }) as unknown as PrismaClient
}

const prismaClient = globalForPrisma.prisma ?? createPrismaClient()

export const prisma: PrismaClient = prismaClient

// Development: one client across hot reloads. Production: one client per bundle on the shared pool (above).
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaClient

export default prismaClient

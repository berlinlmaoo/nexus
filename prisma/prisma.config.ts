import path from 'node:path'
import type { PrismaConfig } from 'prisma'
import 'dotenv/config'

export default {
  earlyAccess: true,
  schema: path.join('prisma', 'schema.prisma'),
  seed: {
    import: path.join('prisma', 'seed.ts'),
    args: [],
  },
} as PrismaConfig

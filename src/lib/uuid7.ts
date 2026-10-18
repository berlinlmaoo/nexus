import { randomBytes } from "crypto"

/**
 * A UUIDv7 (RFC 9562): 48-bit unix ms, version 7, 74 random bits. The same format Prisma's
 * `@default(uuid(7))` mints, for the few places that write rows with raw SQL (docs/internal/UUID-MIGRATION.md).
 */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16)
  const ms = BigInt(now)
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & BigInt(0xff))
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

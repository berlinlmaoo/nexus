import { humanDay, todayWib } from "@/lib/gideon-dates"
import { wibDay } from "@/lib/calendar/core"
import type { Input } from "./types"

export const PUBLIC_BASE = (process.env.NEXUS_PUBLIC_URL || "https://nexus.znetworks.id").replace(/\/+$/, "")

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined)

export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[^\d.-]/g, "")))) return Number(v.replace(/[^\d.-]/g, ""))
  return undefined
}

export function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return [...new Set(v.map(str).filter((x): x is string => Boolean(x)))]
  const s = str(v)
  return s ? [s] : []
}

export function limitOf(input: Input, fallback: number, max = 50): number {
  const n = num(input.limit)
  return n ? Math.max(1, Math.min(max, Math.floor(n))) : fallback
}

/** Whitespace folded, cut with an ellipsis. */
export function clip(s: unknown, n: number): string | null {
  if (typeof s !== "string") return null
  const t = s.replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** An instant as people say it in WIB: "today 14:05", "yesterday 09:30", "Thu 16 Oct 14:05". */
export function whenWib(d: Date | string | null | undefined, now: Date = new Date()): string | null {
  if (!d) return null
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return null
  const day = wibDay(t)
  const today = todayWib(now)
  const w = new Date(t.getTime() + 7 * 3600e3)
  const hm = `${String(w.getUTCHours()).padStart(2, "0")}:${String(w.getUTCMinutes()).padStart(2, "0")}`
  const yesterday = wibDay(new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400e3))
  if (day === today) return `today ${hm}`
  if (day === yesterday) return `yesterday ${hm}`
  return `${humanDay(day, "en", today)} ${hm}`
}

/** A "YYYY-MM-DD" day as a label ("Mon 20 Oct"). */
export function dayLabel(day: string | null | undefined): string | null {
  return day ? humanDay(day, "en", todayWib()) : null
}

/** A person by (part of) their name among active org members: exactly one, or an error the model can act on. */
export async function findPerson(name: string, opts: { exclude?: string } = {}): Promise<{ id: string; name: string | null }> {
  const { default: prisma } = await import("@/lib/prisma")
  const { ORG_WORKSPACE_ID } = await import("@/lib/org")
  if (/^(me|saya|aku|gw|gue)$/i.test(name)) throw new Error("That is the person themselves.")
  const people = await prisma.user.findMany({
    where: {
      name: { contains: name, mode: "insensitive" },
      deactivatedAt: null,
      workspaceMembers: { some: { workspaceId: ORG_WORKSPACE_ID } },
      ...(opts.exclude ? { id: { not: opts.exclude } } : {}),
    },
    select: { id: true, name: true },
    take: 6,
  })
  const exact = people.filter((p) => p.name?.toLowerCase() === name.toLowerCase())
  const pick = exact.length === 1 ? exact : people
  if (pick.length === 1) return pick[0]
  if (!pick.length) throw new Error(`Nobody in the company is named like "${name}".`)
  throw new Error(`Several people match "${name}": ${pick.map((p) => p.name).join(", ")}. Ask which one.`)
}

/** Rupiah as the forms show money ("Rp 6.000.000"); counts never get "Rp" (memory nexus-format-angka). */
export function rupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`
}
export function count(n: number): string {
  return Math.round(n).toLocaleString("id-ID")
}

/** An id as UUIDv7 (with dashes) or a cuid — both are ids in NEXUS around the 18 Oct 2026 UUID switch. */
export const ID_RE = /^[0-9a-z][0-9a-z-]{7,40}$/i

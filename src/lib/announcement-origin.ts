/**
 * Where an announcement came from (owner, 22 Oct 2026). Control Room's list showed every per-person push
 * (Absen Monitor warnings, "install the app" nudges, GIDEON test posts) between the real announcements.
 *
 *   origin  "manual"  typed in the Control Room composer (POST /api/announcements from the form)
 *           "system"  everything else
 *   source  composer | gideon | attendance_warning | template | legacy
 *
 * A warning (kind "warning") is system whatever the column says: a build from before the column wrote it
 * with the default "manual" while the SQL was already applied, and a warning is never a composer post.
 */

export type AnnouncementOrigin = "manual" | "system"
export type AnnouncementOriginFilter = AnnouncementOrigin | "all"

export const ANNOUNCEMENT_SOURCES = ["composer", "gideon", "attendance_warning", "template", "legacy"] as const

/** `?origin=` → filter. Absent / unknown = "all": the old behaviour, so released apps keep seeing everything. */
export function parseOriginFilter(raw: string | null | undefined): AnnouncementOriginFilter {
  const v = (raw ?? "").trim().toLowerCase()
  if (v === "manual") return "manual"
  if (v === "system" || v === "auto" || v === "automatic") return "system"
  return "all"
}

/** Prisma `where` for one origin (mirrors effectiveOrigin). */
export function originWhere(filter: AnnouncementOriginFilter) {
  if (filter === "manual") return { origin: "manual", NOT: { kind: "warning" } }
  if (filter === "system") return { OR: [{ origin: "system" }, { kind: "warning" }] }
  return {}
}

export function effectiveOrigin(a: { origin?: string | null; kind?: string | null }): AnnouncementOrigin {
  if (a.kind === "warning") return "system"
  return a.origin === "system" ? "system" : "manual"
}

export function effectiveSource(a: { origin?: string | null; kind?: string | null; source?: string | null }): string {
  if (a.kind === "warning" && (!a.source || a.source === "composer" || a.source === "legacy")) return "attendance_warning"
  return (ANNOUNCEMENT_SOURCES as readonly string[]).includes(a.source ?? "") ? (a.source as string) : "legacy"
}

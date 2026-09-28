/**
 * Where a day's check-in happened, as one line of text (owner decision, Berlin, 28 Sep 2026).
 *
 * A location-free member (WorkspaceMember.noGeofenceMode) may check in anywhere; the record is still
 * filed under the NEAREST office (check-in route: resolveNearestOffice), so printing "which office"
 * for that day named a building they were never in. From now on, per record:
 *   - the check-in was outside that office's radius  → the ADDRESS they checked in at
 *   - inside the radius (or unknown)                 → the office name, as before
 *
 * Pure (no prisma) so the unit test can load it directly: node src/lib/attendance-place.test.mjs.
 * The same rule is mirrored in the web (apps/nexus-lovable-ui/src/lib/attendance-place.ts) and iOS
 * (AttendanceRecord.placeLabel); change one, change the others.
 */

export type AttendancePlaceLike = {
  checkInDistanceMeters?: number | null
  checkInAddress?: string | null
  checkInLat?: number | null
  checkInLng?: number | null
  officeLocation?: { name?: string | null; radiusMeters?: number | null } | null
}

/**
 * true  — the check-in was further from the record's office than its radius (only a location-free
 *         member can do that; everyone else is refused at the door).
 * false — inside the radius.
 * null  — unknown: no check-in distance (a BoD "Hadir" override, a correction, a synthetic history
 *         row) or no office radius.
 */
export function isCheckInAway(record: AttendancePlaceLike): boolean | null {
  const distance = record.checkInDistanceMeters
  const radius = record.officeLocation?.radiusMeters
  if (typeof distance !== "number" || !Number.isFinite(distance)) return null
  if (typeof radius !== "number" || !Number.isFinite(radius)) return null
  return distance > radius
}

/** The first two comma-separated parts of a reverse-geocoded address ("Jl. Kemang Raya 12, Bangka"). */
export function shortAddress(address: string | null | undefined): string | null {
  if (!address) return null
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean)
  return parts.length ? parts.slice(0, 2).join(", ") : null
}

/**
 * The text for "where was this day": the short check-in address when the check-in was away from the
 * office, else the office name. Away with no address (the geocoder failed) falls back to the
 * coordinates, never to the office name — naming the office is exactly what this replaces.
 */
export function placeLabel(record: AttendancePlaceLike): string {
  const officeName = record.officeLocation?.name?.trim() || ""
  if (isCheckInAway(record) !== true) return officeName
  const address = shortAddress(record.checkInAddress)
  if (address) return address
  const { checkInLat: lat, checkInLng: lng } = record
  if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
  return "Di luar kantor"
}

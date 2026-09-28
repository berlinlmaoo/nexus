/**
 * "Which office" for one day — or, when the check-in was made AWAY from the office, the address it was
 * made at (owner decision, Berlin, 28 Sep 2026). Per record, not per person: a location-free member
 * who checked in inside the office radius still gets the office name for that day.
 *
 * The server sends `checkInAway` (lib/attendance-place.ts there); a payload without it falls back to
 * the same rule computed here (distance > the office radius). Same rule on iOS
 * (AttendanceRecord.placeLabel). Change one, change the others.
 */

export type AttendancePlaceLike = {
  checkInAway?: boolean | null;
  checkInDistanceMeters?: number | null;
  checkInAddress?: string | null;
  checkInLat?: number | null;
  checkInLng?: number | null;
  officeLocation?: { name?: string | null; radiusMeters?: number | null } | null;
} | null | undefined;

/** true = checked in outside the office radius; false = inside; null = unknown. */
export function checkInAway(rec: AttendancePlaceLike): boolean | null {
  if (!rec) return null;
  if (typeof rec.checkInAway === "boolean") return rec.checkInAway;
  const d = rec.checkInDistanceMeters;
  const r = rec.officeLocation?.radiusMeters;
  if (typeof d !== "number" || !Number.isFinite(d) || typeof r !== "number" || !Number.isFinite(r)) return null;
  return d > r;
}

/** First two comma parts of a reverse-geocoded address. */
export function shortAddress(address?: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts.slice(0, 2).join(", ") : null;
}

/**
 * The day's place as text plus whether it is an away check-in (so the UI can add "away from the
 * office"). Away with no address → coordinates, never the office name.
 */
export function recordPlace(rec: AttendancePlaceLike): { label: string; away: boolean } {
  const office = rec?.officeLocation?.name?.trim() || "";
  if (!rec || checkInAway(rec) !== true) return { label: office, away: false };
  const address = shortAddress(rec.checkInAddress);
  if (address) return { label: address, away: true };
  if (typeof rec.checkInLat === "number" && typeof rec.checkInLng === "number") {
    return { label: `${rec.checkInLat.toFixed(5)}, ${rec.checkInLng.toFixed(5)}`, away: true };
  }
  return { label: "Away from the office", away: true };
}

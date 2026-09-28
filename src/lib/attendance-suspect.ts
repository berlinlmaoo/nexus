/**
 * Reviewing attendance flagged for its location (owner, 28 Sep 2026).
 *
 * assessLocationIntegrity (lib/attendance.ts) flags a check at the moment it is made. Its signals are
 * NOT equally good evidence, and a BoD verdict of "not valid" turns the day into TK — so the owner's
 * rule is that only proof of a fake location may do that:
 *
 *   FAKE  — the phone's own OS said the position was simulated (iOS isSimulatedBySoftware, Android
 *           isMock: a mock-location app), or the claim is physically impossible (> 900 km/h since the
 *           person's previous check). Reviewable as VALID or INVALID.
 *   CHECK — weak signals with innocent explanations: the same coordinate as the previous check (a
 *           phone that has not moved, or iOS/the browser answering from its cached fix — 28 of 28
 *           such flags in Sep 2026 were ordinary office check-ins), or 200–900 km/h (a stale cached
 *           fix does that too). Shown so a BoD can look, reviewable only as VALID.
 *
 * Absen Monitor (batch 2, 29 Sep 2026) adds a third level between the two:
 *
 *   NOFACE — the face detector (face/ sidecar, cron/attendance-face-check) found no face in a selfie:
 *            a wall, the floor, a covered camera. Liveness in app 0.1.6 prevents it there, but the web,
 *            older apps and the offline queue can still send one. Not proof of anything about the
 *            location, so reviewable only as VALID; the BoD can send the person a warning instead.
 *
 * Order: FAKE > NOFACE > CHECK.
 */

export const SUSPECT_IMPOSSIBLE_KMH = 900
export const NO_FACE_SIGNAL = "No face in the selfie (a wall, the floor, a covered camera)"

export type SuspectLevel = "FAKE" | "NOFACE" | "CHECK"
export type SuspectSide = {
  at: string | null
  lat: number | null
  lng: number | null
  accuracyM: number | null
  simulated: boolean
  suspect: boolean
  reason: string | null
  impliedKmh: number | null
  photoUrl: string | null
  address: string | null
  offline: boolean
  /** Faces found in the selfie; null = not checked yet (or no readable selfie). */
  faceCount: number | null
  level: SuspectLevel | null
  /** What each signal means, in plain words (English; the apps translate the known ones). */
  signals: string[]
}

type SideInput = {
  at: Date | null
  lat: number | null
  lng: number | null
  accuracyM: number | null
  simulated: boolean
  suspect: boolean
  reason: string | null
  impliedKmh: number | null
  photoUrl: string | null
  address: string | null
  offline: boolean
  /** Raw column: null = not checked, -1 = unreadable file (reported as null), else faces found. */
  faceCount?: number | null
}

/** The column value as the API reports it: -1 (file could not be read) is "unknown", not a count. */
export function publicFaceCount(v: number | null | undefined): number | null {
  return v == null || v < 0 ? null : v
}

export function sideLevel(s: { simulated: boolean; suspect: boolean; impliedKmh: number | null; faceCount?: number | null }): SuspectLevel | null {
  if (s.simulated) return "FAKE"
  if (s.suspect && s.impliedKmh != null && s.impliedKmh > SUSPECT_IMPOSSIBLE_KMH) return "FAKE"
  if (s.faceCount === 0) return "NOFACE"
  if (s.suspect) return "CHECK"
  return null
}

export function signalsOf(s: { simulated: boolean; suspect: boolean; reason: string | null; impliedKmh: number | null; faceCount?: number | null }): string[] {
  const out: string[] = []
  if (s.faceCount === 0) out.push(NO_FACE_SIGNAL)
  if (s.simulated) out.push("The phone reported a simulated location (a fake-GPS / mock-location app)")
  if (s.suspect && s.impliedKmh != null && s.impliedKmh > SUSPECT_IMPOSSIBLE_KMH) {
    out.push(`Impossible travel: ${s.impliedKmh} km/h since the previous check`)
  } else if (s.suspect && s.impliedKmh != null && s.impliedKmh > 200) {
    out.push(`Fast travel: ${s.impliedKmh} km/h since the previous check — can also be an old cached position`)
  }
  if (s.suspect && s.reason?.includes("identical")) {
    out.push("Same coordinates as the previous check — usually a phone that hasn't moved or a cached position, not a fake")
  }
  return out
}

export function side(i: SideInput): SuspectSide | null {
  if (!i.at && i.lat == null) return null
  return {
    at: i.at?.toISOString() ?? null,
    lat: i.lat, lng: i.lng, accuracyM: i.accuracyM,
    simulated: i.simulated, suspect: i.suspect, reason: i.reason, impliedKmh: i.impliedKmh,
    photoUrl: i.photoUrl, address: i.address, offline: i.offline,
    faceCount: publicFaceCount(i.faceCount),
    level: sideLevel({ ...i, faceCount: publicFaceCount(i.faceCount) }),
    signals: signalsOf({ ...i, faceCount: publicFaceCount(i.faceCount) }),
  }
}

export function recordLevel(sides: Array<SuspectSide | null>): SuspectLevel | null {
  const levels = sides.map((s) => s?.level).filter(Boolean)
  if (levels.includes("FAKE")) return "FAKE"
  if (levels.includes("NOFACE")) return "NOFACE"
  if (levels.includes("CHECK")) return "CHECK"
  return null
}

/** Both sides of a record, as the Absen Monitor list and its review/warn routes build them. */
export function recordSides(r: {
  checkInAt: Date | null; checkInLat: number | null; checkInLng: number | null; checkInAccuracyM: number | null
  checkInSimulated: boolean; checkInSuspect: boolean; checkInSuspectReason: string | null; checkInImpliedKmh: number | null
  checkInPhotoUrl: string | null; checkInAddress: string | null; checkInOffline: boolean; checkInFaceCount: number | null
  checkOutAt: Date | null; checkOutLat: number | null; checkOutLng: number | null; checkOutAccuracyM: number | null
  checkOutSimulated: boolean; checkOutSuspect: boolean; checkOutSuspectReason: string | null; checkOutImpliedKmh: number | null
  checkOutPhotoUrl: string | null; checkOutAddress: string | null; checkOutOffline: boolean; checkOutFaceCount: number | null
}): { checkIn: SuspectSide | null; checkOut: SuspectSide | null } {
  return {
    checkIn: side({
      at: r.checkInAt, lat: r.checkInLat, lng: r.checkInLng, accuracyM: r.checkInAccuracyM,
      simulated: r.checkInSimulated, suspect: r.checkInSuspect, reason: r.checkInSuspectReason, impliedKmh: r.checkInImpliedKmh,
      photoUrl: r.checkInPhotoUrl, address: r.checkInAddress, offline: r.checkInOffline, faceCount: r.checkInFaceCount,
    }),
    checkOut: side({
      at: r.checkOutAt, lat: r.checkOutLat, lng: r.checkOutLng, accuracyM: r.checkOutAccuracyM,
      simulated: r.checkOutSimulated, suspect: r.checkOutSuspect, reason: r.checkOutSuspectReason, impliedKmh: r.checkOutImpliedKmh,
      photoUrl: r.checkOutPhotoUrl, address: r.checkOutAddress, offline: r.checkOutOffline, faceCount: r.checkOutFaceCount,
    }),
  }
}

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
 */

export const SUSPECT_IMPOSSIBLE_KMH = 900

export type SuspectLevel = "FAKE" | "CHECK"
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
}

export function sideLevel(s: { simulated: boolean; suspect: boolean; impliedKmh: number | null }): SuspectLevel | null {
  if (s.simulated) return "FAKE"
  if (s.suspect && s.impliedKmh != null && s.impliedKmh > SUSPECT_IMPOSSIBLE_KMH) return "FAKE"
  if (s.suspect) return "CHECK"
  return null
}

export function signalsOf(s: { simulated: boolean; suspect: boolean; reason: string | null; impliedKmh: number | null }): string[] {
  const out: string[] = []
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
    level: sideLevel(i),
    signals: signalsOf(i),
  }
}

export function recordLevel(sides: Array<SuspectSide | null>): SuspectLevel | null {
  const levels = sides.map((s) => s?.level).filter(Boolean)
  if (levels.includes("FAKE")) return "FAKE"
  if (levels.includes("CHECK")) return "CHECK"
  return null
}

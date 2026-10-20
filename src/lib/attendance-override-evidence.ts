/**
 * Evidence for a BoD/OAA status change from the attendance board (POST /api/attendance/override).
 *
 * Owner rule (Berlin, 20 Oct 2026, final at 12:50): evidence is OPTIONAL but asked for.
 *   - any status → SICK                         asks for the sick note (photo or PDF)
 *   - any status → PERMIT (Present included)    asks for a supporting photo/file
 *   - PERMIT / TK (absent) / no record → PRESENT asks for a supporting photo/file
 *   - anything → TK, and every other change      no upload field (reason text as before)
 * The clients show the upload prominently for those transitions and save without it too. A change
 * that asked for evidence and got none is stored with "no evidence attached" (evidenceMissing) on the
 * request / record and in the audit, so OAA can see it. Never refused, so no client-version gating.
 *
 * Pure: no I/O and no imports, so the node test (attendance-override-evidence.test.mjs) can load it alone.
 */

export type OverrideAction = "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "PERMIT" | "CLEAR_PENALTY"

/**
 * What the day is before the change, as the board shows it. ABSENT (TK) and NONE (nothing recorded)
 * are kept apart for the audit trail, but are treated the same by the rule.
 */
export type OverrideDayState = "PRESENT" | "PERMIT" | "SICK" | "LEAVE" | "DAY_OFF" | "ABSENT" | "NONE"

/** Which piece of evidence a transition asks for (optional); null = none, no upload field. */
export type OverrideEvidenceKind = "SICK_NOTE" | "PERMIT_EVIDENCE" | "PRESENT_EVIDENCE"

const PRESENT_NEEDS_EVIDENCE_FROM: ReadonlySet<OverrideDayState> = new Set(["PERMIT", "ABSENT", "NONE"])

export function overrideEvidenceKind(action: OverrideAction | string, from: OverrideDayState): OverrideEvidenceKind | null {
  const a = String(action).toUpperCase()
  if (a === "SICK") return "SICK_NOTE"
  if (a === "PERMIT") return "PERMIT_EVIDENCE"
  if (a === "PRESENT" && PRESENT_NEEDS_EVIDENCE_FROM.has(from)) return "PRESENT_EVIDENCE"
  return null
}

/**
 * The day's state from what the database holds for it.
 *  - `approvedTypes`: types of the APPROVED, non-auto-deduction requests covering the day
 *    (the cron's "Auto:" day-off is a TK penalty, not a status — leave it out).
 *  - `hasCheckIn`: an attendance record with a check-in exists for the day.
 *  - `pastWorkday`: the day is over and was a workday — no record then reads as TK (ABSENT) rather
 *    than "nothing yet". Only changes the label; the rule treats both alike.
 * An approved PERMIT wins over a check-in: a permit day may carry the check-in made before it.
 */
export function resolveOverrideDayState(input: { hasCheckIn: boolean; approvedTypes: readonly string[]; pastWorkday?: boolean }): OverrideDayState {
  const types = new Set(input.approvedTypes.map((t) => String(t).toUpperCase()))
  if (types.has("PERMIT")) return "PERMIT"
  if (input.hasCheckIn) return "PRESENT"
  if (types.has("SICK")) return "SICK"
  if (types.has("LEAVE")) return "LEAVE"
  if (types.has("DAY_OFF") || types.has("RED_DATE")) return "DAY_OFF"
  return input.pastWorkday ? "ABSENT" : "NONE"
}

export const OVERRIDE_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024

/**
 * Same acceptance as the request route's supporting document: a picture or a PDF, by MIME first and by
 * extension when the type is empty or generic (the iOS app labels every upload application/octet-stream).
 */
export function isSupportedEvidenceFile(name: string, mime: string): boolean {
  const m = (mime || "").toLowerCase()
  if (m.startsWith("image/") || m === "application/pdf") return true
  const unknown = !m || m === "application/octet-stream" || m === "binary/octet-stream"
  if (!unknown) return false
  return /\.(jpe?g|png|heic|heif|webp|gif|pdf)$/i.test(name)
}


export const OVERRIDE_EVIDENCE_TYPE_MESSAGE = {
  en: "The evidence must be a photo or a PDF.",
  id: "Bukti harus berupa foto atau PDF.",
}

export const OVERRIDE_EVIDENCE_SIZE_MESSAGE = {
  en: "The evidence must be smaller than 10 MB.",
  id: "Ukuran bukti maksimal 10 MB.",
}

/** "id" when the caller asked for Indonesian (Accept-Language), else "en". */
export function evidenceLang(acceptLanguage: string | null | undefined): "en" | "id" {
  return /^\s*id\b/i.test(acceptLanguage ?? "") ? "id" : "en"
}

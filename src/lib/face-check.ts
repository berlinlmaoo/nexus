/**
 * Face check on attendance selfies (batch 2, 29 Sep 2026).
 *
 * The detector is the `nexus-face` sidecar (face/ in this repo): OpenCV YuNet behind a tiny HTTP
 * server on the internal docker network, reading the uploads directory read-only. Asked with a path
 * relative to the uploads root, it answers { faces, best }.
 *
 * Results as stored in AttendanceRecord.checkIn/OutFaceCount:
 *   n ≥ 0  faces found
 *   -1     the selfie could not be read (file gone, not an image, not one of our uploads) — final,
 *          never retried, reported by the API as null
 *   null   not checked yet; a detector that is down or failing leaves it null and the next cron run
 *          tries again
 */

export const FACE_URL = (process.env.NEXUS_FACE_URL?.trim() || "http://nexus-face:8080").replace(/\/+$/, "")
export const FACE_UNREADABLE = -1

/** "/api/files/attendance/x.jpg" → "attendance/x.jpg"; null for anything that is not a local upload. */
export function uploadPathOf(photoUrl: string): string | null {
  const m = /^\/api\/files\/(.+)$/.exec(photoUrl.split("?")[0])
  if (!m) return null
  const rel = decodeURIComponent(m[1])
  if (rel.includes("..") || rel.startsWith("/")) return null
  return rel
}

/** Faces in one selfie: n ≥ 0, FACE_UNREADABLE, or null when the detector could not answer. */
export async function countFaces(photoUrl: string): Promise<number | null> {
  const path = uploadPathOf(photoUrl)
  if (!path) return FACE_UNREADABLE
  try {
    const res = await fetch(`${FACE_URL}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 400 || res.status === 404 || res.status === 422) return FACE_UNREADABLE
    if (!res.ok) return null
    const body = (await res.json()) as { faces?: unknown }
    return typeof body.faces === "number" && Number.isInteger(body.faces) && body.faces >= 0 ? body.faces : null
  } catch {
    return null
  }
}

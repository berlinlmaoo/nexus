import { stat, readFile } from "fs/promises"
import path from "path"
import { androidApkDir } from "@/lib/android-app"

/**
 * The sideloaded Android release: what /download/android shows and /api/app/android/apk serves.
 *
 * On disk (nexus-prod ~/nexus-data/android, mounted read-only at NEXUS_ANDROID_APK_DIR =
 * /app/data/android), outside every web root and every upload directory:
 *
 *   current.json                      which release is current — the ONLY thing the server trusts
 *   nexus-<versionName>-<versionCode>.apk
 *
 *   current.json = {
 *     "versionName": "0.1.6",                  required, x.y.z
 *     "versionCode": 1,                        required, positive integer
 *     "file": "nexus-0.1.6-1.apk",             required, a plain file name in the same directory
 *     "sha256": "…64 hex…",                    optional, shown on the page (the Android session hands it over)
 *     "releasedAt": "2026-09-26T03:00:00Z",    optional, shown on the page
 *     "notes": "One line per change\nSecond"   optional, release notes (plain text)
 *   }
 *
 * Publishing a build = copy the APK in, then rewrite current.json (write a temp file and mv it, so a
 * download never sees half a JSON). Old APKs can stay; only the one named here is ever served. The
 * JSON is re-read when its mtime changes, so no restart or deploy is needed.
 */

export const RELEASE_MANIFEST = "current.json"
export const APK_CONTENT_TYPE = "application/vnd.android.package-archive"

export interface AndroidRelease {
  versionName: string
  versionCode: number
  /** Absolute path of the APK inside the container. */
  path: string
  fileName: string
  sizeBytes: number
  /** Strong validator for resumable downloads: changes whenever the file does. */
  etag: string
  lastModified: Date
  sha256: string | null
  releasedAt: string | null
  notes: string | null
  /** What the phone saves it as: NEXUS-<versionName>.apk */
  downloadName: string
}

export type ReleaseProblem = "missing" | "invalid"

let memo: { key: string; value: AndroidRelease | ReleaseProblem } | null = null

function problem(dir: string, why: string): ReleaseProblem {
  console.warn(`android release (${dir}/${RELEASE_MANIFEST}): ${why}`)
  return "invalid"
}

/**
 * The current release, or why there is none: "missing" (no manifest yet — the normal state before the
 * first build is handed over) or "invalid" (a manifest that names nothing servable; logged).
 */
export async function readAndroidRelease(dir: string = androidApkDir()): Promise<AndroidRelease | ReleaseProblem> {
  const manifestPath = path.join(dir, RELEASE_MANIFEST)
  let mst
  try {
    mst = await stat(manifestPath)
  } catch {
    return "missing"
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch {
    return problem(dir, "not valid JSON")
  }
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const versionName = typeof m.versionName === "string" && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(m.versionName.trim()) ? m.versionName.trim() : null
  const versionCode = typeof m.versionCode === "number" && Number.isInteger(m.versionCode) && m.versionCode > 0 ? m.versionCode : null
  // A bare file name only: no directories, no "..", nothing that can point outside `dir`.
  const fileName = typeof m.file === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/.test(m.file) ? m.file : null
  if (!versionName) return problem(dir, "versionName is not x.y.z")
  if (!versionCode) return problem(dir, "versionCode is not a positive integer")
  if (!fileName) return problem(dir, "file is not a plain *.apk name")

  const apkPath = path.join(dir, fileName)
  let st
  try {
    st = await stat(apkPath)
  } catch {
    return problem(dir, `${fileName} does not exist`)
  }
  if (!st.isFile() || st.size === 0) return problem(dir, `${fileName} is not a non-empty file`)

  const key = `${mst.mtimeMs}:${mst.size}:${st.mtimeMs}:${st.size}:${dir}`
  if (memo?.key === key) return memo.value

  const sha256 = typeof m.sha256 === "string" && /^[0-9a-fA-F]{64}$/.test(m.sha256.trim()) ? m.sha256.trim().toLowerCase() : null
  const releasedAt =
    typeof m.releasedAt === "string" && Number.isFinite(Date.parse(m.releasedAt)) ? new Date(Date.parse(m.releasedAt)).toISOString() : null
  const notes = typeof m.notes === "string" && m.notes.trim() ? m.notes.trim().slice(0, 4000) : null
  const value: AndroidRelease = {
    versionName,
    versionCode,
    path: apkPath,
    fileName,
    sizeBytes: st.size,
    etag: `"apk-${versionCode}-${st.size}-${Math.floor(st.mtimeMs)}"`,
    lastModified: st.mtime,
    sha256,
    releasedAt,
    notes,
    downloadName: `NEXUS-${versionName}.apk`,
  }
  memo = { key, value }
  return value
}

/**
 * The Android app's identity and release facts, all set by the owner through env. There is no
 * anonymous Play Store lookup like the iTunes one app-store.ts uses, so nothing here is scraped:
 *
 *   NEXUS_ANDROID_MIN_VERSION     oldest Android versionName still served (x.y.z). Unset or unreadable
 *                                 → "0.0.0": no Android build is ever refused until the owner sets it.
 *   NEXUS_ANDROID_LATEST_VERSION  current release (x.y.z), for "update available" and the update
 *                                 reminder. Unset → unknown (null): nothing is nagged.
 *   NEXUS_ANDROID_LATEST_RELEASED_AT  when that release went out (ISO 8601, e.g. 2026-09-26T03:00:00Z).
 *                                 Optional. Set → the iOS rule applies to Android too: the release
 *                                 becomes the minimum GRACE (3 days) after this instant, and until then
 *                                 the policy carries nextMinimum + graceUntil (the app's daily "Update
 *                                 NEXUS by <date>" warning). Unset or unreadable → no grace window and no
 *                                 automatic roll: the minimum is NEXUS_ANDROID_MIN_VERSION alone, exactly
 *                                 as before. (Unlike iOS there is no store to watch, so the owner states
 *                                 the moment instead of the server observing it.)
 *   NEXUS_ANDROID_STORE_URL       where "update" sends people. Default: the signed-in APK download page
 *                                 (ANDROID_DOWNLOAD_URL_DEFAULT). Must be https; moving to Play later is
 *                                 this one env change.
 *   NEXUS_ANDROID_APK_DIR         directory (inside the container) holding the sideloaded release:
 *                                 current.json + the APK it names (android-release.ts). Default
 *                                 /app/data/android, bind-mounted read-only from ~/nexus-data/android.
 *   NEXUS_ANDROID_CERT_SHA256     comma-separated SHA-256 fingerprints of the app's signing
 *                                 certificates (Play app-signing key first, then upload/debug keys if
 *                                 wanted), as Play Console shows them ("AB:CD:…", 32 bytes). Feeds
 *                                 /.well-known/assetlinks.json and the passkey origins. Empty → both
 *                                 stay exactly as they were before Android existed.
 *
 * Pure: env reads only, no imports, so it is safe from the middleware and loadable by the plain-node
 * tests (android-app.test.mjs).
 */

export const ANDROID_PACKAGE = "id.znetworks.nexus"
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`
export const ANDROID_FLOOR_DEFAULT = "0.0.0"
/** The web page that serves the sideloaded APK (Phaëthon route /download/android). */
export const ANDROID_DOWNLOAD_PATH = "/download/android"
export const ANDROID_DOWNLOAD_URL_DEFAULT = `https://nexus.znetworks.id${ANDROID_DOWNLOAD_PATH}`
export const ANDROID_APK_DIR_DEFAULT = "/app/data/android"
/** Same window as iOS (version-policy.ts GRACE_MS; android-app.test.mjs keeps the two equal). */
export const ANDROID_GRACE_MS = 3 * 24 * 60 * 60 * 1000

type Env = Record<string, string | undefined>

const warned = new Set<string>()
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

/** "0.1.6" → "0.1.6"; anything that is not exactly three numeric parts → null. */
function strictVersion(raw: string | undefined): string | null {
  const m = /^\s*(\d{1,6})\.(\d{1,6})\.(\d{1,6})\s*$/.exec(raw ?? "")
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null
}

/** NEXUS_ANDROID_MIN_VERSION as x.y.z; unset or unreadable → ANDROID_FLOOR_DEFAULT (logged once). */
export function androidMinVersion(env: Env = process.env): string {
  const raw = env.NEXUS_ANDROID_MIN_VERSION
  const v = strictVersion(raw)
  if (raw?.trim() && !v) {
    warnOnce(`min:${raw}`, `NEXUS_ANDROID_MIN_VERSION=${JSON.stringify(raw)} is not x.y.z — using ${ANDROID_FLOOR_DEFAULT} (no Android build is refused)`)
  }
  return v ?? ANDROID_FLOOR_DEFAULT
}

/** NEXUS_ANDROID_LATEST_VERSION as x.y.z, or null when unset/unreadable (logged once). */
export function androidLatestVersion(env: Env = process.env): string | null {
  const raw = env.NEXUS_ANDROID_LATEST_VERSION
  const v = strictVersion(raw)
  if (raw?.trim() && !v) warnOnce(`latest:${raw}`, `NEXUS_ANDROID_LATEST_VERSION=${JSON.stringify(raw)} is not x.y.z — ignored`)
  return v
}

/** NEXUS_ANDROID_STORE_URL when it is an https URL; otherwise (unset, http, garbage) the download page. */
export function androidStoreUrl(env: Env = process.env): string {
  const raw = env.NEXUS_ANDROID_STORE_URL?.trim()
  if (!raw) return ANDROID_DOWNLOAD_URL_DEFAULT
  try {
    if (new URL(raw).protocol === "https:") return raw
  } catch {
    // fall through
  }
  warnOnce(`store:${raw}`, `NEXUS_ANDROID_STORE_URL=${JSON.stringify(raw)} is not an https URL — using ${ANDROID_DOWNLOAD_URL_DEFAULT}`)
  return ANDROID_DOWNLOAD_URL_DEFAULT
}

/** Whether a store URL is Google Play (the copy then says "Google Play"; otherwise "download"). */
export function isPlayStoreUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "play.google.com"
  } catch {
    return false
  }
}

/** `url` + `v=<version>` (the update reminder's per-release dedupe key), keeping any existing query. */
export function withVersionParam(url: string, version: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`
}

/** NEXUS_ANDROID_APK_DIR: where the sideloaded release lives inside the container. */
export function androidApkDir(env: Env = process.env): string {
  return env.NEXUS_ANDROID_APK_DIR?.trim() || ANDROID_APK_DIR_DEFAULT
}

/** NEXUS_ANDROID_LATEST_RELEASED_AT as epoch ms, or null when unset/unreadable (logged once). */
export function androidLatestReleasedAt(env: Env = process.env): number | null {
  const raw = env.NEXUS_ANDROID_LATEST_RELEASED_AT?.trim()
  if (!raw) return null
  // A full date-time with an explicit zone only: "2026-09-26" alone would be read as UTC midnight by
  // some parsers and local time by others, and the grace deadline must not depend on which.
  const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw) ? Date.parse(raw) : NaN
  if (!Number.isFinite(ms)) {
    warnOnce(`released:${raw}`, `NEXUS_ANDROID_LATEST_RELEASED_AT=${JSON.stringify(raw)} is not an ISO date-time with a zone — ignored (no grace window, no automatic minimum)`)
    return null
  }
  return ms
}

function cmp(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

export interface AndroidVersionPolicy {
  /** Oldest Android versionName still served, "x.y.z". "0.0.0" = nothing is refused. */
  minSupported: string
  /** NEXUS_ANDROID_LATEST_VERSION, or null when not set. */
  latest: string | null
  storeUrl: string
  /** Only while `latest` is inside its grace window: the moment it becomes the minimum (ISO)… */
  graceUntil?: string
  /** …and that version. */
  nextMinimum?: string
}

/**
 * The Android policy at `now`, from env alone — the iOS rule with the release moment stated by the owner:
 *   minSupported = NEXUS_ANDROID_MIN_VERSION, raised to LATEST once LATEST_RELEASED_AT + 3 days has passed;
 *   before that (and only if LATEST is above the floor) graceUntil/nextMinimum announce the step.
 * Without LATEST_RELEASED_AT nothing rolls and no window is announced. Pure: no I/O, no clock of its own.
 */
export function computeAndroidVersionPolicy(env: Env = process.env, now: number = Date.now()): AndroidVersionPolicy {
  let minSupported = androidMinVersion(env)
  const latest = androidLatestVersion(env)
  const storeUrl = androidStoreUrl(env)
  const releasedAt = latest ? androidLatestReleasedAt(env) : null
  if (latest && releasedAt !== null && cmp(latest, minSupported) > 0) {
    const at = releasedAt + ANDROID_GRACE_MS
    if (at <= now) minSupported = latest
    else return { minSupported, latest, storeUrl, graceUntil: new Date(at).toISOString(), nextMinimum: latest }
  }
  return { minSupported, latest, storeUrl }
}

/**
 * NEXUS_ANDROID_CERT_SHA256 → ["AB:CD:…", …] (upper-case, colon-separated, duplicates dropped).
 * Accepts the Play Console form or 64 bare hex digits. An entry that is not 32 bytes of hex is dropped
 * with one warning: a typo must not publish a statement nobody can match, or break the passkey list.
 */
export function androidCertFingerprints(raw: string | undefined = process.env.NEXUS_ANDROID_CERT_SHA256): string[] {
  const out: string[] = []
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const hex = trimmed.replace(/:/g, "").toUpperCase()
    if (!/^[0-9A-F]{64}$/.test(hex)) {
      warnOnce(`cert:${trimmed}`, `NEXUS_ANDROID_CERT_SHA256: ${JSON.stringify(trimmed)} is not a SHA-256 fingerprint — ignored`)
      continue
    }
    const pretty = hex.match(/../g)!.join(":")
    if (!out.includes(pretty)) out.push(pretty)
  }
  return out
}

/**
 * The WebAuthn origin Android's Credential Manager reports for an app signed with this certificate:
 * `android:apk-key-hash:<base64url(SHA-256 of the signing cert), no padding>`.
 */
export function apkKeyHashOrigin(fingerprint: string): string {
  return `android:apk-key-hash:${Buffer.from(fingerprint.replace(/:/g, ""), "hex").toString("base64url")}`
}

/** One origin per configured fingerprint; [] when NEXUS_ANDROID_CERT_SHA256 is empty. */
export function androidPasskeyOrigins(raw?: string): string[] {
  return androidCertFingerprints(raw ?? process.env.NEXUS_ANDROID_CERT_SHA256).map(apkKeyHashOrigin)
}

/**
 * The Digital Asset Links statement list served at /.well-known/assetlinks.json.
 *   handle_all_urls  — App Links (the manifest decides which paths: /f/, /v/, never /s/).
 *   get_login_creds  — passkeys and saved passwords shared between the site and the app.
 * No fingerprints → [] (a valid, empty statement list: the domain vouches for nothing yet).
 */
export function assetLinksStatements(raw?: string) {
  const fingerprints = androidCertFingerprints(raw ?? process.env.NEXUS_ANDROID_CERT_SHA256)
  if (fingerprints.length === 0) return []
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ]
}

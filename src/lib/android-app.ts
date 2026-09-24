/**
 * The Android app's identity and release facts, all set by the owner through env. There is no
 * anonymous Play Store lookup like the iTunes one app-store.ts uses, so nothing here is scraped:
 *
 *   NEXUS_ANDROID_MIN_VERSION     oldest Android versionName still served (x.y.z). Unset or unreadable
 *                                 → "0.0.0": no Android build is ever refused until the owner sets it.
 *   NEXUS_ANDROID_LATEST_VERSION  current Play release (x.y.z), for "update available" and the update
 *                                 reminder. Unset → unknown (null): nothing is nagged.
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

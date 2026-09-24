/**
 * Who is calling, and how new is it.
 *
 *   iOS 0.1.6 and later   `X-Nexus-Client: ios/<marketing>/<build>`   e.g. `ios/0.1.6/12`
 *   web (Phaëthon SPA)    `X-Nexus-Client: web/1`
 *   iOS 0.1.5 and older   no X-Nexus-Client; URLSession's default `User-Agent: NEXUS/<build> CFNetwork/…`
 *   Android               `X-Nexus-Client: android/<versionName>/<versionCode>`   e.g. `android/0.1.0/1`
 *   curl, scripts, …      neither
 *
 * The header is a statement of capability, not a credential. Every caller of these helpers must
 * treat "no header" and "a header we cannot read" as the OLDEST client — the one held to the
 * looser rules. The User-Agent fallback (parseLegacyIosUserAgent) exists for exactly one purpose:
 * the minimum-version gate in version-policy.ts, which refuses attendance WRITES from builds below
 * the minimum. Nothing else should key a rule on it.
 *
 * Pure: no I/O and no server-only imports, so it is safe to use from anywhere (middleware included).
 */

export type Version = readonly [number, number, number]

export interface ClientTag {
  /** Lower-cased: "ios", "android", "web", … */
  platform: string
  version: [number, number, number]
  /** The build number after the version, e.g. "12" in `ios/0.1.6/12`; null when absent. */
  build: string | null
}

// platform / 1–3 numeric parts / optional build. Deliberately a PREFIX match (no `$`): the attendance
// request rule has always accepted `ios/0.1.6<anything>`, and keeping that is what "no behaviour
// change" means there.
const TAG_RE = /^([a-z][a-z0-9_-]*)\/(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[^/\s]*)(?:\/([^/\s]+))?/i

/**
 * `ios/0.1.6/12` → { platform: "ios", version: [0, 1, 6], build: "12" }; `web/1` → { "web", [1, 0, 0], null }.
 * Missing, empty or unreadable → null. A native-app tag (iOS, Android) must carry all three parts (both
 * apps always send their marketing version / versionName as x.y.z) — `ios/1` or `android/1.2` is not
 * "1.0.0" / "1.2.0", it is something we do not understand, so null: never gated, looser rules.
 */
export function parseClientTag(raw: string | null | undefined): ClientTag | null {
  if (!raw) return null
  const m = TAG_RE.exec(raw.trim())
  if (!m) return null
  const platform = m[1].toLowerCase()
  if ((platform === "ios" || platform === "android") && m[4] === undefined) return null
  return {
    platform,
    version: [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)],
    build: m[5] ?? null,
  }
}

export type NativeAppPlatform = "ios" | "android"

/**
 * Which native app a request says it is, from X-Nexus-Client alone: "ios" / "android" for a readable
 * tag of that platform, null for the web, an unknown platform, an unreadable tag or no header. Like
 * everything here it is a statement, not a credential: use it to label, never to grant.
 */
export function nativeAppPlatformOf(raw: string | null | undefined): NativeAppPlatform | null {
  const client = parseClientTag(raw)
  return client && (client.platform === "ios" || client.platform === "android") ? client.platform : null
}

function toParts(v: string | readonly number[]): readonly number[] {
  return typeof v === "string" ? v.split(".").map((n) => parseInt(n, 10) || 0) : v
}

/**
 * -1 when a < b, 0 equal, 1 when a > b. Strings compare numerically per dot-separated part
 * ("0.1.9" < "0.1.10"), missing parts count as 0 ("0.1" == "0.1.0"), and tuples from
 * parseClientTag can be passed directly.
 */
export function compareVersions(a: string | readonly number[], b: string | readonly number[]): number {
  const pa = toParts(a), pb = toParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/** "0.1.6" / "0.1" / "1" → normalised "x.y.z"; anything else → null. */
export function normalizeVersion(raw: string | null | undefined): string | null {
  const m = /^\s*(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?\s*$/.exec(raw ?? "")
  return m ? `${Number(m[1])}.${Number(m[2] ?? 0)}.${Number(m[3] ?? 0)}` : null
}

/**
 * CFBundleVersion → marketing version for the iOS builds that predate the X-Nexus-Client header.
 * Each entry is the FIRST build of that version; builds are monotonic, so a build maps to the last
 * entry at or below it. Taken from nexus-ios project.yml history (CURRENT_PROJECT_VERSION /
 * MARKETING_VERSION): 1 = 0.1.0, 2–3 = 0.1.1, 4 = 0.1.2, 5–7 = 0.1.3, 8 = 0.1.4, 9–11 = 0.1.5
 * (only 11 shipped), 12 = 0.1.6 — which sends the header, so the UA path should never see it.
 * (Build 2 was briefly labelled "1.0" on 31 Aug before going back to 0.1.x; it is pre-0.1.4 either way.)
 */
const IOS_BUILDS: ReadonlyArray<readonly [number, string]> = [
  [1, "0.1.0"],
  [2, "0.1.1"],
  [4, "0.1.2"],
  [5, "0.1.3"],
  [8, "0.1.4"],
  [9, "0.1.5"],
  [12, "0.1.6"],
]

/** Marketing version of an iOS build number, or null for one we cannot place (0, negative, NaN). */
export function iosVersionForBuild(build: number): string | null {
  if (!Number.isInteger(build) || build < IOS_BUILDS[0][0]) return null
  let v: string | null = null
  for (const [first, version] of IOS_BUILDS) {
    if (build >= first) v = version
    else break
  }
  return v
}

const LEGACY_UA_RE = /^NEXUS\/(\d{1,6})\b/

/**
 * The version of a header-less iOS app from its User-Agent (`NEXUS/11 CFNetwork/… Darwin/…`), or null.
 * ONLY for the minimum-version gate — see the file comment. A request that carries X-Nexus-Client is
 * never judged by this.
 */
export function parseLegacyIosUserAgent(ua: string | null | undefined): { build: number; version: string } | null {
  if (!ua) return null
  const m = LEGACY_UA_RE.exec(ua)
  if (!m) return null
  const build = Number(m[1])
  const version = iosVersionForBuild(build)
  return version ? { build, version } : null
}

/**
 * Policy #2 — "a rule turns on when the App Store has the version that can obey it."
 *
 * True once the App Store has shown a version ≥ `v`: either the current lookup says so, or the
 * server has recorded seeing such a version before (AppReleaseSeen, which survives restarts — so
 * once true it stays true, even through an Apple outage). False while it has not, and false when
 * nothing is known (lookup failed and nothing recorded) — a rule gated on this stays OFF, the
 * looser side, when we do not know. Cached like the version policy (rows ~1 min, lookup ~1 h),
 * and never waits more than ~1.5 s for Apple.
 *
 * How to gate a server-wide rule on it — e.g. hold EVERYONE to single-day sick notes once 0.1.6
 * can be downloaded, while a phone that already sends `ios/0.1.6+` is held to it from day one:
 *
 * ```ts
 * import { isIosVersionLive, parseClientTag, compareVersions } from "@/lib/client-version"
 *
 * const client = parseClientTag(request.headers.get("x-nexus-client"))
 * const capable = client?.platform === "web" || (client?.platform === "ios" && compareVersions(client.version, "0.1.6") >= 0)
 * const enforce = capable || (await isIosVersionLive("0.1.6"))
 * if (enforce && startDate !== endDate) return NextResponse.json({ error: "…" }, { status: 400 })
 * ```
 *
 * Mind what "live" means before using the second half: the day a version is live, most phones are
 * still on the old one. Only gate on it where the older app can still comply, or wait for the
 * version to become the minimum (version-policy.ts: 3 days after it first appears) so older apps
 * are told to update instead of being refused with an error they cannot act on.
 */
export async function isIosVersionLive(v: string): Promise<boolean> {
  // Loaded lazily: version-policy imports this module, and it touches the database.
  const { getIosVersionPolicy } = await import("@/lib/version-policy")
  const { latestIosVersion } = await import("@/lib/app-store")
  const policy = await getIosVersionPolicy()
  if (policy.highestSeen && compareVersions(policy.highestSeen, v) >= 0) return true
  const latest = await latestIosVersion()
  return latest !== null && compareVersions(latest, v) >= 0
}

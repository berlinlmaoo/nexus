import prisma from "@/lib/prisma"
import { APP_STORE_URL, latestIosVersion } from "@/lib/app-store"
import { compareVersions, normalizeVersion, parseClientTag, parseLegacyIosUserAgent } from "@/lib/client-version"

/**
 * The minimum iOS version NEXUS still serves — and the 426 gate that enforces it.
 *
 * The minimum moves by itself:
 *
 *   minSupported = max(FLOOR, every App Store version this server first saw ≥ 3 days ago)
 *
 * FLOOR is NEXUS_IOS_MIN_VERSION, "0.1.4" when unset or unreadable. A release L therefore becomes
 * the minimum exactly GRACE (3 days) after the server first saw the App Store serve it — time for
 * automatic updates to land and for the in-app "update available" nag to work — and until then the
 * previous minimum stands. "First saw" is persisted (AppReleaseSeen, written by app-store.ts from
 * every genuine store lookup), so deploys and restarts do not reset the clock, and the minimum is
 * computed from those rows, never from the live lookup: a slow, failed or stale lookup cannot lower
 * it. Rows are never deleted, so the minimum only ever moves up.
 *
 * Who is refused, by the gate in middleware.ts (iosUpgradeGate below):
 *   • X-Nexus-Client `ios/x.y.z` below the minimum → 426 on EVERY /api call except
 *     /api/app/version-policy and /api/health. These builds (0.1.6+) know to show the update screen.
 *   • No header, User-Agent `NEXUS/<build>` (iOS 0.1.5 and older) below the minimum → 426 only on
 *     attendance WRITES (anything under /api/attendance that is not GET/HEAD/OPTIONS). Those builds
 *     have no update screen; they show the server's `error` text, so reads keep working and only the
 *     thing that must not happen on an outdated client — taking attendance — is stopped.
 *   • Everything else — the web (`web/1`, browsers), an unreadable header, an unknown build, curl —
 *     is NEVER refused. An unidentifiable caller cannot be told apart safely, and refusing it would
 *     lock out people who cannot tell the server is the problem.
 */

export const IOS_FLOOR_DEFAULT = "0.1.4"
export const GRACE_MS = 3 * 24 * 60 * 60 * 1000
/**
 * The first release the rolling minimum applies to. Versions the App Store already served before
 * this system existed (0.1.5 and older) never raise the minimum on their own: the owner's rule is
 * "0.1.4 until 0.1.6 ships, then 0.1.6 three days later". Without this, the empty table recorded
 * 0.1.5 on the day of deploy and cut 0.1.4 off attendance three days later — before 0.1.6 existed.
 */
export const ROLLING_FROM = "0.1.6"
const ROWS_FRESH_MS = 60 * 1000

export const UPGRADE_REQUIRED_MESSAGE =
  "This version of NEXUS is no longer supported. Update from the App Store to keep going."
export const ATTENDANCE_UPGRADE_MESSAGE =
  "This NEXUS version can no longer take attendance. Update NEXUS from the App Store, then try again."

export interface IosRelease { version: string; firstSeenAt: Date }

export interface IosVersionPolicy {
  /** Oldest version still served, "x.y.z". */
  minSupported: string
  /** When a newer release is inside its grace window: the moment it becomes the minimum (ISO). */
  graceUntil?: string
  /** …and the version that becomes the minimum then. */
  nextMinimum?: string
  /** Highest version the App Store has ever been seen serving (recorded), or null. */
  highestSeen: string | null
}

let floorMemo: { raw: string | undefined; floor: string } | null = null

/** NEXUS_IOS_MIN_VERSION normalised to x.y.z; unset or unreadable → IOS_FLOOR_DEFAULT (logged once). */
export function iosFloor(): string {
  const raw = process.env.NEXUS_IOS_MIN_VERSION
  if (floorMemo && floorMemo.raw === raw) return floorMemo.floor
  const parsed = normalizeVersion(raw)
  if (raw?.trim() && !parsed) {
    console.warn(`NEXUS_IOS_MIN_VERSION=${JSON.stringify(raw)} is not x.y.z — using ${IOS_FLOOR_DEFAULT}`)
  }
  floorMemo = { raw, floor: parsed ?? IOS_FLOOR_DEFAULT }
  return floorMemo.floor
}

/** The policy at time `now` for a floor and the recorded releases. Pure — the rule, in one place. */
export function computeIosVersionPolicy(floor: string, releases: readonly IosRelease[], now: number): IosVersionPolicy {
  let min = normalizeVersion(floor) ?? IOS_FLOOR_DEFAULT
  let highestSeen: string | null = null
  for (const r of releases) {
    const v = normalizeVersion(r.version)
    if (!v) continue
    if (!highestSeen || compareVersions(v, highestSeen) > 0) highestSeen = v
    if (compareVersions(v, ROLLING_FROM) < 0) continue
    if (r.firstSeenAt.getTime() + GRACE_MS <= now && compareVersions(v, min) > 0) min = v
  }
  // The next step up: of the releases still inside their window and above the minimum, the one that
  // matures first (the highest, if several mature at the same moment).
  let next: { version: string; at: number } | null = null
  for (const r of releases) {
    const v = normalizeVersion(r.version)
    const at = r.firstSeenAt.getTime() + GRACE_MS
    if (!v || at <= now || compareVersions(v, min) <= 0 || compareVersions(v, ROLLING_FROM) < 0) continue
    if (!next || at < next.at || (at === next.at && compareVersions(v, next.version) > 0)) next = { version: v, at }
  }
  return next
    ? { minSupported: min, graceUntil: new Date(next.at).toISOString(), nextMinimum: next.version, highestSeen }
    : { minSupported: min, highestSeen }
}

// ---------------------------------------------------------------------------------------------
// Cached policy. State lives on globalThis so the middleware bundle and the route bundles — which
// webpack gives separate module instances — share one cache and one "highest minimum so far".

interface PolicyState {
  releases: IosRelease[] | null
  loadedAt: number
  inflight: Promise<void> | null
  /** Highest minimum ever returned by this process: belt and braces for "never lower". */
  highWater: string | null
}
const g = globalThis as unknown as { __nexusIosVersionPolicy?: PolicyState }
const state: PolicyState = (g.__nexusIosVersionPolicy ??= { releases: null, loadedAt: 0, inflight: null, highWater: null })

function refresh(): Promise<void> {
  if (!state.inflight) {
    state.inflight = (async () => {
      try {
        const rows = await prisma.appReleaseSeen.findMany({
          where: { platform: "ios" },
          select: { version: true, firstSeenAt: true },
        })
        state.releases = rows
        state.loadedAt = Date.now()
      } catch (e) {
        // Keep the previous rows: a failed read must not lower the minimum. Retry after the window.
        console.error("version policy: could not read AppReleaseSeen:", e)
        state.loadedAt = Date.now()
      } finally {
        state.inflight = null
      }
      // Also keep the App Store observation going (hourly at most — the lookup is cached), so a
      // new release starts its grace clock even on a day nobody opens /api/app/version-policy.
      void latestIosVersion(0).catch(() => null)
    })()
  }
  return state.inflight
}

/** Drop the cached rows so the next call re-reads them (after a new release is recorded). */
export function invalidateIosVersionPolicy(): void {
  state.loadedAt = 0
}

/**
 * The current iOS version policy. Rows are cached ~1 min and refreshed in the background; only the
 * very first call in a process waits for the database. Evaluated against the clock on every call,
 * so a release becomes the minimum at its exact graceUntil, not at the next refresh.
 */
export async function getIosVersionPolicy(now = Date.now()): Promise<IosVersionPolicy> {
  if (!state.releases) await refresh()
  else if (now - state.loadedAt > ROWS_FRESH_MS) void refresh()
  const policy = computeIosVersionPolicy(iosFloor(), state.releases ?? [], now)
  if (state.highWater && compareVersions(state.highWater, policy.minSupported) > 0) {
    policy.minSupported = state.highWater
  } else {
    state.highWater = policy.minSupported
  }
  return policy
}

// ---------------------------------------------------------------------------------------------
// The gate.

const EXEMPT = new Set(["/api/app/version-policy", "/api/health"])
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export interface UpgradeRequired {
  status: 426
  body: { error: string; code: "UPGRADE_REQUIRED"; minSupported: string; storeUrl: string }
}

function isAttendancePath(pathname: string): boolean {
  return pathname === "/api/attendance" || pathname.startsWith("/api/attendance/")
}

/**
 * null = let the request through; otherwise the 426 to send. See the file comment for who is
 * refused. Requests with no X-Nexus-Client and no `NEXUS/<build>` User-Agent (the web, curl,
 * scripts) return null before anything is looked up — they are never blocked.
 */
export async function iosUpgradeGate(
  request: { method: string; headers: { get(name: string): string | null } },
  pathname: string,
): Promise<UpgradeRequired | null> {
  if (!pathname.startsWith("/api/") || EXEMPT.has(pathname)) return null

  let version: readonly number[] | string
  let message: string
  const tag = request.headers.get("x-nexus-client")
  if (tag) {
    const client = parseClientTag(tag)
    if (!client || client.platform !== "ios") return null // web/1, unknown platform, unreadable: never blocked
    version = client.version
    message = UPGRADE_REQUIRED_MESSAGE
  } else {
    // A pre-0.1.6 phone: attendance writes only, reads keep working.
    if (READ_METHODS.has(request.method.toUpperCase()) || !isAttendancePath(pathname)) return null
    const legacy = parseLegacyIosUserAgent(request.headers.get("user-agent"))
    if (!legacy) return null // not the iOS app, or a build we cannot place: never blocked
    version = legacy.version
    message = ATTENDANCE_UPGRADE_MESSAGE
  }

  const { minSupported } = await getIosVersionPolicy()
  if (compareVersions(version, minSupported) >= 0) return null
  return { status: 426, body: { error: message, code: "UPGRADE_REQUIRED", minSupported, storeUrl: APP_STORE_URL } }
}

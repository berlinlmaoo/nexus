import prisma from "@/lib/prisma"

/**
 * The App Store side of "which NEXUS is current": the store link, the version Apple is serving,
 * and a persistent record of when this server first saw each version (AppReleaseSeen).
 *
 * Moved out of app-update.ts (which re-exports the lookup and the link, so its importers are
 * unchanged) because that module also pulls in the notification service, and the middleware's
 * version gate needs the lookup without it.
 *
 * Every GENUINE answer from Apple is recorded — from the daily update reminder, the version-policy
 * endpoint and the policy refresh alike, because all of them go through fetchLatestIosVersion. The
 * NEXUS_IOS_LATEST_VERSION fallback and stale cache values are never recorded: "first seen" must
 * mean Apple really served it, since the minimum supported version is derived from it.
 */
export const APP_STORE_ID = "6807031457"
export const APP_STORE_URL = `https://apps.apple.com/id/app/id${APP_STORE_ID}`
/**
 * The store lookup, with a cache-buster.
 *
 * Apple serves this endpoint through a CDN that holds the previous answer for hours after a
 * release. Measured on 24 Sep 2026: the plain URL returned 0.1.4 (released the 16th) from this
 * server while the same URL with a changing parameter returned 0.1.5 (released the 23rd). Without
 * it every "update NEXUS" reminder is a day late, silently — the run reports success and simply
 * compares everyone against the old version. The in-process cache below is what keeps the rate
 * down; the parameter only stops someone else's cache answering for Apple.
 */
function lookupUrl(): string {
  return `https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=id&_=${Date.now()}`
}

let cache: { version: string; at: number } | null = null

/** Current App Store version, cached for an hour. Falls back to NEXUS_IOS_LATEST_VERSION, then null. */
export async function fetchLatestIosVersion(): Promise<string | null> {
  if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.version
  try {
    const res = await fetch(lookupUrl(), {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    })
    if (res.ok) {
      const json = (await res.json()) as { results?: Array<{ version?: string }> }
      const v = json.results?.[0]?.version?.trim()
      if (v && /^\d+(\.\d+)*$/.test(v)) {
        cache = { version: v, at: Date.now() }
        void recordIosRelease(v)
        return v
      }
    }
  } catch (e) { console.error("app store lookup failed:", e) }
  const env = process.env.NEXUS_IOS_LATEST_VERSION?.trim()
  return env && /^\d+(\.\d+)*$/.test(env) ? env : cache?.version ?? null
}

// Versions already written this process — one INSERT per version per process, not per lookup.
const recorded = new Set<string>()

/**
 * Remember that Apple served `version`. First sighting wins (ON CONFLICT DO NOTHING keeps the
 * original firstSeenAt), so a restart, a second instance or a CDN flip-flop never moves it later.
 * Never throws: a failed write is retried on the next lookup.
 */
export async function recordIosRelease(version: string): Promise<void> {
  if (recorded.has(version)) return
  try {
    const { count } = await prisma.appReleaseSeen.createMany({
      data: [{ platform: "ios", version }],
      skipDuplicates: true,
    })
    recorded.add(version)
    if (count > 0) {
      console.log(`app store: first sighting of iOS ${version}`)
      // Let the policy pick up the new grace window now rather than at its next refresh.
      const { invalidateIosVersionPolicy } = await import("@/lib/version-policy")
      invalidateIosVersionPolicy()
    }
  } catch (e) {
    console.error(`app store: could not record iOS ${version}:`, e)
  }
}

// ---------------------------------------------------------------------------------------------
// Fast, never-throwing access for request paths.

const FRESH_MS = 60 * 60 * 1000 // a good answer is kept an hour (same as the lookup's own cache)
const RETRY_MS = 5 * 60 * 1000 // a failed lookup is not retried for five minutes
let latestMemo: { version: string | null; until: number } | null = null
let inflight: Promise<string | null> | null = null

/**
 * The App Store's current iOS version, or null. Never waits longer than `maxWaitMs` for Apple:
 * past that it answers with the last known value (or null) and lets the lookup finish in the
 * background for the next caller. Concurrent callers share one lookup, and a failure is remembered
 * for five minutes so an Apple outage does not turn into one outbound request per API call.
 * Falls back to NEXUS_IOS_LATEST_VERSION like the lookup it wraps (fetchLatestIosVersion).
 */
export async function latestIosVersion(maxWaitMs = 1500): Promise<string | null> {
  if (latestMemo && Date.now() < latestMemo.until) return latestMemo.version
  if (!inflight) {
    inflight = fetchLatestIosVersion()
      .catch(() => null)
      .then((v) => {
        // A failed refresh keeps a previously good answer rather than forgetting it.
        latestMemo = v
          ? { version: v, until: Date.now() + FRESH_MS }
          : { version: latestMemo?.version ?? null, until: Date.now() + RETRY_MS }
        return latestMemo.version
      })
      .finally(() => { inflight = null })
  }
  const stale = latestMemo?.version ?? null
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string | null>((resolve) => { timer = setTimeout(() => resolve(stale), maxWaitMs) })
  try {
    return await Promise.race([inflight, timeout])
  } finally {
    clearTimeout(timer)
  }
}

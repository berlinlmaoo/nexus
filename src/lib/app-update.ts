import prisma from "@/lib/prisma"
import { createInAppNotification } from "@/lib/notification-service"

/**
 * "Your NEXUS is out of date" — decided from what the phones themselves report.
 *
 * Every device tells the server its app version when it registers for push; the App Store tells
 * us what the current version is. Anyone whose newest device is behind gets one push, repeated no
 * more than weekly, with the store link. Nothing to configure per release: the day a build goes
 * live on the store, the next morning's run finds it. A phone that registered before versions
 * were reported (blank) is by definition on an old build and is treated as behind.
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
const REMIND_EVERY_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE_WITHIN_MS = 60 * 24 * 60 * 60 * 1000

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
      if (v && /^\d+(\.\d+)*$/.test(v)) { cache = { version: v, at: Date.now() }; return v }
    }
  } catch (e) { console.error("app store lookup failed:", e) }
  const env = process.env.NEXUS_IOS_LATEST_VERSION?.trim()
  return env && /^\d+(\.\d+)*$/.test(env) ? env : cache?.version ?? null
}

/** -1 when a < b, 0 equal, 1 when a > b; "0.1.4" vs "0.1.10" compares numerically per part. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0), pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

export async function remindOutdatedApps(opts: { dryRun?: boolean } = {}) {
  const latest = await fetchLatestIosVersion()
  if (!latest) return { latest: null, checked: 0, behind: 0, reminded: 0, note: "App Store version unknown" }
  const devices = await prisma.deviceInstallation.findMany({
    where: { disabledAt: null, lastSeenAt: { gte: new Date(Date.now() - ACTIVE_WITHIN_MS) } },
    select: { userId: true, appVersion: true, lastSeenAt: true },
  })
  // One verdict per person: their NEWEST device decides, so somebody who already updated on the
  // phone they carry is not nagged about an old iPad in a drawer.
  const newest = new Map<string, string | null>()
  for (const d of devices) {
    const cur = newest.get(d.userId)
    if (cur === undefined) { newest.set(d.userId, d.appVersion ?? null); continue }
    if (d.appVersion && (!cur || compareVersions(d.appVersion, cur) > 0)) newest.set(d.userId, d.appVersion)
  }
  let behind = 0, reminded = 0
  const behindUsers: Array<{ userId: string; version: string | null }> = []
  for (const [userId, version] of newest) {
    const isBehind = !version || compareVersions(version, latest) < 0
    if (!isBehind) continue
    behind++
    behindUsers.push({ userId, version })
    if (opts.dryRun) continue
    const created = await createInAppNotification({
      userId,
      type: "app_update",
      title: `NEXUS ${latest} is on the App Store`,
      message: version
        ? `You're on ${version}. Update to get the latest fixes and features — it takes a minute.`
        : `Your NEXUS is an older version. Update to get the latest fixes and features — it takes a minute.`,
      // The version rides in the link so the weekly dedupe is per release: a new release is a new reminder.
      link: `${APP_STORE_URL}?v=${latest}`,
      push: true,
      dedupeWindowMs: REMIND_EVERY_MS,
    }).catch(() => null)
    if (created) reminded++
  }
  return { latest, checked: newest.size, behind, reminded, ...(opts.dryRun ? { behindUsers } : {}) }
}

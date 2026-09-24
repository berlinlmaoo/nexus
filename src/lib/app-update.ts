import prisma from "@/lib/prisma"
import { createInAppNotification } from "@/lib/notification-service"
import { APP_STORE_URL, fetchLatestIosVersion } from "@/lib/app-store"
import { compareVersions } from "@/lib/client-version"
import { androidLatestVersion, androidStoreUrl, isPlayStoreUrl, withVersionParam } from "@/lib/android-app"

// The store lookup moved to app-store.ts (which also records every version Apple serves in
// AppReleaseSeen — this reminder's daily lookup counts as a sighting) and the comparison to
// client-version.ts, so the middleware's version gate can use them without pulling in the
// notification service. Re-exported so every existing `from "@/lib/app-update"` import still works.
export { APP_STORE_ID, APP_STORE_URL, fetchLatestIosVersion } from "@/lib/app-store"
export { compareVersions } from "@/lib/client-version"

/**
 * "Your NEXUS is out of date" — decided from what the phones themselves report.
 *
 * Every device tells the server its app version when it registers for push; the App Store tells
 * us what the current version is. Anyone whose newest device is behind gets one push, repeated no
 * more than weekly, with the store link. Nothing to configure per release: the day a build goes
 * live on the store, the next morning's run finds it. A phone that registered before versions
 * were reported (blank) is by definition on an old build and is treated as behind.
 */
const REMIND_EVERY_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE_WITHIN_MS = 60 * 24 * 60 * 60 * 1000

/**
 * `userIds` reminds those people whatever version they are on, and ignores the weekly dedupe — for
 * reading the notification back after a release without waiting to fall behind one. Everyone else
 * is still judged on their version, so a normal run is unchanged.
 */
export async function remindOutdatedApps(opts: { dryRun?: boolean; userIds?: string[] } = {}) {
  // Android first and independently: it needs no App Store answer, and an Apple outage must not
  // stop it (nor the other way round). Additive in the result: `android`; the iOS fields are unchanged.
  const android = await remindOutdatedAndroid(opts)
  const forced = new Set(opts.userIds ?? [])
  const latest = await fetchLatestIosVersion()
  if (!latest) return { latest: null, checked: 0, behind: 0, reminded: 0, note: "App Store version unknown", android }
  const devices = await prisma.deviceInstallation.findMany({
    // iPhones only: an Android build is judged against the Play version below, never the App Store's.
    where: { platform: "ios", disabledAt: null, lastSeenAt: { gte: new Date(Date.now() - ACTIVE_WITHIN_MS) } },
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
  // Somebody asked for by name is reminded even if their phone is up to date, and even if they
  // were reminded this week. (Unless they only have an Android phone: the Android pass reminded them.)
  for (const id of forced) if (!newest.has(id) && !android.forcedHandled.has(id)) newest.set(id, null)
  for (const [userId, version] of newest) {
    const force = forced.has(userId)
    const isBehind = !version || compareVersions(version, latest) < 0
    if (!isBehind && !force) continue
    behind++
    behindUsers.push({ userId, version })
    if (opts.dryRun) continue
    const created = await createInAppNotification({
      userId,
      type: "app_update",
      title: `NEXUS ${latest} is on the App Store`,
      message: !version
        ? `Your NEXUS is an older version. Update to get the latest fixes and features — it takes a minute.`
        : compareVersions(version, latest) < 0
          ? `You're on ${version}. Update to get the latest fixes and features — it takes a minute.`
          : `You're already on ${version} — nothing to do. This is what the reminder looks like.`,
      // The version rides in the link so the weekly dedupe is per release: a new release is a new reminder.
      link: `${APP_STORE_URL}?v=${latest}`,
      push: true,
      dedupeWindowMs: force ? 0 : REMIND_EVERY_MS,
    }).catch(() => null)
    if (created) reminded++
  }
  return { latest, checked: newest.size, behind, reminded, ...(opts.dryRun ? { behindUsers } : {}), android: android.result }
}

/**
 * The same reminder for Android phones, against NEXUS_ANDROID_LATEST_VERSION (no store to look up),
 * linking to NEXUS_ANDROID_STORE_URL — the signed-in /download/android page by default, never the App
 * Store. Unset → nothing is sent: an unknown "latest" must never tell anyone they are behind. Only
 * people with an Android device are judged here, by their newest Android device; people named in
 * `userIds` who have an Android device (and no iPhone) are reminded here instead of by the iOS pass.
 */
async function remindOutdatedAndroid(opts: { dryRun?: boolean; userIds?: string[] }) {
  const forcedHandled = new Set<string>()
  const latest = androidLatestVersion()
  if (!latest) {
    return { forcedHandled, result: { latest: null, checked: 0, behind: 0, reminded: 0, note: "NEXUS_ANDROID_LATEST_VERSION not set" } }
  }
  const storeUrl = androidStoreUrl()
  const forced = new Set(opts.userIds ?? [])
  const devices = await prisma.deviceInstallation.findMany({
    where: { platform: "android", disabledAt: null, lastSeenAt: { gte: new Date(Date.now() - ACTIVE_WITHIN_MS) } },
    select: { userId: true, appVersion: true },
  })
  const newest = new Map<string, string | null>()
  for (const d of devices) {
    const cur = newest.get(d.userId)
    if (cur === undefined) { newest.set(d.userId, d.appVersion ?? null); continue }
    if (d.appVersion && (!cur || compareVersions(d.appVersion, cur) > 0)) newest.set(d.userId, d.appVersion)
  }
  if (forced.size) {
    const withIphone = new Set(
      (await prisma.deviceInstallation.findMany({
        where: { platform: "ios", disabledAt: null, userId: { in: [...forced] } },
        select: { userId: true },
      })).map((d) => d.userId),
    )
    for (const id of forced) if (newest.has(id) && !withIphone.has(id)) forcedHandled.add(id)
  }
  let behind = 0, reminded = 0
  const behindUsers: Array<{ userId: string; version: string | null }> = []
  for (const [userId, version] of newest) {
    const force = forced.has(userId)
    const isBehind = !version || compareVersions(version, latest) < 0
    if (!isBehind && !force) continue
    behind++
    behindUsers.push({ userId, version })
    if (opts.dryRun) continue
    const created = await createInAppNotification({
      userId,
      type: "app_update",
      title: isPlayStoreUrl(storeUrl) ? `NEXUS ${latest} is on Google Play` : `NEXUS ${latest} is ready to download`,
      message: !version
        ? `Your NEXUS is an older version. Update to get the latest fixes and features — it takes a minute.`
        : compareVersions(version, latest) < 0
          ? `You're on ${version}. Update to get the latest fixes and features — it takes a minute.`
          : `You're already on ${version} — nothing to do. This is what the reminder looks like.`,
      // Per-release dedupe, as on iOS (the download page and Play both ignore the extra parameter).
      link: withVersionParam(storeUrl, latest),
      push: true,
      dedupeWindowMs: force ? 0 : REMIND_EVERY_MS,
    }).catch(() => null)
    if (created) reminded++
  }
  return { forcedHandled, result: { latest, checked: newest.size, behind, reminded, ...(opts.dryRun ? { behindUsers } : {}) } }
}

export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { APP_STORE_URL, latestIosVersion } from "@/lib/app-store"
import { getAndroidVersionPolicy, getIosVersionPolicy } from "@/lib/version-policy"
import { readAndroidRelease } from "@/lib/android-release"

/**
 * GET /api/app/version-policy — public, no auth. What the iOS app needs to decide on its own
 * whether to nag ("update available": latest > mine), warn ("from <graceUntil> this version stops
 * working": mine < nextMinimum) or stop ("update required": mine < minSupported).
 *
 *   minSupported  max(NEXUS_IOS_MIN_VERSION floor, App Store versions first seen ≥ 3 days ago) —
 *                 see lib/version-policy.ts. Below it, /api calls get HTTP 426 (middleware.ts);
 *                 this route is exempt so the app can always read why.
 *   latest        App Store version (cached ~1h); when Apple is slow or down, the highest version
 *                 ever recorded; null only when neither is known. Never waits more than 1 s on Apple.
 *   storeUrl      the App Store page.
 *   graceUntil    only while a newer release is inside its 3-day window: when it becomes the minimum…
 *   nextMinimum   …and which version that is.
 *   android       the Android app's policy, additive (the top-level fields above stay iOS's, so every
 *                 shipped iOS build decodes exactly what it did):
 *                 { minSupported, latest, storeUrl, graceUntil?, nextMinimum? }.
 *                 minSupported = NEXUS_ANDROID_MIN_VERSION ("0.0.0" = nothing refused), raised to latest
 *                 3 days after NEXUS_ANDROID_LATEST_RELEASED_AT; latest = NEXUS_ANDROID_LATEST_VERSION or
 *                 null; storeUrl = NEXUS_ANDROID_STORE_URL, default the /download/android page.
 *                 graceUntil/nextMinimum only inside that 3-day window, same meaning as iOS's.
 */
export async function GET() {
  const [policy, latest, release] = await Promise.all([getIosVersionPolicy(), latestIosVersion(1000), readAndroidRelease().catch(() => "missing" as const)])
  return NextResponse.json(
    {
      minSupported: policy.minSupported,
      latest: latest ?? policy.highestSeen,
      storeUrl: APP_STORE_URL,
      ...(policy.graceUntil ? { graceUntil: policy.graceUntil, nextMinimum: policy.nextMinimum } : {}),
      // + the published APK (current.json): latestName/latestBuild let an app see a newer BUILD of the
      // same version (owner, 29 Sep 2026: builds stay 0.1.6 while it is tested) — additive fields.
      android: { ...getAndroidVersionPolicy(), ...(typeof release === "object" ? { latestName: release.versionName, latestBuild: release.versionCode } : {}) },
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  )
}

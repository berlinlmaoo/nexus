# NEXUS monorepo (since 14 Oct 2026)

One repo, `github.com/berlinlmaoo/nexus`, branch **dev** for all redesign work:

| Path | What | Built where |
|---|---|---|
| `src/`, `pages/`, `prisma/`, `deploy/` | server (Next.js API, realtime, cron) | nexus-prod (`~/deploy-nexus-dev.sh`, prod blue-green) |
| `apps/nexus-lovable-ui` | web SPA | nexus-prod (same deploy) |
| `apps/ios` | iOS / iPadOS / macOS app (was `nexus-ios`, history kept) | owner's Mac: `cd apps/ios && xcodegen generate`, Xcode |
| `apps/android` | Android app (was `nexus-android`, history kept) | VM agents: `cd apps/android && ./gradlew …` |

- The server image never contains `apps/ios` / `apps/android` (`.dockerignore`).
- The old repos `nexus-ios` and `nexus-android` are frozen after the cutover (README says "moved"); nothing is deleted.
- One feature = one commit/PR across server, web, iOS and Android.
- UI tour: `apps/ios/scripts/ui-tour.sh` (iOS/iPad/Mac/web) and `apps/android/scripts/ui-tour-android.sh`.

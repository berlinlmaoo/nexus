# Android Pipeline Dashboard v8

Branch: `feat/android-pipeline-v8`, based on DEV merge `3b0039bc7c5455c93231da6702c1b493a5a227d0`. Implements `CODEX-INPUT/pipeline-v8-android.md` and the native contract. The configured origin was a missing `C:/work/nexus-dev.bundle`; DEV was fetched directly from the repository's GitHub URL into `origin/dev` before creating the feature branch. No merge or push was performed.

## Changes

- Optional v8 deal fields and ordered cashback, contact and budget lists decode safely on older responses. Item adds use a per-tap request UUID, field edits PATCH only the changed key, and every item response replaces the cached deal. Queued item edits and retained drafts preserve typing during earlier saves or realtime refreshes.
- Deal sections follow the contract: barter after main date; Cashback after Commercial; Project contacts after Contract; Budget expenses before Real cost. Budget usage/remaining is server-derived, with green remaining and red over-budget values. Budgets do not change margin. Each cost line has a category picker and always serializes `budgetId`, including null, with `costsBase`; unknown cost metadata and deleted category references survive editing.
- Document types and contact roles follow server vocabulary. EN/ID labels cover all new states; whole rupiah use `Rp 6.000.000` in either language. Years and counts remain plain numbers.
- Verified BoD/OAA discovery adds the pinned Projects row and title switcher. Other roles never request board discovery. Discovery or combined-view 403 hides entry points. All Pipelines uses the existing board, list and health layouts, company chips, company/year filters and combined KPIs. It offers no creation, inline editing or drag. A deal opens through a separate view model for its actual board, with company label and a return action.
- Year and combined company filters query the server so KPIs match those filters; ordinary search, PM, BD, service and health filters stay local. Filter request failures restore the applied filter. Excel downloads use the corresponding filtered server endpoint.
- Presentation mode stays in process memory across board switches, resets on sign-out and is never stored. Entering All Pipelines while presenting uses a centered confirmation. Cashback, Budget and real cost sections are absent; barter and money history are masked; contacts and compensation remain visible. Exports retain real amounts.
- All Pipelines joins every returned board's project room and refetches on the existing `pipeline-changed` event. Source details refetch their own board. View/comment access renders read-only fields.

## Verification

Final debug build and JVM test command uses the installed Temurin JDK 21, one Gradle worker and in-process Kotlin compilation:

```powershell
./gradlew.bat --no-daemon testDebugUnitTest assembleDebug --max-workers=1 `
  '-Dorg.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8' `
  '-Pkotlin.compiler.execution.strategy=in-process' `
  '-PnexusDevHost=<private DEV hostname>' '-PnexusDevAddress=<debug DNS override>'
```

**969 tests passed; zero failures, errors or skips.** New tests exercise old-server decoding, item ordering, partial updates and idempotency, explicit budget nulls, retained cost metadata and merge base, server vocabulary, year/source export URLs, role-before-discovery ordering, forbidden discovery, retained drafts and presentation history privacy.

DEV API checks use a disposable `[TEST] Android Pipeline v8` deal in a QA board. [Live checks](pipeline-v8-evidence/live-api.json) verify item CRUD, duplicate taps, partial field preservation, green/red budget results, unchanged margin, explicit category clearing, deleted category references and year/company filtering. [Excel verification](pipeline-v8-evidence/excel.json) inspects four real XLSX workbooks: board/year and combined/company/year in EN and ID. All contain the existing 34 columns followed by the nine required columns in order, localized details and Filter lines, numeric unmasked rupiah cells, and a numeric year without currency formatting.

The [verification record](pipeline-v8-evidence/verification.json) contains test totals, the local debug APK SHA-256, and SHA-256 values for all **90 screenshots**. Matching accessibility text accompanies each image. Each EN configuration captures states 01–36: Projects entry; barter/items/roles/budget/cost/document pickers; year and company filters; board switcher and centered confirmation; combined board/list/health; company detail and return; presentation and masked history; empty/deleted categories; native saves/validation/add/delete; realtime refresh; and a selected year with no deals for a company. Representative ID captures cover the entry, new fields, budget, document types, confirmation and masked combined view. All 68 added v8 localization keys match between EN and ID; neither locale contains duplicate resource keys.

Phone (1080×2400, 420 dpi) and tablet (1600×2560, 240 dpi) layouts use one Pixel_7 emulator sequentially. Native checks on both configurations save a partial cashback edit without changing its amount, barter or costs; reject negative input without a write; add exactly one recipient and delete it; observe another client's `pipeline-changed` refresh in All Pipelines; and retain the selected year when the chosen company has no deals in it. The tablet navigation check also cancels the centered confirmation and verifies that the board and presentation mode stay unchanged before confirming entry to All Pipelines.

The shared Festival fixture's Venue budget was deleted by another client during this run (confirmed by its audit entry); replacement tablet budget/picker captures therefore use the isolated Android QA deal. That shared fixture was not restored or otherwise edited by this task. Only the isolated Android QA deal and its test rows are removed during cleanup.

The shared `C:/Users/Berlin/android-build.lock` was acquired exclusively for the build/emulator session and released after the emulator stopped. No Windows power settings were changed. Private QA sessions and DEV addresses stay outside the repository. [Cleanup](pipeline-v8-evidence/cleanup.json) verified deletion of the disposable deal, restored 23 original preference/session files byte-for-byte, restored locale/display settings, and found no native crashes.

No physical Android device was available. A live Manager sign-in was unavailable: the secondary saved QA session returned 401 and no current credentials were supplied. Manager/Staff discovery suppression, BoD discovery ordering and 403 hiding are covered by MockWebServer tests; no live Manager screenshots are claimed.

## Delivery

The local debug APK is used only for emulator validation and is not published. Release version/signing metadata remains under the existing release process. Commits use Berlin `<bagasputro.bp@gmail.com>` for author and committer, with no attribution trailers. The incremental delivery bundle is `C:/Users/Berlin/android-pipeline-v8.bundle`, based on the DEV merge above, and is checked with `git bundle verify`.

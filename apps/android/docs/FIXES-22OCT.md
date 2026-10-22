# Android fixes — 22 October 2026

Branch: `fix/android-ann-groupphoto`. Based on DEV `e1a593b6bcde32f4ae909fb9b38fb71d0427b25b` from `nexus-dev-22oct-b.bundle`, including the deployed announcement/group-photo contract and title follow-ups. Implements the FINAL v2 native contract and the owner's added project-header requirement. Application source: `987d25eadae7010ef2b305b599b64f4ee2be031a`.

## Changes

- **Announcements:** the initial Announcements/Pengumuman segment explicitly requests `origin=manual`; System requests `origin=system` in both languages. Audience and announcement kind never classify rows locally. Both lists retain activate/deactivate and delete, with shared Material confirmation dialogs for destructive actions. Loading, retry and request isolation prevent rows from another segment appearing during refresh. The composer returns to Announcements after posting. Labels and empty states match v2; additive origin/source fields decode tolerantly.
- **Group photo:** any GROUP member allowed by the API's `canEditAvatar` can add, change or remove its photo. This follows the owner's clarification; member-management permissions do not gate the control. Missing/false capability stays read-only. The existing profile picker prepares an upright JPEG, with the 5 MB upload limit and localized errors. Removal uses a Material dialog. List, chat header and Group info use the existing avatar component and group placeholder.
- **Realtime/cache:** `conversation-updated` avatar events immediately replace or clear the photo on all three surfaces. Opaque full URLs remain cache keys. Revision checks prevent an older in-flight response or cached list from restoring an obsolete URL. Events and local mutations atomically amend only the photo field in the existing per-user conversation cache, retaining unknown fields and its saved-copy timestamp. This also covers failed refetch and process restart. Runtime state clears on logout.
- **Project headers:** normal, Pipeline, All Pipelines, Outlet, Social and Legal headers use measured titles at 19–14 sp, with at most two balanced lines split only between words. Extremely long phrases or unbroken words receive an ellipsis instead of splitting a word across lines. The complete original name remains accessible. On narrow phones, actions move to a second row when their width would truncate a reasonable name; back, member, GIDEON, settings, presentation and switcher controls remain available. Short titles and wider layouts remain compact. Legal's long template/request titles use the same component.

## Verification

`testDebugUnitTest` and `assembleDebug` passed with JDK 21, one Gradle worker, a 2 GB heap and in-process Kotlin compilation. **990 tests passed; zero failures, errors or skips.** The 21 added tests cover origin requests/error handling, photo capability/transport/errors, authoritative realtime removal and stale-response/restart cache behavior, plus title fitting and balancing. EN and ID resource XML parses without duplicate string keys.

DEV verification used one Pixel_7 emulator, Android API 37:

- EN/ID main and System lists show the corresponding server origins. A targeted composer notice remains manual/composer. System delete/deactivate cancellation preserves its rows. Confirmed native deactivate/delete and delete cancellation work on an owned manual notice. Posting a native notice from System to the QA account switches back to Announcements and creates exactly that targeted manual notice.
- Native picker change/add uploads JPEGs; picker cancellation and removal cancellation preserve the photo. Confirmed removal restores the placeholder and Add action. The sparse photo response preserves the group's name and members. ID photo labels and the centered removal dialog were also checked in dark mode.
- Another API client replaces and removes the photo while each of the list, header and info screens stays open. Every surface and its persisted metadata update without reopening or waiting for fallback polling. Replaced URLs return 404, repeated removal returns 200, and photo changes create no chat system messages.
- Long names were checked on live DEV normal/Pipeline/Outlet/Social projects in EN and ID. Both Pipeline switchers remain functional. Production-component fixtures cover long Legal titles, All Pipelines, extreme phrases/words and crowded actions. Layout checks include 320 dp and 411 dp phones, a 1067 dp tablet, and 150% text size. Final balanced-title captures were reviewed. No native crashes were found.

No physical device or separately authenticated Staff session was available. Strict capability, non-manager membership, missing-capability, DM/project exclusion and legacy read-only cases are covered by JVM tests. Shared System rows were only inspected and cancelled; confirmed destructive mutations used owned manual notices.

## Server follow-up

DEV accepted non-image bytes declared as `image/png` with HTTP 200, contrary to v2's content-validation statement. Missing-file and over-5-MB checks returned the documented `NO_FILE`/`TOO_LARGE` 400 responses. The valid QA photo was restored immediately, then removed during cleanup. Android's picker decodes and re-encodes the image before upload. The server content-sniffing discrepancy remains for the server owner.

## Cleanup and delivery

All four owned projects, the owned group/photo and both owned notices were removed. The emulator's 23 original preference/key files were restored and SHA-256 verified, with its original locale, display and font settings. The sole owned emulator was stopped before releasing `C:/Users/Berlin/android-build.lock`. Windows power settings were untouched.

Private screenshots, UI dumps, API records, build logs, checksums and cleanup records remain outside the public repository at `C:/Users/Berlin/android-fixes-22oct-evidence/`. No screenshots, dumps, exports, sessions or credentials are added by these commits.

The debug APK was installed locally for verification only; SHA-256: `7a39c5a9fe206df58564f226e1e2aa56239ac69349c7d3d933918c32db151ca1`. This work targets the upcoming 0.1.7 release. Version/signing publication remains with the existing release process; source metadata remains 0.1.6 / 13 and no APK was published.

Delivery: `C:/Users/Berlin/android-fixes-22oct.bundle`, incremental from DEV `e1a593b6b`, verified with `git bundle verify`. All task commits use Berlin `<bagasputro.bp@gmail.com>` as author and committer, without attribution trailers. No merge or push was performed.

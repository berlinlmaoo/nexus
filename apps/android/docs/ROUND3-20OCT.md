# Android round 3 — 20 October brief, completed 21 October 2026

Branch: `feat/android-round3-20oct`. Starting tree was clean at `3a66cb5b`; fetching `C:/Users/Berlin/nexus-dev-latest.bundle` into `hub/dev` confirmed the same base. Existing commits were preserved. Version remains 0.1.6 (13). No APK was published, no Windows power settings changed, and only one Gradle invocation or emulator was used at a time.

## Merged baseline repair

The first command on the merged source was `testDebugUnitTest assembleDebug`. Kotlin's light-tree parser crashed with a `NullPointerException`. Temporarily requesting the PSI parser exposed missing whitespace between string literals and `else` at seven sites in five existing files: BlockEditing, BlockEditorDialog, BlockWriting, AutomationDraft and XpAdmin. The repair only adds whitespace. The diagnostic compiler flag was removed; no Gradle configuration change is delivered.

Android Studio's Java 25 runtime also crashed with `EXCEPTION_ACCESS_VIOLATION` in `jvm.dll`. Subsequent verification used the already-installed Temurin JDK 21 at `C:/Users/Berlin/Documents/Dev/jdk21/jdk-21.0.12.1+1`, one worker, 2 GB Gradle heap and Kotlin compilation in process. Diagnostic logs remain outside the repository in `C:/Users/Berlin/Documents/Dev/android-round3-diagnostics`.

## Delivered changes

| Item | Result |
|---|---|
| R-9 | Ticket menus, board headers and status pills use New / Awaiting decision / In review / Done; the Closed menu choice says “Closed (no action)”. Indonesian uses Baru / Menunggu keputusan / Ditangani / Selesai / Ditutup. Awaiting decision remains absent from the editable menu and cannot be a manual board destination. Headers have tinted fills and matching dots: grey, violet, amber, green. Closed keeps its grey pill. |
| R-10 | Messages caches the three filtered conversation lists and unread aggregates. Adjacent pages remain composed; each page uses a keyed LazyColumn. Segmented selection and persisted selection follow the settled page. Relative dates and parsed/system message previews are remembered instead of formatted during repeated row composition. Existing avatar loading already decodes off the UI thread and caches decoded images. |
| R-11 | Inspected the existing implementation: availability-only Save, clearing a quick-pick when availability changes, retaining typed text, Away defaults for quick picks, and the compact Clear after / Starts group were already present. Preserved. |
| R-19 | Added `project-changed` and `complaint-changed` listeners and typed matching rules. Project/task details, forms, pages, Overview status updates, sheets and member settings refetch normal APIs. Ticket board/detail refetch on matching ticket events. Resume/reconnect and polling fallbacks remain, with a 400 ms event debounce. No payload is applied as authoritative data. The referenced R-19 section is absent from the supplied revision file, so event names/kinds were checked against `src/lib/project-realtime.ts`, `src/lib/complaint-realtime.ts` and `pages/api/socket.ts`. |
| Owner QA answers | Timeline names stay 120 dp on phones, with 12 sp two-line text. GIDEON and Memory send buttons are violet with content and grey when empty. Meeting progress's primary action is violet. Existing meeting date chips already share one TextButton layout for empty/set dates; Memory groups already have no border. Replaced remaining standalone Indonesian “tugas” labels with “task”. Presentation mode hides the other project header buttons, leaving the eye; its existing money masking remains. Floating GIDEON is unchanged. |
| R-21 | Optional evidence step for any → Sick/Permit and Permit/TK/no record → Present. No evidence field for Leave/Day off/Clear penalty or the other → Present cases; there is no TK action. Approved Permit takes precedence over a check-in; automatic deduction day-offs are treated as TK. Camera and Files accept images/PDF, with extension fallback for empty/octet-stream types, bounded reads and a 10 MB limit. Selected files can be removed. Save without evidence stays available. Missing-record Present can also supply custom times. |

R-21 follows the final appended contract, not the superseded required-evidence instructions. With no attachment the endpoint receives JSON; with one it receives multipart with the file under `evidence`. Omitted checkout retains the server's shift-end default; custom check-in-only sends JSON null or an empty multipart checkout. History and request details decode the additive evidence fields and show session-authenticated photo thumbnails/PDF links or an amber “No evidence attached” / “Tanpa bukti”.

## Verification

`testDebugUnitTest assembleDebug`: **951 tests, zero failures/errors/skips; debug build successful**. Command:

```powershell
$env:JAVA_HOME='C:/Users/Berlin/Documents/Dev/jdk21/jdk-21.0.12.1+1'
./gradlew.bat --no-daemon testDebugUnitTest assembleDebug --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process'
```

New tests cover the evidence transition matrix (including Permit precedence and auto deductions), old/additive response decoding, optional JSON, multipart PDF upload, custom checkout omission/null/empty semantics, project event kinds/scoping and matching ticket-detail refresh. Two existing source guards were updated for the approved evidence editor and the owner's Task wording.

Emulator checks use the production composables through debug-only `UiPreviewActivity` fixtures: 120 conversations split across the three Messages tabs; all five ticket statuses; Sick/Present evidence steps; and missing-evidence details. The 20 EN/ID × light/dark captures and extracted UI text are in [round3-evidence](round3-evidence/). These are staged UI checks, not live attendance writes. Additional checks select a PDF through system Files, remove it, reject a 10 MB + 1 byte PDF, return a JPEG from the emulator camera, and show custom time fields. Save is enabled with an attachment; removing it restores the enabled Save without evidence action. The size error also leaves optional save available. The default and Done lanes show the status pills, including grey Closed.

Messages profiling used the final debug build, Pixel_7 with two virtual cores, 1536 MB RAM and host GPU, warmed pages and twelve horizontal swipes per run. No Gradle build ran during measurement. These are final-only measurements; there is no matched pre-change timing comparison.

| Run | Rendered frames | Janky frames | p50 | p95 |
|---|---:|---:|---:|---:|
| 1 | 397 | 48 (12.09%) | 20 ms | 44 ms |
| 2 | 410 | 30 (7.32%) | 19 ms | 30 ms |
| 3 | 409 | 23 (5.62%) | 16 ms | 25 ms |

Raw `dumpsys gfxinfo`, test/build totals, local APK SHA-256 and the UI-check results are included in the evidence directory. Preferences changed by the staged checks are restored byte-for-byte and owned fixture files are removed before shutting down the emulator.

Physical-device Photos/App Store-equivalent smoothness remains unverified; emulator frame timings cannot establish that acceptance criterion. Live R-21 server upload, audit/restore and two-session realtime delivery were not exercised in this run. The supplied bundle's server predates the appended R-21 server commit; the client implements the appended wire contract, verified with MockWebServer. Existing R-1..R-20 reports and their earlier physical-device/server limitations remain applicable.

## Delivery

All new commits use Berlin `<bagasputro.bp@gmail.com>` for both author and committer. The delivery bundle is `C:/Users/Berlin/android-round3.bundle`, containing `hub/dev..feat/android-round3-20oct`; it is created after the report commit and checked with `git bundle verify`. The debug APK stays local for emulator validation.

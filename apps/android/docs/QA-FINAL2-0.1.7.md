# Android QA final #2 — 0.1.7 target

**QA run complete. Five defects were fixed. All 168 signed-in layout captures passed actual-image review, and the fixed Month and Attendance widgets passed fresh login-to-logout privacy checks.** Remaining input and coverage limits are listed below; visual acceptance does not establish functional or permission acceptance.

Baseline: `994436651c882a46a8675d53d68aa63bcd3837c9`, with **995 JVM tests** passing. Main branch: `fix/qaf2-android`; final Main code is `54fae3eb0b86248b163951a4e2791dff71352ebf`. Its earlier payment/chat source `d991a4de` separately passed **1,014 tests**, with no failures/errors/skips, and debug assembly. The final widget code was tested in the integrated candidate below; branch counts are not added together.

The signed-in sweep used isolated verification source `1aedc662df97373a609810ff46a15d8356ff3d3b`, combining Main `d991a4de`, Stage `bd31204c` and Names `a02279d9`: **1,033 tests passed** and APK SHA256 `07F7C834A56BCB51E9F5AFB71F61C9E5D4D95E6A86C987200F006A00EA5A2FC0`. Those 168 visual passes and the initial A-5 failure retain that provenance.

The final integrated application source is `7db9591f9126d7fab0c8f2887706254375c870a8`, including Calendar `76f68bc8` and Attendance `54fae3eb`. **1,046 tests passed, zero failures/errors/skips; debug assembly passed.** Final APK SHA256: `9CB8351CDA40A56D731B8BB8AADEE0DA92BD5630B73A7D3A57FADCF887AF91EF`. Fresh Month and Attendance widget login/logout/tap/removal acceptance uses this artifact. Main, Stage and Names deliverable branches remain separate; `verify/qaf2-all` is included in the Main bundle to reproduce their tested combination. Documentation-only merges preserve the compiled application source tree `3b7dba7ccf03cca6400a9360e7aa4262bb906d41`.

QA used DEV and the owned visible Pixel_7 emulator with host GPU. The release target in this filename does not change APK metadata: the tree remains **versionName 0.1.6 / versionCode 13**. No APK publication or production login was performed. Raw screenshots, UI hierarchies, API responses, credentials and people data remain outside Git; evidence names below identify private run artifacts.

Phone and tablet checks in the separate Stage/Names runs use configured viewports on that same emulator. No physical tablet or physical-device performance acceptance is claimed.

## Defects

| id A-n | screen | severity | repro | fixed? (commit) | evidence |
|---|---|---|---|---|---|
| A-1 | Pipeline payment dialogs | P1 — lost draft | Open New term, enter label/amount/date, then use the actual edge Back gesture or rotate. The baseline closes the dialog and loses its draft. | Yes, Main `f86f56e0`; owner/session guard follow-up `7a33e11d`. Draft and busy state live in the retained board ViewModel; dirty dismissal requires confirmation. | `term-draft-baseline.json` reproduces both losses. `term-draft-fixed.json` passes Back → keep editing, rotation, discard/reset, clean cancel, exactly one saved term and close on acknowledgement. Nine regressions cover payment drafts and credential-owner behavior. Native Mark paid acceptance also passed on the combined source: dirty Back/keep editing, stable landscape amount/date retention and one exact-term payment save/readback (`markpaid-native.json`). |
| A-2 | Chat composer after real process death | P1 — lost message metadata | Select a reply and a person from mention suggestions, then background and kill the app process. The baseline restores text but drops the selected reply; picked UID mappings were also transient in source. | Yes, Main `d991a4de`. One scoped framework SavedStateHandle snapshot keeps text, quote, ready uploaded-file metadata and picked UIDs. Tokens and in-flight requests are not saved. | `chat-process-baseline.json` proves PID replacement and lost reply; baseline send stores no reply reference. `chat-fixed-native.json` proves a different PID, retained text/reply/document/literal tag, then a native send with exact stored reply and attachment. Ten regressions cover scope, restore, ACK revisions, credential identity and write-refusal authority. Recipient delivery is not proved by message GET. |
| A-3 | Pipeline stage headers | P2 — ordinary labels truncated | On phone/tablet, long localized Proposal/Won names receive ellipsis while counts and large monetary totals share the header row. | Yes, **separate** `fix/qaf2-android-stagehdr` source `bd31204c`; not included in the Main source/test count above. | Separate report `QA2-STAGE-HEADERS.md`, `build-stagehdr.json`, `stagehdr-fixed-captures.json` and `stagehdr-centered.json`: 1,001 tests green; phone/tablet EN light and ID dark reviewed. Two whole-word lines, 13sp → 9.75sp floor, separate total row and intact 48dp Add target. Separate verified bundle/report; the combined source passes 1,033 tests and its four-variant signed-in layout sweep is complete. |
| A-4 | Leaderboard/podium and project-folder names | P2 — long names clipped | Inspect longer names on phone and tablet, including normal multiword folder labels and two-digit ranks at font scale 1.3. | Yes, **separate Names** source `a02279d9`, **1,008 tests green**. Targeted native acceptance passed; the combined source passes 1,033 tests and its four-variant signed-in layout sweep is complete. | `names-final-complete-captures.json`: 16 normal-font frames passed. Six phone font-1.3 frames validated names and exposed rank wrapping; `a02279d9` fixes that follow-up. `names-rank-final-retakes.json`: six fresh actual rank/name retakes passed independent review. Normal name captures use the unchanged Names renderer from `f4e87dd`; rank retakes identify the final `a02279d9` artifact. |
| A-5 | Launcher widgets after native signout | P1 — cached private content remains visible | The real signed-in Month widget keeps its grid and four private task previews after normal native logout on `1aedc662`. Attendance has the same captured-value pattern and a late-response write path. | Yes: Main Calendar `76f68bc8`, Attendance `54fae3eb`. Live composition observes auth and snapshot revision; Attendance also clears synchronously and rejects stale credential/server/generation responses. | Initial failure: `logout-widget-cleanup-private.json` and `widget-signout-failure-visual-review-private.json`. Fixed candidate `7db9591f` / `9CB8351C…`: a fresh login shows four real private previews; normal logout replaces the whole widget with the sign-in prompt; tap stays at login. Actual PNG review passes; `logout-widget-fix-cleanup-private.json` confirms only the owned widget was removed and the original Search binding preserved. Thirteen new cache/auth/race regressions pass in the 1,046-test combined suite. |

Glance `update`/`updateAll` does not restart an already running `provideGlance`; observing data inside `provideContent` is the documented pattern. The fix follows that lifecycle and keeps redraw requests for inactive sessions. [Android GlanceAppWidget API](https://developer.android.com/reference/kotlin/androidx/glance/appwidget/GlanceAppWidget)

The old Social Media Report and Outlet absence notes in the 19 Oct report are historical. Baseline source already contains their native implementations. Fresh populated overview/calendar/settings layouts and the Social template card passed actual-image review in all four variants; no native report/config Save or template creation is inferred.

## Tested OK

| Check | Completed result and limit |
|---|---|
| Main build and regressions | `build-final.json`: source `d991a4de`, 1,014 tests and debug assembly passed with zero failures/errors/skips. Baseline build: 995 tests. |
| Combined builds | Earlier `build-combined.json`: source `1aedc662`, 1,033 green tests and debug assembly for the signed-in sweep. Final `build-widget-fix.json`: source `7db9591f`, **1,046 green tests** and debug assembly for the widget correction. Neither count is a sum of branch counts. |
| Fixed Month-widget privacy | `widget-fix-signed-in-private.json`, `logout-widget-fix-cleanup-private.json` and `fixed-widget-visual-review-private.json`: fresh actual login, four real private previews, normal logout clears the entire grid/previews/footer, sign-in prompt and safe-login tap. Normal Launcher Remove preserves the original Search binding. The first framework sample preceded Launcher undo expiry; a later exact binding comparison completed without a second Remove. One Month provider/ME/EN light path, not all providers or scopes. |
| Fixed Attendance-widget privacy | `attendance-widget-fixed-private.json` and `attendance-widget-fixed-visual-review-private.json`: fresh login and a normal read populate Not checked in plus six weekday-history dots. A settled tap from Home opens actual Attendance. Normal logout clears account state and history; the widget opens safe login. Only owned Attendance widget (ID 5) is removed; original Search widget (ID 2) is preserved. No attendance write or location grant occurred. Initial Settings/empty-center tap diagnostics are retained and excluded. One EN-light provider path, not an exhaustive widget matrix. |
| Passive runtime observation | Both source windows were bounded before the next APK install. The earlier `1aedc662` and final `7db9591f` windows each have zero FATAL EXCEPTION and NEXUS crash markers. Native fatal signals in these windows belong to the separate `android.hardwar` system service. This is scoped crash-log observation, not universal crash-free or ANR acceptance. |
| Payment draft retention | Actual edge Back prompts before discarding; keep editing retains values; rotated dialog retains label/amount; discard resets; one term saves and closes on ACK. The save completed before the busy-state native capture, so an in-flight native rotation pass is not claimed. Busy/identity behavior has regression coverage. |
| Baseline normal form/deal rotation | Source `994436651`: `form-rotation.json` and `pipeline-rotation-baseline.json` preserve the edited form description/deal text and drawer through rotation. These receipts establish the working QA baseline, not a fresh rotation retest on the later fixes. Combined-source Mark paid rotation is separately verified below. |
| Mark paid dialog | On the combined build, actual dirty Back and keep editing retain the amount. The stable 2400×1080 landscape image retains amount/date and both actions. One Save updates the same owned term to partly paid, with paidAmount 100000 and the selected date independently read back. A stale hierarchy from the first orientation attempt was diagnosed and retained as setup evidence; fresh-dump checks and a stable retest supply the acceptance proof. |
| Chat full draft and real process death | On the verified Main APK, select the existing owned USER quote and a real roster suggestion, upload a TXT document, then restore after Home → exact-PID kill → plain activity start. Text, quote, ready file chip and literal tag return after authorization. Native Send is independently read back with the expected reply ID, document name/path/size and text. No force-stop was used for this restoration proof. |
| Chat 4,001/4,000 boundary | `chat-fixed-boundary.json`: 4,001 code points show the native warning and disable Send; 4,000 enable Send. Exactly one native 4,000-codepoint message is read back unchanged and appears in the already-mounted web chat without reload. Controlled chunk entry populated the test fixture; the actual native counter, button state, send and server read-back were checked. |
| DKA option | The same full draft remains with “Don't keep activities” enabled, and the original setting is restored. This option-only check does not prove ViewModel destruction. The separate PID replacement is the strong process-death proof. |
| Group photo add/change/remove | `group-photo-add.json` and `group-photo-cycle.json`: native picker add, change and confirmed removal save; an already-mounted real web view reflects each change without reload. Back from the removal confirmation retains the photo. |
| Android photo-picker permissions | `photo-picker-permissions.json`: system picker used; broad image/video/storage permissions remain unchanged and undeclared. This covers the exercised picker path, not every Android permission-revocation combination. |
| System photo-picker cancel | `photo-picker-cancel-private.json`: the actual system picker opens, actual Back cancels, the same owned Group info remains visible and its null avatar is independently unchanged. Two actual images passed review; no upload or API write occurred. |
| Real web UI → mounted native project update | `realtime-project.json`: edit the exact owned project title through the browser's actual input/save controls; native remains mounted and updates without reload. Observed about **4.36 seconds**, including observation overhead. |
| Real web UI → mounted native form coedit | `realtime-form.json`: browser description input/autosave updates the already-mounted native form without reload. Observed about **4.32 seconds**, including observation overhead. This is one field/coedit path, not a complete concurrent-edit conflict matrix. |
| Real web UI → mounted native Calendar | `realtime-calendar.json`: the actual browser task-date control changes an owned task; an already-mounted native day count updates **0 → 1 task** without reload. Observed about **4.46 seconds**, including observation overhead. |
| Availability-only manual status | `presence-native.json`: actual native Online, Away and Do not disturb choices save with `manual.text == ""` and the correct availability. Each step starts from a fresh manual-null read and cleans only its recorded row; all three return `cleared: 1` and verified manual null. The original/final manual are null. Concurrent replacement atomicity was not tested; the helper also compares the full snapshot before ID-bound cleanup. |
| Separate Names native acceptance | Phone/tablet EN light and ID dark: all 16 normal-font target frames passed; six font-1.3 name frames and six corrected rank retakes passed their stated checks. Selected folder/profile navigation remained usable. No person-name or XP mutation was used to manufacture these cases. This is targeted Names acceptance, not the full four-variant sweep. |
| Legal headers in four variants | Both existing 60- and 47-grapheme template names fit fully in two whole-word lines in EN/ID and light/dark, with controls readable. Eight actual images reviewed; no template edits. |
| Manual status modal in four variants | All four actual modal images have readable choices and actions. The background is Settings; these images establish modal presentation, not a separate Home-entry interaction. |
| Existing GIDEON summaryId presentation | One visible existing pending spreadsheet card in each variant shows the complete localized summary and readable red/green diff. The other two cards and lower footer are partly/offscreen; no Apply/Discard accessibility or action is claimed. The action heading remains English in Indonesian. Original off-target diagnostic images are retained and excluded from acceptance. |
| Populated Social views, all four variants | Two synthetic days in the exact owned project supply both platforms. Native visible Instagram totals are engagement 128, views 2200, likes 110, comments 11 and shares 7; TikTok shows engagement 138, views 2400, likes 120, comments 11 and shares 7. Posts are 5 each. Lower overview frames and the 23 Oct day dialog match the recorded inputs. Calendar, settings and the Social template gallery card were also reviewed. Setup used normal APIs; no native report/config Save or template creation is inferred. All four variants and the scrolled supplements were reviewed. |
| Populated Outlet Guest views, all four variants | The exact owned event is reported with sales 1000000 and pax 21. Scrolled native Guest frames show RSVP 12 (7 + 5), Hosting 3 and Communities 6. Expand reveals both custom child counts, 2 and 4. The exact Hide tap removes the expanded-state label; child-row absence was not separately asserted. Overview/calendar/Reported board/settings were reviewed. Setup used normal APIs in the owned project; no native report/config Save is inferred. All four variants and the scrolled supplements were reviewed. |
| Focused Main phone font scale 1.3 | `font13-main-targets-private.json`: six actual images cover task Board, form builder and Mark paid dialog in EN light and ID dark. The tested task/status labels, form body/tools and payment amount/date/actions remain readable. Compact header ellipsis and scrollable/offscreen content remain scoped in receipts. Font scale was restored; no tablet or all-screen font-scale pass is claimed. |
| Scoped ACTION_VIEW routes | `deep-links-native-retakes-private.json`: invalid attendance IDs/dates reach today's Attendance fallback without a permission overlay; a missing trail shows the record-not-found error; the missing-bonus route opens the current allowance sheet over the prior trail error, without proving a matching grant. Earlier booking-missing opens the booking list fallback, and the owned Calendar date route selects the requested 27 Oct rather than today, 24 Oct. These are route/fallback checks, not valid attendance/booking-record or R-21 passes. |
| Live owned-group deletion | `live-group-deletion-private.json`: with native still mounted, deletion produces the deleted-group banner and removes the old message, group identity and composer in about 2.31 seconds; exact Group info then returns 404. No native reopen was used. Two actual images passed review. Recipient delivery, restoration and a browser deleted-banner pass are not claimed. |
| Real signed-in launcher widget | `widget-native-private.json`: normal launcher binding of one Month provider, configuration Save with Mine scope and header tap to the Mine Calendar were exercised. Actual configuration, launcher and Calendar landing images were reviewed in all four variants; A42 accepts the configuration layout. Original Google Search binding was preserved. This is one provider/scope path, not all eight providers. Source `1aedc662` separately failed logout masking as A-5; the focused `7db9591f` correction passes above. |
| Opposite OS/app theme Home | EN app-light with system-dark and EN app-dark with system-light both retain the selected native Home appearance. Actual images and OS/app preference receipts were reviewed. This is Home-only coverage. |
| Published artifact install | Authentic published 0.1.6/13 ARM artifact checksum, installation and login-screen opening were verified. No DEV login was attempted in that published APK. This is install/login-screen smoke only. |

Realtime checks used actual browser controls on owned fixtures. Transport was not instrumented, so the timings do not isolate socket delivery from polling fallback. They do prove the visible update without reopening native.

Message GET does not expose recipient rows or normally retain `mentionedUserIds`. The baseline's derived zero count is not evidence of failed mention delivery. The fixed run proves roster selection/literal retention and stored reply/file metadata; picked UID serialization and send construction have JVM coverage. Recipient inbox/push delivery remains untested without recipient credentials.

## Four-variant capture index

All 42 signed-in states have actual PNG acceptance in all four variants: **168 visual passes, zero visual failures in this signed-in matrix**. A42 uses the real widget configuration image. All these captures belong to combined source `1aedc662` / APK `07F7C834…` / 1,033 tests. **V means the visible layout was reviewed**, not functional, permission or backend acceptance. Scoped limitations such as offscreen content remain in each private receipt. A-5 is a separate reproduced logout failure and does not rewrite the signed-in verdicts; its completed fixed-artifact checks retain their separate `7db9591f` provenance.

The private `native-capture-index.html`, `native-capture-index-private.json`, `native-four-variant-progress.json` and `native-visual-review-private.json` preserve every attempt, original PNG hash, source/APK/test-count snapshot and explicit review. Wrong-target/debug-navigation/gesture diagnostics are retained and excluded. Three older wrong-target review receipts are rejected as stale; they are not accepted integrity failures. No 19 Oct result is inherited.

| State | EN light | EN dark | ID light | ID dark |
|---|---|---|---|---|
| A01 home | V | V | V | V |
| A02 attendance-today | V | V | V | V |
| A03 my-tasks | V | V | V | V |
| A04 calendar-month | V | V | V | V |
| A05 calendar-people | V | V | V | V |
| A06 calendar-filters | V | V | V | V |
| A07 self-profile | V | V | V | V |
| A08 account-profile | V | V | V | V |
| A09 owned-task-board | V | V | V | V |
| A10 owned-task-table | V | V | V | V |
| A11 owned-task-timeline | V | V | V | V |
| A12 owned-task-en-detail | V | V | V | V |
| A13 owned-task-id-detail | V | V | V | V |
| A14 owned-project-settings | V | V | V | V |
| A15 current-gm-pipeline | V | V | V | V |
| A16 pipeline-filter-menu | V | V | V | V |
| A17 pipeline-presentation | V | V | V | V |
| A18 owned-live-deal-drawer | V | V | V | V |
| A19 all-pipelines | V | V | V | V |
| A20 all-pipeline-board-switcher | V | V | V | V |
| A21 all-pipelines-presentation | V | V | V | V |
| A22 announcements-manual | V | V | V | V |
| A23 announcements-system | V | V | V | V |
| A24 owned-group-thread | V | V | V | V |
| A25 owned-group-info | V | V | V | V |
| A26 owned-project-forms | V | V | V | V |
| A27 owned-form-builder | V | V | V | V |
| A28 owned-form-preview | V | V | V | V |
| A29 owned-form-settings | V | V | V | V |
| A30 social-overview | V | V | V | V |
| A31 social-calendar | V | V | V | V |
| A32 social-settings | V | V | V | V |
| A33 outlet-overview | V | V | V | V |
| A34 outlet-calendar | V | V | V | V |
| A35 outlet-board | V | V | V | V |
| A36 outlet-report-settings | V | V | V | V |
| A37 rooms | V | V | V | V |
| A38 gideon-current-ui | V | V | V | V |
| A39 gideon-history | V | V | V | V |
| A40 gideon-memory-cards | V | V | V | V |
| A41 gideon-reminders | V | V | V | V |
| A42 widget-entry | V | V | V | V |

Supplemental acceptance includes 16 Status/Legal/GIDEON frames across all four variants and 29 populated Social/Outlet frames (English15, Indonesian14). These are additional scoped images, not extra functional passes. Widget/theme/font/deep-link/deletion evidence is recorded under its actual separate run.

The separate Stage and Names phone/tablet runs cover EN/light and ID/dark. Their EN/dark and ID/light target cases were not separately captured. Names has phone font-scale1.3 acceptance and final rank retakes; Stage larger-font/extreme-label coverage is deterministic. These facts do not establish an all-screen or native tablet font-scale1.3 pass.

## NOT tested (honest)

| Requested coverage | Current disposition |
|---|---|
| Published QA6/QA5 signed-in compatibility smoke | **NOT TESTED.** The authentic release has no signed-out DEV selector, and the matching signing key is unavailable on this PC. Only artifact/install/login-screen smoke is complete. No production login was substituted. |
| Published → debug retained-data upgrade | **OWNER SKIP.** Matching signing material is unavailable. No successful in-place overlay or retained-data claim is made. |
| QA6 Staff, Manager, OAA and demo.owner positive-role flows | **NOT TESTED.** Required credential/session inputs were not provided. QA5 sender/owner checks do not substitute for Staff/Manager/OAA access or demo.owner company-only room checks. |
| Mention recipient delivery | **NOT TESTED.** Native live deleted-group handling is complete above. Recipient inbox/push delivery still requires recipient credentials; GET messages cannot prove it. |
| Exhaustive Pipeline/title/cell behavior | The four-variant matrix reviewed Manual/System announcements, the exercised Pipeline/All/presentation states and owned Table/Timeline layouts. It does not establish every Pipeline v8 action, every project-title type or full-name display in fixed 120dp cells; those broader functional/long-cell claims remain **NOT TESTED**. |
| Attendance R-21 override evidence | **NOT TESTED.** Coordinator-approved date/person/operation inputs are absent; no dates were invented and no real attendance action was taken. |
| Meeting GPU work and meeting-upload restoration | **NOT TESTED.** The coordinator's meeting GPU lock/window/test inputs are absent. The emulator's host-GPU setting does not supply that backend slot. |
| GIDEON F3 offline window and noChange=true card | **NOT TESTED.** No approved offline window. An actual native unchanged-date request was safely refused by the server, created no proposal/card and left task fields unchanged (`gideon-nochange-result.json`); that does not exercise a noChange=true card. Existing summaryId card presentation was separately captured and reviewed in all four variants. |
| Complaint, attendance/attendance-board and XP web → native realtime | **NOT TESTED.** Project, form and Calendar browser-driven updates above are complete. No complaint was created because a normal cleanup DELETE route is unavailable. Positive attendance/XP inputs are absent. |
| VIEW/COMMENT permissions and form viewer-positive roles | **NOT TESTED.** Authorized QA5 owner behavior does not establish a real VIEW/COMMENT or nonmember positive case. |
| Positive attendance/booking links, old Calendar-folder ID and additional widget paths | **NOT TESTED / INPUT MISSING.** Scoped fallback/date routes and real Month/Attendance widget bindings are complete above. No valid attendance/booking-record or R-21 input was supplied. Fresh read-only discovery returned 37 accessible company folders, all UUIDs, with no legacy aliases or supplied old-ID (`legacy-folder-discovery-private.json`). All providers/scopes were not exercised. The fixed Month signout path passes separately; all providers/scopes/staleness combinations remain untested. |
| Killed-state notification tap | **NOT TESTED — configuration missing.** The exercised debug configuration has all four required Firebase fields blank (`push-config-status-private.json`), so PushManager cannot initialize delivery. No private configuration path was supplied. No real push/tap pass is claimed; direct ACTION_VIEW is not a substitute. |
| Exhaustive Back/rotation, broad system font 1.3 and killed-state notification | **NOT TESTED beyond stated cases.** Explicit payment/photo-confirmation/picker-cancel/rotation/process, targeted Names font paths and six focused Main phone font-1.3 images are complete. Push/recipient input is absent. No all-dialog, all-screen or tablet native font-scale pass is claimed. |
| R-4 daily-error aggregate / R-8 physical frame rate | **OPEN CARRIED LIMITS.** Fresh DEV `/api/gideon/perf` returns failures15m for all four tiers but omits failures24h (`r4-performance-current-private.json`). No invented daily zero is shown. Physical-device acceptance remains unavailable; emulator captures do not establish physical frame rate. |

## Design/UX suggestions (not fixed)

No design-only change is included. Two observed follow-ups are optional: keep the Timeline month label readable when its start is scrolled behind the fixed Names column, and use a localized action heading for the existing GIDEON spreadsheet card in Indonesian (its summaryId sentence already localizes). Compact selectors and extreme fixture names legitimately ellipsize; those observations are not treated as failures of normal-name fitting.

## Cleanup and delivery

**Owned fixture and web/browser cleanup completed.** `cleanup-fixtures-private.json` is `CLEANED`: the previously deleted owned Group is reconciled as missing, the recorded private form and four owned projects are removed through normal restorable endpoints, dependent owned tasks/deals/report routes are verified missing, and both exact empty Names folders are verified missing. Cleanup guarded form submission counts and creator/FULL/workspace/name receipts; it did not select objects by a broad prefix, hard-delete records, alter code-number ledgers, touch sessions or create/delete complaints.

`cleanup-web-session-private.json` verifies that the newly created web session is revoked (profile 401) while the original supplied session remains valid (profile 200). `browser-cleanup-private.json` verifies closure of only the isolated QA browser. The additional native sessions used for the A-5 Month and Attendance retests are signed out through the normal account flow; both widgets clear correctly and are removed. Their session-list checks confirm removal of the newly created Android row while retaining the original supplied session. Original supplied API-session access remains valid.

`restore-device-status.json` verifies the original installed APK checksum and all **5,389 original app files** across the six backed-up app directories, plus recorded display/font/rotation/activity/animation settings, app locale and runtime permission flags. Exact hash-matched QA media and dump artifacts were removed. The original system night mode and Search-widget binding were restored. Restoration does not independently certify file modes, original UID, Android Keystore or all global AVD state. The app was left force-stopped. `final-cleanup-private.json` records shutdown of only the owned Pixel_7 emulator; observers were stopped before reinstalling the original APK. The shared lock is released only after bundle verification and the completion marker.

Delivery: `C:/Users/Berlin/android-qaf2.bundle` contains `fix/qaf2-android` and `verify/qaf2-all` above baseline `994436651`; separate requested bundles are `C:/Users/Berlin/qa2-android-fix-stagehdr.bundle` and `C:/Users/Berlin/qa2-android-fix-names.bundle`, with `QA2-STAGE-HEADERS.md` and `QA2-NAMES.md`. Final delivery checks verify all bundles, Berlin author/committer attribution and public-artifact hygiene. No DEV merge/push, version change or APK publication was performed. Screenshots, dumps, exports, APKs, private helpers and credentials remain outside Git.

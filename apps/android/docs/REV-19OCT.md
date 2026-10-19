# Android device revisions — 19–20 Oct 2026

Branch: `feat/android-rev-19oct`, based on DEV `603f9dd7a`. Final application source: `e932b782`. Author and committer: Berlin <bagasputro.bp@gmail.com>. Version remains **0.1.6 / 13**; no push, publication or version bump.

**937 JVM tests in 189 suites, zero failures/errors/skips; testDebugUnitTest + assembleDebug PASS.** Native DEV verification used **Pixel_7 / emulator-5556 with a visible window and host GPU**. Builds ran with the emulator stopped, one worker and a 2 GiB heap after the owner's crash/resume instruction. No Windows power, firewall or system settings were changed.

The supplied revisions are implemented or retained where already correct. R-4's daily-error aggregate remains unavailable from DEV; R-8 still needs physical-device frame-rate acceptance. R-9/R-10/R-19 have no entries in the supplied brief. These limits are not represented as completed checks.

## R-12–R-20

| Item | Change / commits | Verification |
|---|---|---|
| R-12 | `6cf15918`: soft accent selection with a 10 dp radius, no border; today's circle retained. | EN/ID, light/dark Calendar captures. |
| R-13 | `5206a9e6`, `d9efc0bf`: Home refetches its dashboard on assigned-task user-room pings and resume; My Tasks also refreshes live/on resume. The expanded stat wraps its content with an inner scroll and 70% maximum height. | Owned task Done/reopened changes reached the native Home popup and My Tasks without broad project-room subscriptions. A labelled one-task production-component mount verifies the short popup height. |
| R-14 | `1ffe918b`: Home status panel immediately below Attendance, using the Settings row and current presence dot. | Four presentation variants; native status sheet opens. No status was saved in this round. |
| R-15 | `d9efc0bf`: both attendance events refresh authorized APIs, debounce 400 ms, and retain foreground/reconnect recovery across Home, attendance, requests, crew/board, member/admin attendance, monitor, day-off bonuses/deductions, Reports and widget data. | Seven native screen/component cases counted actual DEV reads after five **client-staged** pings and foregrounding. Separate board-event coverage and payload/user-room unit tests passed. No real attendance, review verdict, grant or request was written. |
| R-16 | `5aaa30c7`, `e932b782`: shared filled fields (159 existing calls), quiet secondary actions (59 calls), 10–12 dp field corners, accent focus/red error rings; remaining segmented borders use the light border token. Meeting owner/date chips, top-right trash and enabled violet Apply are implemented. | 54 route/state comparisons and 39 after component mounts have before pairs. Owner/date edits persisted, trash removed only the second owned proposal, Apply opened confirmation, and cold reopening retained edits. The confirmation was cancelled. [Every changed source/screen and pair](REV-19OCT-SCREEN-SWEEP.md). |
| R-17 | `622c6a07`: credits above the filled composer, disclaimer immediately beneath, accent outline only while focused. | Empty and populated chats, keyboard up/down, four phone variants and tablet-sized AVD captures. Existing proposals were not applied or discarded. |
| R-18 | `3924325b`: shared violet checked Checkbox/Switch defaults; custom form and people selections corrected; onyx primary buttons retained. | Four language/theme combinations. Eight enabled checked-control regions contain the violet accent; existing Memory or the ready meeting switch supplies the switch samples. Loading/disabled controls were excluded from the color acceptance check. No Memory pause change was submitted. |
| R-20 | `d738d93d`: eye control, temporary display policy, masked KPI/card/list/health/overdue/term/history amounts, disabled money fields, no card margin line or Real Cost & Margin section. Non-money fields remain editable. Mode resets on leaving the tab and opening a fresh screen; no persisted setting or export change. | Four native phone variants passed masking, disabled fields, terms/history, server updates, unmasking, warm same-process reentry and cold reset. A native brand edit persisted while masked. Native export opened the share sheet; the workbook retained the checked synthetic values. Nothing was shared. Wide-layout KPI masking passed on the same AVD with size/density restored afterward. |

## Evidence

[Round 2 checks, hashes, cleanup and restored preferences](REV-19OCT-ROUND2-VERIFICATION.json) · [340 curated Round 2 capture files and comparison gallery](../../../../nexus-shots/android-rev2-19oct/index.html) · [field migration inventory](REV-19OCT-FIELD-SWEEP.json) · [button migration inventory](REV-19OCT-BUTTON-SWEEP.json). R-16 route pairs include the green field/button snapshot `5aaa30c7` and later final-app recaptures; earlier after-images precede the R-18 selection change. R-18 has its separate four-variant enabled-control proof. The first English/light R-20 functional pass used `d738d93d`; the remaining phone passes, final mask smoke, segmented-border checks and wide-layout check used `e932b782`. Some canonical pairs reference interaction captures. Component mounts are labelled and do not imply that every conditional branch on their enclosing screen was exercised.

The live session was the existing QA BoD account. OAA-only chat filters/transcripts were not bypassed or live-tested as BoD. Legacy unmounted screens and unsubmitted conditional flows are identified in the screen matrix. Component mounts use real composables, normal permission-checked DEV reads where applicable, and inert callbacks for staged presentation data. Login keeps its approved light appearance. The tablet checks use a resized Pixel_7 AVD, not physical tablet hardware.

Some planned component variants were rejected when DEV transport or viewer-role loading timed out: en-light/monitor, en-light/gideon-credits, en-light/mcp-tokens, en-light/xp-adjust, id-dark/gideon-credits, id-dark/gideon-people, id-dark/gideon-people-credits. The screen matrix uses verified pairs, including Indonesian/dark for Monitor, tokens and XP. These rejected attempts are not counted among successful mounts. DEV transport intermittently timed out; affected reads and idempotent private-fixture updates were retried. A completed screenshot/loading state was not counted as an enabled-control color check. No role, shared server flag, real attendance or real financial record was changed.

## Retained R-1–R-11 work

The first revision round supplied 94 curated captures and 931 passing tests. Its real upload/transcription/cancel/resume, Memory submit/blur, availability-only status saves and UI checks remain in [the original evidence](REV-19OCT-VERIFICATION.json) and [gallery](../../../../nexus-shots/android-rev-19oct/index.html). Source behavior for those flows is retained.

| Item | Implementation / commits | Verification |
|---|---|---|
| R-1 tier title | Retained `f4d30d7d`: standard borderless `TextButton`, with chat title underneath. The dropdown's border belongs to the menu. | Four variants: `r1-plain-tier-title.png`, `r1-tier-menu.png`; menu opens. No duplicate redesign. |
| R-2 summary composer | `ea99b7f8`: soft filled capsule, transparent indicators, circular active/disabled send control inside. Existing loading, paused/full and async guards preserved. | Four variants: `r2-memory-composer-empty.png`, `r2-memory-composer-filled.png`. Drafts were not submitted. |
| R-3 Memory page | `6580d95a`: rounded groups without shadows/borders, captions below toggle/summary groups, external profile headers with separate rounded editable fields. Existing subtitle/back navigation and blur-save scope retained. | Four-variant `r3-memory-grouped.png`. Native IME Done saved an owned nickname to DEV; reopening prefilled it; navigating to Summary saved the next edit on blur. Only that test memory was removed. |
| R-4 Performance | `363dcc41`, `806f48a6`: plain tier names, one summary strip with inline GPU dot/age, status pills, two-column/six-metric cards, one idle message, no duplicate average line. Existing charts retained. Nullable daily-error decode supports a future `tiers[].failures24h` field; missing data stays unknown. | Four variants: `r4-performance-summary.png`, `r4-performance-metrics.png`. A short owned GIDEON QA answer supplied a real active card; idle cards were also checked. **Daily errors cannot yet be verified against DEV; see below.** |
| R-5 upload bytes | `02789481`, `be306aea`: one validated reading drives bar, bytes and rounded percentage, preferring newer WorkManager progress to a stale poll. Successful work stays at 100% when WorkManager clears its progress payload. | Unit tests cover stale/mismatched progress, zero totals, rounding and completion. Real 31.1 MiB DEV upload advanced from zero: label read `8.0 MB of 31.1 MB · 26 %`; the subsequent screenshot shows `16.0 MB ... 51 %` with the bar advancing too. |
| R-6 meeting flow | `483ed582`, `91334506`, `998d7ac4`: one Upload → Transcribe → Minutes/tasks-ready layout, current detail, notification sentence, Open meeting/Done, and upload-only destructive Cancel upload. No navbar Cancel after starting. EN/ID copy. Polling continues through processing while the page is resumed and refreshes after returning from background. | Real DEV recording reached QUEUED → TRANSCRIBING → SUMMARIZING → READY on the same page; Open meeting opened its draft. Native Done closed the ready screen. Native Cancel upload removed the partial 31.1 MiB upload and closed the page. Final build: background processing reached READY and returning refreshed the same page automatically. No Apply. |
| R-7 timeline | `a1b84bb0`: phone Names defaults on; existing 120 dp column and hide chip retained. | Initial native assertion checked the undated task after scrolling, then checked hiding. Four final variants show the default column and hidden state in `r7-timeline-names-default/hidden.png`. |
| R-8 table | Audited; Android table implementation retained. No speculative scroll rewrite or new offset mechanics. | Frame timings and sampled ART trace below. Android's requested iOS per-frame row-work pattern was not identified in this fixture. Physical-device acceptance is still open. |
| R-11 / N-1b | `75f792d4`: new status has no default availability; explicit availability allows empty text. Quick picks default Away; availability clears quick-pick text and preserves typed text. Expiry adds 4 h / This week; Custom/Later controls are conditional, with one time summary and existing-status-only Clear. | Native Online/Away/DND empty-text saves read back correctly from DEV, including null status text and empty manual text. Prefill and Clear passed. Quick-pick clearing, typed-text preservation and expiry menu passed. Four-variant presentation checks retain the full two-line ID DND label. |

## R-8 timing audit

The repeatable fixture was a private 15-row QA project with the QA person assigned to every task and dates on ten tasks. It exercises Name/Assignee/Due date without editing Finance Management. This does not cover image-heavy real-user avatar data or Berlin's physical iPhone.

Android already uses `LazyColumn` rows, standard horizontal scrolling and layout-phase frozen-name offsets. The sampled main-thread trace was dominated by framework scheduling/rendering; it did not identify repeated date formatting as a dominant cost. Frame statistics reported no slow bitmap uploads. There was no justified Android-specific table change, so the table source is identical between the two passes.

| Pass / run | Frames | Janky frames | p50 | p95 |
|---|---:|---:|---:|---:|
| Baseline 1 | 164 | 25 (15.24%) | 13 ms | 29 ms |
| Baseline 2 | 168 | 23 (13.69%) | 13 ms | 27 ms |
| Baseline 3 | 169 | 24 (14.20%) | 13 ms | 27 ms |
| Final 1 | 167 | 29 (17.37%) | 13 ms | 32 ms |
| Final 2 | 180 | 21 (11.67%) | 12 ms | 25 ms |
| Final 3 | 171 | 29 (16.96%) | 16 ms | 30 ms |

These are debug-AVD measurements with host variability, **not an improvement claim or proof of smooth physical 60/120 fps**. Raw dumps, trace path/hash and sampled method totals are recorded in the evidence JSON. Physical performance still needs device validation.

## External contract and missing scope

R-4: the last successful DEV performance read (2026-10-19T19:56:17.442Z) supplies fifteen-minute error data and answer/restart counts without the required daily-error aggregate. Android keeps the daily count unknown rather than fabricating zero or relabelling another window. Nullable per-tier daily-error decoding is covered for older, partial, zero and populated responses. A final refresh exhausted four curl connection attempts; the last successful response is retained in the evidence. The server must supply the agreed daily count.

R-9/R-10/R-19: no requirements were present in the final supplied file; none were invented. Physical 60/120 fps acceptance for R-8 remains unverified.

## Cleanup and handoff

Cleanup reused the same QA session through curl after the Node helper hit connection timeouts. This round's exact journalled task, meeting, document, form, private projects, Pipeline deal/term and GIDEON chat were removed through the normal DEV APIs and rechecked as missing. The owned Inbox row returned by the normal list API was removed without marking or deleting unrelated rows. Existing memories, pause preference, manual status and other QA activity were preserved. The original four preference files match byte-for-byte; only view/draft keys for owned fixture IDs were removed. A cold Indonesian/dark Home was verified. The temporary helper and owned device evidence/export files were removed.

Pixel_7 was shut down after verification and restoration; owned-process absence was checked. The shared ADB server and other workers' devices were left alone.

Bundle: `C:/Users/Berlin/android-rev.bundle`, generated after the report commit with `git bundle create C:/Users/Berlin/android-rev.bundle feat/android-rev-19oct ^hub/dev` and verified locally.

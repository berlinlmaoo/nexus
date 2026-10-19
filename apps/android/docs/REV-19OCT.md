# Android device revisions — 19 Oct 2026

Branch: `feat/android-rev-19oct`, based on DEV `603f9dd7a` after fetching `C:/Users/Berlin/nexus-dev-latest.bundle` into `hub/dev`. Final application source: `998d7ac4`. Author and committer: Berlin <bagasputro.bp@gmail.com>. Version remains **0.1.6 / 13**; no push, publication or version bump.

**931 JVM tests, zero failures/errors/skips; `testDebugUnitTest assembleDebug` PASS.** Fresh verification used the existing DEV QA session on **Pixel_7 / emulator-5556, visible window, `-gpu host`**. **94 curated captures** cover EN/ID and light/dark. Fixtures are cleaned up, original preferences restored, and the assigned emulator is stopped.

The supplied Android revisions are implemented or retained where already correct. R-4's daily error value remains an external contract gap: DEV does not return that aggregate. R-9/R-10 have no entries in the supplied file. Physical-device frame-rate acceptance for R-8 remains unverified.

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

## Evidence and limits

[Capture hashes, checks, timings and cleanup](REV-19OCT-VERIFICATION.json) · [local screenshot gallery](../../../../nexus-shots/android-rev-19oct/index.html).

Each of EN/light, EN/dark, ID/light and ID/dark has 11 main presentation captures. An additional 24 captures render the production meeting progress composable with **staged client data** at 0/40/80%, queued, transcribing and ready. Those are presentation checks, separate from the real DEV upload/transcription/cancel/resume flows. They are labelled in the gallery and evidence JSON. The final lifecycle-only polling correction was checked with a fresh real DEV background/resume flow.

Representative real-flow images in `en-light/`: `r5-live-upload-zero.png`, `r5-live-upload-bytes-advanced.png`, `r6-live-cancel-closed.png`, `r6-live-ready-settled.png`, `r6-live-open-meeting.png`, `r6-live-done-closed.png`, `r6-live-before-background.png`, `r6-live-resumed-ready.png`. Existing pending GIDEON proposals were not applied or discarded.

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

R-4: the live `/api/gideon/perf` response supplies `failures15m`, `errorRate`, `answers24h` and restart counts, but no 24-hour error aggregate. Android displays an unknown value rather than a fabricated zero or a relabelled 15-minute count. Its nullable `tiers[].failures24h` support is tested for old, partial, zero and populated responses. The server still needs to supply the agreed daily count (with non-model failures/restarts treated consistently with the existing error metric). No server endpoint was changed in this Android branch.

R-9/R-10: the heading says R-1–R-11, but the final file contains R-1–R-8 plus the appended R-11/N-1b contract. No requirements were invented for the absent entries. N-1b itself is live and its native save/readback checks passed.

## Cleanup and handoff

Owned meeting fixtures, the private project, all 15 tasks and its project chat are inaccessible after cleanup. The short owned GIDEON QA conversation was soft-deleted through the normal API. Original manual-status state, existing memories and pause setting are preserved; original appearance/language/calendar/message preferences were restored byte-for-byte. The temporary native helper and owned device files were removed. AVD network speed was restored after upload tests. The original session and ID/dark preferences were retained.

The restored Indonesian/dark UI was verified on a final cold start, with preference bytes still matching the baseline. Pixel_7 acknowledged final shutdown and process absence was verified. Other emulators and the shared ADB server were left alone.

Bundle: `C:/Users/Berlin/android-rev.bundle`, generated after the report commit with:

```text
git bundle create C:/Users/Berlin/android-rev.bundle feat/android-rev-19oct ^hub/dev
git bundle verify C:/Users/Berlin/android-rev.bundle
```

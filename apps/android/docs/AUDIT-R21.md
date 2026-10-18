# Android R21 UI audit verification

18 Oct 2026, branch `feat/android-r21`, audit baseline `b5f00ac7`.

All 59 findings in the supplied `audit-r21.json` were reviewed against its approved web screenshots and the corresponding web/iOS source. Confirmed deviations are corrected. Duplicate findings share fixes. Finding 53 retains the approved web wording; mixed findings retain the reference-correct subparts, as explained below. No new visual convention was introduced.

The [local screenshot comparison index](../../../../nexus-shots/audit-r21-index.html) places the original Android audit, approved web and verified Android side by side for every finding. PNG names below are relative to `C:/Users/Berlin/Documents/Dev/nexus-shots/`. Screenshots, private session, host/address configuration and QA data stay outside Git.

## Validation

- `testDebugUnitTest assembleDebug`: PASS, 773 tests, zero failures/errors/skips, portable JDK 21, 3 GB Gradle heap and two workers. Each implementation group built green before its small commit. Phone formatting and legacy notification language/content precedence have additional regression coverage.
- AVD `Pixel_7`, explicit serial `emulator-5556`, visible window with `-gpu host -no-audio -no-snapshot-save -no-boot-anim`. Windows process inspection confirmed host GPU, a nonzero window handle and no `-no-window`. DEV HTTPS on port 8443, one reused QA5 session. Emulator shut down at completion.
- The final tour captured and visually reviewed 25 selected main/auxiliary routes, plus manual Docs, Forms, More, Control Room, task, chat, Gallery and interaction captures. English, Indonesian and affected dark surfaces inspected. `audit-r21-final/tour-report.json` lists the selected routes. This is scoped regression QA, not a claim that every destructive action or role was exercised.
- Functional checks: actual authenticated task-cover upload/render; live description 409 retains the draft and displays the remote text; chat Reply prefill; lane collapse/jump and view navigation; table horizontal swipe; GIDEON active send on an unsent draft and tier menu; Docs overflow/GIDEON; room past-booking expansion; notification Delete/Undo. Undo preserved every server notification ID and unread count.
- Board XML inspection: Previous, Next and four Mark done actions have clickable parent bounds of 126 × 126 px at 420 dpi (48dp); artwork remains small. Calendar and overflow action descriptions are localized. This is a targeted check of the cited controls, not a whole-app accessibility certification.
- Attendance map loaded OSM tiles/geofences/locate in both themes. Camera opened as a full-screen cover and was cancelled. No check-in/out submitted. No physical phone was available; physical GPS/camera/biometric quality remains a device QA follow-up, not an emulator-tested claim.
- Cleanup verified: this audit’s temporary conflict task reads 404, cover attachment absent, personal Gallery view absent. Existing QA project/tasks/chat retained. QA profile language restored to its original value; native local language/theme restored to English/light.
- All commits use Berlin <bagasputro.bp@gmail.com>, without attribution trailers. No push/publication/version change; versionCode stays 13.

## Per-finding disposition

Numbers follow the JSON array order (1–59); screen identifiers are not unique in that file.

| # | Area | Resolution | Device evidence |
|---|---|---|---|
| 1 | Home FAB | Restored approved 52dp bottom-left position. | `audit-r21-final/dashboard.png` |
| 2 | Chat bubbles | Onyx own bubbles, grey file cards, Reply, day separator and conversation start. | `audit-chat.png` |
| 3 | Phone view switcher | Single active chip, previous/next, overflow/New; lane jump/collapse/add. | `audit-board-final.png` |
| 4 | Gallery | Native saved Gallery layout, adaptive grid, authenticated cover images and properties. | `audit-gallery-cover.png` |
| 5 | Task properties | Breadcrumb, status/priority chips, assignee remove/add; empty Project/Tags rows and quest banner removed. Populated tags remain editable. | `audit-task-final.png` |
| 6 | Attendance map | High-accuracy initial request with display-only cached fallback; loading/location-off state, map/geofences/locate visible. Submission still requires a fresh fix. | `audit-attendance-dark-final.png` |
| 7 | Liveness cover | Full-screen camera dialog covers bottom tabs and system bars; cancellation verified without submitting attendance. | `audit-liveness.png` |
| 8 | Home profile | Profile photo loaded; compact period label and points baseline aligned. | `audit-home-profile.png` |
| 9 | Member plural | Shared singular/plural resource in thread header. | `audit-chat.png` |
| 10 | Chat composer | Round paperclip, soft pill with mention hint and filled round send. | `audit-chat.png` |
| 11 | Bubble contrast | Theme ink/onyx pair replaces decorative violet; dark reply/file content uses the bubble foreground. | `audit-chat-dark-final.png` |
| 12 | Calendar controls | Shared soft segmented controls replace outlined Material switches. | `audit-r21-final/calendar.png` |
| 13 | Calendar chip wrapping | Grey track/raised selected thumb and wrapping division chips. | `audit-calendar-id.png` |
| 14 | Project cards | Wrapping project title, status on its own row, clipped decoration removed. | `audit-r21-final/projects.png` |
| 15 | Overview view clipping | Phone view dropdown replaces clipped strip; shared tablet tabs retain edge fades. | `audit-r21-final/project-overview.png` |
| 16 | ID project search | Localized project task search placeholder. | `audit-board-id.png` |
| 17 | View-strip boundaries | Phone dropdown exposes every saved view/module without clipped labels. | `audit-board-final.png` |
| 18 | Priority/title | High orange; Urgent/overdue red. Board titles wrap in full. | `audit-board-final.png` |
| 19 | Touch targets | Completion rings have separate 48dp hit areas; cited compact IconButtons enlarged without enlarging artwork. | `audit-board-final.png` |
| 20 | Table overflow | Right gutter and localized horizontal-swipe hint; additional columns reached by swiping. | `audit-table-scrolled.png` |
| 21 | Quest/header actions | Removed empty quest banner; retained owner-required header actions with labels and 48dp targets. | `audit-task-final.png` |
| 22 | Task inputs | Borderless page description/comment/subtask inputs. | `audit-task-sections-final.png` |
| 23 | Task sections | Flat page sections with hairlines and oldest-first comments; composer below comments. | `audit-task-sections-final.png` |
| 24 | Docs list | Project subtitle decoded/resolved, shared soft search. | `audit-docs.png` |
| 25 | Podium | Wider name area and consistent text slots; two-line names preserve QA Dev. Soft search. | `audit-r21-final/leaderboard.png` |
| 26 | GIDEON controls | Tier dropdown moved to composer; chevron and credits-today/unlimited meter. | `audit-gideon-active.png` |
| 27 | Control Room ID | Resource-backed Pengguna/Audit/Quest matching approved web terminology. | `audit-admin-id.png` |
| 28 | User rows | Top-aligned avatars, outlined Details, Google Workspace sign-in label. | `audit-admin-users.png` |
| 29 | Role statistics | Registered-user total from admin pagination (67), role cards from workspace membership (1/9/11/33), hierarchy note and Board label. | `audit-admin.png` |
| 30 | Profile form/tabs | Label-above soft fields; shared tabs expose clipped ends with fades and scroll. | `audit-settings.png` |
| 31 | Profile email/phone | Embedded email + Change, Google Workspace box, web-equivalent phone display formatting. | `audit-settings.png` |
| 32 | Inbox row actions | One labeled 48dp overflow and unread indicator frees title width. | `audit-notifications.png` |
| 33 | Undo/feedback | Delete waits for Snackbar Undo window; Undo restores row before DELETE. Replaced nine platform Toast callsites with shell Snackbar feedback. | `audit-inbox-undo.png` |
| 34 | Submissions empty state | Legal card counts as content under All; header subtitle wraps. | `audit-submissions.png` |
| 35 | Home viewport edge | Bottom fade indicates content continues behind floating navigation. | `audit-r21-final/dashboard.png` |
| 36 | Typography | Inter styles reset Material letter spacing to zero; established explicit brand labels retained. No speculative global font-size migration. | `audit-r21-final/dashboard.png` |
| 37 | Project marks/agenda | Existing ProjectMark already respects project icon; grey page is the approved default for projects without icons. Agenda strip now fades at scroll edges. | `audit-home-agenda-fade.png` |
| 38 | Chat composer duplicate | Same fix as 10. | `audit-chat.png` |
| 39 | File type/spacing | Uppercase extension and size in compact grey inner card; removed excess file-to-time gap. | `audit-chat.png` |
| 40 | Calendar chip/legend | Wrapping chips fixes clipping. Kept explanatory legend copy because it is also present in approved reference. | `audit-calendar-id.png` |
| 41 | Action descriptions | Named previous/next month controls and Add option; visible target/description checks on affected pages. | `audit-r21-final/project-calendar.png` |
| 42 | Folder actions | Calendar, drag and overflow targets enlarged to 48dp. | `audit-r21-final/projects.png` |
| 43 | Project header | Two-line title and 48dp actions preserve native Back and approved project controls. | `audit-board-final.png` |
| 44 | Lane surfaces | Neutral lane background and complete neighboring lane surface in both themes. | `audit-board-dark-final.png` |
| 45 | Lane heading | Removed duplicate grouping caption, retained lane chip and count. | `audit-board-final.png` |
| 46 | Timeline tab clipping | Same phone dropdown correction as 3/15/17. | `audit-r21-final/project-timeline.png` |
| 47 | Calendar today | Filled navy circle around day number; weekend/first-of-month treatment retained. | `audit-project-calendar-final.png` |
| 48 | Timeline labels | Short-span titles placed beside bars; sticky No date on undated rows. Alpha/Charlie have past due dates, so are correctly not labeled undated. | `audit-timeline-scrolled.png` |
| 49 | Description 409 | Retains local draft and shows actual latest saved text inline with Load latest; retry base updates. Live stale-write fixture verified. | `audit-description-conflict.png` |
| 50 | Forms list | Duplicate intro removed; title wraps and Public badge has its own row. | `audit-forms.png` |
| 51 | Doc reader | Project breadcrumb, overflow Share/Open web/GIDEON navigation. | `audit-doc-actions.png` |
| 52 | Vault usage | Minimum visible fill for nonzero usage, accurate numeric label and full-width dividers. | `audit-vault.png` |
| 53 | Room terminology | Reference retained: supplied 20-room-booking-web.png explicitly says Booking Ruangan / Booking baru / Booking ruang meeting. Pemesanan would introduce a different design/copy. | `audit-rooms-id.png` |
| 54 | Room month state | Matches approved list: past bookings collapsed with Show/Hide, meaningful empty-upcoming state and New booking. Today disabled in current month, enabled away from it. | `audit-r21-final/room-booking.png` |
| 55 | GIDEON composer | Borderless input and filled active send; typed an unsent draft to verify. | `audit-gideon-active.png` |
| 56 | Tier menu | Rounded bordered card, consistent 88dp rows and reserved selection-check slot. | `audit-tier-final.png` |
| 57 | Control Room boundaries | Shared tab fades and wrapping two-column role-stat grid. | `audit-admin-id.png` |
| 58 | Legacy ID notifications | Server bilingual fields win; narrow fallback for known legacy assignment/comment/legal templates preserves names and unknown content. | `audit-notifications-id.png` |
| 59 | More icons | Outline Vault/Reports icons match the established list set. | `audit-more.png` |

## Reference checks and limits

Finding 53’s suggested “Pemesanan Ruang” contradicts `20-room-booking-web.png`, which explicitly uses “Booking Ruangan”, “Booking baru” and “Booking ruang meeting”. Android keeps those approved strings. The same screenshot uses a bookings-only month list, so finding 54 is resolved with its past-booking toggle, meaningful empty state and correctly disabled current-month Today control; no new calendar layout was invented.

The old grey project page mark is the established fallback for projects without an icon (37); the shared renderer already supports real project icons. Calendar explanatory copy is also in the approved reference (40). Task header Follow/Favourite/Like/trophy are explicitly required by owner16 (21). Alpha/Charlie have past due dates, so only genuinely undated tasks get No date in the timeline (48).

Earlier Fix 21 owner/race work remains in STATUS.md. Its separate positive OAA/Staff/Manager-session QA gaps and absent Social Media/Outlet features are unchanged by this 59-finding UI round; no unavailable role was promoted or bypassed.

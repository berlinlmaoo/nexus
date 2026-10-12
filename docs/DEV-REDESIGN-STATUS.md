# iOS / iPadOS / macOS — dev redesign status

Owner decision (12 Oct 2026): the app ships TOGETHER with the redesigned web. Branch `dev` only (never
`main`); the NEXUS_DEV_SERVER flag + server switch (Settings › Server, or long-press the login title) point
the build at https://nexus-prod.tail765d02.ts.net:8443.

Build on the Mac: `git fetch && git switch dev && git pull && xcodegen generate`, then ⌘B / ⌘R.
Nothing here has been compiled: Linux can only `swiftc -parse` each file (all changed files pass).

Checks that run without Xcode:
- `./scripts/check-localization.sh` — fails on a duplicate Indonesian key across `Sources/Localization*.swift`
  (the same check is the pre-build script in project.yml). New strings live in
  `Sources/LocalizationRedesign.swift`.

## Phase 1 — logic + copy (done)

| What | Where | Verify on device |
|---|---|---|
| Rupiah/IDR: "369.000" = 369 000; Rp grouped while typing; plain numbers never "Rp"; saved on focus loss / close | CustomFieldNumber.swift (+ Linux test, 61 web cases pass), CustomFieldChips, TaskDetailExtrasView, New task | Type 369000 in a Rupiah field, close the task at once, reopen: Rp 369.000 |
| New task takes its column's status (no forced TODO) | APIClient.createTask | Add a card in "Done"/"In progress": it stays there with that status |
| Status options = columns, ordered To-do / In progress / Complete, web palette (light + dark) | StatusOptions.swift, ProjectBoardView | Finance Suwara board order + colours |
| Task detail: status picker = project options (grouped), priority in app language, Blocked by + Time tracked removed, Payout proof tag, multi-file pick, saves title/description/fields on close, no newline in title, remote rename shown, comment kept on failure, one comment/subtask in flight, activity in app language | TaskDetailView, TaskDetailExtrasView, ServerText.swift | Edit title → swipe back at once; Esc-equivalent loses nothing |
| My Submissions rebuilt (status columns, filters incl. per project, amounts, proof, history, comments + reply, delete with alert, live) | SubmissionsView.swift, RedesignAPI.swift | Open QA audit request 3 (Finance Suwara) — proof listed |
| Forms: Idempotency-Key, email/link validation (client + server codes), delete with `expect` + 409 re-confirm | FormFillAPI/Models/View, FormBuilderAPI/View | Delete a form while someone submits |
| Version: dev builds report ios/0.1.7/14 | project.yml | — |
| Navigation Home · Work · Team · System; My Tasks, Notifications, Settings, Tickets, Pages | AdaptiveRoot, RootView | Phone More grid + iPad sidebar, both languages |
| Copy sweep (iOS rows of copy-sweep.md), Quest kept | many views | Login screen, Attendance cards |
| Calendar: no-PIC tasks absent (server), "No division" neutral dot, unplaced listed at top; golden test updated | CalendarCore (+ watch label) | Month dot legend, day panel |
| Double-submit guards (New project, New task, automation Turn on, Duplicate) | — | Double-tap Create |
| Social Approvals / Integrity | nothing to remove — iOS never had those screens | — |
| WhatsApp / Webhooks | done by the other agent (5ad301b) | — |

Not done in phase 1: the ~80 older slangy Indonesian strings that no screen above touched (e.g. "Nggak …")
were left as they are.

## Phase 2 — board like web / Notion

_Not started._

## Phase 3 — block editor, GIDEON, templates, iPad/Mac

_Not started._

## Verify on device first

_Filled in as phases land._

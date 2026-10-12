# iOS / iPadOS / macOS — dev redesign status

Owner decision (12 Oct 2026): the app ships TOGETHER with the redesigned web. Branch `dev` only (never
`main`); the NEXUS_DEV_SERVER flag + server switch (Settings › Server, or long-press the login title) point
the build at https://nexus-prod.tail765d02.ts.net:8443. Target: the NEXUS **dev web** as it is now (Notion's
interaction patterns blended with NEXUS's own identity — brand, colours, clipboard project mark, attendance /
XP / Quest), with native Apple conventions (SF Symbols, navigation, sheets, centred `.alert`, Dynamic Type,
iPad sidebar, Mac keyboard shortcuts). Where Notion and NEXUS dev differ, NEXUS dev wins.

Build on the Mac: `git fetch && git switch dev && git pull && xcodegen generate`, then ⌘B / ⌘R.
**Nothing here has been compiled.** Linux can only `swiftc -parse` each file (all changed files pass), plus
these real checks that do compile and run on Linux (swift:5.10 in Docker):
- `./scripts/check-localization.sh` — no duplicate Indonesian key across `Sources/Localization*.swift`
  (also the pre-build script in project.yml). New strings live in `Sources/LocalizationRedesign.swift`.
- `Tests/CustomFieldNumber` — the web's 61 Rupiah/number cases, all pass.
- `Tests/CalendarGolden` — refreshed from dev, 12/12 match.
- Block conversion round-trip (BlockEditing.swift) on the "Event SOP" page: byte-identical.
- Saved-views and block-doc decoding against real dev payloads.

Server work done for the app (dev only, branch feat/ios-edit merged into dev, deployed):
- `POST /api/collab/edit` — block edits from the app merged into the live Yjs room (lib/block-merge.ts,
  lib/collab-rooms.ts applyBlockEdit). Live two-client test `scripts/collab-edit-test.mjs`: 13/13 pass
  (web client sees the app's edit live, conflict → 409, keepBoth, persistence, no-room path).
- Fixed a latent save bug in the Yjs rooms: a save with nothing to save left the room unable to save again.

## Phase 1 — logic + copy (done)

| What | Where |
|---|---|
| Rupiah/IDR parsing like the web, saved on focus loss / close | CustomFieldNumber.swift, CustomFieldChips, TaskDetailExtrasView |
| New task takes its column's status | APIClient.createTask |
| Status options = columns (group order, palette) | StatusOptions.swift |
| Task detail: option status picker, no Blocked by / Time tracked, proof tag, multi-file, saves on close, guards | TaskDetailView |
| My Submissions rebuilt (status columns, per-project filter with counts remembered, proof, history, reply, delete) | SubmissionsView |
| Forms: Idempotency-Key, email/link checks, delete with `expect` + 409 re-confirm; dev builds report 0.1.7/14 | Form* files, project.yml |
| Navigation Home · Work · Team · System; copy sweep; Quest kept | AdaptiveRoot, RootView, many |
| Calendar "No division", golden test | CalendarCore |
| Double-submit guards | several |
| Indonesian: every slangy string made plain (≈85) | Localization.swift |

## Phase 2 — board (done)

| What | Where |
|---|---|
| Coloured status columns, custom statuses (rename/colour/move/delete/+Status) | ProjectBoardView, BoardRedesign |
| Inline new card at the top (queue, Esc/tap-away saves, ⤢ open) | InlineDraftCard |
| Multi-select drag = whole visible selection, batch-move, Undo 10 s | ProjectBoardView |
| **Manual order inside a column** (drop on a card = before it; POST /api/tasks/reorder; Undo) | LaneColumn, ListTab |
| Saved views (chips, filter/sort/group sheet, Per kategori), bulk Move to / Priority | ProjectViews.swift |
| Task as centred sheet on iPad/Mac | ProjectBoardView.open |
| Undo a task delete (auditLogId → undo-delete), bulk Assign to / Due date with Undo, timeline "No date" | ProjectBoardView, TaskBatchDuplicate |

## Phase 3 — editor, GIDEON, templates, iPad/Mac (done)

| What | Where |
|---|---|
| **Page editing** (paragraph, H1–3, bullet/numbered/to-do, toggle, quote; other blocks kept, movable, deletable), inline marks kept outside the edited stretch, save on Done / close, offline outbox, conflict alert (Keep both / Use theirs / Cancel) | BlockEditing.swift (+ Tests/BlockEditing), BlockEditorView, DocsView |
| **Task description** uses the same editor | TaskBodyCard |
| Page reader draws the block doc; live re-read on doc-changed | BlockDocView, DocsView |
| **GIDEON**: project/task context, chats, steps/sources/cards, Review approvals; **@ context picker, Personalize, Save as doc**; **AI actions in the editor** (improve … translate, action items → tasks, free prompt) | Gideon.swift, GideonPanel(+Extras), GideonWrite |
| Template gallery (7 server templates, palette colours) | TemplateGallery |
| iPad/Mac: sidebar (incl. GIDEON page), full-width pages, ⌘1–⌘7, ⌘[ ⌘] ⌘F ⌘N ⌘, ⌘E ⌘↩ ⌘Z, hover, 44 pt | AdaptiveRoot, ProjectBoardView |

## UI sweep — screen by screen (web dev visual language, 12 Oct 2026)

Shared pieces every screen uses now: calm `EmptyState` (one muted icon in a soft circle + title + reason +
quiet next-step button), `NXUnderlineTabs` (light underline tabs with counts), `.nxChoiceChip` (light
selected chips), no dashed placeholder boxes, status pills in the option palette, sentence-case labels,
full-width pages on iPad/Mac.

| Screen | State |
|---|---|
| Login / Sign up / Reset password | copy swept (Email, Password, Sign in); NEXUS look kept |
| Home (Dashboard) | NEXUS identity kept (gradient tiles, level card) as the web; no "Commander" |
| Chat (Messages, info, new chat) | shared empty state; unchanged otherwise (web unchanged) |
| GIDEON panel + sidebar page | rebuilt (see Phase 3) |
| Notifications | underline filter tabs with counts, date-only meta, plain copy |
| Threads | shared empty state |
| Z Vault | shared empty state; drop target dash kept (meaningful) |
| My Tasks | plain copy (Due soon / Later / Done recently) |
| My Submissions | rebuilt like the web |
| Calendar (month, people, day panel) | "No division"; dashed boxes removed |
| Room Booking | shared empty state |
| Projects list / folders | plain copy, no dashed boxes |
| Project: Overview | unchanged (already redesigned 11 Oct to the web) |
| Project page header (13 Oct, after the owner's Mac build) | web page header: project icon + large title; iPad/Mac labelled "Ask GIDEON", "Project settings", dark "Add task"; phone keeps icons; back only when pushed; plain background |
| Project tab row (13 Oct) | web chips (icon + label, soft fill when on); saved views sit beside their layout tab ("Per kategori" next to Board); "+" new view; filter button with a dot when filtered; view menu on long-press / right-click; the old chip bar under the tabs is gone |
| Project: Board / List | rebuilt (Phase 2); List redone 13 Oct as flat hairline rows: done circle, title, properties on the right on iPad/Mac (first 3 custom fields e.g. amount, due with overdue red, priority, status pill, avatars), wrapped under the title on iPhone; collapsible group headers with coloured pill and done/total |
| Sidebar (iPad/Mac, 13 Oct) | calm outline icons in one muted colour, regular-weight labels, smaller project marks |
| Project: Sheet / Timeline | statuses ordered; Timeline skips undated tasks |
| Project: Calendar / Pages / Forms / Chat / Automations / Pipeline / Outlet | shared pieces; Pages editable |
| Task detail | rebuilt (Phase 1 + editor) |
| Project settings / New project / Template gallery | title "Project settings", light chips |
| Leaderboard / Reports / Person report | shared pieces, "Search people" |
| Forms (list, builder, fill) | plain copy, delete flow, validation |
| Attendance (+ requests, offices, admin, liveness) | plain copy, status labels in the app language, light filter chips |
| Tickets | BoD queues Inbox / In review / All with counts, lands on first non-empty; staff by status |
| Settings | web tabs: Profile, Members, Notifications, Security, Appearance, Claude (MCP); Security › Active sessions (device label as web lib/device-label.ts, "This device" badge, per-row Sign out and "Sign out other sessions" behind centred alerts; own session revoked → clean sign-out) |
| Control Room (users, audit, quests, org chart, day-off, fake GPS, announcements) | light chips / tabs, shared empty states |
| What's New | copy swept |
| Watch / widgets | "Team", "No division" |

## Server pieces that must ship to production WITH the app

All of these exist on the dev server only (branch `dev` of the NEXUS repo). The app calls them; on today's
production they answer 404 or behave the old way, so they go out in the same release as the app:

| Piece | Used by the app for |
|---|---|
| `POST /api/collab/edit` (lib/block-merge.ts, collab-rooms applyBlockEdit / requestBlockEdit) **plus the room-save fix** in lib/collab-rooms.ts persist() | editing pages and task descriptions |
| `POST /api/tasks/reorder` | manual order inside a column |
| `POST /api/tasks/undo-delete` + `auditLogId` in DELETE /api/tasks/:id | Undo after deleting a task |
| `POST /api/tasks/batch-move` | multi-select drag, bulk Move to / Priority, Undo |
| `POST /api/tasks` `placement: "top"`; status from the column when none is sent | inline new card |
| Sections accept the palette colour names (blue, green, yellow, red, purple, brown, orange, pink, gray) | status colours |
| `/api/projects/:id/views` (saved views) and status-option sections (TaskList.taskStatus, color) | board, views, status picker |
| GIDEON: `stream` events, `approvalMode`, `context` (+ `refs`), chats, proposals, `/api/gideon/prefs`, `/api/gideon/save-doc`, `/api/gideon/write` | GIDEON panel, Personalize, Save as doc, editor AI |
| Form submit `Idempotency-Key` + INVALID_EMAIL / INVALID_URL; form DELETE `expect` | forms |
| `/api/forms/my-submissions` `columns` + replies / delete | My Submissions |
| Calendar: no-PIC tasks excluded, "No division" placement | calendar |
| `GET /api/user/sessions` with `client` + `current`; `DELETE /api/user/sessions/:id` answering `{ current }` (prod has the routes but neither field: no "This device" badge there) | Settings › Security › Active sessions |

## Residual risks

1. **Not compiled.** The first ⌘B will tell; the likeliest trouble is long SwiftUI expressions (split where
   found) and argument labels. Needs Xcode 16 or later (the editor model is created in view initialisers,
   fine because `View` is main-actor on the iOS 18+ SDK).
2. In-column reorder needs a drop exactly on a card; between cards there is no insertion line.
3. Editing a line keeps every mark and mention outside the edited stretch (Linux test on 6 real dev pages,
   257 checks); a mention or date the edit cuts into becomes plain text, as in an editor.
4. What's New entries stay English by design.

## Verify on device first

1. ⌘B; then switch to Bahasa once (no launch crash).
2. Finance Suwara board: colours; A ⏎ B ⏎ C in a new card; drag a selection → Undo; drop a card on another
   card in the same column (order changes, Undo).
3. A Rupiah field: type 369000, close the task at once, reopen.
4. Pages: open ZZ Blocks QA › Event SOP, Edit, change a line and add a to-do, Done — check on the web live;
   edit the same line on the web and in the app (conflict alert). Airplane mode → edit → Done → back
   online → reopen (sent).
5. Task description editing, then GIDEON ✨ in the keyboard bar (Improve writing → Replace).
6. GIDEON: @ a project, Personalize name, Save as doc → Open page; a proposal Apply.
7. Tickets as BoD (lands on the first non-empty queue); Settings tabs; Notifications tabs.
8. iPad + keyboard: sidebar ⌘1–⌘7, GIDEON page, task sheet, ⌘N / ⌘F / ⌘[ ⌘].

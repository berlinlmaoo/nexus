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

## Spreadsheet — native (13 Oct 2026, was planned for 0.1.7)

The project tab **Spreadsheet** (key `sheet`) is now the real project spreadsheet (ProjectSheet), as on the
web; the old grid of tasks is the tab **Table** (key `table`), matching the web's keys and names.

| Piece | Where |
|---|---|
| Formula engine, number formats, data validation, conditional formats, sheet-types helpers, clipboard (pure) — 1:1 Swift ports of the web's lib/sheet-*.ts and components/sheets/sheet-types.ts / sheet-clipboard.ts; formula.js functions reimplemented from the MIT source (no HyperFormula) | Sources/Sheets/SheetFormula*.swift, SheetNumFmt, SheetValidation, SheetCF, SheetTypes, SheetClipboard |
| Tests on Linux: every case of the web's sheet-formula / numfmt / validation / cf tests plus a corpus produced by running the web engine itself (439 formulas × id-ID/en-US, every SUPPORTED_FUNCTION and formula.js function, typed input, formats, A1↔stored, shift, R1C1, deletion rewrite, validation, CF): **17,486 checks, 0 fails** | Tests/SheetFormula (command in main.swift) |
| App text vs the server's `GET /api/sheets/:id?computed=1` on real dev sheets: 0 mismatches; model test (selection, save queue) 18/18; bridge smoke test 13/13 | Tests/SheetModel, scratch harness |
| Grid: UICollectionView with its own layout (rows × columns, cells reused) inside UIViewRepresentable; column letters / row numbers in strips that follow the scroll; free two-axis scroll; selection drawn over the cells | SheetGrid.swift |
| Touch: tap selects, tap the selected cell or double-tap edits, press-and-hold then drag selects a range (release without moving = menu: cut/copy/paste/clear, rows, columns). Pointer (iPad trackpad, Mac): drag selects a range, ⌘-click adds a range, ⇧-click extends, right-click = menu | SheetGrid.swift |
| Keyboard (iPad keyboard, Mac): arrows (⇧ extends, ⌘ jumps to the edge), Tab / ⇧Tab, Enter (edits; after a Tab run returns to the start column), ⇧Enter, Delete, Esc, F2, ⌘C ⌘X ⌘V, ⌘Z ⇧⌘Z ⌘Y, ⌘A, ⌘B ⌘I; typing starts editing with that key | SheetGrid.swift |
| Formula bar: name box (A1 / range) + the cell's content, edited there (Enter saves and moves down, Tab right, **Esc cancels**, ✓ / ✕ buttons); while typing a formula a tap on a cell inserts its address | SheetViews.swift |
| Dropdown cells (validation lists, select / multi-select columns) open a picker with the chip colours; checkbox cells tick on tap; invalid cells get the red corner; conditional formats and column rules paint cells; cell formats (bold, italic, strike, colours, alignment, wrap, number formats, font size) drawn | SheetBridge.swift |
| Saving: **per-sheet serial save queue** (one request in flight per sheet, newest value per cell wins), kept on disk; **offline queue + badge** (cloud-slash with the count), sent on reconnect / app foreground / next launch; refused writes reload the sheet with the server's sentence; sign-out clears it | SheetOutbox.swift |
| **Undo / redo** per sheet (toolbar on iPad/Mac, bottom bar on iPhone, ⌘Z): cell edits, formats, paste (one step incl. auto-added rows/columns), row insert/delete (rows come back in place with values and formats), **column delete restores the columns with their old ids, values, formats, the formulas the server rewrote and the validation rules** (web S-BUG-6) | SheetStore.swift |
| Paste: NEXUS JSON (formulas move with the paste), HTML table, or TSV from other apps; **auto-expands columns and rows** when the block is bigger than what is left | SheetStore.paste |
| Realtime: room `sheet:<id>`; `sheet-cells` applied live except this app's own echo (**X-Nexus-Tab originTab**), never over the cell being edited or with an older row; `sheet-structure` re-reads the sheet | RealtimeClient, SheetStore |
| Sheet tabs: switch, add, rename, duplicate, delete (centred alert; lead+ and never the first sheet); Sum of a selected block in the bottom bar | SheetViews.swift |

Not on the phone/tablet yet (web only): charts, pivot tables, filter views / slicers, borders / merges /
freeze panes, column resize, comments and version history panels, find & replace, conditional-format and
validation EDITORS (the rules made on the web apply here), protected-range editing UI (the server still
enforces it). Long text is clipped at the cell edge (no overflow into empty neighbours yet).

## Notification language (13 Oct 2026)

Notifications and pushes are English unless the person chose Indonesian. The app sends its in-app
language (never the phone's): `X-Nexus-Lang: en|id` on every request, and `PATCH /api/user/profile
{ uiLanguage }` on launch / sign-in and whenever the language picker changes. The inbox shows
`texts[appLanguage]` when the server sent both languages, else the stored title / message.

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
| Sheets: `X-Nexus-Tab` → `originTab` on sheet-cells / sheet-structure events, rows POST with `positions` + `styles`, column-delete range shrinking, the 25 sheet fixes of 13 Oct | Spreadsheet tab |
| `User.uiLanguage`, `PATCH /api/user/profile { uiLanguage }`, `X-Nexus-Lang`, `Notification.texts` | notification / push language |

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
9. Spreadsheet (ZZ Bughunt sheet): scroll both ways; type 1.500 and =SUM(…) via the formula bar; press-and-
   hold then drag a range → Copy → Paste elsewhere (formula shifts); delete a column → ⌘Z (values and
   formulas back); airplane mode → edit → badge → back online (sent); edit on the web → appears live.
10. Bahasa → a new notification arrives in Indonesian; English → English.

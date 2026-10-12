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
| **Freeze rows / columns** (settings.frozenRows / frozenCols): the layout pins the frozen cells to the visible edge (frame + contentOffset; a bounds-change invalidation limited to the frozen items), the header strips keep the frozen letters / numbers put with Sheets' grey bar, the selection is drawn in four clipped panes so it never shows through a frozen pane, keyboard / taps / drags scroll past the frozen edge. View › Freeze: none / 1 / 2 / up to the active row (≤ 20) or column (≤ 10), also in the cell menu; refused when the line cuts a merged block (Sheets' sentence) | SheetGrid.swift, SheetGridStore.swift |
| **Column width / row height**: drag a header edge with the pointer (resize pointer on iPad trackpad / Mac), or with a finger the round handle on the edge of selected whole columns / rows; several selected columns / rows take the same size; live preview, one PATCH (columns width, rows `heights`) and one undo step | SheetGrid.swift (SheetHeaderStrip), SheetGridStore.swift |
| **Long text overflow**: unwrapped text runs over EMPTY neighbours (left-aligned → right, right-aligned → left, centred both ways), stops at the first non-empty / dropdown / checkbox / merged cell and at the frozen edge; numbers, wrapped, clipped and rotated text never spill; gridlines under the text hidden; taps still select the cell under the finger | SheetGridModel.swift (SheetSpill), SheetGrid.swift |
| **Merged cells** (settings.merges by row / column id): drawn as one cell, hidden rows / columns inside shrink it; selection, arrows, Tab / Enter and ⇧-extend snap to whole blocks; Format › Merge all / vertically / horizontally / Unmerge (bar, iPhone Format sheet, cell menu) | SheetGridModel.swift (SheetMerges), SheetStore.swift, SheetGridStore.swift |
| **Borders** (style `bx` per side with line + colour, legacy `bd`): drawn inside the cell (thin / medium / thick / dotted / dashed / double); Borders panel with the web's ten presets, line style and colour (remembered per device), shared edges stored once and the neighbour's shared edge cleared, exactly like the web's applyBorderPreset; gridlines on / off (settings.noGrid) | SheetGridModel.swift (SheetGridStyle), SheetGridFormat.swift |
| **Filter**: Data › Create a filter / Remove filter (the data block around the selection); a funnel on the filter's header row (solid when the column filters something) opens the column menu: Sort A → Z / Z → A (rows of the block really reordered, formulas shifted, one undo step), Filter by colour, Filter by condition (all 19 conditions, dates, custom formula), Filter by values (search, Select all / Clear, counts, (Blanks)); filtered rows leave the grid. Filter views: open one (per viewer), create a new one; slicers made on the web are honoured. lib/sheet-filter.ts ported 1:1 (SheetFilter.swift) | SheetFilter.swift, SheetFilterMenu.swift, SheetStore.rebuild |
| **Hide / unhide rows and columns** (cell menu, Rows & columns menu; ◂▸ arrows on the header where something is hidden — tap to show it; View › Show hidden rows / columns), collapsed row / column groups made on the web stay hidden | SheetGridStore.swift, SheetGrid.swift |
| **Formats**: text and fill colour (Sheets' 80 swatches, hex like the web; a hex fill without a text colour gets black / white text), font size in points (`fp`, 6–36), vertical align, wrapping (overflow / wrap / clip, `wr`), number formats (automatic, plain text, number, percent, scientific, accounting, Rupiah, date, time, date time, duration) with decimal places − / +, clear formatting. iPad / Mac: in the format bar (popovers); iPhone: More › Format… sheet | SheetViews.swift, SheetGridFormat.swift |
| Tests on Linux (Tests/SheetModel, command in main.swift): every case of the web's sheet-filter.test.mjs, plus borders, merges, overflow, colours, fonts, decimals, hidden gaps — **103 checks, 0 fails**; SheetStore / SheetBridge / SheetGridStore type-checked on Linux with a UIKit shim | Tests/SheetModel |
| **Alternating colours / tables** (settings.bandings, settings.tables): header / footer / two band colours painted UNDER each cell's own format (the cell's fill, conditional formats and column rules still win; light fills get black or white text like the web's styleInline) | SheetBridge.swift (bandBase) |
| **Charts on the grid**: every chart of settings.charts floats at its `at` anchor (row id / column id + dx / dy, w × h) and scrolls with the cells (a hidden anchor row hides it, a hidden column moves it to the next one); drawn by the Charts panel's Swift Charts view in a UIHostingController. Tap selects (violet border, ⋯ menu: Edit / Duplicate / Delete), tap again opens the chart editor; move: pointer drag (iPad trackpad, Mac) or press-and-hold then drag (touch); resize: the corner handle; Delete / Backspace removes a selected chart, Esc deselects. Saved as the web does (new anchor cell + offset, one undo step). Charts anchored in frozen rows / columns draw above the frozen panes; the others pass under them | SheetGridObjects.swift, SheetGrid.swift, SheetGridStore.swift (placeChart / deleteChart / duplicateChart) |
| **Column stats** (Tools › Column stats): ‹ › between columns, Ignore rows, Count by value / Distribution bars, Most / Least frequent, totals (sum, average, median, min, max); hidden and filtered rows included like Sheets. lib/sheet-stats.ts ported 1:1 | SheetStats.swift, SheetPanelStats.swift |
| **Named ranges** (list, jump, add / edit / delete with Sheets' name rules) and **Protected sheets and ranges** (description, range or whole sheet with "except", warn vs restrict, Only you / Custom editors from the project's members; managers only, like the web). Editing a warn range asks first (centred "Heads up!" alert, "don't show again for 5 minutes"); a restricted range refuses typing, clear, paste, checkbox, dropdown and formatting for anyone but its owner, editors and leads before anything is sent (the server enforces it anyway) | SheetRanges.swift, SheetPanelRanges.swift, SheetStore.swift (guardProtected) |
| **Font family** (`ff`): the web's 18 families, mapped to the fonts iOS / the Mac have (Arial, Georgia, Courier New, Times New Roman, Verdana, Trebuchet…; the ones iOS lacks — Calibri, Cambria, Consolas, Comic Sans, Impact, Segoe UI, Tahoma — use the font installed on a Mac when there is one, else the nearest: Georgia / New York serif, Menlo, Chalkboard, Futura, Verdana, the system font); menu on iPad / Mac, picker on iPhone | SheetGridModel.swift (SheetGridText), SheetGridObjects.swift (SheetGridFonts) |
| **Custom number formats**: Custom number format (pattern + live example + Sheets' presets + recently used), Custom date and time (chips per field with code menus, separators typed between, presets), Custom currency (search, six variants, 42 currencies) → style nf "custom" + pt; the pattern's colour section ([Red]…) colours the cell | SheetPanelNumFmt.swift, SheetBridge.swift |
| **Freeze handles**: the grey bars on the select-all corner drag to freeze rows (≤ 20) / columns (≤ 10) up to where they are dropped (violet preview line), like the web; refused across a merged block | SheetGridObjects.swift (SheetCornerView), SheetGrid.swift |
| **Text rotation** (`rt`): tilt up / down, rotate up / down, stacked, custom angle (−90…90); drawn turned counter-clockwise inside the cell and placed by its alignment; rows without a height of their own grow for rotated and large text (web autoHeights) | SheetGrid.swift (cell), SheetGridModel.swift, SheetStore.swift |
| Tests on Linux: Tests/SheetModel **132 checks, 0 fails** (adds fonts, rotation, auto row height, chart anchors); Tests/SheetPanels **239 checks, 0 fails** (adds every case of sheet-stats.test.mjs + named-range / protection rules) | Tests/SheetModel, Tests/SheetPanels |
| **Wrapped-text auto row height**: rows without a height of their own grow to fit wrapped text (`wr: "w"` / legacy `w`), measured with each cell's font (size, bold, italic, family) in its column width − 12, lines × px × 1.3 + 8, capped at 400 — the web's autoHeights; a manual height always wins. Recomputed on every rebuild (edit, realtime, resize, format) but a row is measured again only when the signature of its sized cells (text, style, column width) changed | SheetGridModel.swift (SheetGridText.autoRowHeight / wrappedLines), SheetStore.computeAutoHeights |
| **Chart download as PNG**: chart ⋯ on the grid, the Charts panel's chart ⋯ and the chart editor's preview button draw the chart (same Swift Charts view, at its sheet size, light, 2×) with ImageRenderer into "<title>.png"; iPhone / iPad: share sheet (iPad popover points at the chart), Mac: Save panel. SVG stays web only | SheetChartExport.swift, SheetPanelCharts.swift, SheetGrid.swift |
| **Slicers**: Data › Add a slicer (over the filter's range, else the data block around the selection; first column; placed right of the block — web addSlicer) opens the Slicer editor (Data: range + column; Customise: title + background colour; Delete slicer, which the web has no button for). Each slicer floats on the grid as the web's pill chip at its `at` anchor (filter icon, title or header, "N of M", caret; own colour with readable text): tap selects, tap again opens its value list (the filter menu: values, condition, colour, sort A→Z / Z→A of its range), ⋯ beside it = Filter by values / Edit slicer / Delete slicer; press-and-hold (or pointer) drags it; Delete key removes a selected one. Saved to settings.slicers; filtering keeps going through SheetStore.rebuild | SheetSlicer.swift, SheetPanelSlicer.swift, SheetGridObjects.swift (pill), SheetGrid.swift, SheetViews.swift |
| **Chart editor save fix**: Done merges only the fields the editor changed (vs what it opened with) into the chart as it is in settings at save time — a move / resize on the grid while the editor was open is no longer reset (same merge for the slicer editor) | SPChartSpec.mergeEdits, SheetSlicerSpec.mergeEdits |
| Tests on Linux: Tests/SheetModel **145 checks, 0 fails** (adds wrapped lines / heights); Tests/SheetPanels **247 checks, 0 fails** (adds the editor merge); SheetStore + SheetSlicer type-checked and smoke-run on Linux (slicer hides rows, N of M, value list, merge, auto height shrinks after widening) | Tests/SheetModel, Tests/SheetPanels |

Still web only: renaming / deleting filter views, sort by colour, SVG chart download.

## Notification language (13 Oct 2026)

Notifications and pushes are English unless the person chose Indonesian. The app sends its in-app
language (never the phone's): `X-Nexus-Lang: en|id` on every request, and `PATCH /api/user/profile
{ uiLanguage }` on launch / sign-in and whenever the language picker changes. The inbox shows
`texts[appLanguage]` when the server sent both languages, else the stored title / message.

## QA web fixes ported (13 Oct) — part 1

Work, people and projects, from the dev web commits afa857f, 0c1f523, 0a89f86, 45cf033, 3f8b3ca, 458d9af,
6720b8c, 0b0b64a (QA 13 Oct 2026). Indonesian in `LocalizationQAWork.swift` (`indonesianQAWork`).

- **Project access levels** (`ProjectAccess.swift`): Full access / Can edit / Can comment / Can view from
  `viewerAccessLevel` + `viewerCanManage` (GET project) and `accessLevel` on members; "Lead" reads
  **Project Owner** everywhere. Project settings: read-only for anyone without Full access (one line says
  why), level dropdown on every member row (change / Remove, `PATCH …/members`, 409 LAST_OWNER shown with
  the server's sentence), a level for the batch in Add members, Invite by email and New project
  (`memberAccessLevel`). Delete = Full access; Duplicate = BoD. An older server sends no level: nothing is
  hidden. Board/chat/task-detail gating lives in files owned by part 2 (patches handed to the lead).
- **Personal attendance privacy**: a peer's profile shows "XP gained this period" (`restricted` XP log,
  gains only) with the privacy line; Control Room user detail says approver / hours / mode are private when
  `personalHidden`; the Approval chart takes its edges from `/api/admin/approval-chart` (the members list
  now withholds `approverId` outside a Manager's chain, which drew everyone as "not placed").
- **Quests by IP & Division**: New quest picks chart units (`unitIds`, sub-units count), quest rows say who
  it is for ("Deleted division", "Everyone (was for a team…)").
- **Leaderboard ties**: equal XP share a rank, the next skips (1, 1, 1, 4); the podium prints the shared rank.
- **Errors / failed writes** (`FailureText.swift`): one wording for failures (never "Internal server
  error"), `LoadErrorView` (offline / not found / no access / server) used by the Vault; Reports use the
  shared wording; `ProjectUnavailableView` (Project not found → Go to Projects, no access → who to ask)
  for the project page; `failureToast` for failed writes that keep the person's input.
- **My Tasks**: Overdue · Due soon · Later · Done recently (lib/my-tasks.ts rules, WIB day for date-only
  dues), most urgent first, "Show all N" instead of a silent cut, due + "Nd late" on every row, "+" New
  task assigned to me (`assigneeIds`).
- **Reports**: past period at its end (`work.asOf`: "At the end of the period"), "Other projects" and
  "Task in a project you're not in" rows without links.
- **Calendar**: neighbouring-month days show their dots, lines and counts (quieter) and stay tappable.
- **Pipeline**: the name is asked first (nothing is created on Cancel).
- **Room booking**: New / edit / delete booking (creator or Manager+), 24-hour quarter-hour times, next
  quarter hour by default, ended slots refused, ROOM_TAKEN / BOOKING_IN_PAST said in the app's language,
  rooms named as the web does.
- **Attendance Score**: board + record use the server's `owed` (joined mid-period = days from their start,
  prorated allowance); the record says "from <date>".
- **Untitled** → "Tanpa judul" / "Task tanpa judul" / "Project tanpa judul" (`UntitledText`) on My Tasks,
  Home, Calendar, Docs, folder and Overview rows, Reports.

## QA web fixes ported (13 Oct) — part 2

Interaction, chat, GIDEON, editors, from the dev web commits 3c74c80, 7987b45, 3462249, 5a9bb7c, 30baf06,
79f65da, 3f8b3ca, 458d9af, 0b0b64a, 74979ab, 33ab776, 45cf033 (QA 13 Oct 2026). Shared pieces in
`QAInteractKit.swift`; Indonesian in `LocalizationQAInteract.swift` (`indonesianQAInteract`).

- **GIDEON failures** (`GideonProblem`): every refusal is worded in the app's language from its status /
  `code` / the route's fixed sentences, never raw ("Gideon error (503).", the Indonesian-only "File
  terlalu besar…", "Gideon lagi gak bisa dihubungi…"): busy (429), can't be reached (502–504, a dropped
  connection), not connected on this server (503 `not_configured` / `GIDEON_UNAVAILABLE`), the editor's
  `rate_limited`, file too large / unreadable (413/415). The empty-answer placeholder "(Gideon balas
  kosong…)" counts as no answer. **Try again** under the error re-asks the failed question (nothing is
  stored server-side for a failed turn, so no duplicate) or reopens a conversation that failed to load;
  a conversation that is gone says so; the Chats list shows a failure with Try again instead of "No
  chats yet". Reply scrub is server-side (tickets, served to every client): nothing to port.
- **Offline keep-draft**: inline new card = one keeper (web `kept()`): the card takes a failed title back
  while it is open, otherwise the board keeps it in an alert with Try again / Discard (offline only; a
  refusal is just said). Chat composer and task comment box keep unsent text per chat / task on the
  device (`LocalDrafts`, cleared once the server has it). A task rename that fails while closing offline
  is kept and sent the next time the task opens. Page / description edits are copied to the device 400 ms
  after each change (`BlockEditMirror`), not only on a failed save: a closed or killed app reopens the
  page with the edit and the next launch sends it (outbox → conflict asked as before); a card scrolling
  away and back no longer reloads over unsaved text.
- **Board / List / Table**: long-press then drag is the native `.draggable` (cards and rows; the menu
  shows on a long press without moving). The iOS edge swipe only starts at the screen edge, so a sideways
  board swipe never navigates back (the web bug was Chromium's swipe-back). Order for equal positions comes
  from the server (position, createdAt, id) and the app keeps it (stable sorts). Table drag: patch handed
  to the lead (ProjectTabExtras is not part 2's file).
- **Notifications**: the Inbox row shows the sender's avatar (`actor`, servers since 13 Oct) with the
  kind as a badge; `title` / `message` come from `texts[lang]` everywhere (Inbox, Home bell). Pushes are
  written by the server in the person's language; the Notification Service extension only adds images.
- **Search**: a person opens the DM with them (`POST /api/conversations` DM); their record only for
  themselves and BoD / One Above All (web S-08). Tasks and pages show their project; "Untitled" pages read
  "Tanpa judul"; hardware keyboard ↑ ↓ Enter, ⌘F back to the box.
- **Chat**: long-press Reply / Copy was already there (context menu on the bubble); Enter sends,
  Shift+Enter is a new line on a hardware keyboard (also GIDEON and task comments).
- **Keyboard**: ⌘K in the block editor (pages, task description) adds a link to the focused line, or
  changes / removes one already there (`LinkInsertSheet`; also a link button on the keyboard bar; a line
  with a link shows a link mark); ⌘K in the comment box writes the address in (comments render links).
  ⌘K is bound only while an editor has the keyboard (`EditorKeys`), so the app-wide ⌘K search (patch for
  the lead) never fires over an editor. ⌘O = new GIDEON chat (anywhere, and in the panel). Esc closes the
  GIDEON panel, Chats, Personalize, Save as doc, Ask AI, view filter, duplicate, assignee, new task, edit
  group, link-to-task sheets and the iPad task sheet.
- **Access-level gating from part 1** (in part 2's files): Add task needs Can edit; status columns and
  their menus need Full access; a read-only level chip next to the project name; 403 / 404 use
  `ProjectOpenFailure` + `ProjectUnavailableView`; project chat read-only below Can comment ("Can view"
  instead of the composer); Delete task needs Can edit.
- **Checked on Linux**: every changed file `swiftc -parse`; link add / edit / remove round-trip on the
  "Event SOP" page + new rows of every kind (83 checks, 0 fails); GIDEON error wording (0 fails).

## iPad trackpad / pointer (13 Oct 2026)

`UIApplicationSupportsIndirectInputEvents = YES` (Sources/Info.plist), Apple's standard key for pointer
support: trackpad and mouse clicks arrive as pointer touches instead of fake finger touches. Effects:
- Spreadsheet: click-drag selects a range, right-click opens the cell menu, header edges show a resize pointer.
- Everywhere: click-dragging a list or scroll view no longer scrolls it (two-finger scroll / wheel do, as in
  Apple's own apps); drag & drop, context menus (right-click / two-finger click), swipe actions and buttons
  keep working.
Test on iPad with a trackpad: scroll lists (two fingers), drag a board card and a list row, right-click a
card / a chat message, swipe-to-delete rows, the approval chart pan / zoom, the photo viewer pinch, the
Vault media viewer, sheets and popovers closing.

## QA round 2 additions (13 Oct, lead)

- Date-only due dates (00:00 UTC or 00:00 WIB) show the day only, everywhere (task detail fixed; My Tasks,
  Calendar and boards already did).
- Person record score starts on the WIB join day: the app shows the server's `score.from`.
- GIDEON chats titled by a web suggestion chip show in the app's language (GideonChatTitle.swift).
- Notification language (PATCH uiLanguage + `texts[lang]`): done in 5aaa3fb.
- Spreadsheet panels wired into the screen (Tools menu on iPad/Mac, More on iPhone, Comment in the cell menu,
  amber corner on cells with comments); viewers reach comments, history and charts too.

## Access levels round 2 (13 Oct)

Port of web 5e416d9 + e74a735. Gated on `ProjectDetail.canEditProject` / `canCommentProject`; an older
server that sends no level gates nothing.
- Can view / Can comment see a project read-only: no Add task / New form / ⌘N, no inline New task, no drag,
  drop, Move to, selection or bulk bar (Board, List, Table), no Add task on a calendar date, no Write / Edit
  brief, no status-update composer, Forms tab = fill in only (no builder, publish, New form).
- Saved views: New view, Rename, Delete only from Can edit; below it Filter and sort applies on this screen
  only (`screenConfigs`, nothing saved).
- Task detail: one-line notice; title, status/priority/dates, assignees, fields, description, subtask
  toggles and add, attachment add/delete disabled; Can comment keeps the comment box, Can view does not.
- Pages: Edit hidden below Can edit (project level read once per page).
- Project chat: `Conversation.canPost` (server) + level; the composer becomes the web's "View only" line, in
  the Messages tab too.
- 403 / 404 opening a task or page: LoadErrorView ("You can't open this task / page"), not the cache.
- Readable refusals: `AccessRefusal` maps NEEDS_EDIT_ACCESS / NEEDS_COMMENT_ACCESS / NEEDS_FULL_ACCESS (and
  older "MEMBER role" / "LEAD role" lines) in `APIClient.serverMessage`, so every APIError.http message reads
  as a sentence; raw 5xx lines become "Something went wrong on our side". ID strings:
  `indonesianAccessR2` (LocalizationAccessR2.swift).

## Shortcuts help, error states, Table gate (13 Oct)

- Keyboard shortcuts sheet (web ShortcutsHelp / lib/keyboard.ts): ⌘/ in the iPad/Mac root (AdaptiveRoot
  hidden shortcut group; search and shortcuts now share ONE `.sheet(item:)` via `SidebarRootSheet`, env passed
  explicitly), ⌘/ or Esc closes it. Also a "Keyboard shortcuts" card in Settings › Appearance (not on iPhone).
  Lists only what the app binds, grouped: Anywhere (⌘K, ⌘S, ⌘1–⌘7, ⌘O, ⌘/, Esc), Search, Project (⌘N, ⌘[ ⌘],
  ⌘F, ⌘,), Tasks (⌘Z undo move, quick add ⌘↩/Esc, duplicate mode ⌘A/⌘D), Text editor (⌘K link, ⌘E, ⌘↩),
  Calendar, Chat, Z Vault viewer, Spreadsheet (SheetGrid keyCommands). Views/KeyboardShortcutsHelp.swift —
  keep it in step with the handlers.
- Error / not-found states (web 6720b8c + 45cf033): Control Room Users, Quests, Announcements, GIDEON usage,
  App installs and Attendance admin show LoadErrorView with Try again instead of an empty list / "Total 0" /
  "BoD and above only"; Extra day off, Absen Monitor, Audit and the IP & Division chart word failures through
  FailureText. A user removed while their detail is open gets a not-found state. Quest delete and
  announcement delete / (de)activate failures are toasts (were silent). Tickets: list = LoadErrorView (a
  failed refresh keeps the list); thread = LoadErrorView with "This ticket doesn't exist" / "isn't yours" +
  Back to tickets; Esc closes the thread; a notification link is not called "missing" when the list failed.
  A tapped announcement push that 404s / fails now says so (alert) instead of doing nothing.
- Table tab: rows are draggable / drop targets only when ProjectBoardView passes `onDrop` (Can edit and up,
  `tableDrop`), via the `SheetRowDrag` modifier in ProjectTabExtras.swift.

## BoD round 2 (13 Oct)

Web bb2d8f9 (BoD R2) + 33f3080 / 0275d91 (keyboard/touch R2).

- Project members: Remove asks first (centred `.alert`, "Remove %@ from this project? They lose access right
  away.") in Project settings and in Control Room › user › project chips. 409 LAST_OWNER on Remove (server
  DELETE now guards it too) and on a level change shows the server's sentence (`ProjectAccessText.changeFailed`
  prefers the 409 body; fixed line only for an empty body).
- Leaderboard podium: a tied rank shares its step (colour + height follow the shared rank, the place only
  decides left / middle / right).
- Quest "For": `Views/UnitTreePicker.swift` — trigger ("Everyone" / names / "%d divisions") opening a
  searchable, indented IP & Division tree with checkboxes (groups are headings, IPs bold), picked units as
  removable chips. CreateQuestSheet now keeps the raw `OrgUnitDTO`s (`QuestUnitOption` is unused).
- Server address: Settings › Claude (MCP) shows the MCP URL built from `Config.baseURL` (+ copy). No other
  user-facing hard-coded host in the app (no room-display screen on iOS).
- 44 pt touch targets: `touchTarget44(drawn:)` (Views/TouchTarget.swift) grows the hit area and hands the
  room back with negative padding, so nothing moves. Applied to My Tasks done circle, subtask circles, the
  clear / close "x" buttons (search fields, toasts, error lines, reply / attachment chips, GIDEON context
  chips, dashboard cards, pipeline, forms, attachment viewer) and the attendance board's full-board / export /
  month arrows; removable member chips.
- Focus stays in the top-most sheet: `SheetCover` (Sources/SheetCover.swift) answers "is something presented
  over me?" (UIKit: a presented controller's next responder is its presenter, so un-claimed keys fell through).
  Guarded: root ⌘1–⌘7 / ⌘K / ⌘/ / ⌘S, project ⌘N / ⌘, / ⌘[ / ⌘] / ⌘F, board ⌘Z undo bar, selection bar
  Esc / ⌘A / ⌘D, Messages ⌘N, GIDEON ⌘O; Calendar's iPhone shortcuts are disabled while a task / sheet is up.
  NOT done (Sheets/ is owned elsewhere): SheetGridHost should ignore keys while covered — return `[]` from
  `keyCommands`, pass `pressesBegan` to super and skip `becomeFirstResponder` when
  `SheetCover.isCovered(self)`.
- ID strings in `indonesianAccessR2`.

## Calendar: read-only task for non-members (13 Oct)

Web 80a286c (owner, 13 Oct 2026): the Master Calendar shows every project's tasks to everyone (private
projects stay masked); /api/tasks/:id and the other task routes stay members-only (403 for a non-member).

- `Views/CalendarTaskReadOnly.swift` — `CalTaskReadOnly` replaces `CalTaskPreview` (deleted from
  CalendarParts.swift; it read /api/tasks/:id and so failed with 403 for every non-member). It reads
  `GET /api/calendar/task?id=<id>&detail=1` (`APIClient.calendarTaskDetail`, CalendarAPI.swift; model
  `CalTaskDetailResponse` / `CalReadOnlyTask`, decode checked against dev). Banner "You're not in this
  project — view only"; title, parent, status, start + due (WIB), priority, project (+ linked), people,
  description as text (the column's docToText, like the web), subtasks, attachment names/sizes (no URL, not
  tappable), comments (author, Jakarta time, text). No actions. `found:false` → "This task no longer
  exists"; 403 / 404 / offline → `LoadErrorView`.
- Who gets what is unchanged (CalendarView.openItem / claimRouterTask, same rule as the web's CalendarPage):
  canEdit through the home project → `TaskDetailView` (its level rights); otherwise the read-only page;
  masked → "Internal task" sheet, never fetched (the server never sends `task` for a masked one either).
- `CalAvatar` is no longer `private` (used by the new file). ID string in `indonesianAccessR2`.

## Realtime catch-up (13 Oct, blue-green slot switch)

Events sent during the ~1 s gap of a server slot switch are lost on every client. The app already refetches:
every socket (re)connect — including the one after coming back to the foreground, since the socket closes in
the background — runs `RealtimeClient.catchUp()`, which posts workspace / project tasks / inbox / pipeline /
outlet / automations / pages / sheet-structure / chat notifications with no ids, so EVERY open screen
reloads (project board and tabs, task detail, page, spreadsheet, chat list + open thread, notifications,
badges), and flushes the spreadsheet save queue. Screens on `.liveRefresh` also reload on returning to the
front even when the socket can't connect. Verified by reading the paths; no code change needed.

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
| `GET /api/calendar/task?id=…&detail=1` (the `task` payload; prod answers without it, so the app says "This task no longer exists") and the calendar showing every non-private project's tasks to everyone (80a286c) | Calendar read-only task for non-members |

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

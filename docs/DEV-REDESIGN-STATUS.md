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

## Phase 2 — board like web / Notion (done)

| What | Where | Verify on device |
|---|---|---|
| Coloured status columns (wash + pill + group label), plain sections unchanged | ProjectBoardView (LaneColumn), StatusOptions | Finance Suwara: To Do grey, On Progress yellow, Done green; dark mode |
| Custom statuses: rename / colour / move / delete-with-move / + Status | LaneColumn ••• menu, BoardAlert | Add "Review" to In progress → becomes In review status |
| Inline new card at the top (queue, Esc/tap-away saves, ⤢ open, × discard), filter prefill | BoardRedesign InlineDraftCard | Type A ⏎ B ⏎ C quickly: three tasks, top of column |
| Multi-select + drag = whole selection, one batch-move, Undo 10 s (⌘Z); List groups take drops | ProjectBoardView.dropped/moveTasks | Select 3 → drag one → all move; Undo |
| Saved views: chips (built-in + "Per kategori" + custom), filter/sort/group sheet, new/rename/delete | ProjectViews.swift, BoardRedesign | Finance Management → Per kategori |
| Task opens as a centred sheet on iPad/Mac, push on iPhone; ⌘N | ProjectBoardView.open | iPad landscape |
| Select-field chips in option colours | CustomFieldChips | — |
| Timeline skips undated tasks | TimelineTab | — |

Pickers: the app keeps native Menu / graphical DatePicker sheets (with Clear) — the iOS equivalents of the
web's SelectPicker / DateField; there are no browser-style native selects to replace.
Not done: in-column manual reorder (web C-BUG-6) — SwiftUI's drop on a column has no index without
custom geometry, which the house rules forbid without a device.
Check-in reminder "Later" (web): the app has no in-app reminder modal (push only), so nothing to change.

## Phase 3 — block editor, GIDEON, templates, iPad/Mac (done, with limits)

| What | Where | Verify on device |
|---|---|---|
| Pages drawn from the block doc (headings, lists, to-dos, callout, toggle, code, table, image, file, bookmark), read-only | BlockDocView.swift, DocsView reader | ZZ Blocks QA › Event SOP |
| Task description: plain-text editor kept (server merges into the block doc, unchanged lines keep formatting) | TaskDetailView | Edit one line of a rich description, check the web |
| GIDEON: Ask GIDEON on project + task (new chat with context chip), stream events, steps line, Sources chips, cards, proposals Apply/Discard (alert), chats list with search/delete, X-Nexus-Client, uiLang, approvalMode review | Gideon.swift, GideonPanel.swift | Ask "ada task apa aja?" from Finance Management; ask it to change a due date → Apply |
| Template gallery: 7 server templates (EN/ID from server), previews in the status palette, guarded Create | ProjectTemplates, TemplateGallery | New project → Content Plan |
| iPad/Mac: sidebar ⌘1…⌘7, project ⌘[ ⌘] ⌘F ⌘N ⌘, ; board ⌘Z / ⌘↩; hover; 44 pt targets; task as centred sheet | AdaptiveRoot, ProjectBoardView | iPad with keyboard; Mac Catalyst |
| Bulk Move to / Priority on the visible selection (+ Undo); Duplicate visible-only | TaskBatchDuplicate | Select 3, filter to 1, Duplicate → 1 copy |

Not done (why):
- Editing pages in the app: live editing is Yjs over sockets on the web; an app write would bypass it.
- GIDEON @-mentions in the composer, Personalize, Save as doc, AI in the editor: web-only for now.
- Board in-column reorder (needs custom drop geometry; house rule: no unproven layout tricks).

## Verify on device first

1. Build: `git pull && xcodegen generate`, ⌘B. Every changed file passes `swiftc -parse`; nothing is
   type-checked on Linux. Most likely compile issues: the long ViewBuilder expressions in
   ProjectBoardView (split already), ViewFilterSheet, GideonPanel.answerExtras.
2. Settings › Server → Dev, sign in, switch to Bahasa once (localization tables are built then — the
   duplicate-key check passes, but confirm no launch crash).
3. Finance Suwara board: colours, group labels, inline new card (A ⏎ B ⏎ C), drag a selected group of
   cards → Undo; open a task (iPad: centred sheet) → Rupiah field 369000 → close at once → reopen.
4. My Submissions: columns/filters/proof/reply.
5. Finance Management › "Per kategori" view; Filter and sort… sheet.
6. GIDEON from a project header; a proposal Apply.
7. Pages tab of ZZ Blocks QA.

# Legal on Android — notes for the Android agent

The Legal feature (owner, 14 Oct 2026) is live on the server, the web and iOS/iPad/Mac. Android must reach
the same behaviour. Read these first:

- [legal.md](legal.md) for the rules
- [legal-api.md](legal-api.md) for the endpoints and JSON shapes
- the web client, which the copy and layout follow: `apps/web/src/components/legal/*`,
  `apps/web/src/lib/legal-api.ts`, `apps/web/src/lib/i18n/id-legal.ts` (the Indonesian wording to reuse in
  `values-in/strings.xml`)
- the iOS client: `apps/ios/Sources/LegalAPI.swift`, `LegalModels.swift`, `Views/Legal*.swift`

## Gating (do this first)

- `core/Viewer.kt` should read `canAccessLegal` from `GET /api/workspaces/members`, next to `isCompany` and
  `canAccessPipeline`. A missing field means false; clear it in `reset()`.
- Draw the Legal entry (More menu in `ui/shell/ShellMenus.kt`, and the route in `ui/shell/SignedInShell.kt`)
  only when it is true.
- Wrap the route like `CompanyOnly`: a `LegalOnly` that shows "Legal is by invitation only" when the flag is
  false, or when any call answers `403` with `code: "LEGAL_NOT_INVITED"`.
- The server refuses every `/api/legal/*` call for people who weren't invited. Hiding the entry is a
  courtesy, not the security.
- Settings writes (companies, kop, numbering series) are for `invitePower` ANY or STAFF only
  (`GET /api/legal/me`). Show them read-only for everyone else.

## Screens (`feature/legal/`)

Four tabs, like the web: **Documents · Templates · Companies & numbering · Members**.

1. **Documents (archive)**
   - Debounced search over number, title and counterparty.
   - Filters: company, type, status, made here vs uploaded, from/to date, project or deal (the picker reads
     `GET /api/legal/links`).
   - Paged list (`page`, `limit` 50). Each row shows the number in monospace, title, type, counterparty,
     company, date and a status chip.
   - Actions: **New document** and **Upload document**.
2. **New document**
   - Pick a template, then the issuing company if the template is for any company.
   - `POST …/documents/prepare` returns `fields`; render one input per type:
     - `text`, `longtext`
     - `date`: a picker that sends `YYYY-MM-DD`; default `TANGGAL_DOKUMEN` to today in Asia/Jakarta
     - `number`
     - `money`: "Rp" prefix, groups thousands with "." while typing, sends the digits
     - `select`, `boolean`
     - `list`: rows of `columns`, with add and remove
   - Also ask for title, counterparty and "Belongs to".
   - Number preview: call `prepare` again (debounced) when `TANGGAL_DOKUMEN` or a `{FIELD}` the series format
     reads changes.
   - Generate with `POST …/documents`. A 422 has `fieldErrors` keyed by field name (`ROWS.0.CELL` for a cell)
     and `problems`; show both. A non-null `pdfError` is only a warning.
3. **Document**
   - Header: number (struck through when `numberReleased`), title, type · company · date · template vN.
     Status selector (PATCH `status`) offering only what the rules allow: nothing once VOID, only VOID once
     SIGNED, and SIGNED only for an UPLOADED document. VOID asks first in a centred dialog that says whether
     the number goes to the next document (`hasNumber && !signedAt`) or stays retired (signed).
   - **Upload signed copy** on FINAL / SENT (PDF or photo, multipart version with `status=SIGNED`), and
     **Create addendum** on SIGNED (the New document flow with `parentDocumentId`, addendum templates only,
     the form started from `prefill`). Show signed by / when, the parent link, the addenda list with their
     status, and on a void "number reused by …". A SIGNED or VOID document hides editing, GIDEON, Restore,
     Mark final and Upload new version.
   - **Overview**:
     - Preview the PDF of `signedVersion ?? finalVersion ?? currentVersion`.
     - Download DOCX / PDF / original, saved and shared as `Version.downloadName` + extension
       ("… REV 2.pdf", "… FINAL.pdf", "… SIGNED.pdf"). Offer "Make PDF" when it is missing.
     - Edit title, counterparty and notes; set "Belongs to".
     - Versions list with the Final badge, **Mark final** (PATCH `finalVersion`, plus `status FINAL` if it
       was a draft), **Restore**, and **Upload new version** (no status: only the signed-copy action signs).
     - Each version shows its `label` (REV n / FINAL / SIGNED).
   - **Review & edit** (only when a version has a DOCX):
     - Paragraph list from `GET …/paragraphs`. Tap an editable one to edit it, with a live word diff.
     - Locked paragraphs (the number; fields, images, links) are greyed out with the reason.
     - A save bar shows "N paragraphs changed", a note, Discard and **Save as new version** (JSON with
       `baseVersion`). On a 409, reload and say someone else saved.
     - Checkboxes select paragraphs for GIDEON.
   - **GIDEON** panel:
     - An instruction plus the ticked paragraphs go to `POST …/gideon`.
     - Show the newest proposal while its `baseVersion` equals `currentVersion`:
       - **PENDING**: a checkbox per change, the word diff from `segments`, and Approve /
         "Approve n of m" / Discard.
       - **CLARIFY**: the question, an answer box and Reply (`replyTo` + `answer`).
       - **FAILED**: the reason in red.
     - Nothing changes until Approve.
   - **Compare**: two version pickers. Show `diff`: fold unchanged paragraphs into "N unchanged
     paragraphs", show changed ones with the word diff, and show added and removed ones as boxes.
4. **Templates**
   - The list has a "Show archived" switch.
   - **Upload template**: a .docx, name, type, company, and a numbering series filtered by company and type.
     A 422 lists `problems`; show them as a list.
   - Detail:
     - Edit name, type, company, series and description.
     - Field editor: label, type (scalar fields only, among text/longtext/date/number/money/select),
       required, choices for `select`, nested columns for lists. `TANGGAL_DOKUMEN` stays a required date.
     - Archive / Restore.
     - Versions with download, and upload of a new version with a note.
     - The "How to write placeholders" help (copy the web's table).
5. **Companies & numbering**
   - Per company: name, code, legal name (PT) and address. Show a warning while the legal name is empty.
   - Kop status, with download and upload (.docx).
   - Numbering series with an "In use" switch and editing of label, format and reset period. The editor shows
     "N numbers issued. Next today: …" from `GET /api/legal/series/:id`.
   - Add series, and the token help table.
6. **Members**
   - Active people: Owner badge, role, "Can invite staff", "Invited by X on date".
   - Remove (with a confirm) where `canRevoke`.
   - "Show removed people (n)".
   - The Invite sheet searches `GET …/members/candidates` and is shown only when `invitePower` is not NONE.
     Use the web's sentence for each power.

## Strings and tests

- Every string goes in English in `values/strings.xml` and Indonesian in `values-in/strings.xml`, worded like
  `id-legal.ts`. Labels for types and statuses: `apps/web/src/components/legal/legal-labels.ts`.
- Add unit tests for the model decoding (sample JSON from legal-api.md), the money input formatting, and the
  number-preview field extraction (`{NAME}` / `{NAME:n}` tokens, ignoring SEQ ROMAWI MM BLN YYYY YY CO), the
  same way `feature/pipeline` has its tests.

## Requests (owner, 14 Oct 2026) — to build

Server, web and iOS have it; Android does not yet. Contract: [legal-api.md](legal-api.md#requests-owner-14-oct-2026).
Copy and layout follow the web (`components/legal/LegalRequestForm.tsx`, `MyLegalRequests.tsx`,
`LegalRequests.tsx`; Indonesian in `apps/web/src/lib/i18n/id-legal-requests.ts`) and iOS
(`Views/LegalRequestViews.swift`).

1. **Deep link.** `https://<host>/f/legal-<24 letters/digits>` opens the request form in the app instead of
   the form screen (any other `/f/<id>` stays a form). Signed out: the login screen first, then the form.
   - `GET /api/legal-requests/form/:linkId`. 404 `LEGAL_LINK_UNKNOWN` → "This link doesn't work any more";
     `accepting: false` → "This link isn't accepting requests right now".
   - Company picker unless `link.company` is set; document type from `templates` (hide those whose
     `companyId` is another company's). Fields with the Legal field inputs (no field names shown, all
     optional). For `isAddendum`: a required text field "Number of the document to amend" (`parentNumber`).
   - Purpose (multi-line), needed-by date, related project/deal (`GET /api/legal-requests/links`), up to 5
     attachments (PDF/DOCX/JPG/PNG, 50 MB each) → multipart `data` + `file`, with an `Idempotency-Key`
     per attempt. Success screen: "Request sent" + Open My Submissions / Send another request.
2. **My Submissions.** Above the board, "Legal requests" cards from `GET /api/legal-requests/mine`: name,
   company, stage chip, deadline (red when overdue), document number, reject reason, and a Download button
   when `canDownload` (`GET …/mine/:id/file`). Tap → detail (`GET …/mine/:id`) with answers and attachments.
   Refresh on `workspace-changed {kind: "submissions"}`. Show the empty state only when both lists are empty.
3. **Notifications.** `/submissions?legal=<id>` → the request's detail; `/legal?tab=requests&request=<id>` →
   Legal → Requests opened on it.
4. **Legal → Requests tab** (after Documents), invited members only:
   - Board (To Do / In Progress / Done; on a phone a segmented column switch) and a List, filters type,
     company, PIC (`none` = no PIC), deadline (overdue / week / none), search. Move a card with a long-press
     menu "Move to …" (PATCH `column`). Refresh on `workspace-changed {kind: "legal"}`.
   - Card: template name, company, requester, deadline (red when overdue), PIC, document number + status,
     "Rejected" label.
   - Detail: column and PIC pickers; for an addendum the typed number and a picker of SIGNED documents
     (`GET /api/legal/documents?status=SIGNED&q=`) → PATCH `parentDocumentId`; **Create document** = the New
     document flow started from `prefill` (template, company, values, link; for an addendum with
     `parentDocumentId`) and `requestId` in the generate body; **Open document** once linked; **Reject**
     in a centred dialog with a required reason (POST `/reject`); answers and attachments.
   - **Request links** sheet: each link (general + per company) with Copy, a "Taking requests" switch and
     Regenerate (confirm first: the old link stops working).
5. Strings in `values/strings.xml` + `values-in/strings.xml`; unit tests for the decoding of `MyRequest` /
   `BoardRequest` and for the `/f/legal-…` link detection.

## UI tour: Legal screen ids (14 Oct 2026)

The iOS/web tour (`apps/ios/scripts/ui-tour-screens.json`, `apps/ios/docs/UI-TOUR.md`) now photographs Legal.
When the Android tour (`apps/android/scripts/ui-tour-android.sh`, its own `id|title` list) gets Legal, use the
same ids, in this order, between `tickets` and `settings`, so the screenshots line up in `index.html`:

| id | screen | how the iOS/web tour reaches it |
|---|---|---|
| `legal-archive` | Legal home, Documents tab (the archive) | `/legal` · `nexus://legal` |
| `legal-document` | a document's detail with its versions | newest `[TEST]` document from `GET /api/legal/documents?q=[TEST]`; web `/legal?tab=documents&doc=<id>`, app taps its row |
| `legal-templates` | Templates tab | `/legal?tab=templates` · app taps the tab |
| `legal-requests` | Requests board (To Do / In Progress / Done) | `/legal?tab=requests` · app taps the tab |
| `legal-request-form` | the request form `/f/legal-<token>` | general link's `path` from `GET /api/legal/request-links`, looked up at run time (never hardcoded) |
| `legal-settings` | Companies & numbering tab | `/legal?tab=settings` · app taps the tab |
| `legal-hidden` | signed in as qa6 (not invited): no Legal in the navigation, `/legal` shows "Legal is by invitation only" | web only, needs qa6's password; skipped without it |

The QA account qa5@dev.invalid is a Legal root on dev. A screen whose value cannot be found (no `[TEST]`
document, no link) is recorded as `skipped: <reason>`, not a failure. This is documentation only; the Android
code has no Legal tour steps yet.

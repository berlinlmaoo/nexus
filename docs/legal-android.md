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
   - Header: number, title, type · company · date · template vN. Status selector (PATCH `status`).
   - **Overview**:
     - Preview the PDF of `finalVersion ?? currentVersion`.
     - Download DOCX / PDF / original. Offer "Make PDF" when it is missing.
     - Edit title, counterparty and notes; set "Belongs to".
     - Versions list with the Final badge, **Mark final** (PATCH `finalVersion`, plus `status FINAL` if it
       was a draft), **Restore**, and **Upload new version** (a PDF or photo sends `status SIGNED`).
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

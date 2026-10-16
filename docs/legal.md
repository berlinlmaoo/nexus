# Legal documents

Owner decisions of 14 Oct 2026. Docassemble-style document assembly + a Paperless-style archive for the four
issuing companies (Intoo, PATS, Suwara Lokal, The Z Networks). Server: `src/lib/legal/*`, `src/app/api/legal/*`.
Web: `apps/web/src/routes/_app/legal.tsx`, `apps/web/src/components/legal/*`.

## Access (invitation only)

- The owner (`LEGAL_ROOT_EMAILS`, comma-separated emails; empty = nobody) always has Legal and may invite anyone of
  the company.
- A BoD / One Above All member the owner invited may invite staff (anyone below BoD) and remove the people
  they invited. The power comes from the owner's invitation: a staff member a BoD member invited, who is
  later promoted to BoD, does not get it.
- Invited staff may not invite anyone.
- Nobody else has Legal: not BoD, not One Above All, not a system admin. Leaving the company (or being
  offboarded) ends it.
- Every `/api/legal/*` route goes through `legalGate()` and answers `403 {code: "LEGAL_NOT_INVITED"}` to
  everyone else. `GET /api/workspaces/members` returns `canAccessLegal`; the clients draw the Legal nav entry
  only when it is true.
- Invite and revoke are audit rows (`legal_member`). `LegalMember` keeps the latest inviter and revoker; a
  revoke stamps `revokedAt` instead of deleting the row.
- Companies, kops and numbering series are changed only by those who may invite (`settingsForbidden`).
  Templates and documents are open to every member.

## Numbers

- One `DocumentNumber` row per number issued. `series` holds `LegalSeries.key`, which never changes.
- The counter restarts each year, or each month for invoices (`LegalSeries.resetPeriod`). A format must print
  `{SEQ}` and the year, and a monthly counter must also print the month (`seriesProblem`).
- Format tokens: `{SEQ:n}`, `{ROMAWI}`, `{BLN}`, `{MM}`, `{YYYY}`, `{YY}`, `{CO}`, and `{FIELD}` for any form
  field. When a template doesn't ask for a field its format needs, the form adds it.
- No gaps:
  1. Every check runs first: the form, the number's fields, and a dry run of the fill.
  2. Then one transaction takes the number (under an advisory lock), fills the template, adds the kop,
     stores the DOCX, and writes the document with its version 1. Any failure rolls the number back.
  3. The PDF is made after the commit. If it fails, the DOCX stays and the PDF can be retried.
- A numbered document is never deleted; it is set to **VOID**. Uploaded documents carry their own printed
  number and take nothing from a series.
- **VOID gives the number back** (owner, 14 Oct 2026), only for a document that was never signed:
  `releaseLegalNumber` marks its `DocumentNumber` row released (`releasedAt`, `releasedFromId`) and takes it off
  the document (which keeps its printed `number`, struck through). The counter's next document takes the
  LOWEST released number first and re-issues that row in place (same seq, text rendered again), so the unique
  indexes stay valid; it is linked as `numberReusedBy`. Release and reuse run under the same advisory lock and
  transaction as allocation. Nothing else frees a number: rows are never deleted (14 Oct review fix), and a
  document that was ever signed (`signedAt`) keeps its number retired when voided.
- VOID is one-way. SIGNED is reached by uploading the signed copy on a FINAL / SENT document and then locks it
  (no edits, GIDEON, restore, new versions or PDF remake); it can only be voided. Rules: `rules.ts`
  (`statusChangeProblem`, `lockProblem`, `releasesNumberOnVoid`, `pickSeq`).

## Signed copies and file names

- "Upload signed copy" stores a PDF or photo as a new version (`signedVersion`), sets SIGNED with `signedAt`
  and `signedBy`, and writes an audit row. That file is the primary download; the generated FINAL stays.
- The revision is in the file NAME only, never printed in the document: `<number> - <title> REV n`, `… FINAL`
  (the final version once FINAL or later), `… SIGNED` (the signed copy). `revisionLabel` / `downloadBaseName`.
- The archive filters `signed=1` and shows "signed <date> · <who>" on each row.

## Addenda

- "Create addendum" on a SIGNED document makes a new document of type `ADD` with `parentDocumentId`. Its
  company and kop are the parent's; its number is the parent's + `/ADD-n`, gap-free per parent, from the
  `DocumentNumber` counter `legal-add:<parentId>` (same lock; a voided unsigned addendum gives its n back to
  that parent's next addendum).
- The Addendum template (type Addendum, no company) is uploaded from the app like the others. Auto fields:
  `NOMOR_INDUK`, `JENIS_DOKUMEN_INDUK`, `JUDUL_INDUK`, `TANGGAL_INDUK`, `KE`. The form starts with the parties
  read from the parent's values (`addenda.ts`).
- The archive filters one chain with `parentId` (the parent and its addenda, oldest first).

## Templates

- A template is a `.docx` with `{{PLACEHOLDERS}}`, uploaded from the app. The fields are detected
  automatically (`inspectTemplate`), and each upload is a version. Labels, types and required flags carry over
  to the next version by field name. A document keeps the template version it was made from.
- The language is in `src/lib/legal/filters.ts`:
  - `{{TGL | hari | upper}}`, `{{HONOR | terbilang_rupiah}}`
  - Money (owner, 14 Oct 2026): every amount in a document is written `{{NILAI | rupiah}}` →
    "Rp. 6.250.000,00" (prefix "Rp. ", "." thousands, always ",00"), never "IDR …,-"; computed amounts too
    (`{{HONOR | persen:50 | rupiah}}`). The words stay `({{NILAI | terbilang_rupiah}})`. Only the documents:
    the forms and the rest of the app keep "Rp 6.250.000".
  - `{{#ROWS}}…{{/ROWS}}` for tables, and a section with no placeholders inside is a yes/no switch
  - `{{#NPWP}}, NPWP {{NPWP}}{{/NPWP}}`: a section that prints its own field shows only when it has a value
    (empty or "-" hides it); the field is optional
  - Computed values: `{{HONOR | persen:50}}`, `{{NILAI_TERMIN | persen_dari:NILAI_LISENSI}}`,
    `{{TANGGAL_DOKUMEN | tambah_bulan:DURASI_BULAN}}`, `{{ROWS | jumlah:COLUMN}}`; later filters read the
    computed value (`| terbilang_rupiah`, `| tanggal`)
  - Auto fields: `NOMOR`, `NAMA_PERUSAHAAN`, `PT_PERUSAHAAN`, `ALAMAT_PERUSAHAAN`, `KODE_PERUSAHAAN`
  - `TANGGAL_DOKUMEN` is asked in every form; it decides the number's month and year.
- The owner's real templates are **not** in this repo, which is public. They are uploaded through the app.
  Two of the originals contain real personal data and must never be committed.

## Requests (owner, 14 Oct 2026)

People outside Legal ask for a document through a **request link**, the same way finance and multimedia
forms work. Server: `src/lib/legal/requests.ts` (+ the pure `request-rules.ts`); web:
`components/legal/LegalRequestForm.tsx`, `MyLegalRequests.tsx`, `LegalRequests.tsx`; iOS:
`Views/LegalRequestViews.swift`.

- **Link only.** `/f/legal-<24 letters/digits>`; no menu entry or button for anyone else. One general link
  (the company is picked in the form) and one per active company (preset and locked), made on first use
  (`LegalRequestLink.scope` = `general` or the company id). Legal members copy them, open / close them for
  new requests, and regenerate them (a new token: the old URL answers 404 `LEGAL_LINK_UNKNOWN` at once).
- **Sign in to send.** Anyone may open the link; the document types and their fields are shown only after
  signing in to NEXUS, and sending needs a session. The request then appears in the requester's
  **My Submissions** (web `/submissions`, iOS My Submissions) with its stage, live.
- **The form.** Company (unless locked) and document type (the active templates, those of another company
  hidden). The template's fields, from its current version, all optional and without `TANGGAL_DOKUMEN`
  (Legal sets the date). Then purpose / notes, needed-by date, up to 5 attachments (Legal's upload rules:
  PDF / Word / JPG / PNG checked on the bytes, 50 MB each), and a related project or deal (only what the
  requester can open). `Idempotency-Key` makes a retry safe.
- **Addendum requests** (an `ADD` template) type the parent's number as free text, plus the changes
  (`PERUBAHAN` rows of `PASAL_DIUBAH` + `ISI_BARU`). Nothing looks the number up and the answer is the same
  whatever it is, so numbers can't be probed. Legal picks the real parent (a SIGNED document) on the board,
  then the usual addendum flow runs.
- **Nothing else leaks.** A requester sees only their own requests (someone else's answers 404 like a
  missing one) and, of the archive, only the document their own request produced: its number, title and
  status, and the FINAL / SIGNED file (`requesterFileVersion`: the signed copy once SIGNED, the final
  version once FINAL or SENT, nothing before).
- **The board** (Legal → Requests, invited members only): To Do / In Progress / Done, or a list, filtered
  by type, company, PIC and deadline (red when overdue). "Create document" opens New document filled from
  the request (`requestId` on `POST /api/legal/documents`), links the document to the request, makes the
  maker PIC when there was none, and moves the card to In Progress. The card follows its document
  (`syncRequestForDocument`, after every version, status change and signed copy): SIGNED → Done. Cards can
  be dragged by hand. Reject needs a reason, which the requester reads; it goes to Done labelled Rejected,
  and moving it back to To Do / In Progress reopens it. A request whose document is signed can't be
  rejected; a request whose document was voided can get a new one.
- **Stages** the requester sees: RECEIVED, IN_PROGRESS, REVISION (a version after the first), FINAL,
  SIGNED, DONE (dragged to Done without a signed document), REJECTED. In progress, revision, final, signed
  and rejected are pushed (in-app + push, EN/ID by the recipient's language) and link to
  `/submissions?legal=<id>`. A new request is pushed to every Legal member, linking to
  `/legal?tab=requests&request=<id>`.
- **Live:** `workspace-changed {kind: "legal"}` to the Legal members' own rooms (the board), and
  `{kind: "submissions"}` to the requester's room (My Submissions).
- Files live under the Legal storage dir, never as task attachments or Vault items.
- SQL: `prisma/sql/2026-10-14-legal-requests.sql` (two new tables, expand-only).

## Kop

Each company's kop is a `.docx` whose page header holds the logo and the address. `applyKop` copies that header
into the document as its first-page header. The template's own headers stay on the following pages, and the
template's default footer is reused on page 1.

## Files

Files live under `public/uploads/attachments/legal/YYYY/MM/<uuid>`. That directory is already bind-mounted with
`attachments/`. They are not Vault items, so Vault rules and share links never reach them. `/api/legal/*`
bodies are left out of the middleware's body matchers, the same as `/api/vault/*`.

## Deploy

1. Apply `prisma/sql/2026-10-14-legal.sql` (then `…-legal-docnum-issuer-setnull.sql` and
   `…-legal-signed-void-addendum.sql`) before deploying the image. It is additive and idempotent, and
   seeds the four companies and their series. Legal names other than PATS are left empty, to be filled in
   **Legal → Companies & numbering**.
2. Add a Gotenberg sidecar on the app's network, with no published port:

   ```yaml
   nexus-gotenberg:
     image: gotenberg/gotenberg:8
     restart: unless-stopped
     command: ["gotenberg", "--api-timeout=120s", "--libreoffice-auto-start=true"]
   ```

   Then set `GOTENBERG_URL=http://nexus-gotenberg:3000` on the app. Without it, documents are made as DOCX
   only.
3. Upload each company's kop and the templates from the app.

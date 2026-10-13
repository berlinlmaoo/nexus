# Legal API (for the native clients)

The contract the web client (`apps/web/src/lib/legal-api.ts`) uses. Design and rules: [legal.md](legal.md).
All routes need a signed-in session.

**Access.** Every `/api/legal/*` route answers `403 {"error", "code": "LEGAL_NOT_INVITED"}` to someone
without Legal.
- Draw the Legal entry only when `GET /api/workspaces/members` returns `canAccessLegal: true`. Older servers
  send no field; treat that as false.
- Settings writes (companies, kop, series) also answer 403 unless `invitePower` is `ANY` or `STAFF` (from
  `GET /api/legal/me`). Hide those controls otherwise.

**Errors.** `{error: string}` is a sentence to show as is. A 422 may carry:
- `fieldErrors`: `{FIELD: msg}`, with a table cell keyed `ROWS.0.CELL`;
- `problems`: `string[]`, one line per problem in a template file.

A 409 on a version write means someone else saved first: reload the document and show the newer version.

**PDFs** are made in the background after a Word version is written (generate, upload, edit, restore, GIDEON
approve). In those answers, `pdfError: null` means the PDF is being made; a string means none will be (for
example, PDF conversion is not set up). While a recent Word version (`createdAt` under 3 minutes ago) has
`hasDocx && !hasPdf`, re-fetch the document every few seconds.

**Dates.** `docDate` is `YYYY-MM-DD` (a calendar day). Form date values are `YYYY-MM-DD` too. Timestamps are ISO-8601.

## Access & members

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/legal/me` | | `{access: true, isRoot, invitePower: "ANY"\|"STAFF"\|"NONE"}` |
| GET | `/api/legal/members` | | `{members: Member[], invitePower}` |
| GET | `/api/legal/members/candidates` | `?q=` | `{candidates: [{userId, name, email, avatar, orgRole}]}` (only those the viewer may invite) |
| POST | `/api/legal/members` | `{userId}` | 201 `{ok, userId}` |
| DELETE | `/api/legal/members/:userId` | | `{ok}` |

`Member`: `{userId, name, email, avatar, orgRole, isRoot, active, invitedAt, invitedBy{id,name,avatar}?,
revokedAt, revokedBy?, canRevoke, invitePower}`. Show the active members, and the removed ones behind a toggle.

## Companies & numbering

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/legal/companies` | | `{companies: Company[]}` |
| PATCH | `/api/legal/companies/:id` | `{name?, legalName?, address?, code?, active?}` | `{company}` (`code` gets a 409 once numbers exist) |
| GET | `/api/legal/companies/:id/kop` | | the kop .docx |
| POST | `/api/legal/companies/:id/kop` | multipart `file` (.docx) | `{company}` |
| POST | `/api/legal/companies/:id/series` | `{docType, label, format, resetPeriod}` | 201 `{series}` |
| GET | `/api/legal/series/:id` | | `{series, issued, next}` (`next` = today's next number) |
| PATCH | `/api/legal/series/:id` | `{label?, format?, resetPeriod?, active?}` | `{series}` |

`Company`: `{id, code, name, legalName, address, hasKop, kopFileName, kopUpdatedAt, active, documentCount,
series: Series[]}`. `Series`: `{id, key, docType, label, format, resetPeriod: "YEAR"|"MONTH", active}`.

## Templates

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/legal/templates` | `?archived=1&docType=&companyId=` | `{templates: Template[]}` |
| POST | `/api/legal/templates` | multipart `file` (.docx), `name`, `docType`, `companyId?`, `seriesId?`, `description?` | 201 `{template}`; 422 with `problems` |
| GET | `/api/legal/templates/:id` | | `{template}` |
| PATCH | `/api/legal/templates/:id` | `{name?, description?, docType?, companyId?, seriesId?, archived?, fields?}` | `{template}` |
| POST | `/api/legal/templates/:id/versions` | multipart `file`, `note?` | 201 `{template}` |
| GET | `/api/legal/templates/:id/versions/:v/file` | | the .docx |

- `Template`: `{id, name, description, docType, company{id,code,name}?, series{id,key,label,format}?,
  currentVersion, archived, fields: Field[], createdBy, createdAt, updatedAt, versions: [{version, fileName,
  size, note, fieldCount, createdBy, createdAt}]}`.
- `Field`: `{name, label, type, required, help?, options?, columns?: Field[]}`.
  - `type` is one of `text | longtext | date | number | money | select | boolean | list`.
  - A `list` field's value is an array of row objects keyed by its `columns`.
  - `fields` in a PATCH changes presentation only: label, type of a scalar field, required, help, options.

## Documents

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/legal/documents` | `q, companyId, docType, status, source, projectId, dealId, from, to, sort (date\|created\|number), page, limit` | `{documents: Summary[], total, page, pageSize}` |
| POST | `/api/legal/documents/prepare` | `{templateId, companyId?, values?}` | `{template, company{…, hasKop}, series{…, format}, fields: Field[], numberPreview}` |
| POST | `/api/legal/documents` | `{templateId, companyId?, values, title?, counterparty?, projectId?, dealId?}` | 201 `{id, number, pdfError}`; 422 with `fieldErrors` / `problems` |
| POST | `/api/legal/documents/upload` | multipart `file` (PDF/DOCX/JPG/PNG), `companyId`, `docType`, `title`, `number?`, `counterparty?`, `docDate?`, `status?` (default SIGNED), `projectId?`, `dealId?`, `notes?` | 201 `{id, pdfError}` |
| GET | `/api/legal/documents/:id` | | `{document: Document}` |
| PATCH | `/api/legal/documents/:id` | `{title?, counterparty?, status?, notes?, projectId?, dealId?, finalVersion?}`; for an UPLOADED document also `number?, docType?, docDate?` | `{document}` |
| DELETE | `/api/legal/documents/:id` | | `{ok}` (uploaded only; a numbered document answers 409: set it to VOID) |
| GET | `/api/legal/documents/:id/versions/:v/file` | `?format=docx\|pdf\|original&inline=1` | the file |
| POST | `/api/legal/documents/:id/versions/:v/pdf` | | `{ok}`; 502 `{error}` when the PDF service fails |
| GET | `/api/legal/links` | `?q=` | `{projects: [{id,name}], deals: [{id, code, name, brand, projectId}]}` (only what the viewer can open) |

- The New document form is `prepare.fields`, in order. Re-call `prepare` with the values that the number
  format reads, plus `TANGGAL_DOKUMEN`, to refresh `numberPreview`. Default `TANGGAL_DOKUMEN` to today in
  Jakarta.
- `Summary`: `{id, number, docType, title, counterparty, docDate, status, source, company{id,code,name},
  project{id,name}?, deal{id,code,name,projectId}?, linkHidden, currentVersion, createdBy, createdAt, updatedAt}`.
  `linkHidden: true` = linked to a project or deal this viewer can't open (its name is withheld).
- `Document`: `Summary` + `{notes, series?, template{id,name,version}?, fieldValues, finalVersion, hasNumber,
  updatedBy, versions: Version[]}`.
- `Version`: `{version, kind: GENERATED|MANUAL|GIDEON|UPLOAD|RESTORE, fileName, mimeType, size, hasDocx,
  hasPdf, hasFile, note, changes, author, createdAt}`.
- The shown file is `finalVersion ?? currentVersion`.
- Statuses: `DRAFT FINAL SENT SIGNED VOID`.
- Types: `SURAT SP SK PKS SPK NDA MOU INVOICE PJM PGB OTHER`. Labels are in
  `apps/web/src/components/legal/legal-labels.ts`.

## Review, versions, GIDEON

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/legal/documents/:id/paragraphs` | `?version=` (default current) | `{version, current, paragraphs: [{index, text, editable, lockReason?: "number"\|"complex", style?, inTable}]}`; 409 for a non-Word version |
| POST | `/api/legal/documents/:id/versions` | JSON `{baseVersion, edits: [{index, text}], note?}` | 201 `{version, pdfError}` |
| POST | `/api/legal/documents/:id/versions` | multipart `file`, `baseVersion`, `note?`, `status?` | 201 `{version, pdfError}` (e.g. the signed scan) |
| POST | `/api/legal/documents/:id/versions/:v/restore` | `{baseVersion}` | 201 `{version}` |
| GET | `/api/legal/documents/:id/compare` | `?a=&b=` | `{a, b, diff: ParagraphDiff[]}` |
| GET | `/api/legal/documents/:id/gideon` | | `{proposals: Proposal[]}` (newest first) |
| POST | `/api/legal/documents/:id/gideon` | `{baseVersion, instruction, targets: number[], replyTo?, answer?}` | 201 `{proposal}` |
| POST | `/api/legal/documents/:id/proposals/:pid` | `{decision: "approve"\|"discard", indexes?: number[]}` (omit = all; never empty) | `{proposal, version, pdfError}` |

- `ParagraphDiff` is one of:
  - `{type:"same", a, b, text}`
  - `{type:"removed", a, text}`
  - `{type:"added", b, text}`
  - `{type:"changed", a, b, before, after, segments: [{type:"same"|"del"|"ins", text}]}`
- `Proposal`: `{id, status: PENDING|CLARIFY|APPLYING|APPLIED|DISCARDED|FAILED, baseVersion, instruction, question?,
  summary, changes: [{index, before, after, segments}], appliedVersion, createdBy, decidedBy, decidedAt,
  createdAt}`.
  - On `FAILED`, `summary` says why.
  - On `CLARIFY`, answer by POSTing `{replyTo: id, answer, baseVersion, instruction: "", targets: []}`.
  - Show the newest proposal only while `baseVersion == document.currentVersion`.
- Hide editing for a version without `hasDocx`.
- Locked paragraphs are shown, but can't be edited or ticked.
- `targets` are the paragraphs the person ticked. GIDEON may change only those, or the fewest paragraphs it
  needs when none are ticked.

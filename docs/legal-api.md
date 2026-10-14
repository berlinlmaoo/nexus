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
| GET | `/api/legal/documents` | `q, companyId, docType, status, source, projectId, dealId, from, to, signed (1), parentId, sort (date\|created\|number), page, limit` | `{documents: Summary[], total, page, pageSize}` |
| POST | `/api/legal/documents/prepare` | `{templateId, companyId?, values?, parentDocumentId?}` | `{template, company{…, hasKop}, series{…, format}?, fields: Field[], numberPreview, parent?, prefill}` |
| POST | `/api/legal/documents` | `{templateId, companyId?, values, title?, counterparty?, projectId?, dealId?, parentDocumentId?}` | 201 `{id, number, pdfError}`; 422 with `fieldErrors` / `problems` |
| POST | `/api/legal/documents/upload` | multipart `file` (PDF/DOCX/JPG/PNG), `companyId`, `docType`, `title`, `number?`, `counterparty?`, `docDate?`, `status?` (default SIGNED), `projectId?`, `dealId?`, `notes?` | 201 `{id, pdfError}` |
| GET | `/api/legal/documents/:id` | | `{document: Document}` |
| PATCH | `/api/legal/documents/:id` | `{title?, counterparty?, status?, notes?, projectId?, dealId?, finalVersion?}`; for an UPLOADED document also `number?, docType?, docDate?` | `{document}`; 409 `{code: "LEGAL_STATUS_LOCKED"}` for a status move the rules refuse |
| DELETE | `/api/legal/documents/:id` | | `{ok}` (uploaded only; a generated or numbered document answers 409: set it to VOID) |
| GET | `/api/legal/documents/:id/versions/:v/file` | `?format=docx\|pdf\|original&inline=1` | the file |
| POST | `/api/legal/documents/:id/versions/:v/pdf` | | `{ok}`; 502 `{error}` when the PDF service fails |
| GET | `/api/legal/links` | `?q=` | `{projects: [{id,name}], deals: [{id, code, name, brand, projectId}]}` (only what the viewer can open) |

- The New document form is `prepare.fields`, in order. Re-call `prepare` with the values that the number
  format reads, plus `TANGGAL_DOKUMEN`, to refresh `numberPreview`. Default `TANGGAL_DOKUMEN` to today in
  Jakarta.
- `Summary`: `{id, number, docType, title, counterparty, docDate, status, source, company{id,code,name},
  project{id,name}?, deal{id,code,name,projectId}?, linkHidden, currentVersion, createdBy, createdAt, updatedAt,
  signedAt?, signedBy?, voidedAt?, numberReleased, numberReusedBy{id,number,title}?, parent{id,number,title,status,docType}?,
  addendumNo?, addendaCount}`.
  `linkHidden: true` = linked to a project or deal this viewer can't open (its name is withheld).
- `Document`: `Summary` + `{notes, series?, template{id,name,version}?, fieldValues, finalVersion, signedVersion?,
  hasNumber, numberReusedFrom: [{id,number,title}], addenda: [{id, number, title, status, docDate, signedAt,
  addendumSeq, numberReleased}], updatedBy, versions: Version[]}`.
- `Version`: `{version, kind: GENERATED|MANUAL|GIDEON|UPLOAD|RESTORE, fileName, mimeType, size, hasDocx,
  hasPdf, hasFile, note, changes, author, createdAt, label, downloadName}`.
  - `label`: `REV n` (a version of a document that is not final), `FINAL` (the final version once the status is
    FINAL, SENT or SIGNED), `SIGNED` (the signed copy). `downloadName` = `<number> - <title> <label>` without
    extension; the file endpoint sends the same name (with an ASCII fallback). Name shared/saved files with it.
    Nothing is printed inside the document.
- The shown file is `signedVersion ?? finalVersion ?? currentVersion`.
- Statuses: `DRAFT FINAL SENT SIGNED VOID` (owner, 14 Oct 2026):
  - VOID is one-way. Voiding a document that holds a number and was never signed gives the number back to
    its series (`numberReleased`); the series' next document takes the lowest given-back number first and
    then shows on the voided one as `numberReusedBy`. A signed document can be voided, but its number is
    never given back. Ask before voiding: the web and iOS say which of the two happens.
  - SIGNED is reached only by uploading the signed copy on a FINAL or SENT document (multipart version with
    `status=SIGNED`, a PDF or JPG/PNG). An UPLOADED document may still be PATCHed to SIGNED.
  - A SIGNED document is locked: paragraph edits, GIDEON, restore, new versions and "Make PDF" answer 409.
    Its status can only move to VOID.
- Addenda: `parentDocumentId` (a SIGNED document) with a template of type `ADD`. The addendum takes the
  parent's company and kop; its number is the parent's + `/ADD-n`, gap-free per parent (a voided unsigned
  addendum gives its n back). `prepare` answers `parent{id, number, title, docType, addendumNo}` and `prefill`
  (the parties, from the parent) to start the form with. Auto fields of an addendum template: `NOMOR_INDUK`,
  `JENIS_DOKUMEN_INDUK`, `JUDUL_INDUK`, `TANGGAL_INDUK`, `KE` (Pertama, Kedua, …).
- Types: `SURAT SP SK PKS SPK NDA MOU ADD INVOICE PJM PGB OTHER`. Labels are in
  `apps/web/src/components/legal/legal-labels.ts`.

## Review, versions, GIDEON

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/legal/documents/:id/paragraphs` | `?version=` (default current) | `{version, current, paragraphs: [{index, text, editable, lockReason?: "number"\|"complex", style?, inTable}]}`; 409 for a non-Word version |
| POST | `/api/legal/documents/:id/versions` | JSON `{baseVersion, edits: [{index, text}], note?}` | 201 `{version, pdfError}` |
| POST | `/api/legal/documents/:id/versions` | multipart `file`, `baseVersion`, `note?`, `status?` | 201 `{version, pdfError, signed}`; `status=SIGNED` = the signed copy (FINAL/SENT only, PDF or photo) |
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

## Requests (owner, 14 Oct 2026)

Rules: [legal.md](legal.md#requests-owner-14-oct-2026). Two sides.

**Requester** (`/api/legal-requests/*`, any signed-in person; only their own requests):

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/legal-requests/form/:linkId` | `linkId` = `legal-<token>` | `{link: {company{id,name}?, accepting}, signedIn, companies?: [{id,code,name}], templates?: FormTemplate[]}` (companies / templates only when signed in and accepting); 404 `{code: "LEGAL_LINK_UNKNOWN"}` |
| POST | `/api/legal-requests/form/:linkId` | JSON `{templateId, companyId?, values, purpose?, deadline? (YYYY-MM-DD), projectId?, dealId?, parentNumber?}`, or multipart with that JSON in `data` + up to 5 `file`; header `Idempotency-Key` | 201 `{ok: true, id}` (200 for a repeat of the same key); 401 `LOGIN_REQUIRED`; 403 `LEGAL_LINK_CLOSED`; 422 `fieldErrors` |
| GET | `/api/legal-requests/links` | `?q=` | like `/api/legal/links`, with the requester's own access |
| GET | `/api/legal-requests/mine` | | `{requests: MyRequest[]}` |
| GET | `/api/legal-requests/mine/:id` | | `{request: MyRequest + answers}`; 404 when not mine |
| GET | `/api/legal-requests/mine/:id/file` | `?inline=1`, `?format=docx` | the FINAL / SIGNED file; 404 when not mine or not final yet |
| GET | `/api/legal-requests/mine/:id/attachments/:attachmentId` | | a file I attached |

- `FormTemplate`: `{id, name, description, docType, companyId?, isAddendum, fields: Field[]}` (every field
  `required: false`, no `TANGGAL_DOKUMEN`). For an addendum, `parentNumber` is required text and is never
  looked up: the answer is the same for any number.
- `MyRequest`: `{id, createdAt, updatedAt, company{id,name}, templateName, docType, isAddendum,
  parentNumberText, deadline, stage, rejectReason?, pic{id,name,avatar}?, document{number,title,status}?,
  canDownload, purpose, attachments: [{id,fileName,mimeType,size}], project?, deal?}`; the detail adds
  `answers: [{name, label, type, value, columns?}]`.
- `stage`: `RECEIVED IN_PROGRESS REVISION FINAL SIGNED DONE REJECTED`.

**Legal** (invited members only, 403 `LEGAL_NOT_INVITED` otherwise):

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/legal/requests` | `column, docType, companyId, picId ("none"), deadline (overdue\|week\|none), q` | `{requests: BoardRequest[]}` |
| GET | `/api/legal/requests/:id` | | `{request: BoardRequest + {fieldValues, fields}, prefill}` |
| PATCH | `/api/legal/requests/:id` | `{column?, picId? (null), parentDocumentId? (null)}` | `{request}`; parent must be SIGNED (409) |
| POST | `/api/legal/requests/:id/reject` | `{reason}` (3+ characters) | `{request}`; 409 once its document is signed |
| GET | `/api/legal/requests/:id/attachments/:attachmentId` | `?inline=1` | the file |
| GET | `/api/legal/request-links` | | `{links: [{scope, company?, path, accepting, rotatedAt, updatedAt}]}` |
| PATCH | `/api/legal/request-links/:scope` | `{accepting}` | `{link}` |
| POST | `/api/legal/request-links/:scope/regenerate` | | `{link}` (new `path`; the old one stops working) |
| POST | `/api/legal/documents` | as above + `requestId` | links the new document to the request (409 when the request was rejected or already has a live document; an addendum request needs `parentDocumentId`) |

- `BoardRequest`: `{id, createdAt, updatedAt, requester{id,name,avatar}?, company{id,code,name}, templateId,
  templateName, docType, isAddendum, parentNumberText, parent{id,number,title,status,docType}?, deadline,
  column: TODO|IN_PROGRESS|DONE, stage, rejected, rejectedAt, rejectReason, pic?, document{id,number,title,
  status,docType,signedAt}?, doneAt, purpose, attachments, project?, deal?, linkHidden}`.
- `prefill`: `{requestId, templateId, companyId, isAddendum, parentDocumentId, values, projectId, dealId}`
  (project / deal only when this member may link them). Start New document from it and send `requestId`.
- Live: `workspace-changed {kind: "legal"}` (board) and `{kind: "submissions"}` (requester).

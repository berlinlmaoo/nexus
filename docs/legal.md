# Legal documents

Owner decisions of 14 Oct 2026. Docassemble-style document assembly + a Paperless-style archive for the four
issuing companies (Intoo, PATS, Suwara Lokal, Z Networks). Server: `src/lib/legal/*`, `src/app/api/legal/*`.
Web: `apps/web/src/routes/_app/legal.tsx`, `apps/web/src/components/legal/*`.

## Access (invitation only)

- The owner (`LEGAL_ROOT_EMAILS`, default `bagasputro.bp@gmail.com`) always has Legal and may invite anyone of
  the company.
- A BoD / One Above All member the owner invited may invite staff (anyone below BoD) and remove the people
  they invited.
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

## Templates

- A template is a `.docx` with `{{PLACEHOLDERS}}`, uploaded from the app. The fields are detected
  automatically (`inspectTemplate`), and each upload is a version. Labels, types and required flags carry over
  to the next version by field name. A document keeps the template version it was made from.
- The language is in `src/lib/legal/filters.ts`:
  - `{{TGL | hari | upper}}`, `{{HONOR | terbilang_rupiah}}`
  - `{{#ROWS}}…{{/ROWS}}` for tables, and a section with no placeholders inside is a yes/no switch
  - Auto fields: `NOMOR`, `NAMA_PERUSAHAAN`, `PT_PERUSAHAAN`, `ALAMAT_PERUSAHAAN`, `KODE_PERUSAHAAN`
  - `TANGGAL_DOKUMEN` is asked in every form; it decides the number's month and year.
- The owner's real templates are **not** in this repo, which is public. They are uploaded through the app.
  Two of the originals contain real personal data and must never be committed.

## Kop

Each company's kop is a `.docx` whose page header holds the logo and the address. `applyKop` copies that header
into the document as its first-page header. The template's own headers stay on the following pages, and the
template's default footer is reused on page 1.

## Files

Files live under `public/uploads/attachments/legal/YYYY/MM/<uuid>`. That directory is already bind-mounted with
`attachments/`. They are not Vault items, so Vault rules and share links never reach them. `/api/legal/*`
bodies are left out of the middleware's body matchers, the same as `/api/vault/*`.

## Deploy

1. Apply `prisma/sql/2026-10-14-legal.sql` before deploying the image. It is additive and idempotent, and
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

# Print to the office printer on Android — notes for the Android agent

Print (owner, 18 Nov 2026) sends a Legal document or a page straight to the office printer (Epson L3250, A4)
over the server; the phone never talks to the printer. The server, the web and iOS have it. Android must reach
the same behaviour. Read these first:

- the server: `src/app/api/print/**` (routes), `src/lib/print/**` (access, limits, IPP, PDF)
- the web client, which the copy follows: `apps/web/src/components/print/PrintDialog.tsx`,
  `apps/web/src/components/settings/PrintLogSection.tsx`, `apps/web/src/lib/print-api.ts`,
  `apps/web/src/lib/i18n/id-print.ts` (the Indonesian wording to reuse in `values-in/strings.xml`)
- the iOS client: `apps/ios/Sources/PrintAPI.swift`, `PrintModels.swift`, `Views/PrintSheet.swift`,
  `Views/PrintLogView.swift`, `LocalizationPrint.swift`; the entry points in `Views/LegalDocumentView.swift`
  (`LegalFileButtons`), `Views/DocsView.swift` (`DocReaderView` ••• menu) and `Views/SettingsView.swift`

## Owner decisions

- **Who can print = who can view.** A Legal document needs Legal access (invited); a page needs access to its
  project. The server checks this on every print; hiding buttons is a courtesy, not the security.
- **Every print is logged** (who, what, pages, copies, colour, result). Everyone sees their own prints in
  Settings › Print log; **BoD and One Above All see everyone's** and can filter by person.
- Limits (server): 1–5 copies, at most 50 pages per print, 20 prints per person per hour.
- Black & white is the default; Color is a choice.
- No offline queue: a print either goes now or fails with a reason. Never replay a print later.

## Gating: remote config

`GET /api/app/config?platform=android` has a top-level `printing` object:

```json
{ "printing": { "enabled": true, "printerName": "Epson L3250", "maxCopies": 5, "maxPages": 50 } }
```

- Add `val printing: PrintingConfig? = null` to `ConfigBody` in `core/config/RemoteConfig.kt`
  (`@Serializable data class PrintingConfig(val enabled: Boolean? = null, val printerName: String? = null,
  val maxCopies: Int? = null, val maxPages: Int? = null)`), plus getters `printingEnabled` (default **false**:
  absent = off, an older server has no key), `printerName`, `printingMaxCopies` (default 5),
  `printingMaxPages` (default 50).
- Every Print entry point (Legal, page, Settings › Print log) is drawn only while `printingEnabled` is true.

## Endpoints

Errors are always JSON `{ "error": string, "code"?: string }`. The server's `error` is English (except
`PRINT_NOT_CONFIGURED`), so map the known codes to `strings.xml` text and fall back to the server's sentence.

### `POST /api/print` — send a print

```json
{ "kind": "legal", "id": "0193f…", "copies": 2, "colorMode": "mono" }
```

- `kind`: `"legal"` (a Legal document) or `"doc"` (a page). `id`: the document / page id.
- `copies`: 1–5. `colorMode`: `"color"` | `"mono"`.
- `version` (int, Legal only, optional): omit it. The server then prints the primary version
  (`signedVersion ?? finalVersion ?? currentVersion`), which is the one the document screen shows.

`201`:

```json
{ "job": {
  "id": "0193f…", "kind": "legal", "refId": "0193e…", "title": "SPK/CH/001 - Kontrak kerja",
  "pages": 3, "copies": 2, "colorMode": "mono", "status": "printing", "ippJobId": 412, "error": null,
  "createdAt": "2026-11-18T03:12:44.120Z", "finishedAt": null, "userId": "0192…"
} }
```

`status`: `queued` → `printing` → `done` | `failed` (`error` then holds the reason, already a sentence).

| status | code | show (EN) |
|---|---|---|
| 400 | `BAD_COPIES` | Copies must be between 1 and 5. |
| 401 | — | sign out, as every other 401 |
| 403 | `LEGAL_NOT_INVITED` | Legal is by invitation only |
| 403 | — (`Forbidden`) | the server's sentence |
| 404 | `NOT_FOUND` | the server's sentence |
| 422 | `TOO_MANY_PAGES` | "This file has {n} pages. One print can have at most 50 pages." (`n` from the server's sentence `This file has N pages…`; else "Too many pages: at most 50 per print.") |
| 422 | `NOT_PRINTABLE` | This version has no file that can be printed. |
| 422 | `PAGES_UNKNOWN` | Couldn't count the pages of this file, so it wasn't printed. |
| 429 | `PRINT_RATE_LIMIT` | You've printed 20 times this hour. Try again later. |
| 503 | `PRINT_NOT_CONFIGURED` | Printer isn't set up on this server |
| 503 | `PDF_NOT_CONFIGURED` | This server can't turn files into PDF yet, so it can't print them. |
| 500 | — | the app's usual "Something went wrong on our side" |

The request can take a while (the server makes the PDF of a Word file or a page first): use a 120 s timeout.

### `GET /api/print/jobs/{id}` — one job

`200 { "job": Job }`. While the job is `printing` the server asks the printer for its state, so polling this
is how the sheet learns the result.

### `GET /api/print/jobs` — the print log

Query: `userId=` (BoD/OAA only; anyone else may pass only their own id, else 403), `from=YYYY-MM-DD`,
`to=YYYY-MM-DD` (WIB days, both inclusive), `cursor=` (the previous `nextCursor`), `limit=` (1–100, default 50).

```json
{
  "jobs": [ { "id": "…", "kind": "doc", "refId": "…", "title": "SOP Studio", "pages": 4, "copies": 1,
              "colorMode": "color", "status": "done", "ippJobId": 413, "error": null,
              "createdAt": "2026-11-18T03:20:01.000Z", "finishedAt": "2026-11-18T03:20:40.000Z",
              "userId": "…", "user": { "id": "…", "name": "Rani", "avatar": null } } ],
  "nextCursor": null,
  "canSeeAll": true,
  "people": [ { "id": "…", "name": "Rani", "avatar": null } ],
  "printing": { "enabled": true, "printerName": "Epson L3250", "maxCopies": 5, "maxPages": 50 }
}
```

`people` (everyone who ever printed) is filled only when `canSeeAll`.

## Screens

1. **Legal document** (`feature/legal/LegalDocumentScreen.kt`): a **Print** button (printer icon) in the row
   of the shown version's file buttons (`FileButtons(model, doc, shown)` in the overview, not the per-version
   rows). Only when `printingEnabled` and the shown version is printable: `hasPdf || hasDocx ||
   (hasFile && mimeType == "application/pdf")` (a photo of a signed copy does not print). Title passed to the
   sheet: `"<number> - <title>"` (empty parts left out).
2. **Page** (`feature/docs/Docs.kt`, `DocReaderScreen`): a **Print** item in the existing ••• (`MoreVert`)
   `DropdownMenu`, next to Share link / Open on web / GIDEON. Hidden while editing.
3. **Print sheet** (a `ModalBottomSheet`, one shared composable for both):
   - Printer: `printerName` (or "—").
   - Copies: a stepper − / + from 1 to `maxCopies` (default 1).
   - Colour: segmented **Color / Black & white**, default **Black & white**.
   - Footer: "At most 50 pages per print."
   - **Print** button; while sending it is disabled and reads "Sending to the printer…".
   - After `201` the controls lock and a status block shows the job: spinner + "Printing…" / "Queued", then
     ✓ "Printed" or ✗ "Print failed" + the job's `error`. Under it "{n} pages × {c} · Black & white".
   - Poll `GET /api/print/jobs/{id}` every 2.5 s until `done` / `failed`, for at most 2 minutes; then say
     "Still printing. Check the Print log in Settings later." Stop polling when the sheet closes.
   - A refusal (table above) shows in red under the button; the person can change copies and try again.
   - Close button ("Close", "Done" once finished); not dismissable while sending.
4. **Settings › Print log** (`feature/auth/AccountScreen.kt`, `SettingsTab.PROFILE`): a row "Print log" with a
   printer icon, drawn like `GideonMemoryEntry()` and right after it, only when `printingEnabled`. Opens a
   new screen (`feature/print/PrintLogScreen.kt`, route in `ui/shell/SignedInShell.kt`):
   - Filters on top: **Person** (only when `canSeeAll`: "Everyone" + `people`), **Period** (All time, Today,
     Last 7 days, Last 30 days, Custom → From / To date pickers). Any change reloads from the first page.
   - Rows: kind icon (Legal document / Page), title, status chip (Queued neutral, Printing… info, Printed
     success, Print failed danger), meta line "[name ·] {n} pages × {c} · Color|Black & white · 18 Nov, 10:12"
     (WIB), and for a failed job its `error`.
   - Pull to refresh; load the next page with `cursor = nextCursor` when the last row appears.
   - Empty state (the app's empty-state component, reason + next step): "No prints yet" + "Print a Legal
     document or a page from its ••• menu."; with filters on: "No prints yet" + "Nothing was printed in this
     period. Try another date or person.". Load error: "Couldn't load the print log" + the reason + Try again.

## Strings (EN → ID)

| English | Indonesian |
|---|---|
| Print | Cetak |
| Print log | Riwayat print |
| Printer | Printer |
| Copies | Salinan |
| Color | Warna |
| Black & white | Hitam-putih |
| Sending to the printer… | Mengirim ke printer… |
| Printing… | Sedang mencetak… |
| Printed | Sudah dicetak |
| Print failed | Print gagal |
| Queued | Antre |
| {n} pages × {c} | {n} halaman × {c} |
| At most {n} pages per print. | Maksimal {n} halaman per print. |
| Still printing. Check the Print log in Settings later. | Masih mencetak. Cek Riwayat print di Pengaturan nanti. |
| No prints yet | Belum ada print |
| Print a Legal document or a page from its ••• menu. | Cetak dokumen Legal atau halaman dari menu •••-nya. |
| Nothing was printed in this period. Try another date or person. | Tidak ada yang dicetak di periode ini. Coba tanggal atau orang lain. |
| Couldn't load the print log | Riwayat print tidak bisa dimuat |
| Printer isn't set up on this server | Printer belum diatur di server ini |
| Too many pages: at most 50 per print. | Terlalu banyak halaman: maksimal 50 per print. |
| This file has {n} pages. One print can have at most {m} pages. | File ini punya {n} halaman. Satu print maksimal {m} halaman. |
| You've printed 20 times this hour. Try again later. | Kamu sudah print 20 kali dalam sejam. Coba lagi nanti. |
| This version has no file that can be printed. | Versi ini tidak punya file yang bisa dicetak. |
| Couldn't count the pages of this file, so it wasn't printed. | Jumlah halaman file ini tidak terbaca, jadi tidak dicetak. |
| This server can't turn files into PDF yet, so it can't print them. | Server ini belum bisa mengubah file jadi PDF, jadi belum bisa mencetaknya. |
| Copies must be between 1 and {n}. | Jumlah salinan harus antara 1 dan {n}. |
| Everyone | Semua orang |
| Person | Orang |
| Period | Periode |
| All time / Today / Last 7 days / Last 30 days / Custom | Semua waktu / Hari ini / 7 hari terakhir / 30 hari terakhir / Custom |
| From / To | Dari / Sampai |
| Legal document / Page | Dokumen legal / Halaman |

Reuse existing keys where they exist (Everyone, From, To, Close, Done, Try again…); no duplicate keys.

## Acceptance checklist

- [ ] `printing` absent or `enabled: false` → no Print button, no ••• Print item, no Print log row.
- [ ] Legal: Print shows only for a printable shown version; a JPG-only signed copy hides it.
- [ ] Sheet: copies 1–5 (− disabled at 1, + at 5), Black & white preselected, printer name shown.
- [ ] Print sends `kind`, `id`, `copies`, `colorMode` (no `version`); button disabled while sending.
- [ ] Status polls every ~2.5 s, ends on done / failed, gives up after 2 min with the "still printing" line.
- [ ] Each error code in the table shows the Android string in EN and ID; unknown codes show the server text.
- [ ] Print log: own jobs for staff; BoD/OAA see everyone with the person filter and names on rows.
- [ ] Period presets and custom From/To send WIB `YYYY-MM-DD`; pull to refresh; paging via `nextCursor`.
- [ ] Empty state and error state as above; dark mode and Indonesian checked.
- [ ] Unit tests: decoding of `Job` / the log page (sample JSON above, missing fields tolerated), the error
      code → string mapping (incl. the page count parsed from `TOO_MANY_PAGES`), the period → from/to dates.
- [ ] No print is queued offline or retried automatically.

## Print screen: print an uploaded file (owner, 18 Nov 2026)

A dedicated **Print** screen (ID **Cetak**) where any signed-in member of the company workspace uploads any file
and prints it on the office printer. Web: `/print`. iOS: `apps/ios/Sources/Views/PrintUploadView.swift` (the
screen), `PrintSheet.swift` (pages field for `kind: .upload`), `PrintAPI.swift` (`uploadPrintFile`,
`deletePrintUpload`), `PrintModels.swift` (`PrintUpload`, `PrintPageRanges`); route `nexus://print`
(`NXScreen.printing`, More tile on the phone, sidebar Team group on iPad/Mac).

### Entry point

- A **Print** row (printer icon) in the launcher next to Room Booking / Z Vault: an entry in `ui/shell/ShellNav.kt`
  like `ROOMS(Group.HOME, …, "rooms", companyOnly = true)`, route `"print"` in `ui/shell/SignedInShell.kt`,
  screen in `feature/print/PrintUploadScreen.kt`.
- Drawn only for company members **and** while `printingEnabled`. Opened with printing off, the screen shows
  the empty state "Printer isn't set up on this server".

### Endpoints

`POST /api/print/uploads` — multipart, one field `file` (PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, JPG/PNG; max 25 MB;
HEIC refused). Send the file's real MIME type and name. The server converts it to PDF and counts the pages:
**5–30 s**, so use a 180 s timeout and show progress.

```json
201 { "upload": { "id": "0193f…", "fileName": "Rundown.xlsx", "pages": 3, "size": 48211,
                  "createdAt": "2026-11-18T04:01:10.000Z", "expiresAt": "2026-11-18T05:01:10.000Z" } }
```

| status | code | show (EN) |
|---|---|---|
| 400 | `NO_FILE` / `EMPTY` | Couldn't read that file. |
| 403 | `NOT_A_MEMBER` | Printing is for members of the company workspace. |
| 413 | `TOO_LARGE` | The file is larger than 25 MB |
| 415 | `UNSUPPORTED_TYPE`, message mentions "HEIC" | HEIC photos can't be printed. Save the photo as JPG or PNG first. |
| 415 | `UNSUPPORTED_TYPE`, message "doesn't match its name" | The file doesn't match its name (it may be damaged or renamed). |
| 415 | `UNSUPPORTED_TYPE` (other) | This kind of file can't be printed. Use PDF, Word, Excel, PowerPoint, JPG or PNG. |
| 422 | `PAGES_UNKNOWN` | Couldn't count the pages of this file, so it wasn't printed. |
| 502 | `CONVERSION_FAILED` | This file couldn't be converted for printing. Try saving it as PDF first. |
| 503 | `PRINT_NOT_CONFIGURED` / `PDF_NOT_CONFIGURED` | as in the table above |

`DELETE /api/print/uploads/{id}` → `{ "ok": true }`. Call it (fire and forget) when the person chooses another
file or leaves the screen without printing. The server also deletes an upload after 1 h, and right after its
print job ends.

`POST /api/print` with an upload:

```json
{ "kind": "upload", "id": "<upload id>", "copies": 1, "colorMode": "mono", "pageRanges": "1-3,5" }
```

`pageRanges` only for `upload`; empty or absent = all pages. The job's `pages` = pages actually printed, its
`kind` is `"upload"` and its `title` the file name. New errors:

| status | code | show (EN) |
|---|---|---|
| 400 | `BAD_RANGE` | Write pages like 1-3,5 |
| 400 | `OUT_OF_RANGE` | This file has {n} pages. (`n` from the server's "This file has N pages") |
| 404 | `UPLOAD_GONE` | This upload has expired. Upload the file again. (forget the upload: back to the empty state) |
| 422 | `TOO_MANY_PAGES` | for chosen pages: "These pages add up to {n}. One print can have at most 50 pages." (`n` from "add up to N"); else the existing text |

### Flow

1. **Empty state** (the app's empty-state component): icon printer, title "Print any file on the office
   printer", body "PDF, Word, Excel, PowerPoint, JPG or PNG, up to 25 MB. The file is deleted from the server
   once it's printed.", button **Choose a file** (after a print: **Print another file**), and under it
   "Printer: {printerName}".
2. **Choose a file**: the system document picker (`ActivityResultContracts.OpenDocument`) limited to the MIME
   types above. Read the bytes through the content resolver; take the display name from `OpenableColumns`.
3. **Preparing**: a card with a spinner, "Preparing the file…" and the file name while the upload runs. An
   error shows in red under it and the empty state comes back.
4. **File card**: file name, "{n} pages", buttons **Print** (primary) and **Choose another file** (deletes the
   current upload first, then opens the picker).
5. **Print** opens the print sheet with an extra **Pages** field (only for uploads): text, placeholder
   "All pages", helper "e.g. 1-3,5". Check it as the server does (`src/lib/print/page-ranges.ts`): spaces
   ignored, `^\d+(-\d+)?(,\d+(-\d+)?)*,?$`, each `lo ≥ 1`, `hi ≥ lo`, `hi ≤ pages`, overlaps counted once;
   more than 50 chosen (or all pages of a file over 50) → the TOO_MANY_PAGES text. While invalid, the helper
   shows the problem in red and Print is disabled.
6. Once `POST /api/print` answers 201 (or `UPLOAD_GONE`), the upload is used up: the screen forgets it (no
   DELETE) and returns to the empty state with **Print another file**; the sheet keeps polling the job as before.
7. Leaving the screen with an unprinted upload → `DELETE` it. An upload that finishes after the screen was left
   is deleted as soon as it arrives.

### Print log

Rows with `kind: "upload"` get an upload icon (iOS `arrow.up.doc`) and the label "Uploaded file".

### Strings (EN → ID)

| English | Indonesian |
|---|---|
| Print (screen, menu) | Cetak |
| Choose a file | Pilih file |
| Choose another file | Pilih file lain |
| Preparing the file… | Menyiapkan file… |
| {n} pages | {n} halaman |
| Pages | Halaman |
| All pages | Semua halaman |
| e.g. 1-3,5 | mis. 1-3,5 |
| Print another file | Print file lain |
| Print any file on the office printer | Cetak file apa saja di printer kantor |
| PDF, Word, Excel, PowerPoint, JPG or PNG, up to 25 MB. The file is deleted from the server once it's printed. | PDF, Word, Excel, PowerPoint, JPG, atau PNG, maksimal 25 MB. File dihapus dari server setelah dicetak. |
| HEIC photos can't be printed. Save the photo as JPG or PNG first. | Foto HEIC tidak bisa dicetak. Simpan dulu sebagai JPG atau PNG. |
| This upload has expired. Upload the file again. | File ini sudah kedaluwarsa. Unggah ulang filenya. |
| Write pages like 1-3,5 | Tulis halaman seperti 1-3,5 |
| This file has {n} pages. | File ini punya {n} halaman. |
| The file is larger than 25 MB | File lebih dari 25 MB |
| This kind of file can't be printed. Use PDF, Word, Excel, PowerPoint, JPG or PNG. | Jenis file ini tidak bisa dicetak. Gunakan PDF, Word, Excel, PowerPoint, JPG, atau PNG. |
| The file doesn't match its name (it may be damaged or renamed). | Isi file tidak cocok dengan namanya (mungkin rusak atau diganti namanya). |
| This file couldn't be converted for printing. Try saving it as PDF first. | File ini tidak bisa dikonversi untuk dicetak. Coba simpan dulu sebagai PDF. |
| These pages add up to {n}. One print can have at most 50 pages. | Halaman yang dipilih berjumlah {n}. Satu print maksimal 50 halaman. |
| Printing is for members of the company workspace. | Print hanya untuk anggota workspace perusahaan. |
| Uploaded file | File unggahan |

### Acceptance

- [ ] Print row only for company members while `printingEnabled`; `nexus://print`-style deep link / route works.
- [ ] Picker offers only PDF/Word/Excel/PowerPoint/JPG/PNG; a HEIC or >25 MB file shows its own message.
- [ ] "Preparing the file…" shows during the 5–30 s conversion; then name + page count.
- [ ] Choose another file and leaving the screen DELETE the old upload; a late upload after leaving is deleted.
- [ ] Pages field: empty = all; `1-3,5` sends `pageRanges`; bad text / out of range / over 50 blocks Print with
      the right message; server `BAD_RANGE` / `OUT_OF_RANGE` / `TOO_MANY_PAGES` texts also map.
- [ ] After 201 the screen goes back to the empty state with "Print another file"; `UPLOAD_GONE` does too.
- [ ] Print log shows uploads with the upload icon and the file name.
- [ ] Unit tests: the page-range checker (same cases as `src/__tests__` for page-ranges), `PrintUpload` decoding,
      the new error-code mapping.

## UI tour ids

The iOS/web tour (`apps/ios/scripts/ui-tour-screens.json`) adds `legal-print` (the print sheet over the
`[TEST]` Legal document; web taps "Print|Cetak", iOS taps the button with identifier `legal.print`) and
`settings-print-log` (`/settings?section=print-log`; the app taps "Print log|Riwayat print"). Use the same ids
when the Android tour gets them.
`print-upload` (web `/print`, app `nexus://print`) is the Print screen's empty state.

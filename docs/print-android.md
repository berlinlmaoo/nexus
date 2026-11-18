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

## UI tour ids

The iOS/web tour (`apps/ios/scripts/ui-tour-screens.json`) adds `legal-print` (the print sheet over the
`[TEST]` Legal document; web taps "Print|Cetak", iOS taps the button with identifier `legal.print`) and
`settings-print-log` (`/settings?section=print-log`; the app taps "Print log|Riwayat print"). Use the same ids
when the Android tour gets them.

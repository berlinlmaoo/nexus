# NEXUS Spreadsheet ↔ Google Sheets parity (gap table)

Owner, 12 Oct 2026: the project Spreadsheet must match Google Sheets "plek ketiplek". Source of truth for
Sheets is the observed inventory (Chromium, id-ID, 12 Oct 2026; EN name — ID label as seen). This table
maps every inventory item to NEXUS.

- **Before** = state at `1114d84` (12 Oct 2026, morning). **After** = state after the parity waves (see
  the commit list at the bottom). `have` / `partial` / `missing` / `n/a` (impossible or meaningless for an
  internal web app: Apps Script, add-ons, macros, data connectors, Forms, Drive-level file actions).
- Code lives in `apps/nexus-lovable-ui/src/components/sheets/` (web) and `apps/nexus-lovable-ui/src/lib/sheet-*.ts`
  (pure logic + tests); server in `src/lib/project-sheets.ts`, `src/app/api/sheets/**`.
- Data model: everything new lives in the existing JSON columns — `ProjectSheet.settings` (sheet-level:
  CF rules, bandings, filter, filter views, slicers, named/protected ranges, groups, tables, charts, pivot,
  theme, locale, versions…) and `SheetRow.styles` (per cell: fonts, hex colours, borders, rotation, wrap,
  number patterns, notes). No new table or column. Types: `apps/nexus-lovable-ui/src/lib/sheet-model.ts`;
  server narrowing: `readSheetSettings` / `normalizeCellStyle`.

| # | Inventory item (EN — ID) | Before | Before ref | After |
|---|---|---|---|---|
| **0 App chrome** | | | | |
| 0.1 | Title + saving status ("Menyimpan…") | partial | ProjectSheetView header, "Saving…" in status bar | have |
| 0.2 | Presence avatars, +N, collaborator selection border | have | use-sheet-realtime, peerCursors | have |
| 0.3 | Comments button, Share | partial | comment button in fx bar; share = project membership (n/a) | partial — comments button; Share n/a (project membership) |
| 0.4 | Menu search "Search the menus (Alt+/)" | missing | — | have — Help › Search the menus, Alt+/ |
| 0.5 | Name box (type range / named range, ▾ list "Manage named ranges", Ctrl+J) | partial | SheetGrid nameBox (no named ranges, no ▾) | partial — typeable, Ctrl+J, named ranges usable; no ▾ list |
| 0.6 | Formula bar fx | have | SheetGrid fx input | have |
| 0.7 | Hide menus (Ctrl+Shift+F) | missing | — | missing |
| 0.8 | Toolbar overflow "⋮" when a sidebar is open | missing | toolbar wraps | have — groups fold into ⋮ |
| 0.9 | Sheet bar: + add, ≡ all sheets, tabs ▾, scroll arrows | partial | SheetTabs (no ≡ list, no ▾) | have — +, ≡ all sheets, tab ▾, scroll arrows |
| 0.10 | Quick-sum chip with ▾ (Sum, Average, Min, Max, Count, Count numbers; Alt+Shift+Q) | partial | status bar Menu (no Alt+Shift+Q) | have — Count when no numbers, Alt+Shift+Q |
| 0.11 | Grid: blue active border, light-blue range, fill handle dot, tinted headers | have | SheetGrid Row | have |
| **1.1 File** | | | | |
| 1.1.1 | New ▸ / Open / Make a copy / Email / Move / Move to bin / Details / Offline / Approvals / Language / Security limitations | n/a | Drive-level; a NEXUS sheet belongs to a project | n/a |
| 1.1.2 | Import | have | ProjectSheetView Import (CSV/XLSX) | have |
| 1.1.3 | Share ▸ (share / publish to web) | n/a | access = project membership | n/a |
| 1.1.4 | Download ▸ xlsx / ods / pdf / html / csv / tsv | partial | xlsx + csv buttons only | partial — xlsx, pdf (print), html, csv, tsv; no .ods |
| 1.1.5 | Rename | partial | tab rename only | have (sheet) |
| 1.1.6 | Version history ▸ Name current version / See version history (Ctrl+Alt+Shift+H) | missing | per-cell history only (CellComments) | have — name current version, history panel, show changes, restore |
| 1.1.7 | Settings (locale, time zone, calculation) | missing | — | have — locale, time zone, recalculation, iterative |
| 1.1.8 | Print (Ctrl+P) | missing | — | have |
| **1.2 Edit** | | | | |
| 1.2.1 | Undo / Redo | have | use-sheet-undo | have |
| 1.2.2 | Cut / Copy / Paste | have | sheet-clipboard | have |
| 1.2.3 | Paste special ▸ values / format / formula / CF only / DV only / transposed / column widths / all except borders | partial | values only | have — all 8 kinds |
| 1.2.4 | Paste without formatting (Ctrl+Shift+V) | partial | = values only | have |
| 1.2.5 | Move ▸ row up/down, column left/right | partial | row drag only | have |
| 1.2.6 | Delete ▸ values / rows N–M / columns A–C / cells shift up / shift left / notes (selection-aware labels) | partial | values, rows | have — selection-aware labels |
| 1.2.7 | Find and replace (Ctrl+H) | partial | inline bar, match case only | have — dialog with scope/case/entire cell/regex/formulas/links |
| 1.2.8 | Copy as / paste from Markdown | missing | — | missing |
| **1.3 View** | | | | |
| 1.3.1 | Show ▸ formula bar / gridlines / formulas (Ctrl+`) / protected ranges | missing | — | have |
| 1.3.2 | Freeze ▸ none / 1 / 2 / up to row N; columns likewise | have | View menu, drag handles | have — incl. up to row/column N |
| 1.3.3 | Group ▸ group / ungroup rows/columns (Alt+Shift+→/←), labels with numbers | missing | — | have — Alt+Shift+→/←, gutter [–]/[+] |
| 1.3.4 | Comments ▸ hide / minimise / show all | partial | per-cell threads only | partial — hide / show all; no minimise |
| 1.3.5 | Hidden sheets ▸ | missing | — | have |
| 1.3.6 | Zoom ▸ 50–200% | have | toolbar + View | have |
| 1.3.7 | Full screen (Ctrl+F1) | missing | — | have |
| **1.4 Insert** | | | | |
| 1.4.1 | Cells ▸ shift right / shift down | missing | — | have |
| 1.4.2 | Rows ▸ "Insert N rows above/below" (N = selection) | partial | 1 row | have |
| 1.4.3 | Columns ▸ "Insert N columns left/right" | partial | 1 column | have |
| 1.4.4 | Sheet (Shift+F11) | partial | tab "+" only | have |
| 1.4.5 | Pre-built tables, Timeline, Emoji, Smart chips (people/file/calendar/finance), Data extraction | n/a | need Drive/Workspace data | n/a |
| 1.4.6 | Chart (Alt+F1) | missing | — | have |
| 1.4.7 | Pivot table | missing | — | have (new sheet only) |
| 1.4.8 | Image ▸ in cell / over cells | missing | — | missing |
| 1.4.9 | Drawing | n/a | | n/a |
| 1.4.10 | Function ▸ SUM… + categories | partial | toolbar Σ, 9 functions | have — categories |
| 1.4.11 | Link (Ctrl+K) popover | partial | window.prompt | have — popover + link card |
| 1.4.12 | Checkbox / Dropdown (auto-detect values) | have | insertCheckbox / insertDropdown | have |
| 1.4.13 | Comment (Ctrl+Alt+M) | have | CellComments | have |
| 1.4.14 | Note (Shift+F2) + black triangle | missing | — | have |
| **1.5 Format** | | | | |
| 1.5.1 | Theme sidebar (15 presets + customise) | missing | — | have |
| 1.5.2 | Number ▸ 14 formats with examples + custom currency / date-time / number | partial | auto, number, %, Rupiah, date, plain text | have — Sheets list with examples + 3 custom dialogs |
| 1.5.3 | Text ▸ bold / italic / underline / strike + shortcuts | have | Format menu, toolbar | have |
| 1.5.4 | Alignment ▸ L/C/R (Ctrl+Shift+L/E/R) + top/middle/bottom | partial | no shortcuts | have — incl. shortcuts |
| 1.5.5 | Wrapping ▸ overflow / wrap / clip | partial | wrap on/off | have |
| 1.5.6 | Rotation ▸ 6 presets + custom angle (−90…90 by 15) | missing | — | have |
| 1.5.7 | Font size ▸ 6–36 | partial | px list 9–36 | have — 6–36 pt |
| 1.5.8 | Merge cells ▸ all / vertical / horizontal / unmerge | partial | merge all / unmerge | have |
| 1.5.9 | Convert to table (Ctrl+Alt+T) | missing | — | have |
| 1.5.10 | Conditional formatting | partial | per-column rules (6 styles) in ColumnPopover | have |
| 1.5.11 | Alternating colours | missing | — | have |
| 1.5.12 | Clear formatting (Ctrl+\\) | have | | have |
| **1.6 Data** | | | | |
| 1.6.1 | Sort sheet ▸ by column X A→Z / Z→A (writes) | partial | per-viewer view sort, not saved | have — writes the order |
| 1.6.2 | Sort range ▸ + advanced dialog (header row, multi-key) | missing | — | have |
| 1.6.3 | Create / remove filter (shared, green outline, header icons) | partial | per-viewer text filter | have — shared |
| 1.6.4 | Filter views (create, group-by, save as, rename, duplicate, delete) | missing | — | have |
| 1.6.5 | Add a slicer | missing | — | have |
| 1.6.6 | Protect sheets and ranges (+ enforcement) | missing | — | have — warn/restrict, enforced by the API |
| 1.6.7 | Named ranges (+ use in formulas) | missing | — | have — usable in formulas |
| 1.6.8 | Named functions | missing | — | missing |
| 1.6.9 | Randomise range | missing | — | have |
| 1.6.10 | Column stats | missing | — | have |
| 1.6.11 | Data validation | have | DataValidationPanel, sheet-validation | have |
| 1.6.12 | Data clean-up ▸ remove duplicates / trim whitespace (cleanup suggestions) | missing | — | partial — remove duplicates, trim; no cleanup suggestions |
| 1.6.13 | Split text to columns + separator chooser | missing | — | have |
| 1.6.14 | Data connectors | n/a | BigQuery/Looker | n/a |
| **1.7 Tools** | | | | |
| 1.7.1 | Forms | n/a | | n/a |
| 1.7.2 | Spelling | partial | browser spellcheck in the cell editor | partial (browser spellcheck) |
| 1.7.3 | Suggestion controls ▸ autocomplete / formula suggestions | partial | formula autocomplete always on | have — autocomplete toggle |
| 1.7.4 | Calculation control ▸ automatic / manual | missing | — | have — manual + F9 |
| 1.7.5 | Notification settings, Explore, Dictionary, Activity dashboard, Accessibility | n/a | | n/a |
| **1.8 Extensions** | Add-ons, Macros, Apps Script, AppSheet, Data Studio | n/a | | n/a |
| **1.9 Help** | | | | |
| 1.9.1 | Search the menus | missing | — | have |
| 1.9.2 | Function list | partial | SUPPORTED_FUNCTIONS in autocomplete | have |
| 1.9.3 | Keyboard shortcuts (Ctrl+/) | missing | — | have |
| 1.9.4 | Help / training / updates / privacy / terms | n/a | | n/a |
| **2 Toolbar** | | | | |
| 2.1 | Search menus · undo · redo · print · paint format | partial | undo/redo | have |
| 2.2 | Zoom combobox (typeable) | partial | list only | have |
| 2.3 | $ · % · .0 · .00 · 123 ▾ (with examples) | partial | Rp, %, decimals, 123 (6 formats) | have |
| 2.4 | Font family ▾ (each name in its face) | missing | — | have |
| 2.5 | Font size − / box / + | partial | dropdown only | have |
| 2.6 | B · I · S · text colour | have | | have |
| 2.7 | Colour picker: Reset, 10×8 swatches, STANDARD ✎, CUSTOM ⊕, CF / alternating links | partial | 10 named colours | have |
| 2.8 | Borders panel: 10 types + colour + 6 line styles (sticky) | partial | 8 presets, thin black only | have |
| 2.9 | Merge split button (all / vertical / horizontal / unmerge) | partial | toggle | have |
| 2.10 | H-align · V-align · wrap ▾ · rotation ▾ (icons mirror state) | partial | no rotation, wrap toggle | have |
| 2.11 | Link · comment · chart · filter toggle · filter views ▾ · Σ ▾ (categories) | partial | link, comment, column filter, Σ | have |
| **3 Context menus** | | | | |
| 3.1 | Cell menu (21 items: cut, copy, paste, paste special ▸, insert N rows/cols, insert cells ▸, delete rows/cols/cells ▸, convert to table, create filter, insert link, comment, insert note, dropdown, smart chips, more cell actions ▸ CF / DV / get link / named range / protect) | partial | ~15 NEXUS items, different order | have |
| 3.2 | Column header menu (22 items incl. sort sheet, CF, DV, column stats, more column actions ▸) | partial | | have |
| 3.3 | Row header menu (17 items) | partial | | have |
| 3.4 | Sheet tab menu (delete w/ confirm, duplicate, copy to, rename, change colour ▸, protect, hide, view comments, move right/left) | partial | SheetTabs menu (named colours) | partial — no “Copy to” |
| 3.5 | Right-click outside selection moves selection | have | | have |
| **4 Sidebars & dialogs** | | | | |
| 4.1 | Data validation sidebar (list, editor, criteria, chips, advanced) | have | DataValidationPanel | have |
| 4.2 | Conditional formatting sidebar (single colour all conditions, colour scale, custom formula, default "Is not empty" #b7e1cd live) | missing | | have |
| 4.3 | Alternating colours (12 presets, header/footer, custom) | missing | | have |
| 4.4 | Tables (dark-green header, ▾ per column, column types, name tab, banding, + handle, table menu) | missing | | have |
| 4.5 | Filter (green outline, header icons, by values / condition / colour, sort, collaboration warning) | partial | text contains filter | have |
| 4.6 | Filter views (dark-green bar, name, range, save, ✕) | missing | | have |
| 4.7 | Slicer (sidebar + floating chip) | missing | | have |
| 4.8 | Sort range dialog | missing | | have |
| 4.9 | Find & replace dialog (scope, match case, entire cell, regex, formulas, links) | partial | | have |
| 4.9b | Split text to columns | missing | | have |
| 4.9c | Remove duplicates dialog, trim whitespace | missing | | have |
| 4.10 | Named ranges sidebar | missing | | have |
| 4.11 | Protected sheets & ranges sidebar + permissions | missing | | have |
| 4.12 | Chart editor (Setup / Customise, ~30 types, floating chart object) | missing | | have |
| 4.13 | Pivot table (create dialog, "Pivot Table 1" sheet, editor rows/cols/values/filters, suggestions) | missing | | have (new sheet only) |
| 4.14 | Column stats sidebar | missing | | have |
| 4.15 | Insert link popover (+ link card) | partial | prompt() | have |
| 4.16 | Named functions sidebar | missing | | missing |
| 4.16b | Data extraction | n/a | needs people/file chips | n/a |
| 4.17 | Theme sidebar | missing | | have |
| 4.18 | Notes vs comments | partial | comments only | have |
| 4.19 | Spreadsheet settings (locale, time zone, recalculation, iterative) | missing | | have |
| 4.20 | Version history (list, show changes, name, restore) | missing | cell history only | have |
| 4.21 | Custom number / date-time / currency formats | missing | | have |
| 4.22 | Keyboard shortcuts dialog | missing | | have |
| 4.23 | Smart chips / @ menu | n/a | people/files/calendar are Workspace data | n/a |
| **5 Grid rendering** | | | | |
| 5.1 | Dropdown chip cells, open list, multi-select | have | sheet-dropdown | have |
| 5.2 | Checkbox cells | have | | have |
| 5.3 | Date picker when editing a date cell | missing | | have |
| 5.4 | Conditional colours / colour scale gradient | partial | 6 tints per column | have |
| 5.5 | Alternating colours | missing | | have |
| 5.6 | Tables look | missing | | have |
| 5.7 | Filter look (outline, tinted headers, funnel icons) | missing | | have |
| 5.8 | Filter view bar | missing | | have |
| 5.9 | Frozen panes thick divider + drag; merge-conflict dialog | partial | no merge-conflict check | partial — no merge-conflict dialog |
| 5.10 | Hidden rows/columns arrows | have | | have |
| 5.11 | Row/column groups gutter [–]/[+] | missing | | have |
| 5.12 | Merged cells, bottom-aligned | have | | have |
| 5.13 | Note marker (black triangle) | missing | | have |
| 5.14 | Comment marker | have | amber triangle | have |
| 5.15 | Invalid-data red triangle | have | | have |
| 5.16 | Text overflow into empty neighbours | missing | truncated | have |
| 5.17 | Wrap with auto row height | partial | wraps, row height fixed | have |
| 5.18 | Clip | partial | (= no wrap) | have |
| 5.19 | Rotation with auto row height | missing | | have |
| 5.20 | Borders (styles + colours) | partial | thin, foreground colour | have |
| 5.21 | Text colour / fill (any colour) | partial | 10 named colours | have |
| 5.22 | Number formats render | partial | | have |
| 5.23 | URL auto-link | partial | link cells via Insert link only | partial — links via Insert link only |
| 5.24 | Chart object / slicer floating over grid | missing | | have |
| **Appendix A** | Keyboard shortcuts (per entry, see dialog) | partial | ~25 of ~110 | partial — 69 entries listed in the Ctrl+/ dialog |

## Result (12 Oct 2026)

Inventory rows (149, excluding section headers): before **have 22 · partial 54 · missing 63 · n/a 10**;
after **have 125 · partial 9 · missing 5 · n/a 10**.

Still missing: hide menus (0.7), copy as / paste from Markdown (1.2.8), image in / over cells (1.4.8),
named functions (1.6.8 / 4.16). Partial: share, name-box ▾ list, .ods download, minimise comments,
cleanup suggestions, spelling, tab "Copy to", merge-conflict dialog, URL auto-link.

Verified in a headless browser against a stateful mock of the sheets API (42 scripted flows: every
menu, the context menus, fill / borders / font / rotation / wrap, paint format, quick sum, search
menus, CF, alternating colours, filter, sort range, remove duplicates, trim, split, find and
replace, named ranges in formulas, protect, column stats, notes, groups, date picker, tables,
charts, pivot, slicer, number-format dialogs, theme, shortcuts, version history, settings, phone
view, narrow toolbar). Unit tests: sheet-cf, -chart, -datatools, -filter, -formula, -numfmt,
-palette, -pivot, -stats, -validation, -versions.

Commits:
- `63234fa` Spreadsheet (web + API): parity fixes found in browser QA (owner, 12 Oct 2026)
- `628c929` Spreadsheet (web): Sheets parity wave C, tables, charts, pivot, formats, versions, settings (owner, 12 Oct 2026)
- `b5ae8d6` Spreadsheet (web): Sheets parity wave B, conditional formatting, filters, data tools (owner, 12 Oct 2026)
- `96bbfde` Spreadsheet (web + API): Sheets parity wave A, menus, toolbar, palette, borders, fonts (owner, 12 Oct 2026)

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
| 0.1 | Title + saving status ("Menyimpan…") | partial | ProjectSheetView header, "Saving…" in status bar | |
| 0.2 | Presence avatars, +N, collaborator selection border | have | use-sheet-realtime, peerCursors | |
| 0.3 | Comments button, Share | partial | comment button in fx bar; share = project membership (n/a) | |
| 0.4 | Menu search "Search the menus (Alt+/)" | missing | — | |
| 0.5 | Name box (type range / named range, ▾ list "Manage named ranges", Ctrl+J) | partial | SheetGrid nameBox (no named ranges, no ▾) | |
| 0.6 | Formula bar fx | have | SheetGrid fx input | |
| 0.7 | Hide menus (Ctrl+Shift+F) | missing | — | |
| 0.8 | Toolbar overflow "⋮" when a sidebar is open | missing | toolbar wraps | |
| 0.9 | Sheet bar: + add, ≡ all sheets, tabs ▾, scroll arrows | partial | SheetTabs (no ≡ list, no ▾) | |
| 0.10 | Quick-sum chip with ▾ (Sum, Average, Min, Max, Count, Count numbers; Alt+Shift+Q) | partial | status bar Menu (no Alt+Shift+Q) | |
| 0.11 | Grid: blue active border, light-blue range, fill handle dot, tinted headers | have | SheetGrid Row | |
| **1.1 File** | | | | |
| 1.1.1 | New ▸ / Open / Make a copy / Email / Move / Move to bin / Details / Offline / Approvals / Language / Security limitations | n/a | Drive-level; a NEXUS sheet belongs to a project | |
| 1.1.2 | Import | have | ProjectSheetView Import (CSV/XLSX) | |
| 1.1.3 | Share ▸ (share / publish to web) | n/a | access = project membership | |
| 1.1.4 | Download ▸ xlsx / ods / pdf / html / csv / tsv | partial | xlsx + csv buttons only | |
| 1.1.5 | Rename | partial | tab rename only | |
| 1.1.6 | Version history ▸ Name current version / See version history (Ctrl+Alt+Shift+H) | missing | per-cell history only (CellComments) | |
| 1.1.7 | Settings (locale, time zone, calculation) | missing | — | |
| 1.1.8 | Print (Ctrl+P) | missing | — | |
| **1.2 Edit** | | | | |
| 1.2.1 | Undo / Redo | have | use-sheet-undo | |
| 1.2.2 | Cut / Copy / Paste | have | sheet-clipboard | |
| 1.2.3 | Paste special ▸ values / format / formula / CF only / DV only / transposed / column widths / all except borders | partial | values only | |
| 1.2.4 | Paste without formatting (Ctrl+Shift+V) | partial | = values only | |
| 1.2.5 | Move ▸ row up/down, column left/right | partial | row drag only | |
| 1.2.6 | Delete ▸ values / rows N–M / columns A–C / cells shift up / shift left / notes (selection-aware labels) | partial | values, rows | |
| 1.2.7 | Find and replace (Ctrl+H) | partial | inline bar, match case only | |
| 1.2.8 | Copy as / paste from Markdown | missing | — | |
| **1.3 View** | | | | |
| 1.3.1 | Show ▸ formula bar / gridlines / formulas (Ctrl+`) / protected ranges | missing | — | |
| 1.3.2 | Freeze ▸ none / 1 / 2 / up to row N; columns likewise | have | View menu, drag handles | |
| 1.3.3 | Group ▸ group / ungroup rows/columns (Alt+Shift+→/←), labels with numbers | missing | — | |
| 1.3.4 | Comments ▸ hide / minimise / show all | partial | per-cell threads only | |
| 1.3.5 | Hidden sheets ▸ | missing | — | |
| 1.3.6 | Zoom ▸ 50–200% | have | toolbar + View | |
| 1.3.7 | Full screen (Ctrl+F1) | missing | — | |
| **1.4 Insert** | | | | |
| 1.4.1 | Cells ▸ shift right / shift down | missing | — | |
| 1.4.2 | Rows ▸ "Insert N rows above/below" (N = selection) | partial | 1 row | |
| 1.4.3 | Columns ▸ "Insert N columns left/right" | partial | 1 column | |
| 1.4.4 | Sheet (Shift+F11) | partial | tab "+" only | |
| 1.4.5 | Pre-built tables, Timeline, Emoji, Smart chips (people/file/calendar/finance), Data extraction | n/a | need Drive/Workspace data | |
| 1.4.6 | Chart (Alt+F1) | missing | — | |
| 1.4.7 | Pivot table | missing | — | |
| 1.4.8 | Image ▸ in cell / over cells | missing | — | |
| 1.4.9 | Drawing | n/a | | |
| 1.4.10 | Function ▸ SUM… + categories | partial | toolbar Σ, 9 functions | |
| 1.4.11 | Link (Ctrl+K) popover | partial | window.prompt | |
| 1.4.12 | Checkbox / Dropdown (auto-detect values) | have | insertCheckbox / insertDropdown | |
| 1.4.13 | Comment (Ctrl+Alt+M) | have | CellComments | |
| 1.4.14 | Note (Shift+F2) + black triangle | missing | — | |
| **1.5 Format** | | | | |
| 1.5.1 | Theme sidebar (15 presets + customise) | missing | — | |
| 1.5.2 | Number ▸ 14 formats with examples + custom currency / date-time / number | partial | auto, number, %, Rupiah, date, plain text | |
| 1.5.3 | Text ▸ bold / italic / underline / strike + shortcuts | have | Format menu, toolbar | |
| 1.5.4 | Alignment ▸ L/C/R (Ctrl+Shift+L/E/R) + top/middle/bottom | partial | no shortcuts | |
| 1.5.5 | Wrapping ▸ overflow / wrap / clip | partial | wrap on/off | |
| 1.5.6 | Rotation ▸ 6 presets + custom angle (−90…90 by 15) | missing | — | |
| 1.5.7 | Font size ▸ 6–36 | partial | px list 9–36 | |
| 1.5.8 | Merge cells ▸ all / vertical / horizontal / unmerge | partial | merge all / unmerge | |
| 1.5.9 | Convert to table (Ctrl+Alt+T) | missing | — | |
| 1.5.10 | Conditional formatting | partial | per-column rules (6 styles) in ColumnPopover | |
| 1.5.11 | Alternating colours | missing | — | |
| 1.5.12 | Clear formatting (Ctrl+\\) | have | | |
| **1.6 Data** | | | | |
| 1.6.1 | Sort sheet ▸ by column X A→Z / Z→A (writes) | partial | per-viewer view sort, not saved | |
| 1.6.2 | Sort range ▸ + advanced dialog (header row, multi-key) | missing | — | |
| 1.6.3 | Create / remove filter (shared, green outline, header icons) | partial | per-viewer text filter | |
| 1.6.4 | Filter views (create, group-by, save as, rename, duplicate, delete) | missing | — | |
| 1.6.5 | Add a slicer | missing | — | |
| 1.6.6 | Protect sheets and ranges (+ enforcement) | missing | — | |
| 1.6.7 | Named ranges (+ use in formulas) | missing | — | |
| 1.6.8 | Named functions | missing | — | |
| 1.6.9 | Randomise range | missing | — | |
| 1.6.10 | Column stats | missing | — | |
| 1.6.11 | Data validation | have | DataValidationPanel, sheet-validation | |
| 1.6.12 | Data clean-up ▸ remove duplicates / trim whitespace (cleanup suggestions) | missing | — | |
| 1.6.13 | Split text to columns + separator chooser | missing | — | |
| 1.6.14 | Data connectors | n/a | BigQuery/Looker | |
| **1.7 Tools** | | | | |
| 1.7.1 | Forms | n/a | | |
| 1.7.2 | Spelling | partial | browser spellcheck in the cell editor | |
| 1.7.3 | Suggestion controls ▸ autocomplete / formula suggestions | partial | formula autocomplete always on | |
| 1.7.4 | Calculation control ▸ automatic / manual | missing | — | |
| 1.7.5 | Notification settings, Explore, Dictionary, Activity dashboard, Accessibility | n/a | | |
| **1.8 Extensions** | Add-ons, Macros, Apps Script, AppSheet, Data Studio | n/a | | |
| **1.9 Help** | | | | |
| 1.9.1 | Search the menus | missing | — | |
| 1.9.2 | Function list | partial | SUPPORTED_FUNCTIONS in autocomplete | |
| 1.9.3 | Keyboard shortcuts (Ctrl+/) | missing | — | |
| 1.9.4 | Help / training / updates / privacy / terms | n/a | | |
| **2 Toolbar** | | | | |
| 2.1 | Search menus · undo · redo · print · paint format | partial | undo/redo | |
| 2.2 | Zoom combobox (typeable) | partial | list only | |
| 2.3 | $ · % · .0 · .00 · 123 ▾ (with examples) | partial | Rp, %, decimals, 123 (6 formats) | |
| 2.4 | Font family ▾ (each name in its face) | missing | — | |
| 2.5 | Font size − / box / + | partial | dropdown only | |
| 2.6 | B · I · S · text colour | have | | |
| 2.7 | Colour picker: Reset, 10×8 swatches, STANDARD ✎, CUSTOM ⊕, CF / alternating links | partial | 10 named colours | |
| 2.8 | Borders panel: 10 types + colour + 6 line styles (sticky) | partial | 8 presets, thin black only | |
| 2.9 | Merge split button (all / vertical / horizontal / unmerge) | partial | toggle | |
| 2.10 | H-align · V-align · wrap ▾ · rotation ▾ (icons mirror state) | partial | no rotation, wrap toggle | |
| 2.11 | Link · comment · chart · filter toggle · filter views ▾ · Σ ▾ (categories) | partial | link, comment, column filter, Σ | |
| **3 Context menus** | | | | |
| 3.1 | Cell menu (21 items: cut, copy, paste, paste special ▸, insert N rows/cols, insert cells ▸, delete rows/cols/cells ▸, convert to table, create filter, insert link, comment, insert note, dropdown, smart chips, more cell actions ▸ CF / DV / get link / named range / protect) | partial | ~15 NEXUS items, different order | |
| 3.2 | Column header menu (22 items incl. sort sheet, CF, DV, column stats, more column actions ▸) | partial | | |
| 3.3 | Row header menu (17 items) | partial | | |
| 3.4 | Sheet tab menu (delete w/ confirm, duplicate, copy to, rename, change colour ▸, protect, hide, view comments, move right/left) | partial | SheetTabs menu (named colours) | |
| 3.5 | Right-click outside selection moves selection | have | | |
| **4 Sidebars & dialogs** | | | | |
| 4.1 | Data validation sidebar (list, editor, criteria, chips, advanced) | have | DataValidationPanel | |
| 4.2 | Conditional formatting sidebar (single colour all conditions, colour scale, custom formula, default "Is not empty" #b7e1cd live) | missing | | |
| 4.3 | Alternating colours (12 presets, header/footer, custom) | missing | | |
| 4.4 | Tables (dark-green header, ▾ per column, column types, name tab, banding, + handle, table menu) | missing | | |
| 4.5 | Filter (green outline, header icons, by values / condition / colour, sort, collaboration warning) | partial | text contains filter | |
| 4.6 | Filter views (dark-green bar, name, range, save, ✕) | missing | | |
| 4.7 | Slicer (sidebar + floating chip) | missing | | |
| 4.8 | Sort range dialog | missing | | |
| 4.9 | Find & replace dialog (scope, match case, entire cell, regex, formulas, links) | partial | | |
| 4.9b | Split text to columns | missing | | |
| 4.9c | Remove duplicates dialog, trim whitespace | missing | | |
| 4.10 | Named ranges sidebar | missing | | |
| 4.11 | Protected sheets & ranges sidebar + permissions | missing | | |
| 4.12 | Chart editor (Setup / Customise, ~30 types, floating chart object) | missing | | |
| 4.13 | Pivot table (create dialog, "Pivot Table 1" sheet, editor rows/cols/values/filters, suggestions) | missing | | |
| 4.14 | Column stats sidebar | missing | | |
| 4.15 | Insert link popover (+ link card) | partial | prompt() | |
| 4.16 | Named functions sidebar | missing | | |
| 4.16b | Data extraction | n/a | needs people/file chips | |
| 4.17 | Theme sidebar | missing | | |
| 4.18 | Notes vs comments | partial | comments only | |
| 4.19 | Spreadsheet settings (locale, time zone, recalculation, iterative) | missing | | |
| 4.20 | Version history (list, show changes, name, restore) | missing | cell history only | |
| 4.21 | Custom number / date-time / currency formats | missing | | |
| 4.22 | Keyboard shortcuts dialog | missing | | |
| 4.23 | Smart chips / @ menu | n/a | people/files/calendar are Workspace data | |
| **5 Grid rendering** | | | | |
| 5.1 | Dropdown chip cells, open list, multi-select | have | sheet-dropdown | |
| 5.2 | Checkbox cells | have | | |
| 5.3 | Date picker when editing a date cell | missing | | |
| 5.4 | Conditional colours / colour scale gradient | partial | 6 tints per column | |
| 5.5 | Alternating colours | missing | | |
| 5.6 | Tables look | missing | | |
| 5.7 | Filter look (outline, tinted headers, funnel icons) | missing | | |
| 5.8 | Filter view bar | missing | | |
| 5.9 | Frozen panes thick divider + drag; merge-conflict dialog | partial | no merge-conflict check | |
| 5.10 | Hidden rows/columns arrows | have | | |
| 5.11 | Row/column groups gutter [–]/[+] | missing | | |
| 5.12 | Merged cells, bottom-aligned | have | | |
| 5.13 | Note marker (black triangle) | missing | | |
| 5.14 | Comment marker | have | amber triangle | |
| 5.15 | Invalid-data red triangle | have | | |
| 5.16 | Text overflow into empty neighbours | missing | truncated | |
| 5.17 | Wrap with auto row height | partial | wraps, row height fixed | |
| 5.18 | Clip | partial | (= no wrap) | |
| 5.19 | Rotation with auto row height | missing | | |
| 5.20 | Borders (styles + colours) | partial | thin, foreground colour | |
| 5.21 | Text colour / fill (any colour) | partial | 10 named colours | |
| 5.22 | Number formats render | partial | | |
| 5.23 | URL auto-link | partial | link cells via Insert link only | |
| 5.24 | Chart object / slicer floating over grid | missing | | |
| **Appendix A** | Keyboard shortcuts (per entry, see dialog) | partial | ~25 of ~110 | |

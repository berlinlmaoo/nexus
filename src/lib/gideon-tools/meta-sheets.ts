/**
 * Metadata of GIDEON's spreadsheet, NEXUS-image and file tools (owner, 18 Oct 2026), same shape as EXTRA_TOOL_META
 * in meta.ts (merged there). Pure: no database.
 *
 *  - get_sheet / search_sheets / read_nexus_image / export_file: reads (export_file only writes a file into the
 *    person's own GIDEON chat, nothing in NEXUS changes).
 *  - edit_sheet_cells / create_sheet / save_file_to_vault: "always" — a card in every mode, applied through the
 *    person's own session on the Sheets / Vault endpoints (proposals route, `web`).
 */

type Meta = { write: boolean; approval?: "always" | "modes"; label: (arg: string) => string }

const L = (withArg: string, without: string) => (a: string) => (a ? withArg.replace("{a}", a) : without)

export const SHEET_TOOL_META: Record<string, Meta> = {
  search_sheets: { write: false, label: L("Searching spreadsheets for “{a}”", "Searching spreadsheets") },
  get_sheet: { write: false, label: L("Reading the spreadsheet {a}", "Reading a spreadsheet") },
  edit_sheet_cells: { write: true, approval: "always", label: L("Preparing edits to {a}", "Preparing spreadsheet edits") },
  create_sheet: { write: true, approval: "always", label: L("Preparing the spreadsheet {a}", "Preparing a spreadsheet") },
  read_nexus_image: { write: false, label: L("Looking at {a}", "Looking at an image") },
  export_file: { write: false, label: L("Making the file {a}", "Making a file") },
  save_file_to_vault: { write: true, approval: "always", label: L("Preparing to save {a} to Z Vault", "Preparing a Z Vault save") },
}

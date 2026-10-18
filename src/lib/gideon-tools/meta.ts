/**
 * GIDEON tools added in the 18 Oct 2026 package (owner-approved): inbox, chat, reminders, leave, bulk tasks,
 * pipeline, outlet / social numbers, legal drafts, vault, doc edits, forms, performance, announcements.
 *
 * Pure metadata (no database), so gideon-runs.ts, the tools route and the proposals route can all read it.
 * The implementations live next to this file (gideon-tools/index.ts).
 *
 * approval:
 *  - "always": a card in EVERY approval mode, "don't ask" included — anything outward-facing (a message others read,
 *    a share link, an announcement), anything on attendance (a leave request, approving someone's request) and
 *    anything done through the person's own web session (`web` apply, see the proposals route).
 *  - "modes": like create_task — direct in "don't ask", a card in "review" and "always ask".
 *
 * Every write of this package also needs `confirm: { proposalId }` echoed back on Apply. Released apps draw an
 * unknown proposal as plain rows and send no confirm, so they are told to open the latest app or the web and the
 * proposal stays waiting (the delete_task rule, 18 Oct 2026). Native spec: docs/internal/gideon-tools-native.md.
 */

export type ExtraApproval = "always" | "modes"

type Meta = {
  /** Changes something (goes through the proposal flow). */
  write: boolean
  approval?: ExtraApproval
  /** English step label (logs, Insights). The web has the same table, translated. */
  label: (arg: string) => string
}

const L = (withArg: string, without: string) => (a: string) => (a ? withArg.replace("{a}", a) : without)

export const EXTRA_TOOL_META: Record<string, Meta> = {
  // 1. What needs me now
  get_my_inbox: { write: false, label: L("Checking what needs you: {a}", "Checking what needs you") },
  // 2. Chat
  list_conversations: { write: false, label: L("Looking up chats: {a}", "Looking up your chats") },
  read_conversation: { write: false, label: L("Reading the chat {a}", "Reading a chat") },
  send_message: { write: true, approval: "always", label: L("Writing a message to {a}", "Writing a message") },
  // 3. Reminders
  list_reminders: { write: false, label: L("Checking your reminders", "Checking your reminders") },
  create_reminder: { write: true, approval: "modes", label: L("Setting a reminder: {a}", "Setting a reminder") },
  cancel_reminder: { write: true, approval: "modes", label: L("Cancelling the reminder {a}", "Cancelling a reminder") },
  // 4. Leave / permission
  get_leave_balance: { write: false, label: L("Checking leave balance", "Checking leave balance") },
  submit_leave_request: { write: true, approval: "always", label: L("Preparing a request: {a}", "Preparing a request") },
  decide_attendance_request: { write: true, approval: "always", label: L("Preparing a decision: {a}", "Preparing a decision") },
  // 5. Bulk task work
  bulk_update_tasks: { write: true, approval: "always", label: L("Preparing changes to {a}", "Preparing changes to several tasks") },
  add_subtasks: { write: true, approval: "always", label: L("Adding subtasks to {a}", "Adding subtasks") },
  // 6. Pipeline
  move_deal_stage: { write: true, approval: "always", label: L("Moving the deal {a}", "Moving a deal") },
  add_payment_term: { write: true, approval: "always", label: L("Adding a payment term to {a}", "Adding a payment term") },
  // 7. Outlet Sales / Social Media Report
  log_outlet_sales: { write: true, approval: "always", label: L("Entering sales for {a}", "Entering outlet sales") },
  log_social_media_day: { write: true, approval: "always", label: L("Entering social numbers for {a}", "Entering social media numbers") },
  // 8. Legal
  create_legal_draft: { write: true, approval: "always", label: L("Preparing a legal draft: {a}", "Preparing a legal draft") },
  // 10. Z Vault
  search_vault: { write: false, label: L("Searching Z Vault for “{a}”", "Searching Z Vault") },
  create_vault_share_link: { write: true, approval: "always", label: L("Preparing a share link for {a}", "Preparing a share link") },
  // 11. Edit a doc
  edit_doc: { write: true, approval: "always", label: L("Preparing an edit to {a}", "Preparing a doc edit") },
  // 12. Forms
  get_form_responses: { write: false, label: L("Reading responses of {a}", "Reading form responses") },
  // 13. Reports / leaderboard
  get_performance: { write: false, label: L("Reading performance: {a}", "Reading performance") },
  // 14. Announcement
  draft_announcement: { write: true, approval: "always", label: L("Drafting an announcement: {a}", "Drafting an announcement") },
  // Spreadsheets, pictures stored in NEXUS, files (A/B/C). export_file only puts a file into the person's own
  // GIDEON chat (nothing in NEXUS changes), so it is a read; saving it to Z Vault is a card.
  search_sheets: { write: false, label: L("Searching spreadsheets for “{a}”", "Searching spreadsheets") },
  get_sheet: { write: false, label: L("Reading the spreadsheet {a}", "Reading a spreadsheet") },
  edit_sheet_cells: { write: true, approval: "always", label: L("Preparing edits to {a}", "Preparing spreadsheet edits") },
  create_sheet: { write: true, approval: "always", label: L("Preparing the spreadsheet {a}", "Preparing a spreadsheet") },
  read_nexus_image: { write: false, label: L("Looking at {a}", "Looking at an image") },
  export_file: { write: false, label: L("Making the file {a}", "Making a file") },
  save_file_to_vault: { write: true, approval: "always", label: L("Preparing to save {a} to Z Vault", "Preparing a Z Vault save") },
}

export function isExtraAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXTRA_TOOL_META, action)
}

export const EXTRA_WRITE_ACTIONS: string[] = Object.entries(EXTRA_TOOL_META).filter(([, m]) => m.write).map(([k]) => k)

export function extraNeedsApproval(action: string, mode: "always_ask" | "review" | "dont_ask"): boolean {
  const m = EXTRA_TOOL_META[action]
  if (!m?.write) return false
  if (m.approval === "always") return true
  return mode !== "dont_ask"
}

export function extraStepLabel(action: string, arg?: string | null): string | null {
  const m = EXTRA_TOOL_META[action]
  return m ? m.label(arg ? arg.slice(0, 80) : "") : null
}

/**
 * Remote-config flag per group (app-config `flags.<name>`, lib/app-config.ts): off = the group's tools answer
 * "not available yet" and their cards cannot be applied. Lets a group ship dark and open without a release.
 */
export const EXTRA_TOOL_GROUP: Record<string, string> = {
  get_my_inbox: "gideonToolsInbox",
  list_conversations: "gideonToolsChat", read_conversation: "gideonToolsChat", send_message: "gideonToolsChat",
  list_reminders: "gideonToolsReminders", create_reminder: "gideonToolsReminders", cancel_reminder: "gideonToolsReminders",
  get_leave_balance: "gideonToolsLeave", submit_leave_request: "gideonToolsLeave", decide_attendance_request: "gideonToolsLeave",
  bulk_update_tasks: "gideonToolsBulkTasks", add_subtasks: "gideonToolsBulkTasks",
  move_deal_stage: "gideonToolsPipeline", add_payment_term: "gideonToolsPipeline",
  log_outlet_sales: "gideonToolsOutletSocial", log_social_media_day: "gideonToolsOutletSocial",
  create_legal_draft: "gideonToolsLegal",
  search_vault: "gideonToolsVault", create_vault_share_link: "gideonToolsVault",
  edit_doc: "gideonToolsDocEdit",
  get_form_responses: "gideonToolsForms",
  get_performance: "gideonToolsPerformance",
  draft_announcement: "gideonToolsAnnouncement",
  search_sheets: "gideonToolsSheets", get_sheet: "gideonToolsSheets", edit_sheet_cells: "gideonToolsSheets", create_sheet: "gideonToolsSheets",
  read_nexus_image: "gideonToolsImages",
  export_file: "gideonToolsFiles", save_file_to_vault: "gideonToolsFiles",
}
export const EXTRA_TOOL_FLAGS: string[] = [...new Set(Object.values(EXTRA_TOOL_GROUP))]

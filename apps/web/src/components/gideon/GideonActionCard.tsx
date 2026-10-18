import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlarmClock, AlarmClockOff, ArrowUpRight, CalendarCheck, CalendarX, Check, CheckCheck, FileText, KanbanSquare, Link2,
  FolderInput, ListChecks, Loader2, Megaphone, Sheet, MessageSquare, PencilLine, Receipt, Scale, Send, TrendingUp, type LucideIcon,
} from "lucide-react";
import { decideGideonProposal, type GideonProposal } from "@/lib/gideon";
import { useLang, type LangApi } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { PROPOSAL_APPLY, PROPOSAL_DISCARD, diffDayText } from "./GideonProposalParts";

/**
 * The card of every GIDEON write added on 18 Oct 2026 (send a message, a reminder, a leave request, approving a
 * request, bulk task changes, deals, outlet/social numbers, a legal draft, a share link, a doc edit, an announcement).
 * It shows exactly what will happen — the rows, and the long text in full (`extra.preview`: the message, the section,
 * the announcement) — and Apply sends the proposal id back (`confirm`), which the server requires for these: a
 * client without this card can never apply one from plain rows.
 */

type Kind = { icon: LucideIcon; title: (t: LangApi["t"]) => string; apply: (t: LangApi["t"]) => string; done: (t: LangApi["t"]) => string; danger?: boolean };

const KINDS: Record<string, Kind> = {
  send_message: { icon: MessageSquare, title: (t) => t("Send a message"), apply: (t) => t("Send"), done: (t) => t("Sent") },
  create_reminder: { icon: AlarmClock, title: (t) => t("Set a reminder"), apply: (t) => t("Set reminder"), done: (t) => t("Reminder set") },
  cancel_reminder: { icon: AlarmClockOff, title: (t) => t("Cancel a reminder"), apply: (t) => t("Cancel reminder"), done: (t) => t("Reminder cancelled"), danger: true },
  submit_leave_request: { icon: CalendarCheck, title: (t) => t("Submit a request"), apply: (t) => t("Submit"), done: (t) => t("Submitted") },
  decide_attendance_request: { icon: CheckCheck, title: (t) => t("Decide a request"), apply: (t) => t("Confirm"), done: (t) => t("Decided") },
  bulk_update_tasks: { icon: ListChecks, title: (t) => t("Change several tasks"), apply: (t) => t("Apply all"), done: (t) => t("Applied") },
  add_subtasks: { icon: ListChecks, title: (t) => t("Add subtasks"), apply: (t) => t("Add"), done: (t) => t("Added") },
  move_deal_stage: { icon: KanbanSquare, title: (t) => t("Move a deal"), apply: (t) => t("Move"), done: (t) => t("Moved") },
  add_payment_term: { icon: Receipt, title: (t) => t("Add a payment term"), apply: (t) => t("Add"), done: (t) => t("Added") },
  log_outlet_sales: { icon: TrendingUp, title: (t) => t("Enter outlet sales"), apply: (t) => t("Save"), done: (t) => t("Saved") },
  log_social_media_day: { icon: TrendingUp, title: (t) => t("Enter social media numbers"), apply: (t) => t("Save"), done: (t) => t("Saved") },
  create_legal_draft: { icon: Scale, title: (t) => t("Create a legal draft"), apply: (t) => t("Create draft"), done: (t) => t("Draft created") },
  create_vault_share_link: { icon: Link2, title: (t) => t("Create a share link"), apply: (t) => t("Create link"), done: (t) => t("Link created") },
  edit_sheet_cells: { icon: Sheet, title: (t) => t("Edit spreadsheet"), apply: (t) => t("Apply"), done: (t) => t("Applied") },
  create_sheet: { icon: Sheet, title: (t) => t("Create a spreadsheet"), apply: (t) => t("Create"), done: (t) => t("Created") },
  save_file_to_vault: { icon: FolderInput, title: (t) => t("Save to Z Vault"), apply: (t) => t("Save"), done: (t) => t("Saved") },
  edit_doc: { icon: PencilLine, title: (t) => t("Edit a doc"), apply: (t) => t("Apply edit"), done: (t) => t("Edited") },
  draft_announcement: { icon: Megaphone, title: (t) => t("Post an announcement"), apply: (t) => t("Post"), done: (t) => t("Posted") },
};
const FALLBACK: Kind = { icon: FileText, title: (t) => t("Make a change"), apply: (t) => t("Apply"), done: (t) => t("Applied") };

/** Row labels the server writes in English (the released apps show them as they are). */
const FIELD: Record<string, string> = {
  To: "To", Chat: "Chat", Message: "Message", When: "When", Reminder: "Reminder", Type: "Type", Dates: "Dates", Days: "Days",
  Reason: "Reason", Balance: "Balance", Person: "Person", Decision: "Decision", Note: "Note", Tasks: "Tasks", Change: "Change",
  Deal: "Deal", Stage: "Stage", Amount: "Amount", Due: "Due", Project: "Project", Date: "Date", Sales: "Sales", Pax: "Pax",
  Views: "Views", Likes: "Likes", Comments: "Comments", Shares: "Shares", Template: "Template", Company: "Company", Number: "Number",
  File: "File", Expires: "Expires", Access: "Access", Doc: "Doc", Section: "Section", Edit: "Edit", Title: "Title", Audience: "Audience",
  Until: "Until", Task: "Task", Subtasks: "Subtasks", Platform: "Platform", Label: "Label", Fields: "Fields", Password: "Password",
  Counterparty: "Counterparty", Location: "Location", Download: "Download", Tone: "Tone", Repeats: "Repeats", Announcement: "Announcement",
  Folder: "Folder", Status: "Status", Probability: "Probability", Term: "Term", Invoice: "Invoice", Paid: "Paid",
  "Contract value": "Contract value", Event: "Event", "What worked": "What worked", "What didn't": "What didn't", Posts: "Posts",
};
/** Values the server writes in English that read as a whole word or phrase. */
const VALUE_WORDS = new Set([
  "Direct message", "New direct message", "Group", "Project room", "Approve", "Reject", "Annual leave", "Day off", "Sick", "Permission (izin)",
  "Public holiday", "Add a section", "Anyone with the link", "No expiry", "Replace section", "Append to the end", "Append under section", "Everyone",
  "Attached — open the request to see it",
  "Draft", "NEXUS members (login required)", "3 days", "7 days", "14 days", "30 days", "Allowed", "View only", "Info", "Good news", "Important",
]);

export function GideonActionCard({ proposal, onDecided }: { proposal: GideonProposal; onDecided: (p: GideonProposal) => void }) {
  const { t, locale } = useLang();
  const kind = KINDS[proposal.action] ?? FALLBACK;
  const Icon = kind.icon;
  const open = proposal.status === "PENDING";
  const applied = proposal.status === "APPLIED";
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = proposal.extra?.preview ?? null;
  const link = proposal.extra?.link ?? null;

  const decide = async (decision: "apply" | "discard") => {
    if (pending) return;
    setPending(decision);
    setError(null);
    try {
      onDecided(await decideGideonProposal(proposal.id, decision, undefined, decision === "apply" ? { confirm: { proposalId: proposal.id } } : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't do that."));
    } finally {
      setPending(null);
    }
  };

  // The long text has its own block; its row would only repeat it.
  const previewField = preview ? proposal.diff.find((r) => r.to === preview)?.field : undefined;
  const rows = proposal.diff.filter((r) => r.field !== previewField);
  const statusLine =
    applied ? kind.done(t) :
    proposal.status === "DISCARDED" ? t("Discarded") :
    proposal.status === "FAILED" ? t("Couldn't apply: {reason}", { reason: proposal.error ?? "" }) :
    proposal.status === "APPLYING" ? t("Applying…") : null;

  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-card", open ? (kind.danger ? "border-destructive/40 shadow-soft" : "border-border shadow-soft") : "border-border opacity-90")}>
      <div className="flex items-start gap-2.5 px-3 pb-2 pt-2.5">
        <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border", open ? (kind.danger ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-sidebar-primary/25 bg-sidebar-primary/10 text-sidebar-primary") : "border-border bg-background text-muted-foreground")}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{kind.title(t)}</span>
          <span className="mt-0.5 block break-words text-[13px] text-muted-foreground">{proposal.summary}</span>
        </span>
        {open && <span className="mt-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />{t("Waiting for your approval")}</span>}
      </div>
      {rows.length > 0 && (
        <dl className="space-y-1 px-3 pb-2.5 text-[13px]">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[6.5rem_1fr] gap-2 rounded-md bg-muted/40 px-2 py-1 max-[380px]:grid-cols-[5.25rem_1fr]">
              <dt className="text-muted-foreground">{t(FIELD[row.field] ?? row.field)}</dt>
              <dd className="min-w-0 whitespace-pre-line break-words">
                {row.from != null && row.from !== "" && <><span className="rounded-sm bg-red-500/10 px-0.5 text-red-700 line-through decoration-red-700/50 dark:text-red-400">{word(diffDayText(row.from, row.fromDay, locale), t)}</span> <span aria-hidden className="text-muted-foreground">→</span> </>}
                <span className={cn(row.from != null && row.from !== "" && "rounded-sm bg-emerald-500/10 px-0.5 font-medium text-emerald-800 dark:text-emerald-300")}>{word(diffDayText(row.to, row.toDay, locale), t) ?? "—"}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {proposal.extra?.sheetEdit?.cells && proposal.extra.sheetEdit.cells.length > 0 && (
        <div className="px-3 pb-2.5">
          <div className="max-h-64 overflow-auto rounded-lg border border-border/70">
            <table className="w-full text-left text-[12.5px]">
              <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur">
                <tr><th className="px-2 py-1 font-medium">{t("Cell")}</th><th className="px-2 py-1 font-medium">{t("Before")}</th><th className="px-2 py-1 font-medium">{t("After")}</th></tr>
              </thead>
              <tbody>
                {proposal.extra.sheetEdit.cells.map((c, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-2 py-1 font-mono text-muted-foreground">{c.ref}</td>
                    <td className="max-w-[10rem] break-words px-2 py-1">{c.from ? <span className="rounded-sm bg-red-500/10 px-0.5 text-red-700 line-through decoration-red-700/50 dark:text-red-400">{c.from}</span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-[10rem] break-words px-2 py-1">{c.to ? <span className="rounded-sm bg-emerald-500/10 px-0.5 font-medium text-emerald-800 dark:text-emerald-300">{c.to}</span> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {preview && (
        <div className="px-3 pb-2.5">
          {previewField && <div className="mb-1 text-xs font-medium text-muted-foreground">{t(FIELD[previewField] ?? previewField)}</div>}
          <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-background px-3 py-2 text-[13px] leading-relaxed">{preview}</div>
        </div>
      )}
      {open && <div className="px-3 pb-2 text-[11px] text-muted-foreground">{t("Nothing happens until you tap {action}. Times are WIB.", { action: kind.apply(t) })}</div>}
      {statusLine && (
        <div className={cn("flex items-center gap-2 px-3 py-2 text-xs font-medium", proposal.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>
          {applied && <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />}
          <span className="min-w-0 flex-1 break-words">{statusLine}</span>
          {applied && link && link.startsWith("/") && (
            <Link to={link} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-sidebar-primary hover:bg-accent">
              {t("Open")} <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </div>
      )}
      {applied && proposal.extra?.note && <div className="select-all break-all px-3 pb-2 text-xs text-muted-foreground">{proposal.extra.note}</div>}
      {error && <div className="px-3 pb-2 text-xs font-medium text-destructive">{error}</div>}
      {open && (
        <div className="flex justify-end gap-1.5 border-t border-border/60 px-2.5 py-2">
          <button type="button" onClick={() => void decide("discard")} disabled={!!pending} className={PROPOSAL_DISCARD}>
            {pending === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Discard")}
          </button>
          <button type="button" onClick={() => void decide("apply")} disabled={!!pending} className={cn(PROPOSAL_APPLY, kind.danger && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}>
            {pending === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : proposal.action === "send_message" ? <Send className="h-3.5 w-3.5" /> : kind.danger ? <CalendarX className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />} {kind.apply(t)}
          </button>
        </div>
      )}
    </div>
  );
}

/** Server values with numbers in them (English on the wire; the released apps show them as they are). */
const VALUE_PATTERNS: { re: RegExp; en: string }[] = [
  { re: /^(\d+) calendar days$/, en: "{a} calendar days" },
  { re: /^(\d+) of (\d+) days off left → (-?\d+) after this$/, en: "{a} of {b} days off left → {c} after this" },
  { re: /^(\d+) of (\d+) leave days left → (-?\d+) after this$/, en: "{a} of {b} leave days left → {c} after this" },
];

function word(text: string | null, t: LangApi["t"]): string | null {
  if (!text) return text;
  if (VALUE_WORDS.has(text)) return t(text);
  for (const p of VALUE_PATTERNS) {
    const m = p.re.exec(text);
    if (m) return t(p.en, { a: m[1], b: m[2] ?? "", c: m[3] ?? "" });
  }
  return text;
}

/** The step labels of these tools (the server's English table is lib/gideon-tools/meta.ts). */
export function extraStepLabel(tool: string, a: string, t: LangApi["t"]): string | null {
  switch (tool) {
    case "get_my_inbox": return t("Checking what needs you");
    case "list_conversations": return t("Looking up your chats");
    case "read_conversation": return a ? t("Reading the chat {name}", { name: a }) : t("Reading a chat");
    case "send_message": return a ? t("Writing a message to {name}", { name: a }) : t("Writing a message");
    case "list_reminders": return t("Checking your reminders");
    case "create_reminder": return a ? t("Setting a reminder: {name}", { name: a }) : t("Setting a reminder");
    case "cancel_reminder": return a ? t("Cancelling the reminder {name}", { name: a }) : t("Cancelling a reminder");
    case "get_leave_balance": return t("Checking leave balance");
    case "submit_leave_request": return a ? t("Preparing a request: {name}", { name: a }) : t("Preparing a request");
    case "decide_attendance_request": return a ? t("Preparing a decision: {name}", { name: a }) : t("Preparing a decision");
    case "bulk_update_tasks": return t("Preparing changes to several tasks");
    case "add_subtasks": return a ? t("Adding subtasks to {name}", { name: a }) : t("Adding subtasks");
    case "move_deal_stage": return a ? t("Moving the deal {name}", { name: a }) : t("Moving a deal");
    case "add_payment_term": return a ? t("Adding a payment term to {name}", { name: a }) : t("Adding a payment term");
    case "log_outlet_sales": return t("Entering outlet sales");
    case "log_social_media_day": return t("Entering social media numbers");
    case "create_legal_draft": return a ? t("Preparing a legal draft: {name}", { name: a }) : t("Preparing a legal draft");
    case "search_vault": return a ? t("Searching Z Vault for “{q}”", { q: a }) : t("Searching Z Vault");
    case "create_vault_share_link": return a ? t("Preparing a share link for {name}", { name: a }) : t("Preparing a share link");
    case "edit_doc": return a ? t("Preparing an edit to {name}", { name: a }) : t("Preparing a doc edit");
    case "get_form_responses": return a ? t("Reading responses of {name}", { name: a }) : t("Reading form responses");
    case "get_performance": return t("Reading performance");
    case "draft_announcement": return t("Drafting an announcement");
    case "search_sheets": return a ? t("Searching spreadsheets for “{q}”", { q: a }) : t("Searching spreadsheets");
    case "get_sheet": return a ? t("Reading the spreadsheet {name}", { name: a }) : t("Reading a spreadsheet");
    case "edit_sheet_cells": return a ? t("Preparing edits to {name}", { name: a }) : t("Preparing spreadsheet edits");
    case "create_sheet": return a ? t("Preparing the spreadsheet {name}", { name: a }) : t("Preparing a spreadsheet");
    case "read_nexus_image": return a ? t("Looking at {name}", { name: a }) : t("Looking at an image");
    case "export_file": return a ? t("Making the file {name}", { name: a }) : t("Making a file");
    case "save_file_to_vault": return a ? t("Preparing to save {name} to Z Vault", { name: a }) : t("Preparing a Z Vault save");
    default: return null;
  }
}

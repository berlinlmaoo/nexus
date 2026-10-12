// Words the server sends ready-made, in one language, turned into the UI language here (audit 12 Oct
// 2026). The server keeps sending what it sends (the released iPhone/Android apps read the same fields);
// the web recognises the shapes it knows and translates them, and anything it does not recognise (text a
// person typed, a new server string) is shown exactly as it came.
//
// Called at render time by components that use useLang(), so `t` follows the current language.
import { localeOf, t } from "@/lib/lang";

// Dates -------------------------------------------------------------------------------------------------

/** "14 Sep" from "2026-09-14": a calendar day, never shifted by the browser's zone. */
function dayText(key: string, withYear = false) {
  const d = new Date(`${key.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(localeOf(), { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** An attendance period "28 Sep – 27 Oct 2026" from its first and last day keys, in the UI language. */
export function periodRangeText(from: string, to: string) {
  return `${dayText(from)} – ${dayText(to, true)}`;
}

/** The last day of attendance period "YYYY-MM" (the 27th): "27 Sep 2026". */
export function periodEndText(periodKey: string) {
  return /^\d{4}-\d{2}$/.test(periodKey) ? dayText(`${periodKey}-27`, true) : periodKey;
}

// XP and attendance deductions ----------------------------------------------------------------------------

/** "45 min" / "120+ min" (the server's late detail) → the UI language. */
function minutesText(detail: string | null | undefined) {
  const m = /^(\d+\+?) min$/.exec((detail ?? "").trim());
  return m ? t("{n} min", { n: m[1] }) : null;
}

/**
 * One XP ledger row of the member record (GET /api/members/:id/record), from its `kind` (lib/xp-reason.ts
 * on the server). `label` is the server's English, used for kinds this table does not know; `detail` is
 * free text (an adjustment note, a bonus period) and stays as written.
 */
export function xpEntryLabel(e: { kind?: string | null; label: string; detail?: string | null }) {
  const withDetail = (key: string) => (e.detail ? `${t(key)} · ${e.detail}` : t(key));
  switch (e.kind) {
    case "late": {
      const min = minutesText(e.detail);
      return min ? `${t("Late check-in")} · ${min}` : t("Late check-in");
    }
    case "nocheckout": return t("No check-out");
    case "alpha": return t("Absent without notice");
    case "waiver": return t("Penalty cleared for the day");
    case "peer_bounty": return t("Integrity report · reward");
    case "peer_penalty": return t("Integrity report · penalty");
    case "admin_adjust": return withDetail("Adjusted by the BoD");
    case "quest_penalty": return t("Goal penalty");
    case "quest": return t("Goal done");
    case "bonus": return e.label.startsWith("No-absence bonus") ? withDetail("No-absence bonus") : withDetail("Bonus");
    case "task_done": return t("Task done");
    case "priority_bonus": return t("Priority task bonus");
    case "goal_milestone": return t("Goal milestone");
    case "streak": return t("Daily streak");
    default: return e.label === "Attendance" || e.label === "XP change" ? t(e.label) : e.label;
  }
}

/** A row of GET /api/attendance/deductions: its `label` is fixed Indonesian per `kind`. */
export function deductionLabel(e: { kind: string; label: string }) {
  switch (e.kind) {
    case "XP_LATE": return t("Late check-in");
    case "XP_NOCHECKOUT": return t("Missed check-out");
    case "XP_ALPHA": return t("Absent without notice");
    case "DAYOFF_AUTO": return t("Day off cut automatically");
    default: return e.label;
  }
}

/**
 * The reason the nightly job writes on a day off it takes (lib/attendance-absence.ts, Indonesian):
 * "Auto: telat >120 menit pada 2026-10-03 (potong jatah day-off)". Anything else is a person's own words.
 */
export function attendanceReasonText(reason: string | null | undefined) {
  const r = (reason ?? "").trim();
  let m = /^Auto: telat >120 menit pada (\d{4}-\d{2}-\d{2}) \(potong jatah day-off\)$/.exec(r);
  if (m) return t("Automatic: more than 120 min late on {date} (taken from the day-off allowance)", { date: dayText(m[1], true) });
  m = /^Auto: tidak check-in\/out pada (\d{4}-\d{2}-\d{2}) \(potong jatah day-off\)$/.exec(r);
  if (m) return t("Automatic: no check-in or check-out on {date} (taken from the day-off allowance)", { date: dayText(m[1], true) });
  if (r === "Auto: telat >120 menit") return t("Automatic: more than 120 min late");
  return reason ?? "";
}

// Notifications -------------------------------------------------------------------------------------------

/** A title for a notification that has none, from its type. Unknown types: the type in plain words. */
const TYPE_TITLE: Record<string, string> = {
  task_assigned: "Task assigned",
  task_completed: "Task completed",
  comment_added: "New comment",
  comment_mention: "You were mentioned",
  doc_mention: "You were mentioned",
  feed_mention: "Mentioned on Threads",
  feed_post: "New post on Threads",
  feed_like: "New like on Threads",
  feed_comment: "New comment on Threads",
  project_invite: "Project invitation",
  status_update: "Status Update",
  submission_status: "Submission update",
  streak_at_risk: "Your streak ends at midnight",
  quest_claimable: "Quest ready to claim",
  block_reminder: "Reminder",
  booking_soon: "Room booking soon",
  booking_confirmed: "Room booked",
  booking_changed: "Room booking changed",
  room_booking: "Room booking",
  announcement: "Announcement",
  complaint_reply: "Ticket reply",
  complaint_status: "Ticket status changed",
  complaint_filed: "New ticket",
  dayoff_quota_low: "Day off running low",
  red_date_quota_low: "Public holidays running low",
  dayoff_bonus_granted: "Extra day off",
  xp_deduction_removed: "XP deduction removed",
  attendance_request_escalated: "Attendance request waiting",
  attendance_office: "Attendance",
  offsite_checkout_pending: "Check-out outside the office",
  calendar_event: "Calendar event",
  pipeline_deal: "Pipeline deal",
  automation: "Automation",
  members_added: "Members added",
  member_removed: "Member removed",
  member_left: "Member left",
  group_created: "Group created",
  group_renamed: "Group renamed",
  test_notification: "Test notification",
};

export function notificationTypeTitle(type: string | null | undefined) {
  const key = (type || "notification").toLowerCase();
  if (TYPE_TITLE[key]) return t(TYPE_TITLE[key]);
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Rule = { re: RegExp; key: string; vars: (m: RegExpExecArray) => Record<string, string> };
const untitled = (s: string) => (s === "Untitled" ? t("Untitled") : s);

// English titles and messages written by lib/notification-service.ts (and a few routes).
const TITLE_RULES: Rule[] = [
  { re: /^(.+?) assigned you: ([\s\S]*)$/, key: "{name} assigned you: {task}", vars: (m) => ({ name: m[1], task: m[2] }) },
  { re: /^(.+?) mentioned you on: ([\s\S]*)$/, key: "{name} mentioned you on: {task}", vars: (m) => ({ name: m[1], task: m[2] }) },
  { re: /^(.+?) mentioned you in: ([\s\S]*)$/, key: "{name} mentioned you in: {doc}", vars: (m) => ({ name: m[1], doc: untitled(m[2]) }) },
  { re: /^(.+?) completed: ([\s\S]*)$/, key: "{name} completed: {task}", vars: (m) => ({ name: m[1], task: m[2] }) },
  { re: /^(.+?) commented on: ([\s\S]*)$/, key: "{name} commented on: {task}", vars: (m) => ({ name: m[1], task: m[2] }) },
  { re: /^Reminder: ([\s\S]*)$/, key: "Reminder: {title}", vars: (m) => ({ title: untitled(m[1]) }) },
  { re: /^(.+?) posted on Threads$/, key: "{name} posted on Threads", vars: (m) => ({ name: m[1] }) },
  { re: /^(.+?) invited you to ([\s\S]+)$/, key: "{name} invited you to {project}", vars: (m) => ({ name: m[1], project: m[2] }) },
  { re: /^(\d+) day-off day left$/, key: "{n} day-off day left", vars: (m) => ({ n: m[1] }) },
  { re: /^(\d+) public-holiday day left$/, key: "{n} public-holiday day left", vars: (m) => ({ n: m[1] }) },
  { re: /^(.+?) in (\d+) min$/, key: "{room} in {n} min", vars: (m) => ({ room: m[1], n: m[2] }) },
];

const MESSAGE_RULES: Rule[] = [
  { re: /^In ([\s\S]+)$/, key: "In {project}", vars: (m) => ({ project: m[1] }) },
  { re: /^(.+?) assigned you "([\s\S]*)"$/, key: "{name} assigned you \"{task}\"", vars: (m) => ({ name: m[1], task: m[2] }) },
  { re: /^(.+?) completed "([\s\S]*)"$/, key: "{name} completed \"{task}\"", vars: (m) => ({ name: m[1], task: m[2] }) },
  { re: /^(.+?) mentioned you on "([\s\S]*)"$/, key: "{name} mentioned you on \"{task}\"", vars: (m) => ({ name: m[1], task: m[2] }) },
  { re: /^(.+?) mentioned you in "([\s\S]*)"$/, key: "{name} mentioned you in \"{doc}\"", vars: (m) => ({ name: m[1], doc: untitled(m[2]) }) },
  { re: /^(.+?) commented on "([\s\S]*)"$/, key: "{name} commented on \"{task}\"", vars: (m) => ({ name: m[1], task: m[2] }) },
  { re: /^(.+?) mentioned you in a post$/, key: "{name} mentioned you in a post", vars: (m) => ({ name: m[1] }) },
  { re: /^You're now a member of "([\s\S]+)"\.$/, key: "You're now a member of \"{project}\".", vars: (m) => ({ project: m[1] }) },
  { re: /^You're now an? (\w+) of "([\s\S]+)"\.$/, key: "You're now {role} of \"{project}\".", vars: (m) => ({ role: m[1], project: m[2] }) },
  { re: /^(.+?) updated "([\s\S]+)" status to ([\s\S]+)$/, key: "{name} updated \"{project}\" status to {status}", vars: (m) => ({ name: m[1], project: m[2], status: m[3] }) },
  { re: /^(.+?) moved "([\s\S]+)" from (.+) to (.+)$/, key: "{name} moved \"{subject}\" from {from} to {to}", vars: (m) => ({ name: m[1], subject: m[2], from: m[3], to: m[4] }) },
  { re: /^(\d+) days? on the line — finish something today to keep it\.$/, key: "{n} days on the line — finish something today to keep it.", vars: (m) => ({ n: m[1] }) },
  { re: /^You've used (\d+) of (\d+) this month\.$/, key: "You've used {used} of {quota} this month.", vars: (m) => ({ used: m[1], quota: m[2] }) },
  { re: /^"([\s\S]+)" is done — collect the XP before the week resets\.$/, key: "\"{title}\" is done — collect the XP before the week resets.", vars: (m) => ({ title: m[1] }) },
];

/** Whole titles/messages the server writes word for word. Other text (a person's words) is never looked up. */
const EXACT = new Set([
  "Mentioned on Threads", "Status Update", "Submission update", "Your streak ends at midnight", "Quest ready to claim",
  "Extra day off", "Attendance warning", "New post",
]);

function applyRules(text: string, rules: Rule[]) {
  for (const r of rules) {
    const m = r.re.exec(text);
    if (m) return t(r.key, r.vars(m));
  }
  return EXACT.has(text) ? t(text) : text;
}

/** A notification's title in the UI language: the stored title when it is a known shape, else the type. */
export function notificationTitle(n: { type?: string | null; title?: string | null }) {
  return n.title ? applyRules(n.title, TITLE_RULES) : notificationTypeTitle(n.type);
}

/** A notification's message in the UI language when it is a known shape; else as stored. */
export function notificationMessage(n: { message?: string | null }) {
  return n.message ? applyRules(n.message, MESSAGE_RULES) : "";
}

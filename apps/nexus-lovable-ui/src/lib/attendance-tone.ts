import type { NexusAttendanceHistory } from "@/lib/nexus-api";

/**
 * The crew board's day colours — shared by the Attendance board and the member record page
 * (/people/:userId), so one person's row there is painted exactly like their row on the board.
 * Moved here unchanged from routes/_app/attendance.tsx (28 Sep 2026).
 */
export type HistRow = NonNullable<NexusAttendanceHistory["rows"]>[number];

export function recTone(r: HistRow): "present" | "permit" | "wfh" | "leave" | "sick" | "dayoff" | "absent" | "none" {
  // Approved leave/sick/permit/day-off/red-date days are surfaced via attendanceDayType (the request
  // type), NOT `status` (which is "COMPLETED" on those synthetic rows) — check it FIRST.
  const dt = (r.attendanceDayType || "").toUpperCase();
  if (dt === "SICK_APPROVED") return "sick";
  if (dt === "DAY_OFF_APPROVED") return "dayoff"; // covers DAY_OFF + RED_DATE (tanggal merah)
  if (dt === "PERMIT_APPROVED") return "permit"; // a working day with the manager's blessing → green, like present
  if (dt === "LEAVE_APPROVED") return "leave";
  // The server's synthetic "no record on a workday" row: status INCOMPLETE, no check-in. It used to
  // fall through to "none" and draw the same grey as a weekend — so an absence looked like nothing.
  if (dt === "ABSENT") return "absent";
  const s = (r.status || "").toUpperCase();
  if (s.includes("REMOTE") || s.includes("WFH")) return "wfh";
  if (s.includes("LEAVE") || s.includes("SICK") || s.includes("PERMIT") || s.includes("OFF") || s.includes("IZIN") || s.includes("CUTI")) return "leave";
  if (r.checkInAt || s.includes("PRESENT") || s.includes("HADIR")) return "present";
  if (s.includes("ABSENT") || s.includes("ALPHA")) return "absent";
  return "none";
}

// BoD's palette (17 Sep 2026): absent red, present & permit green, sick orange, day off purple.
// Leave (cuti) stays yellow so it is not mistaken for a permit; WFH blue.
export const sCls: Record<string, string> = {
  present: "bg-emerald-400/70",
  permit: "bg-emerald-400/70",
  wfh: "bg-sky-400/60",
  leave: "bg-amber-300/80",
  sick: "bg-orange-400/80",
  dayoff: "bg-violet-400/70",
  absent: "bg-rose-500/75",
  none: "bg-muted/40",
};
export const toneLabel: Record<string, string> = {
  present: "Present", permit: "Permit (counted present)", wfh: "WFH", leave: "Leave", sick: "Sick", dayoff: "Day off / public holiday", absent: "Absent", none: "",
};

/** The server's day letter (GET /api/members/:id/record `days[].tone`, as in history?compact=1) → the
 *  board tone above: a late check-in is still green on the board. For when no history row is loaded. */
export function toneFromLetter(letter?: string | null): keyof typeof sCls {
  switch (letter) {
    case "P": case "L": return "present";
    case "I": return "permit";
    case "C": return "leave";
    case "S": return "sick";
    case "D": return "dayoff";
    case "A": return "absent";
    default: return "none";
  }
}

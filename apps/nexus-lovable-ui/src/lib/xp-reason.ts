// Map a raw XpTransaction.reason → human label (+ optional date/note suffix).
// Shared by the BoD audit log and the public per-user XP log so labels stay consistent.
// Late penalty is -min(lateMinutes,120) at 1 XP/min, so |amount| ≈ minutes (capped 120) when the
// exact `lateMinutes` isn't provided.
export function xpReasonInfo(reason: string, amount?: number, lateMinutes?: number | null): { label: string; sub?: string } {
  if (reason.startsWith("attendance:late:")) {
    let minLabel = "";
    if (typeof lateMinutes === "number" && lateMinutes > 0) {
      minLabel = ` ${lateMinutes} min`;
    } else if (amount != null && Math.abs(amount) > 0) {
      const m = Math.abs(amount);
      minLabel = ` ${m >= 120 ? "120+" : m} min`;
    }
    return { label: `Late check-in${minLabel}`, sub: reason.slice("attendance:late:".length) };
  }
  if (reason.startsWith("attendance:nocheckout:")) return { label: "Missed check-out", sub: reason.slice("attendance:nocheckout:".length) };
  if (reason.startsWith("attendance:alpha:")) return { label: "Absent / no notice", sub: reason.slice("attendance:alpha:".length) };
  if (reason.startsWith("bonus:zero-alpha:")) return { label: "No-absence bonus", sub: reason.slice("bonus:zero-alpha:".length) };
  if (reason.startsWith("admin:adjust:")) return { label: "Admin adjustment", sub: reason.slice("admin:adjust:".length) };
  if (reason === "admin:adjust") return { label: "Admin adjustment" };
  const map: Record<string, string> = {
    task_done: "Task done",
    quest: "Quest done",
    streak: "Daily streak",
    penalty: "Quest penalty",
    goal_milestone: "Goal milestone",
  };
  return { label: map[reason] ?? reason };
}

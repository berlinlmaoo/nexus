// Map a raw XpTransaction.reason → human label (+ optional date/note suffix).
// Shared by the BoD audit log and the public per-user XP log so labels stay consistent.
// Late penalty is -min(lateMinutes,120) at 1 XP/min, so |amount| ≈ minutes (capped 120) when the
// exact `lateMinutes` isn't provided.
// Called at render time by components that use useLang(), so `t` follows the current language.
import { t } from "@/lib/lang";

/**
 * The note of a BoD XP adjustment, in the UI language. The server stamps the actor into the stored reason in
 * Indonesian ("admin:adjust:<note> · oleh <Name>", or just "oleh <Name>"), and released apps show that text as is,
 * so the stored form stays; the web swaps the "oleh" (or an English "by") for the current language's word.
 */
export function adminAdjustNote(note: string): string {
  const m = /^(?:(.*?)\s+·\s+)?(?:oleh|by)\s+(.+)$/s.exec(note.trim());
  if (!m) return note.trim();
  const by = t("by {name}", { name: m[2].trim() });
  return m[1] ? `${m[1].trim()} · ${by}` : by;
}

export function xpReasonInfo(reason: string, amount?: number, lateMinutes?: number | null): { label: string; sub?: string } {
  if (reason.startsWith("attendance:late:")) {
    let minLabel = "";
    if (typeof lateMinutes === "number" && lateMinutes > 0) {
      minLabel = " " + t("{n} min", { n: lateMinutes });
    } else if (amount != null && Math.abs(amount) > 0) {
      const m = Math.abs(amount);
      minLabel = " " + t("{n} min", { n: m >= 120 ? "120+" : m });
    }
    return { label: `${t("Late check-in")}${minLabel}`, sub: reason.slice("attendance:late:".length) };
  }
  if (reason.startsWith("attendance:nocheckout:")) return { label: t("Missed check-out"), sub: reason.slice("attendance:nocheckout:".length) };
  if (reason.startsWith("attendance:alpha:")) return { label: t("Absent without notice"), sub: reason.slice("attendance:alpha:".length) };
  if (reason.startsWith("bonus:zero-alpha:")) return { label: t("No-absence bonus"), sub: reason.slice("bonus:zero-alpha:".length) };
  if (reason.startsWith("admin:adjust:")) return { label: t("Admin adjustment"), sub: adminAdjustNote(reason.slice("admin:adjust:".length)) };
  if (reason === "admin:adjust") return { label: t("Admin adjustment") };
  const map: Record<string, string> = {
    task_done: "Task done",
    quest: "Quest done",
    streak: "Daily streak",
    penalty: "Quest penalty",
    goal_milestone: "Goal milestone",
  };
  return { label: map[reason] ? t(map[reason]) : reason };
}

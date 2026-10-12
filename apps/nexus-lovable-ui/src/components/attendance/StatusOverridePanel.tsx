import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Scale } from "lucide-react";
import { celebrate } from "@/components/Celebration";
import { nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";

// Moved here unchanged from routes/_app/attendance.tsx (28 Sep 2026) so the member record page offers
// the same panel; it now also refreshes that page ("member-record") after a change.
// English source labels; translated where they are shown.
const OVERRIDE_LABEL: Record<string, string> = { PRESENT: "Present", PERMIT: "Permit", LEAVE: "Leave", SICK: "Sick", DAY_OFF: "Day off" };

/** BoD-only: rewrite one member-day's status (Hadir on-time / Cuti / Sakit / Day off) — XP penalties
 *  for that day are refunded + an auto-cut day-off restored — or just remove the punishment. */
export function StatusOverridePanel({ userId, name, dateKey, onDone }: { userId: string; name: string | null; dateKey: string; onDone: () => void }) {
  const qc = useQueryClient();
  const { t } = useLang();
  const label = (a: string) => (OVERRIDE_LABEL[a] ? t(OVERRIDE_LABEL[a]) : a);
  const override = useMutation({
    mutationFn: (action: "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "PERMIT" | "CLEAR_PENALTY") => nexusApi.attendanceOverride({ userId, date: dateKey, action }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["attendance-history"] });
      qc.invalidateQueries({ queryKey: ["attendance-requests"] });
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ queryKey: ["member-record"] });
      if (r.action === "CLEAR_PENALTY") {
        celebrate(r.refunded ? t("Penalty for {date} cleared. XP and day off restored.", { date: r.date }) : t("No penalty on {date}. This day stays safe from deductions.", { date: r.date }));
      } else {
        celebrate(`${name ?? "Staff"} · ${r.date} → ${label(r.action)}${r.refunded ? " " + t("(penalty restored)") : ""}`);
      }
      if ((r.multiDayRequestsLeft ?? 0) > 0) {
        alert(t("Note: this date is still covered by {n} multi-day request(s) (leave or permit over several days). If this day should show as Present, change that request in the Requests section.", { n: r.multiDayRequestsLeft ?? 0 }));
      }
      onDone();
    },
    onError: (e) => alert(e instanceof Error ? e.message : t("Couldn’t change the status.")),
  });
  const ask = (action: "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "PERMIT" | "CLEAR_PENALTY") => {
    const what = action === "CLEAR_PENALTY"
      ? t("Clear the penalty for {date} for {name}?\n\nDeducted XP (late, forgot to check out, no-show) is refunded and any day off taken automatically is restored. The attendance status does NOT change.", { date: dateKey, name: name ?? t("this staff member") })
      : t("Change {date} ({name}) to {status}?\n\nThat day’s automatic XP and day-off deductions are restored too.", { date: dateKey, name: name ?? t("this staff member"), status: label(action) });
    if (window.confirm(what)) override.mutate(action);
  };
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary"><Pencil className="h-3.5 w-3.5" /> {t("Change status (BoD)")}</div>
      <div className="flex flex-wrap gap-1.5">
        {(["PRESENT", "PERMIT", "LEAVE", "SICK", "DAY_OFF"] as const).map((a) => (
          <button key={a} disabled={override.isPending} onClick={() => ask(a)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold transition hover:border-primary hover:text-primary disabled:opacity-50">
            {label(a)}
          </button>
        ))}
      </div>
      <button disabled={override.isPending} onClick={() => ask("CLEAR_PENALTY")} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50">
        {override.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />} {t("Clear penalty (restore XP and day off)")}
      </button>
      <p className="mt-1.5 text-[10px] text-muted-foreground">{t("Every action restores that day’s XP and day-off deductions automatically, and is recorded in the audit log.")}</p>
    </div>
  );
}

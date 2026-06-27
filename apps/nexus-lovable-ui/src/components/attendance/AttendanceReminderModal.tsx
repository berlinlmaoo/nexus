import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Clock, X } from "lucide-react";
import { fmtDate, fmtTime, nexusApi } from "@/lib/nexus-api";

/**
 * Daily check-in reminder. Shown while the user hasn't checked in today (and has no approved leave),
 * but ONLY from a lead window before their configured shift start — so it doesn't nag hours early.
 * It then stays until they check in. A forgotten previous-day check-out always shows (must resolve).
 *
 * The CTA NAVIGATES to the attendance page rather than checking in inline. The page has the robust GPS
 * fix (high-accuracy retries) + the offsite / outside-radius fallback flow, so staff who are slightly
 * off the geofence can still complete attendance there. The old inline check-in used a single naive
 * `getCurrentPosition`, so it routinely hard-failed with "di luar radius office" even when the same
 * person could check in fine from the attendance page.
 */
const REMINDER_LEAD_MINUTES = 60; // pop-up mulai muncul 1 jam sebelum jam shift
const ATTENDANCE_TZ = "Asia/Jakarta";

function parseHHMM(value?: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/** Current minutes-since-midnight in the attendance timezone (so it matches the shift clock). */
function nowMinutesInZone(timeZone = ATTENDANCE_TZ): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

export function AttendanceReminderModal() {
  const navigate = useNavigate();
  const today = useQuery({ queryKey: ["attendance-today"], queryFn: nexusApi.attendanceToday, retry: 1, staleTime: 60_000 });
  // BoD ke atas (BoD / One Above All) nggak wajib absen → jangan munculin reminder ini.
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 300_000 });
  const exemptFromAttendance = wsm.data?.role === "BOD" || wsm.data?.role === "ONE_ABOVE_ALL";
  const [dismissed, setDismissed] = useState(false);

  const data = today.data;
  const checkedIn = Boolean(data?.today?.checkInAt);
  const hasApprovedLeave = Boolean(data?.todayRequest);
  const pending = data?.pendingCheckout ?? null;
  const forcedCheckout = Boolean(pending);
  const isCheckout = forcedCheckout;

  // Re-tick every 30s so the reminder appears exactly when its lead window opens, even if the app was
  // already open before then. Only runs while a reminder is actually pending (cheap, self-stopping).
  const [, setTick] = useState(0);
  const reminderEligible = !checkedIn && !hasApprovedLeave && !dismissed && !exemptFromAttendance && !!data;
  useEffect(() => {
    if (!reminderEligible) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [reminderEligible]);

  // Only nag from REMINDER_LEAD_MINUTES before the configured shift start (in the attendance TZ), then
  // keep showing until check-in. No shift set → no time gate. A forgotten checkout ignores the window.
  const shiftStartMin = parseHHMM(data?.myShift?.startTime);
  const withinReminderWindow = shiftStartMin === null ? true : nowMinutesInZone() >= shiftStartMin - REMINDER_LEAD_MINUTES;
  const shouldShow = !today.isLoading && !today.isError && !!data && !checkedIn && !hasApprovedLeave && !dismissed && !wsm.isLoading && !exemptFromAttendance && (forcedCheckout || withinReminderWindow);

  // lock scroll while open
  useEffect(() => {
    if (!shouldShow) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [shouldShow]);

  // Reminder is just a nudge → send the user to the attendance page (robust GPS + offsite fallback live there).
  const goToAttendance = () => { setDismissed(true); navigate({ to: "/attendance" }); };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {shouldShow && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDismissed(true)} />
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-pop"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border bg-gradient-to-br from-accent via-card to-secondary px-5 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Attendance</p>
                <h2 className="mt-0.5 font-display text-xl font-bold tracking-tight">{isCheckout ? "Wrap up yesterday's attendance" : "You haven't checked in today"}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{isCheckout ? `You forgot to check out ${pending?.attendanceDate ? fmtDate(pending.attendanceDate) : "yesterday"}.` : "Time to clock in — open the attendance page for selfie + GPS."}</p>
              </div>
              <button onClick={() => setDismissed(true)} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-3 p-5">
              {isCheckout && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-100 p-3 text-sm font-semibold text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>You need to check out first before you can check in today.</span>
                </div>
              )}

              <button
                onClick={goToAttendance}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99]"
              >
                {isCheckout ? "Check out yesterday" : "Check in now"} <ArrowRight className="h-4 w-4" />
              </button>
              <p className="text-center text-[11px] text-muted-foreground">We'll send you to the attendance page — even if you're outside the office radius, you can use the offsite option there.</p>
              <button onClick={() => setDismissed(true)} className="block w-full text-center text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">Later</button>

              {data?.today?.checkOutAt && <p className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Out {fmtTime(data.today.checkOutAt)}</p>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

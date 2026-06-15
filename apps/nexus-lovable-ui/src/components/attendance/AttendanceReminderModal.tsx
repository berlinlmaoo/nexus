import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, Clock, Loader2, X } from "lucide-react";
import { fmtDate, fmtTime, nexusApi, type AttendanceActionPayload } from "@/lib/nexus-api";
import { celebrate } from "@/components/Celebration";
import { SelfieCapture, type SelfieCaptureHandle } from "@/components/attendance/SelfieCapture";

/**
 * Daily check-in reminder. Shown while the user hasn't checked in today (and has no approved leave),
 * but ONLY from a lead window before their configured shift start — so it doesn't nag hours early.
 * It then stays until they check in. A forgotten previous-day check-out always shows (must resolve).
 * Lets the user check in (selfie + GPS) right from the popup.
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
  const qc = useQueryClient();
  const today = useQuery({ queryKey: ["attendance-today"], queryFn: nexusApi.attendanceToday, retry: 1, staleTime: 60_000 });
  // BoD ke atas (BoD / One Above All) nggak wajib absen → jangan munculin reminder ini.
  const wsm = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 300_000 });
  const exemptFromAttendance = wsm.data?.role === "BOD" || wsm.data?.role === "ONE_ABOVE_ALL";
  const [dismissed, setDismissed] = useState(false);

  const [selfie, setSelfie] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const selfieRef = useRef<SelfieCaptureHandle>(null);

  const data = today.data;
  const checkedIn = Boolean(data?.today?.checkInAt);
  const hasApprovedLeave = Boolean(data?.todayRequest);
  const pending = data?.pendingCheckout ?? null;
  const forcedCheckout = Boolean(pending);

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

  const pick = (f: File | null) => { setMessage(""); setSelfie(f); };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["attendance-today"] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("attendance-history") });
    qc.invalidateQueries({ queryKey: ["my-penalties"] });
  };
  const checkIn = useMutation({ mutationFn: (p: AttendanceActionPayload) => nexusApi.attendanceCheckIn(p), onSuccess: () => { refresh(); pick(null); celebrate("Checked in. Gaskeun hari ini ☕✨"); } });
  const checkOut = useMutation({ mutationFn: (p: AttendanceActionPayload) => nexusApi.attendanceCheckOut(p), onSuccess: () => { refresh(); pick(null); celebrate("Absen kemarin ditutup ✅"); } });
  const busy = checkIn.isPending || checkOut.isPending || locating;
  const isCheckout = Boolean(pending);

  // lock scroll while open
  useEffect(() => {
    if (!shouldShow) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [shouldShow]);

  // Called right after the selfie is captured → auto-grab GPS → check in/out.
  function submitWith(file: File) {
    setMessage("");
    if (!navigator.geolocation) { setMessage("Browser ini nggak support GPS."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const payload = { lat: pos.coords.latitude, lng: pos.coords.longitude, selfie: file } as AttendanceActionPayload;
        if (isCheckout) checkOut.mutate(payload); else checkIn.mutate(payload);
      },
      () => { setLocating(false); setMessage("Lokasi ditolak/timeout — izinkan akses lokasi buat geofence."); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {shouldShow && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            role="dialog" aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-pop"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border bg-gradient-to-br from-accent via-card to-secondary px-5 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Attendance</p>
                <h2 className="mt-0.5 font-display text-xl font-bold tracking-tight">{isCheckout ? "Selesaikan absen kemarin" : "Belum absen hari ini"}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{isCheckout ? `Kamu lupa check-out ${pending?.attendanceDate ? fmtDate(pending.attendanceDate) : "kemarin"}.` : "Selfie + GPS, geofence-verified."}</p>
              </div>
              <button onClick={() => setDismissed(true)} aria-label="Tutup" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-3 p-5">
              {isCheckout && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-100 p-3 text-sm font-semibold text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Wajib check-out dulu sebelum bisa check-in hari ini.</span>
                </div>
              )}

              <button
                disabled={busy}
                onClick={() => { setMessage(""); selfieRef.current?.open(); }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {locating ? "Ambil lokasi…" : "Memproses…"}</> : <><Camera className="h-4 w-4" /> {isCheckout ? "Check out kemarin" : "Check in sekarang"}</>}
              </button>
              <p className="text-center text-[11px] text-muted-foreground">Kamera & lokasi diminta otomatis pas ditekan.</p>
              <button onClick={() => setDismissed(true)} className="block w-full text-center text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">Nanti aja</button>

              {(message || checkIn.isError || checkOut.isError) && <p className="text-sm font-semibold text-destructive">{message || "Gagal — cek izin kamera/lokasi atau kamu di luar radius office."}</p>}
              {data?.today?.checkOutAt && <p className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Out {fmtTime(data.today.checkOutAt)}</p>}

              {/* hidden capture driver: opens camera on button click, auto check-in after photo */}
              <SelfieCapture ref={selfieRef} renderTile={false} file={selfie} onChange={pick} onCapture={submitWith} disabled={busy} />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

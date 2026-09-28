import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowLeftToLine, ArrowRightToLine, CalendarCheck, Hourglass, Loader2, Lock, RotateCcw } from "lucide-react";
import type { NexusOffice } from "@/lib/nexus-api";
import type { GeoFix } from "@/lib/geo";
import { cn } from "@/lib/utils";

/**
 * The one attendance button (owner request, 28 Sep 2026). It replaces PRESENCE IN / PRESENCE OUT side
 * by side and follows the day: green "Check in" → "Check out" locked until the daily reflection is
 * long enough → red "Check out" → a calm done state. While a press runs, every stage is drawn IN the
 * button — face check, where the phone is, sending, the result — so nobody is left wondering whether
 * it worked. It only draws; what is submitted is decided (and unchanged) by the caller.
 * Same states and copy as the iOS AttendanceView.
 */

export const REFLECTION_MIN = 200;

/** A press in progress (or its result for a moment after). null = show the day's state. */
export type PressPhase =
  | { step: "face" }
  | { step: "selfie" }
  | { step: "locating" }
  | { step: "located"; text: string; inside: boolean }
  | { step: "sending"; place?: string }
  | { step: "done"; title: string }
  | { step: "failed"; message: string; mode: "in" | "out" };

/** What the day needs from the button when nothing is running. */
export type DayState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "check-in"; hint?: string | null }
  | { kind: "check-out"; reflectionCount: number; previousDay: boolean }
  | { kind: "waiting-approval" }
  | { kind: "done"; line: string; times?: string | null };

const HOLD_MS = 450;
const HOLD_MS_REDUCED = 250;

/** The press state machine the two check-in surfaces (phone hero, desktop card) share. */
export function useAttendancePress() {
  const reduce = useReducedMotion();
  const [phase, setPhaseState] = useState<PressPhase | null>(null);
  const [shakes, setShakes] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const set = (p: PressPhase | null) => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } setPhaseState(p); };
  /** Keeps a finished step readable for a beat — the steps are real work, this only stops the ticks flashing by. */
  const hold = (p: PressPhase) => new Promise<void>((resolve) => { set(p); tick(); setTimeout(resolve, reduce ? HOLD_MS_REDUCED : HOLD_MS); });
  const succeed = (title: string) => {
    set({ step: "done", title });
    buzz([18, 40, 28]);
    timer.current = setTimeout(() => { timer.current = null; setPhaseState(null); }, 2600);
  };
  const fail = (message: string, mode: "in" | "out") => {
    set({ step: "failed", message, mode });
    buzz([60, 50, 60]);
    if (!reduce) setShakes((n) => n + 1);
  };
  return { phase, set, hold, succeed, fail, shakes, busy: phase != null && phase.step !== "done" && phase.step !== "failed" };
}

/** Haptic where the browser has one (Android Chrome); silently nothing elsewhere (iOS Safari, desktop). */
export function buzz(pattern: number | number[]) {
  try { if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern); } catch { /* not supported */ }
}
function tick() { buzz(8); }

function distanceLabel(m: number) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest active office to a position, with whether it is inside that office's radius. */
export function nearestOffice(pos: { lat: number; lng: number }, offices: NexusOffice[] | undefined) {
  let best: { office: NexusOffice; distance: number } | null = null;
  for (const o of offices ?? []) {
    if (o.isActive === false || typeof o.latitude !== "number" || typeof o.longitude !== "number") continue;
    const d = haversine(pos, { lat: o.latitude, lng: o.longitude });
    if (!best || d < best.distance) best = { office: o, distance: d };
  }
  return best ? { ...best, inside: best.distance <= (best.office.radiusMeters ?? 100) } : null;
}

/**
 * "At PATS Group HQ · 12 m" / "340 m from PATS Group HQ — outside the office area". A preview only:
 * the server measures again, and its answer is the one that counts (a check-in outside is refused
 * with its own sentence, a check-out outside asks for a reason).
 */
export function placeLine(fix: GeoFix, offices: NexusOffice[] | undefined, noGeofence?: boolean): { text: string; inside: boolean } {
  if (noGeofence) return { text: "Location-free · position recorded", inside: true };
  const n = nearestOffice(fix, offices);
  if (!n) return { text: `Location found · ±${distanceLabel(fix.accuracy)}`, inside: true };
  return n.inside
    ? { text: `At ${n.office.name} · ${distanceLabel(n.distance)}`, inside: true }
    : { text: `${distanceLabel(n.distance)} from ${n.office.name} — outside the office area`, inside: false };
}

/** Under "Check in": where the browser last put you, so "am I inside?" is answered before the tap. */
export function whereHint(pos: { lat: number; lng: number } | null, offices: NexusOffice[] | undefined, noGeofence?: boolean) {
  if (noGeofence) return "Location-free — clock in from anywhere";
  if (!pos) return null;
  const n = nearestOffice(pos, offices);
  if (!n) return null;
  return n.inside ? `At ${n.office.name}` : `${distanceLabel(n.distance)} from ${n.office.name}`;
}

export function workedLabel(minutes?: number | null) {
  if (!minutes || minutes <= 0) return null;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** "Checked in 09:02 · on time" / "· 6 min late" / "Checked out 17:47 · worked 8h 45m". */
export function successTitle(kind: "in" | "out", at: string, record?: { lateMinutes?: number | null; workedMinutes?: number | null } | null) {
  if (kind === "in") {
    const late = record?.lateMinutes ?? null;
    return `Checked in ${at}${late == null ? "" : late > 0 ? ` · ${late} min late` : " · on time"}`;
  }
  const worked = workedLabel(record?.workedMinutes);
  return `Checked out ${at}${worked ? ` · worked ${worked}` : ""}`;
}

type Look = {
  key: string;
  title: string;
  subtitle?: string | null;
  icon: "in" | "out" | "lock" | "spin" | "ring" | "check" | "warn" | "retry" | "wait" | "done";
  tone: "green" | "red" | "grey" | "violet" | "amber" | "danger" | "success" | "calm";
  progress?: number;
  enabled: boolean;
};

function lookFor(phase: PressPhase | null, day: DayState): Look {
  if (phase) {
    switch (phase.step) {
      case "face": return { key: "face", title: "Checking your selfie…", icon: "spin", tone: "violet", enabled: false };
      case "selfie": return { key: "selfie", title: "Selfie ✓", icon: "check", tone: "violet", enabled: false };
      case "locating": return { key: "locating", title: "Finding your location…", icon: "ring", tone: "violet", enabled: false };
      case "located": return { key: "located", title: phase.inside ? `${phase.text} ✓` : phase.text, icon: phase.inside ? "check" : "warn", tone: phase.inside ? "violet" : "amber", enabled: false };
      case "sending": return { key: "sending", title: "Sending…", subtitle: phase.place, icon: "spin", tone: "violet", enabled: false };
      case "done": return { key: `done-${phase.title}`, title: phase.title, icon: "check", tone: "success", enabled: true };
      case "failed": return { key: "failed", title: "Try again", subtitle: phase.mode === "in" ? "Check-in failed" : "Check-out failed", icon: "retry", tone: "danger", enabled: true };
    }
  }
  switch (day.kind) {
    case "loading": return { key: "loading", title: "Loading…", icon: "spin", tone: "grey", enabled: false };
    // Today could not be loaded: say so instead of spinning forever (the metric card below says the same).
    case "unavailable": return { key: "unavailable", title: "Couldn’t load today", subtitle: "Refresh the page or sign in again", icon: "warn", tone: "grey", enabled: false };
    case "check-in": return { key: "in", title: "Check in", subtitle: day.hint, icon: "in", tone: "green", enabled: true };
    case "check-out": {
      const title = day.previousDay ? "Check out the previous day" : "Check out";
      return day.reflectionCount >= REFLECTION_MIN
        ? { key: "out", title, subtitle: "Reflection ready ✓", icon: "out", tone: "red", enabled: true }
        : { key: "out-locked", title, subtitle: `Write your reflection first · ${day.reflectionCount}/${REFLECTION_MIN}`, icon: "lock", tone: "grey", progress: day.reflectionCount / REFLECTION_MIN, enabled: false };
    }
    case "waiting-approval": return { key: "waiting", title: "Check-out sent · waiting for approval", icon: "wait", tone: "amber", enabled: false };
    case "done": return { key: "done", title: day.line, subtitle: day.times, icon: "done", tone: "calm", enabled: false };
  }
}

const TONE: Record<Look["tone"], string> = {
  green: "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30",
  red: "bg-rose-500 text-white shadow-lg shadow-rose-500/30",
  grey: "bg-muted text-muted-foreground",
  violet: "bg-violet-600 text-white shadow-lg shadow-violet-600/30",
  amber: "bg-amber-600 text-white shadow-lg shadow-amber-600/30",
  danger: "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30",
  success: "bg-emerald-600 text-white shadow-lg shadow-emerald-600/30",
  calm: "bg-success/10 text-success ring-1 ring-success/25",
};

function Icon({ icon, reduce }: { icon: Look["icon"]; reduce: boolean }) {
  const cls = "h-5 w-5";
  switch (icon) {
    case "in": return <ArrowRightToLine className={cls} />;
    case "out": return <ArrowLeftToLine className={cls} />;
    case "lock": return <Lock className={cls} />;
    case "warn": return <AlertTriangle className={cls} />;
    case "retry": return <RotateCcw className={cls} />;
    case "wait": return <Hourglass className={cls} />;
    case "done": return <CalendarCheck className={cls} />;
    case "spin": return <Loader2 className={cn(cls, "animate-spin motion-reduce:animate-none")} />;
    case "ring":
      return reduce ? <Loader2 className={cls} /> : (
        <svg viewBox="0 0 24 24" className={cn(cls, "animate-spin")} aria-hidden>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="17 100" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <circle cx="12" cy="12" r="11" fill="currentColor" fillOpacity="0.22" />
          <motion.path d="M7 12.5l3.2 3.2L17.2 8.6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, ease: "easeOut" }} />
        </svg>
      );
  }
}

/**
 * The button itself, plus the failure sentence and Cancel under it. `onPress` is called for a
 * press in a state that does something (check in / out, or retry after a failure — the caller
 * decides what a retry means); tapping a result skips it.
 */
export function AttendanceButton({ phase, day, shakes, onPress, onDismiss, className }: {
  phase: PressPhase | null;
  day: DayState;
  shakes: number;
  onPress: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const reduce = Boolean(useReducedMotion());
  const look = lookFor(phase, day);
  // One shake per failure (none with reduced motion); the sentence under the button says why.
  const shake = useAnimationControls();
  useEffect(() => {
    if (shakes > 0 && !reduce) void shake.start({ x: [0, -8, 8, -6, 6, -3, 3, 0], transition: { duration: 0.45 } });
  }, [shakes, reduce, shake]);
  const click = () => {
    if (!look.enabled) return;
    if (phase?.step === "done") { onDismiss(); return; }
    onPress();
  };
  return (
    <div className={cn("space-y-2", className)}>
      <motion.button
        type="button"
        onClick={click}
        disabled={!look.enabled}
        aria-live="polite"
        aria-label={look.subtitle ? `${look.title}. ${look.subtitle}` : look.title}
        animate={shake}
        whileTap={look.enabled && !reduce ? { scale: 0.97 } : undefined}
        className={cn(
          "relative flex min-h-[62px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl px-5 py-3 transition-colors duration-300 motion-reduce:transition-none disabled:cursor-default",
          TONE[look.tone],
        )}
      >
        {look.progress != null && (
          <span aria-hidden className="absolute inset-y-0 left-0 bg-rose-500/20 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.min(1, Math.max(0, look.progress)) * 100}%` }} />
        )}
        <span className="relative shrink-0"><Icon icon={look.icon} reduce={reduce} /></span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={look.key}
            className="relative min-w-0 text-left"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.2 }}
          >
            <span className="block font-display text-base font-bold leading-tight">{look.title}</span>
            {look.subtitle && <span className="block text-xs font-semibold opacity-90">{look.subtitle}</span>}
          </motion.span>
        </AnimatePresence>
      </motion.button>
      {phase?.step === "failed" && (
        <div className="text-center">
          <p className="text-sm font-semibold text-destructive">{phase.message}</p>
          <button type="button" onClick={onDismiss} className="mt-1 text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      )}
    </div>
  );
}

/** An approved leave / sick / permit / day off covers today: the server refuses a check-in, so no button — the reason instead. */
export function CoveredByRequestCard({ type, className }: { type?: string | null; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-success/25 bg-success/5 px-4 py-4 text-center", className)}>
      <CalendarCheck className="mx-auto h-6 w-6 text-success" />
      <p className="mt-1.5 font-display text-base font-bold">Your approved request covers today</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{type ? `${type} · ` : ""}No check-in needed — it's already on your record.</p>
    </div>
  );
}

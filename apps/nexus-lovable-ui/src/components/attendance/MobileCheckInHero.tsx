import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, LocateFixed, LogIn, LogOut, PenLine } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { celebrate } from "@/components/Celebration";
import { ApiError, fmtTime, nexusApi, type AttendanceActionPayload, type NexusAttendanceToday } from "@/lib/nexus-api";
import { getAttendanceFix, GeoError } from "@/lib/geo";

type TodayData = NexusAttendanceToday | null;

const REFLECTION_MIN = 200;

function jktTime(d: Date) {
  return d.toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour12: false });
}
function jktDate(d: Date) {
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function MobileCheckInHero({ today, disabled }: { today: TodayData; disabled: boolean }) {
  const checkedIn = Boolean(today?.today?.checkInAt);
  const checkedOut = Boolean(today?.today?.checkOutAt);
  const pending = today?.pendingCheckout ?? null;
  const forcePending = Boolean(pending);
  const officeName = forcePending ? pending?.officeLocation?.name : today?.today?.officeLocation?.name;
  const shift = today?.myShift;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // ---- check-in / check-out (selfie + GPS), reusing the existing API ----
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["attendance-today"] }); qc.invalidateQueries({ queryKey: ["attendance-history"] }); qc.invalidateQueries({ queryKey: ["my-penalties"] }); };
  const [msg, setMsg] = useState<string | null>(null);
  const [msgOk, setMsgOk] = useState(false);
  const [locating, setLocating] = useState(false);
  // Offsite checkout (outside the geofence): captured attempt + the reason prompt.
  const lastOut = useRef<AttendanceActionPayload | null>(null);
  const [offsitePrompt, setOffsitePrompt] = useState<{ officeName: string; distanceMeters: number } | null>(null);
  const [offsiteReason, setOffsiteReason] = useState("");
  // Daily Reflection — mandatory recap (≥200 chars) collected BEFORE the selfie on check-out.
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflection, setReflection] = useState("");
  const errOf = (e: unknown, fb: string) => (e instanceof ApiError ? ((e.payload as { error?: string } | null)?.error ?? fb) : fb);
  // Big success popup after a confirmed check-in/out (in addition to the confetti).
  const reduce = useReducedMotion();
  const [success, setSuccess] = useState<{ kind: "in" | "out"; time: string } | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (successTimer.current) clearTimeout(successTimer.current); }, []);
  const showSuccess = (kind: "in" | "out") => {
    setSuccess({ kind, time: jktTime(new Date()) });
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccess(null), 2800);
  };
  const checkIn = useMutation({ mutationFn: (p: AttendanceActionPayload) => nexusApi.attendanceCheckIn(p), onSuccess: () => { setMsg(null); refresh(); celebrate("Checked in. Let's cook ☕✨"); showSuccess("in"); }, onError: (e) => { setMsgOk(false); setMsg(errOf(e, "Couldn't check in.")); } });
  const checkOut = useMutation({
    mutationFn: (p: AttendanceActionPayload) => nexusApi.attendanceCheckOut(p),
    onSuccess: (data) => {
      setOffsitePrompt(null); setOffsiteReason(""); setReflection(""); refresh();
      if (data?.pendingApproval) { setMsgOk(true); setMsg("Offsite checkout sent — waiting on BoD approval ⏳"); }
      else { setMsg(null); celebrate("Checked out. Good run today 🏁"); showSuccess("out"); }
    },
    onError: (e) => {
      const payload = e instanceof ApiError ? (e.payload as { code?: string; officeName?: string; distanceMeters?: number } | null) : null;
      if (e instanceof ApiError && e.status === 422 && payload?.code === "OUTSIDE_RADIUS") {
        // Outside the geofence → offer an offsite checkout with a reason (pending BoD approval).
        setMsg(null); setOffsiteReason("");
        setOffsitePrompt({ officeName: payload.officeName ?? "the office", distanceMeters: payload.distanceMeters ?? 0 });
      } else { setMsgOk(false); setMsg(errOf(e, "Couldn't check out.")); }
    },
  });
  const submitOffsite = () => { if (!lastOut.current || !offsiteReason.trim()) return; checkOut.mutate({ ...lastOut.current, offsite: true, reason: offsiteReason.trim() }); };
  const busy = checkIn.isPending || checkOut.isPending || locating;

  const fileRef = useRef<HTMLInputElement>(null);
  const pendingMode = useRef<"in" | "out" | null>(null);
  // Check-in goes straight to the selfie; check-out asks for the daily reflection first.
  const trigger = (mode: "in" | "out") => {
    if (busy || disabled) return;
    setMsg(null);
    if (mode === "out") { setReflectOpen(true); return; }
    pendingMode.current = mode;
    fileRef.current?.click();
  };
  // After the reflection passes ≥200 chars, continue the check-out into the selfie/GPS flow.
  const proceedCheckout = () => {
    if (reflection.trim().length < REFLECTION_MIN) return;
    setReflectOpen(false);
    pendingMode.current = "out";
    fileRef.current?.click();
  };
  const onSelfie = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    const mode = pendingMode.current;
    pendingMode.current = null;
    if (!file || !mode) return;
    setMsg(null);
    setLocating(true);
    getAttendanceFix()
      .then((fix) => {
        setLocating(false);
        const payload: AttendanceActionPayload = { lat: fix.lat, lng: fix.lng, selfie: file, ...(mode === "out" ? { reflection: reflection.trim() } : {}) };
        if (mode === "out") lastOut.current = payload; // keep it so an offsite retry can resubmit the same selfie+GPS+reflection
        (mode === "in" ? checkIn : checkOut).mutate(payload);
      })
      .catch((err) => {
        setLocating(false);
        setMsgOk(false);
        setMsg(err instanceof GeoError ? err.message : "Couldn't get your location. Try again.");
      });
  };

  // IN allowed only when not yet checked in & not force-pending; OUT when checked-in-not-out or force-pending.
  const inDisabled = disabled || busy || checkedIn || forcePending;
  const outDisabled = disabled || busy || (!forcePending && (!checkedIn || checkedOut));

  // ---- map (Leaflet + OSM) ----
  const officesQ = useQuery({ queryKey: ["attendance-offices"], queryFn: nexusApi.attendanceOffices, retry: 1 });
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let watchId: number | null = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (p) => setUserPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 30_000 },
      );
    }
    return () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); };
  }, []);

  // init map once
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    // Display-only map: ALL gesture handlers off so touch/scroll passes through to the page
    // (otherwise dragging on the map pans it instead of scrolling). Recenter still works via setView.
    const map = L.map(mapDivRef.current, {
      zoomControl: false, attributionControl: false,
      dragging: false, touchZoom: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false,
    }).setView([-6.2, 106.816], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    mapDivRef.current.style.touchAction = "pan-y"; // let vertical page scroll happen over the map
    setTimeout(() => map.invalidateSize(), 200);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  // draw markers + geofence whenever offices/user move
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const offices = (officesQ.data?.offices ?? []).filter((o) => typeof o.latitude === "number" && typeof o.longitude === "number");
    const pts: L.LatLngExpression[] = [];
    for (const o of offices) {
      const ll: L.LatLngExpression = [o.latitude as number, o.longitude as number];
      pts.push(ll);
      L.circle(ll, { radius: o.radiusMeters ?? 100, color: "#4f46e5", weight: 1.5, fillColor: "#4f46e5", fillOpacity: 0.1 }).addTo(layer);
      L.marker(ll, { icon: L.divIcon({ className: "", html: `<div style="font-size:26px;line-height:1">🏢</div>`, iconSize: [26, 26], iconAnchor: [13, 24] }) }).addTo(layer).bindTooltip(o.name ?? "Office");
    }
    if (userPos) {
      const ll: L.LatLngExpression = [userPos.lat, userPos.lng];
      pts.push(ll);
      L.marker(ll, { icon: L.divIcon({ className: "", html: `<div style="width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px #2563eb"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(layer);
    }
    if (pts.length === 1) map.setView(pts[0], 16);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 16 });
  }, [officesQ.data, userPos]);

  const recenter = () => {
    const map = mapRef.current;
    if (map && userPos) map.setView([userPos.lat, userPos.lng], 16);
  };

  const status = forcePending ? "Finish yesterday's attendance" : checkedOut ? "Done for today 🎉" : checkedIn ? "Clocked in" : "Ready to check in";

  return (
    <div className="space-y-3">
      <section className="relative isolate h-[46vh] min-h-[360px] w-full overflow-hidden rounded-3xl border border-border shadow-soft">
        <div ref={mapDivRef} className="absolute inset-0 z-0 bg-muted" />

        {/* top clock card */}
        <div className="absolute inset-x-3 top-3 z-20 rounded-3xl border border-white/15 p-4 text-white shadow-lg" style={{ backgroundImage: "linear-gradient(150deg, #c4b5fd 0%, #7c3aed 100%)", boxShadow: "0 12px 28px -12px #a78bfa" }}>
          <div className="flex items-center justify-between text-xs font-semibold opacity-90">
            <span>{jktDate(now)}</span>
            <span>GMT+7</span>
          </div>
          <div className="mt-1 text-center font-display text-5xl font-bold tabular-nums tracking-tight">{jktTime(now)}</div>
          <div className="mt-2 flex justify-center">
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              {shift?.flexi
                ? `Flexi ${shift.startTime}–${shift.endTime} · +9h`
                : `My Work Schedule ${shift ? `${shift.startTime} – ${shift.endTime}` : "—"}`}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-8 text-sm font-bold tabular-nums">
            <span className="opacity-90">IN {today?.today?.checkInAt ? fmtTime(today.today.checkInAt) : "--:--"}</span>
            <span className="opacity-90">OUT {today?.today?.checkOutAt ? fmtTime(today.today.checkOutAt) : "--:--"}</span>
          </div>
        </div>

        {/* recenter */}
        <button onClick={recenter} aria-label="Recenter" className="absolute bottom-4 right-4 z-20 grid h-11 w-11 place-items-center rounded-full bg-card text-foreground shadow-lg ring-1 ring-border active:scale-95">
          <LocateFixed className="h-5 w-5" />
        </button>

        {/* status + office chip */}
        <div className="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-1.5">
          <span className="rounded-full bg-card/90 px-3 py-1 text-xs font-semibold text-muted-foreground shadow ring-1 ring-border backdrop-blur">
            {status}{officeName ? ` · ${officeName}` : ""}
          </span>
          {today?.noGeofence && (
            <span className="rounded-full bg-sky-500/90 px-3 py-1 text-xs font-bold text-white shadow ring-1 ring-sky-300 backdrop-blur">📍 Location-free — clock in from anywhere</span>
          )}
        </div>
      </section>

      {/* IN / OUT buttons — in normal flow (below the map) so they never overlap the fixed navbar */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => trigger("in")}
          disabled={inDisabled}
          className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-4 text-base font-black uppercase tracking-wide text-white shadow-lg transition active:scale-[0.98] disabled:opacity-40"
        >
          {busy && pendingMode.current === "in" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />} Presence In
        </button>
        <button
          onClick={() => trigger("out")}
          disabled={outDisabled}
          className="flex items-center justify-center gap-2 rounded-2xl bg-rose-500 py-4 text-base font-black uppercase tracking-wide text-white shadow-lg transition active:scale-[0.98] disabled:opacity-40"
        >
          {busy && pendingMode.current === "out" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />} Presence Out
        </button>
      </div>

      {/* Offsite checkout prompt — shown when the user is outside the office geofence on check-out */}
      {offsitePrompt && (
        <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-bold text-amber-800">You're outside the office area</div>
          <p className="text-xs text-amber-700">±{Math.round(offsitePrompt.distanceMeters)}m from {offsitePrompt.officeName}. Want to check out from here? <span className="font-semibold">A reason is required</span> — your checkout waits on BoD approval first.</p>
          <textarea value={offsiteReason} onChange={(e) => setOffsiteReason(e.target.value)} rows={2} placeholder="Reason (e.g. content shoot at X / client meeting at Y)" className="w-full resize-none rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500" />
          <div className="flex gap-2">
            <button onClick={() => { setOffsitePrompt(null); setOffsiteReason(""); }} disabled={busy} className="flex-1 rounded-lg border border-border bg-white py-2 text-xs font-semibold text-muted-foreground transition hover:bg-accent disabled:opacity-50">Cancel</button>
            <button onClick={submitOffsite} disabled={!offsiteReason.trim() || busy} className="flex-[1.6] rounded-lg bg-amber-600 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-50">{busy ? "Sending…" : "Check out & request approval"}</button>
          </div>
        </div>
      )}

      {/* Pending offsite-checkout state */}
      {today?.today?.checkOutApproval === "PENDING" && !offsitePrompt && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-700">⏳ Offsite checkout — waiting on BoD approval</div>
      )}
      {today?.today?.checkOutApproval === "REJECTED" && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs font-semibold text-rose-700">Your offsite checkout was rejected by the BoD.</div>
      )}

      {msg && (
        <div className={`rounded-xl border px-3 py-2 text-center text-xs font-semibold ${msgOk ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {msg}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="user" onChange={onSelfie} className="hidden" />

      {/* Daily Reflection — required (≥200 chars) before check-out, captured before the selfie */}
      <AnimatePresence>
        {reflectOpen && (
          <motion.div
            className="fixed inset-0 z-[65] grid place-items-center bg-slate-900/50 p-3 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { if (reflection.trim().length === 0) setReflectOpen(false); }}
          >
            <motion.div
              initial={reduce ? { opacity: 0 } : { y: 30, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
              transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 300, damping: 28 }}
              className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl bg-card p-5 shadow-2xl ring-1 ring-border"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><PenLine className="h-5 w-5" /></div>
                <div>
                  <div className="text-base font-black text-foreground">Daily Reflection</div>
                  <div className="text-xs font-medium text-muted-foreground">Required before check-out · min {REFLECTION_MIN} characters</div>
                </div>
              </div>
              <p className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-[11px] font-medium leading-relaxed text-muted-foreground">
                Tell us: what you worked on today, the progress you made, any blockers, and what's next.
              </p>
              <textarea
                value={reflection}
                onChange={(e) => setReflection(e.target.value)}
                rows={5}
                placeholder="Today I worked on… the progress was… the blocker was… tomorrow I'll continue…"
                className="mt-3 w-full resize-none rounded-2xl border border-border bg-background px-3 py-2.5 text-sm leading-relaxed outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-semibold">
                <span className={reflection.trim().length >= REFLECTION_MIN ? "text-emerald-600" : "text-muted-foreground"}>
                  {reflection.trim().length}/{REFLECTION_MIN}
                </span>
                {reflection.trim().length < REFLECTION_MIN && (
                  <span className="text-muted-foreground">{REFLECTION_MIN - reflection.trim().length} characters to go</span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setReflectOpen(false)} className="flex-1 rounded-2xl border border-border bg-background py-3 text-sm font-semibold text-muted-foreground transition hover:bg-accent active:scale-[0.98]">Cancel</button>
                <button
                  onClick={proceedCheckout}
                  disabled={reflection.trim().length < REFLECTION_MIN}
                  className="flex-[1.6] rounded-2xl bg-rose-500 py-3 text-sm font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-40"
                >
                  Continue · take selfie
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading overlay — visible while the selfie/GPS/upload is in flight */}
      <AnimatePresence>
        {busy && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              initial={reduce ? { opacity: 0 } : { scale: 0.9, y: 12, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { scale: 1, y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { scale: 0.95, opacity: 0 }}
              className="w-full max-w-xs rounded-3xl bg-card p-6 shadow-2xl ring-1 ring-border"
            >
              <div className="flex items-center gap-3">
                <Loader2 className="h-6 w-6 shrink-0 animate-spin text-primary" />
                <div className="text-sm font-bold text-foreground">
                  {locating ? "Grabbing your GPS location…" : checkIn.isPending ? "Sending your check-in to the server…" : checkOut.isPending ? "Sending your check-out to the server…" : "Processing…"}
                </div>
              </div>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-primary/15">
                {reduce ? (
                  <motion.div className="h-full w-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />
                ) : (
                  <motion.div className="h-full w-1/2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" animate={{ x: ["-60%", "220%"] }} transition={{ duration: 1.05, repeat: Infinity, ease: "easeInOut" }} />
                )}
              </div>
              <p className="mt-3 text-center text-[11px] font-medium text-muted-foreground">One sec — don't close this page just yet…</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success popup — confirmed check-in / check-out */}
      <AnimatePresence>
        {success && (
          <motion.div
            className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setSuccess(null)}
          >
            <motion.div
              initial={reduce ? { opacity: 0 } : { scale: 0.8, y: 20, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { scale: 1, y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { scale: 0.9, opacity: 0 }}
              transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 320, damping: 22 }}
              className="w-full max-w-xs rounded-3xl bg-card p-7 text-center shadow-2xl ring-1 ring-border"
              onClick={(e) => e.stopPropagation()}
            >
              <motion.div
                initial={reduce ? { opacity: 0 } : { scale: 0 }}
                animate={reduce ? { opacity: 1 } : { scale: 1 }}
                transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 260, damping: 14, delay: 0.05 }}
                className={`mx-auto grid h-20 w-20 place-items-center rounded-full ${success.kind === "in" ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"}`}
              >
                <CheckCircle2 className="h-12 w-12" strokeWidth={2.5} />
              </motion.div>
              <div className="mt-4 text-xl font-black text-foreground">
                {success.kind === "in" ? "Checked In! ☕" : "Checked Out! 🏁"}
              </div>
              <div className="mt-1 text-sm font-semibold text-muted-foreground">
                {success.time} · {success.kind === "in" ? "Have a great one, happy working!" : "Nice, good run today!"}
              </div>
              <button onClick={() => setSuccess(null)} className="mt-5 w-full rounded-2xl bg-primary py-3 text-sm font-bold text-primary-foreground transition active:scale-[0.98]">
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

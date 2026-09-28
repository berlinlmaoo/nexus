import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LocateFixed, PenLine } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { celebrate } from "@/components/Celebration";
import { ApiError, fmtTime, nexusApi, type AttendanceActionPayload, type NexusAttendanceToday } from "@/lib/nexus-api";
import { getAttendanceFix, GeoError } from "@/lib/geo";
import { recordPlace } from "@/lib/attendance-place";
import { LivenessCapture } from "@/components/attendance/LivenessCapture";
import { IosAppCheckInCard, isUseIosAppError, WebCheckInNote } from "@/components/attendance/IosAppCheckInCard";
import { AttendanceButton, CoveredByRequestCard, placeLine, REFLECTION_MIN, successTitle, useAttendancePress, whereHint, workedLabel, type DayState } from "@/components/attendance/AttendanceButton";

type TodayData = NexusAttendanceToday | null;

function jktTime(d: Date) {
  return d.toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour12: false });
}
/** HH:mm of the time the server recorded, or of now when it sent none. */
function atOf(iso?: string | null) {
  return iso ? fmtTime(iso) : jktTime(new Date()).slice(0, 5);
}
function jktDate(d: Date) {
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function MobileCheckInHero({ today, disabled, failed = false }: { today: TodayData; disabled: boolean; failed?: boolean }) {
  const checkedIn = Boolean(today?.today?.checkInAt);
  const checkedOut = Boolean(today?.today?.checkOutAt);
  const pending = today?.pendingCheckout ?? null;
  const forcePending = Boolean(pending);
  // The day's place: the office, or the check-in address when it was made away from the office
  // (owner, 28 Sep 2026: per record, not per person).
  const officeName = forcePending ? recordPlace(pending).label || null : today?.today?.checkInAt ? recordPlace(today.today).label || null : today?.today?.officeLocation?.name;
  const shift = today?.myShift;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // ---- check-in / check-out (selfie + GPS), reusing the existing API ----
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["attendance-today"] }); qc.invalidateQueries({ queryKey: ["attendance-history"] }); qc.invalidateQueries({ queryKey: ["my-penalties"] }); };
  const [msg, setMsg] = useState<string | null>(null);
  const [msgOk, setMsgOk] = useState(false);
  // iPhone/iPad browsers check in from the app (the server refuses them with USE_IOS_APP).
  // Shown once the server actually refuses (it only does after the 0.1.6 minimum starts).
  const [iosOnly, setIosOnly] = useState(false);
  const [locating, setLocating] = useState(false);
  // Offsite checkout (outside the geofence): captured attempt + the reason prompt.
  const lastOut = useRef<AttendanceActionPayload | null>(null);
  const [offsitePrompt, setOffsitePrompt] = useState<{ officeName: string; distanceMeters: number } | null>(null);
  const [offsiteReason, setOffsiteReason] = useState("");
  // Daily Reflection — mandatory recap (≥200 chars). Written on the page while checked in; the one
  // button stays locked (with the count on it) until it is long enough.
  const [reflection, setReflection] = useState("");
  const reflectionCount = reflection.trim().length;
  const errOf = (e: unknown, fb: string) => (e instanceof ApiError ? ((e.payload as { error?: string } | null)?.error ?? fb) : fb);
  // The press, drawn in the button: face check → location → sending → result.
  const press = useAttendancePress();
  const checkIn = useMutation({
    mutationFn: (p: AttendanceActionPayload) => nexusApi.attendanceCheckIn(p),
    onSuccess: (data) => { setMsg(null); refresh(); press.succeed(successTitle("in", atOf(data?.record?.checkInAt), data?.record)); },
    onError: (e) => { if (isUseIosAppError(e)) { press.set(null); setIosOnly(true); setMsg(null); return; } press.fail(errOf(e, "Couldn't check in."), "in"); },
  });
  const checkOut = useMutation({
    mutationFn: (p: AttendanceActionPayload) => nexusApi.attendanceCheckOut(p),
    onSuccess: (data) => {
      setOffsitePrompt(null); setOffsiteReason(""); setReflection(""); refresh();
      // Offsite: the button itself becomes "Check-out sent · waiting for approval" once today reloads.
      if (data?.pendingApproval) { press.set(null); setMsgOk(true); setMsg("Offsite checkout sent — waiting on BoD approval ⏳"); }
      else { setMsg(null); press.succeed(successTitle("out", atOf(data?.record?.checkOutAt), data?.record)); }
    },
    onError: (e) => {
      if (isUseIosAppError(e)) { press.set(null); setIosOnly(true); setMsg(null); return; }
      const payload = e instanceof ApiError ? (e.payload as { code?: string; officeName?: string; distanceMeters?: number } | null) : null;
      if (e instanceof ApiError && e.status === 422 && payload?.code === "OUTSIDE_RADIUS") {
        // Outside the geofence → offer an offsite checkout with a reason (pending BoD approval).
        press.set(null); setMsg(null); setOffsiteReason("");
        setOffsitePrompt({ officeName: payload.officeName ?? "the office", distanceMeters: payload.distanceMeters ?? 0 });
      } else { press.fail(errOf(e, "Couldn't check out."), "out"); }
    },
  });
  const submitOffsite = () => { if (!lastOut.current || !offsiteReason.trim()) return; press.set({ step: "sending", place: "Outside the office · with your reason" }); checkOut.mutate({ ...lastOut.current, offsite: true, reason: offsiteReason.trim() }); };
  const busy = checkIn.isPending || checkOut.isPending || locating || press.busy;

  const fileRef = useRef<HTMLInputElement>(null);
  const pendingMode = useRef<"in" | "out" | null>(null);
  // The selfie is taken by the face check (straight, side, other side, blink). Only when the browser
  // has no camera API, or the face model cannot be fetched, does it fall back to a plain photo — and
  // that one is at least checked for a face where the browser can.
  const [liveness, setLiveness] = useState<"in" | "out" | null>(null);
  const [fallbackMode, setFallbackMode] = useState<"in" | "out" | null>(null);
  const startSelfie = (mode: "in" | "out") => {
    setFallbackMode(null);
    if (typeof navigator.mediaDevices?.getUserMedia === "function") { setLiveness(mode); return; }
    pendingMode.current = mode;
    fileRef.current?.click();
  };
  // Both go straight to the face check. A check-out is only pressable once the reflection on the
  // page is long enough (the button is locked until then), and the server checks it again.
  const trigger = (mode: "in" | "out") => {
    if (busy || disabled) return;
    if (mode === "out" && reflectionCount < REFLECTION_MIN) return;
    setMsg(null); setOffsitePrompt(null); press.set(null);
    startSelfie(mode);
  };
  const onSelfie = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    const mode = pendingMode.current;
    pendingMode.current = null;
    if (!file || !mode) return;
    proceed(file, mode, false);
  };
  const proceed = (file: File, mode: "in" | "out", verified: boolean) => {
    setMsg(null);
    setLocating(true);
    press.set({ step: "face" });
    // A selfie with no face in it is not an attendance photo. The face check already proved a live
    // person; a plain photo is at least asked for a face where the browser has a detector.
    (verified ? Promise.resolve(true) : hasFace(file))
      .then(async (ok) => {
        if (!ok) throw new NoFaceError();
        await press.hold({ step: "selfie" });
        press.set({ step: "locating" });
        return getAttendanceFix();
      })
      .then(async (fix) => {
        const place = placeLine(fix, officesQ.data?.offices, today?.noGeofence);
        await press.hold({ step: "located", text: place.text, inside: place.inside });
        setLocating(false);
        press.set({ step: "sending", place: place.text });
        const payload: AttendanceActionPayload = { lat: fix.lat, lng: fix.lng, selfie: file, ...(mode === "out" ? { reflection: reflection.trim() } : {}) };
        if (mode === "out") lastOut.current = payload; // keep it so an offsite retry can resubmit the same selfie+GPS+reflection
        (mode === "in" ? checkIn : checkOut).mutate(payload);
      })
      .catch((err) => {
        setLocating(false);
        if (err instanceof NoFaceError) { press.fail("No face in the photo. Take the selfie with your face clearly visible, then try again.", mode); return; }
        press.fail(err instanceof GeoError ? err.message : "Couldn't get your location. Try again.", mode);
      });
  };

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

  // What the one button is for today. The forgotten check-out of a previous day comes first (the
  // server will not take today's check-in until it is closed); an approved request covering today
  // means there is nothing to press (the server refuses the check-in), so a card says why instead.
  const needsReflection = forcePending || (checkedIn && !checkedOut);
  const coveredByRequest = Boolean(today?.todayRequest) && !forcePending && !checkedIn;
  const worked = workedLabel(today?.today?.workedMinutes);
  const day: DayState =
    !today && failed ? { kind: "unavailable" }
    : !today && disabled ? { kind: "loading" }
    : today?.today?.checkOutApproval === "PENDING" && !forcePending ? { kind: "waiting-approval" }
    : needsReflection ? { kind: "check-out", reflectionCount, previousDay: forcePending }
    : checkedOut ? { kind: "done", line: `Done for today${worked ? ` · worked ${worked}` : ""}`, times: `In ${fmtTime(today?.today?.checkInAt)} · Out ${fmtTime(today?.today?.checkOutAt)}` }
    : { kind: "check-in", hint: whereHint(userPos, officesQ.data?.offices, today?.noGeofence) };
  const onPress = () => {
    if (press.phase?.step === "failed") { trigger(press.phase.mode); return; } // retry = a fresh face check
    if (day.kind === "check-in") trigger("in");
    else if (day.kind === "check-out") trigger("out");
  };

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

      {/* The forgotten check-out of a previous day, said before anything else. */}
      {forcePending && !iosOnly && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800">
          ⚠️ You still have an earlier shift that was never checked out. {reflectionCount >= REFLECTION_MIN ? "Tap Check out to close it first — then you can check in again." : "Write the daily reflection below first — Check out unlocks at 200 characters."}
        </div>
      )}

      {/* Daily Reflection — required (≥200 chars) before check-out, written right here while checked in */}
      {needsReflection && !iosOnly && (
        <div className="rounded-2xl border border-border bg-card p-3 shadow-soft">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground"><PenLine className="h-4 w-4 text-primary" /> Daily reflection</span>
            <span className={`text-xs font-bold tabular-nums ${reflectionCount >= REFLECTION_MIN ? "text-emerald-600" : "text-amber-600"}`}>{reflectionCount}/{REFLECTION_MIN}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Required before check-out. What you worked on today, the progress, any blockers, what's next.</p>
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            rows={4}
            disabled={busy}
            placeholder="Today I worked on… the progress was… the blocker was… tomorrow I'll continue…"
            className={`mt-2 w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition focus:ring-2 focus:ring-primary/20 ${reflectionCount >= REFLECTION_MIN ? "border-emerald-400/60" : "border-border focus:border-primary"}`}
          />
          {reflectionCount < REFLECTION_MIN && (
            <p className="mt-1 text-[11px] font-semibold text-amber-600">{REFLECTION_MIN - reflectionCount} more characters needed before you can check out.</p>
          )}
        </div>
      )}

      {/* The one attendance button — in normal flow (below the map) so it never overlaps the fixed navbar */}
      {iosOnly && (!checkedOut || forcePending) ? <IosAppCheckInCard /> : coveredByRequest ? <CoveredByRequestCard type={today?.todayRequest?.type ? statusWords(today.todayRequest.type) : null} /> : <>
      <AttendanceButton phase={press.phase} day={day} shakes={press.shakes} onPress={onPress} onDismiss={() => press.set(null)} />
      {(!checkedOut || forcePending) && <WebCheckInNote />}
      </>}

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
      {fallbackMode && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800">
          The live face check isn't available in this browser.{" "}
          <button type="button" className="underline" onClick={() => { const m = fallbackMode; setFallbackMode(null); pendingMode.current = m; fileRef.current?.click(); }}>Take a plain selfie instead</button>
        </div>
      )}

      <AnimatePresence>
        {liveness && (
          <LivenessCapture
            onCancel={() => setLiveness(null)}
            onCapture={(file) => { const m = liveness; setLiveness(null); proceed(file, m, true); }}
            onUnavailable={() => { const m = liveness; setLiveness(null); setFallbackMode(m); }}
          />
        )}
      </AnimatePresence>

    </div>
  );
}


class NoFaceError extends Error { constructor() { super("no face"); } }

/** "DAY_OFF" → "Day Off". */
function statusWords(raw: string) {
  return raw.split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** true when a face is found, or when this browser cannot look (no FaceDetector API). */
async function hasFace(file: File): Promise<boolean> {
  const FD = (window as unknown as { FaceDetector?: new (o?: { fastMode?: boolean; maxDetectedFaces?: number }) => { detect: (img: ImageBitmap) => Promise<Array<{ boundingBox: DOMRectReadOnly }>> } }).FaceDetector;
  if (!FD) return true;
  try {
    const bitmap = await createImageBitmap(file);
    const faces = await new FD({ fastMode: true, maxDetectedFaces: 3 }).detect(bitmap);
    const min = Math.min(bitmap.width, bitmap.height) * 0.12;
    bitmap.close();
    return faces.some((f) => Math.min(f.boundingBox.width, f.boundingBox.height) >= min);
  } catch { return true; }
}

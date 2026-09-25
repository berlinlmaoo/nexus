import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Check, Loader2, LogIn, LogOut, MapPinOff, Minus, MoreHorizontal, Route as RouteIcon, X } from "lucide-react";
import { ApiError, fmtTime, nexusApi, type NexusAttendanceTrail, type NexusPresenceHour, type NexusTrailPoint } from "@/lib/nexus-api";

/**
 * Where someone was between check-in and check-out — the web twin of the app's live location.
 *
 * The phone reports points while its owner is checked in; the server marks each one inside or
 * outside the office radius and folds the outside stretches into spans. This draws both: the line
 * in time order (green while inside, amber while outside), a pin where they left and where they
 * came back, and beside it the spans in words, because "10:05 – 12:40 · 2 h 35 min" is what a
 * manager actually asks. Same Leaflet + OpenStreetMap tiles as the office picker.
 *
 * Since the hourly presence checks (25 Sep 2026) the phone also reports about once an hour while
 * INSIDE. Those are "still here", not movement: they are kept off the line and out of the pins (they
 * would only scribble inside the office circle) and drawn as faint dots; the hour chips beside the map
 * are where they are read.
 */

const GREEN = "#10b981";
const AMBER = "#f59e0b";
const OFFICE = "#6d5ce7";

/** "2 h 35 min", "45 min", "under 1 min". */
export function fmtSpanDuration(ms: number) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "under 1 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function esc(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function humanEvent(event: string) {
  const s = event.replace(/[_-]+/g, " ").toLowerCase().trim();
  return s ? s[0].toUpperCase() + s.slice(1) : event;
}

function pinIcon(color: string, label: string) {
  const safe = esc(label);
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)"><div style="background:${color};color:#fff;font:600 10px/1 system-ui,sans-serif;padding:3px 5px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35)">${safe}</div><div style="width:10px;height:10px;margin-top:2px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.4)"></div></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/** An hourly check made inside the office — shown as a faint dot, never part of the route. */
const isInsideCheck = (p: NexusTrailPoint) => p.event === "presence" && p.inside;

function TrailMap({ trail }: { trail: NexusAttendanceTrail }) {
  const divRef = useRef<HTMLDivElement>(null);
  const { points, checks } = useMemo(() => {
    const all = trail.points
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .slice()
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { points: all.filter((p) => !isInsideCheck(p)), checks: all.filter(isInsideCheck) };
  }, [trail.points]);
  const office = trail.record.office;

  useEffect(() => {
    if (!divRef.current) return;
    const center: L.LatLngExpression = office ? [office.lat, office.lng] : points.length ? [points[0].lat, points[0].lng] : checks.length ? [checks[0].lat, checks[0].lng] : [-6.2088, 106.8456];
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: false }).setView(center, 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const bounds = L.latLngBounds([]);

    if (office) {
      const circle = L.circle([office.lat, office.lng], { radius: office.radiusMeters, color: OFFICE, weight: 2, fillColor: OFFICE, fillOpacity: 0.12 })
        .bindTooltip(esc(office.name))
        .addTo(map);
      bounds.extend(circle.getBounds());
    }

    for (const p of checks) {
      bounds.extend([p.lat, p.lng]);
      L.circleMarker([p.lat, p.lng], { radius: 2.5, color: GREEN, weight: 0, fillColor: GREEN, fillOpacity: 0.45 })
        .bindTooltip(`Presence check · ${fmtTime(p.at)} WIB${p.accuracy != null ? ` · ±${Math.round(p.accuracy)} m` : ""}`)
        .addTo(map);
    }

    // One polyline per run of same-coloured segments. A segment that touches an outside point is
    // amber, so the walk out of the circle and the walk back in read as part of the outing.
    const outsideSeg = (a: NexusTrailPoint, b: NexusTrailPoint) => !a.inside || !b.inside;
    let run: L.LatLngExpression[] = [];
    let runOutside: boolean | null = null;
    const flush = () => {
      if (run.length >= 2) L.polyline(run, { color: runOutside ? AMBER : GREEN, weight: 4, opacity: 0.9, lineJoin: "round" }).addTo(map);
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const o = outsideSeg(a, b);
      if (runOutside === null || o !== runOutside) { flush(); run = [[a.lat, a.lng]]; runOutside = o; }
      run.push([b.lat, b.lng]);
    }
    flush();

    for (const p of points) {
      bounds.extend([p.lat, p.lng]);
      L.circleMarker([p.lat, p.lng], { radius: 3, color: p.inside ? GREEN : AMBER, weight: 1, fillOpacity: 0.9 })
        .bindTooltip(`${fmtTime(p.at)} WIB${p.accuracy != null ? ` · ±${Math.round(p.accuracy)} m` : ""}${p.event ? ` · ${esc(humanEvent(p.event))}` : ""}`)
        .addTo(map);
    }

    // Left / Back pins: where the phone reported leaving or re-entering (its exit/enter events), and
    // wherever the inside flag flips. The phone sends nothing while inside, so the first point of a
    // day is usually the exit itself — it must read "Left", not "Start".
    const pinned = new Set<number>();
    for (let i = 0; i < points.length; i++) {
      const p = points[i], prev = i > 0 ? points[i - 1] : null;
      const left = p.event === "exit" || (prev !== null && prev.inside && !p.inside);
      const back = p.event === "enter" || (prev !== null && !prev.inside && p.inside);
      if (!left && !back) continue;
      pinned.add(i);
      L.marker([p.lat, p.lng], { icon: pinIcon(left ? AMBER : GREEN, `${left ? "Left" : "Back"} ${fmtTime(p.at)}`), keyboard: false, zIndexOffset: 500 }).addTo(map);
    }
    if (points.length) {
      const first = points[0], last = points[points.length - 1];
      if (!pinned.has(0)) L.marker([first.lat, first.lng], { icon: pinIcon("#334155", `Start ${fmtTime(first.at)}`), keyboard: false, zIndexOffset: 400 }).addTo(map);
      if (points.length > 1 && !pinned.has(points.length - 1)) L.marker([last.lat, last.lng], { icon: pinIcon("#334155", `Last ${fmtTime(last.at)}`), keyboard: false, zIndexOffset: 400 }).addTo(map);
    }

    const fit = () => {
      map.invalidateSize();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
    };
    fit();
    // The map usually mounts inside a dialog that is still animating open — refit once it has a size.
    const t = window.setTimeout(fit, 250);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(divRef.current);
    return () => { window.clearTimeout(t); ro?.disconnect(); map.remove(); };
  }, [points, checks, office]);

  return <div ref={divRef} className="relative z-0 h-64 w-full overflow-hidden rounded-xl border border-border sm:h-80" />;
}

const PRESENCE_LOOK: Record<NexusPresenceHour["status"], { title: string; className: string; icon: ReactNode }> = {
  inside: { title: "At the office", className: "border-emerald-500 bg-emerald-500 text-white", icon: <Check className="h-3.5 w-3.5" strokeWidth={3} /> },
  outside: { title: "Outside the office", className: "border-amber-500 bg-amber-500 text-white", icon: <X className="h-3.5 w-3.5" strokeWidth={3} /> },
  unclear: { title: "Unclear — the phone reported, but its position couldn’t say", className: "border-border bg-muted text-muted-foreground", icon: <span className="text-[11px] font-bold leading-none">?</span> },
  pending: { title: "This hour — not checked yet", className: "border-border bg-transparent text-muted-foreground", icon: <MoreHorizontal className="h-3.5 w-3.5" /> },
  gap: { title: "No check — the phone didn’t report", className: "border-dashed border-border bg-transparent text-muted-foreground", icon: <Minus className="h-3.5 w-3.5" /> },
};

/** One chip per office-clock hour: was the phone at the office when it checked? */
function PresenceChecks({ hours }: { hours: NexusPresenceHour[] }) {
  const decided = hours.filter((h) => h.status !== "pending");
  const atOffice = decided.filter((h) => h.status === "inside").length;
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Presence checks</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {hours.map((h) => {
          const look = PRESENCE_LOOK[h.status] ?? PRESENCE_LOOK.unclear;
          const tip = `${h.label}:00 · ${look.title}${h.at ? ` · ${fmtTime(h.at)} WIB` : ""}`;
          return (
            <li key={h.from} title={tip} aria-label={tip} className="flex w-7 flex-col items-center gap-0.5">
              <span className={`grid h-6 w-6 place-items-center rounded-full border ${look.className}`}>{look.icon}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{h.label}</span>
            </li>
          );
        })}
      </ul>
      {decided.length > 0 && <p className="mt-1.5 text-xs font-semibold">{atOffice} of {decided.length} {decided.length === 1 ? "hour" : "hours"} at the office</p>}
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">✓ at the office · ✗ outside · ? unclear · – no check. About one check an hour while at the office; outside, the route on the map.</p>
    </div>
  );
}

/** `compact`: always one column (map on top) — for narrow panels where a viewport breakpoint would lie. */
/** `trackingState`: the record's locationTrackingState, when the caller has it — explains an empty trail. */
export function LocationTrail({ recordId, compact = false, trackingState }: { recordId: string; compact?: boolean; trackingState?: "on" | "denied" | "web" | null }) {
  const q = useQuery({
    queryKey: ["attendance-trail", recordId],
    queryFn: () => nexusApi.attendanceTrail(recordId),
    retry: (n, e) => !(e instanceof ApiError && (e.status === 403 || e.status === 404)) && n < 1,
    staleTime: 30_000,
    // Still checked in → the trail is growing; keep it fresh while the panel is open.
    refetchInterval: (query) => (query.state.data && !query.state.data.record.checkOutAt ? 60_000 : false),
  });

  if (q.isLoading) return <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (q.isError || !q.data) {
    const e = q.error;
    const msg = e instanceof ApiError && e.status === 403 ? "You can only see the location trail of yourself and the people who report to you."
      : e instanceof ApiError && e.status === 404 ? "No location trail for this day."
      : "Couldn’t load the location trail — give it another go.";
    return <p className="rounded-xl border border-border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">{msg}</p>;
  }

  const trail = q.data;
  const { record } = trail;
  const hasPoints = trail.points.length > 0;
  const nowMs = Date.now();
  const spanEnd = (s: { to: string | null }) => s.to ? new Date(s.to).getTime() : record.checkOutAt ? new Date(record.checkOutAt).getTime() : nowMs;
  const spans = trail.outsideSpans.slice().sort((a, b) => a.from.localeCompare(b.from));
  const totalOutside = spans.reduce((acc, s) => acc + Math.max(0, spanEnd(s) - new Date(s.from).getTime()), 0);

  return (
    <div className={compact ? "grid gap-3" : "grid gap-3 md:grid-cols-[minmax(0,1fr)_15rem]"}>
      <div className="min-w-0">
        {hasPoints ? (
          <>
            <TrailMap trail={trail} />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-1 w-4 rounded-full" style={{ background: GREEN }} /> Inside office</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-1 w-4 rounded-full" style={{ background: AMBER }} /> Outside</span>
              {record.office && <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: OFFICE }} /> {record.office.name} ({Math.round(record.office.radiusMeters)} m)</span>}
              <span>Times in WIB</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
            <MapPinOff className="h-6 w-6 text-muted-foreground/60" />
            <p className="text-sm font-medium">No location recorded</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {trackingState === "web" ? "Checked in from the web — location isn’t tracked during the day. Tracking starts after check-in in the NEXUS app."
                : trackingState === "denied" ? "Location access was off on the phone, so nothing was recorded. Tracking starts after check-in in the NEXUS app."
                : !record.checkInAt ? "There’s no check-in on this day yet. Tracking starts after check-in in the NEXUS app."
                : !record.checkOutAt ? "No points yet. The app checks about once an hour while you’re at the office, and follows the route when you leave it."
                : "Nothing was sent: checked in without the NEXUS app, or with a version before 0.1.6 (those stayed silent inside the office)."}
            </p>
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-2 text-sm">
        {trail.presence && trail.presence.length > 0 && <PresenceChecks hours={trail.presence} />}
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LogIn className="h-3.5 w-3.5" /> Check-in</span>
            <span className="font-semibold tabular-nums">{fmtTime(record.checkInAt)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LogOut className="h-3.5 w-3.5" /> Check-out</span>
            <span className="font-semibold tabular-nums">
              {record.checkOutAt ? fmtTime(record.checkOutAt) : "Still in"}
              {record.checkOutOffsite && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Offsite</span>}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Outside the office</p>
          {spans.length === 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{hasPoints ? "Stayed inside the office radius." : "Nothing recorded."}</p>
          ) : (
            <>
              <ul className="mt-1.5 space-y-1">
                {spans.map((s) => (
                  <li key={s.from} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="tabular-nums">{fmtTime(s.from)} – {s.to ? fmtTime(s.to) : record.checkOutAt ? `${fmtTime(record.checkOutAt)} (out)` : "now"}</span>
                    <span className={s.to ? "text-muted-foreground" : "font-semibold text-amber-700"}>{fmtSpanDuration(spanEnd(s) - new Date(s.from).getTime())}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-border pt-1.5 text-xs text-muted-foreground">Total {fmtSpanDuration(totalOutside)} outside</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The trail in its own dialog — for places that have no detail panel to put it in. */
export function LocationTrailDialog({ recordId, title, subtitle, onClose }: { recordId: string; title: string; subtitle?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-3 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-border bg-card p-4 shadow-pop sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight"><RouteIcon className="h-4 w-4 text-primary" /> {title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <LocationTrail recordId={recordId} />
      </div>
    </div>
  );
}

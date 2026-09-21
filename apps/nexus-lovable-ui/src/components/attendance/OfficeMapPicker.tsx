import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, LocateFixed, Search } from "lucide-react";

/**
 * Pick the office point on a map instead of typing coordinates — the web twin of the iOS picker.
 *
 * The marker is draggable and the map moves with it; the circle is the check-in radius, redrawn
 * from the radius field live, so whether 75 m covers the car park is answered by looking. Search
 * jumps to an address (OpenStreetMap's Nominatim, no key), the locate button to the browser's
 * position. Every move writes lat/lng back to the composer, which keeps its own inputs for fine-tuning.
 */
export function OfficeMapPicker({ lat, lng, radiusMeters, onChange }: {
  lat: number | null; lng: number | null; radiusMeters: number; onChange: (lat: number, lng: number) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [searching, setSearching] = useState(false);

  const place = (la: number, lo: number, zoomTo = true) => {
    const map = mapRef.current; if (!map) return;
    const ll: L.LatLngExpression = [la, lo];
    if (markerRef.current) markerRef.current.setLatLng(ll); else {
      markerRef.current = L.marker(ll, { draggable: true, icon: L.divIcon({ className: "", html: `<div style="font-size:30px;line-height:1;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))">📍</div>`, iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(map);
      markerRef.current.on("dragend", () => { const p = markerRef.current!.getLatLng(); place(p.lat, p.lng, false); onChangeRef.current(p.lat, p.lng); });
    }
    if (circleRef.current) circleRef.current.setLatLng(ll); else {
      circleRef.current = L.circle(ll, { radius: radiusMeters, color: "#6d5ce7", weight: 2, fillColor: "#6d5ce7", fillOpacity: 0.14 }).addTo(map);
    }
    if (zoomTo) map.setView(ll, Math.max(15, Math.min(19, Math.round(16 - Math.log2(Math.max(radiusMeters, 50) / 100)))));
  };

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: false }).setView([lat ?? -6.2088, lng ?? 106.8456], lat != null ? 16 : 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    // A tap places the pin where the finger is — the fastest way to move it by a few metres.
    map.on("click", (e: L.LeafletMouseEvent) => { place(e.latlng.lat, e.latlng.lng, false); onChangeRef.current(e.latlng.lat, e.latlng.lng); });
    if (lat != null && lng != null) place(lat, lng);
    else if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => { place(p.coords.latitude, p.coords.longitude); onChangeRef.current(p.coords.latitude, p.coords.longitude); }, () => {}, { enableHighAccuracy: true, maximumAge: 30_000 });
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; circleRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The composer's own inputs edited by hand: keep the pin in step.
  useEffect(() => { if (lat != null && lng != null && mapRef.current) { const cur = markerRef.current?.getLatLng(); if (!cur || Math.abs(cur.lat - lat) > 1e-7 || Math.abs(cur.lng - lng) > 1e-7) place(lat, lng, false); } }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { circleRef.current?.setRadius(radiusMeters); }, [radiusMeters]);

  const search = async () => {
    const q = query.trim(); if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=id&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
      setResults(res.ok ? await res.json() : []);
    } catch { setResults([]); } finally { setSearching(false); }
  };
  const locate = () => navigator.geolocation?.getCurrentPosition((p) => { place(p.coords.latitude, p.coords.longitude); onChangeRef.current(p.coords.latitude, p.coords.longitude); });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} placeholder="Search an address or place" className="flex-1 bg-transparent text-sm outline-none" />
        {searching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <button type="button" onClick={() => void search()} className="text-xs font-semibold text-primary">Find</button>}
      </div>
      {results.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {results.map((r, i) => (
            <button key={i} type="button" onClick={() => { const la = Number(r.lat), lo = Number(r.lon); place(la, lo); onChangeRef.current(la, lo); setResults([]); }} className="block w-full px-3 py-2 text-left text-xs hover:bg-accent">{r.display_name}</button>
          ))}
        </div>
      )}
      <div className="relative">
        <div ref={divRef} className="h-64 w-full overflow-hidden rounded-xl border border-border" />
        <button type="button" onClick={locate} title="Use my location" className="absolute right-2 top-2 z-[400] grid h-9 w-9 place-items-center rounded-full bg-white text-primary shadow-md hover:bg-accent"><LocateFixed className="h-4 w-4" /></button>
      </div>
      <p className="text-[11px] text-muted-foreground">Drag the pin (or tap the map) onto the office entrance. The circle is where people can check in.</p>
    </div>
  );
}

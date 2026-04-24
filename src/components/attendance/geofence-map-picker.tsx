"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, LocateFixed, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type GeofenceMapPickerProps = {
  latitude: number | null
  longitude: number | null
  radiusMeters: number
  disabled?: boolean
  onChange: (coords: { latitude: number; longitude: number }) => void
}

type LeafletModule = typeof import("leaflet")

const DEFAULT_CENTER = {
  latitude: -6.2088,
  longitude: 106.8456,
}

export function GeofenceMapPicker({
  latitude,
  longitude,
  radiusMeters,
  disabled = false,
  onChange,
}: GeofenceMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import("leaflet").Map | null>(null)
  const markerRef = useRef<import("leaflet").Marker | null>(null)
  const circleRef = useRef<import("leaflet").Circle | null>(null)
  const onChangeRef = useRef(onChange)
  const disabledRef = useRef(disabled)
  const [mapReady, setMapReady] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationHint, setLocationHint] = useState("Klik peta untuk set pusat geofence.")

  const resolvedCenter = useMemo(
    () => ({
      latitude: latitude ?? DEFAULT_CENTER.latitude,
      longitude: longitude ?? DEFAULT_CENTER.longitude,
    }),
    [latitude, longitude]
  )

  // The Leaflet instance must be created once; ongoing coordinate/radius updates are handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  const createMarkerIcon = useCallback((L: LeafletModule) => {
    return L.divIcon({
      className: "attendance-geofence-marker",
      html: `
        <span style="
          display:flex;
          align-items:center;
          justify-content:center;
          width:18px;
          height:18px;
          border-radius:9999px;
          background:#0f172a;
          border:4px solid rgba(255,255,255,0.92);
          box-shadow:0 10px 20px rgba(15,23,42,0.22);
        "></span>
      `,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })
  }, [])

  useEffect(() => {
    let mounted = true

    async function initMap() {
      if (!containerRef.current || mapRef.current) return

      const L = await import("leaflet")
      if (!mounted || !containerRef.current) return
      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
        dragging: !disabled,
      }).setView([resolvedCenter.latitude, resolvedCenter.longitude], latitude && longitude ? 17 : 13)

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)

      const marker = L.marker([resolvedCenter.latitude, resolvedCenter.longitude], {
        icon: createMarkerIcon(L),
        interactive: false,
      }).addTo(map)

      const circle = L.circle([resolvedCenter.latitude, resolvedCenter.longitude], {
        radius: radiusMeters,
        color: "#111827",
        weight: 2,
        fillColor: "#0f172a",
        fillOpacity: 0.1,
      }).addTo(map)

      map.on("click", (event) => {
        if (disabledRef.current) return
        onChangeRef.current({
          latitude: Number(event.latlng.lat.toFixed(6)),
          longitude: Number(event.latlng.lng.toFixed(6)),
        })
        setLocationHint("Pusat geofence diupdate dari klik peta.")
      })

      mapRef.current = map
      markerRef.current = marker
      circleRef.current = circle
      setMapReady(true)
    }

    void initMap()

    return () => {
      mounted = false
      circleRef.current?.remove()
      markerRef.current?.remove()
      mapRef.current?.remove()
      circleRef.current = null
      markerRef.current = null
      mapRef.current = null
    }
  }, [createMarkerIcon])
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    const circle = circleRef.current
    if (!map || !marker || !circle) return

    const nextLatLng: [number, number] = [resolvedCenter.latitude, resolvedCenter.longitude]
    marker.setLatLng(nextLatLng)
    circle.setLatLng(nextLatLng)
    circle.setRadius(radiusMeters)
    map.setView(nextLatLng, map.getZoom(), { animate: false })
  }, [radiusMeters, resolvedCenter.latitude, resolvedCenter.longitude])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (disabled) {
      map.dragging.disable()
      map.doubleClickZoom.disable()
      map.boxZoom.disable()
      map.keyboard.disable()
      map.touchZoom.disable()
    } else {
      map.dragging.enable()
      map.doubleClickZoom.enable()
      map.boxZoom.enable()
      map.keyboard.enable()
      map.touchZoom.enable()
    }
  }, [disabled])

  const handleUseCurrentLocation = useCallback(async () => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setLocationHint("Browser ini tidak mendukung geolocation.")
      return
    }

    setLocating(true)
    setLocationHint("Mengambil lokasi perangkat...")
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        })
      })

      onChange({
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
      })
      setLocationHint("Koordinat diisi dari lokasi perangkat.")
    } catch {
      setLocationHint("Lokasi perangkat tidak berhasil diambil.")
    } finally {
      setLocating(false)
    }
  }, [onChange])

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-on-surface-variant/10 bg-surface-container-low">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-on-surface-variant/10 px-4 py-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-on-surface-variant/40">
            Geofence map picker
          </p>
          <p className="mt-1 text-xs font-medium text-on-surface-variant/65">{locationHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-surface-container px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant/55">
            <MapPin className="h-3.5 w-3.5" />
            Radius {Math.round(radiusMeters || 0)}m
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-2xl px-4 text-[10px] font-black uppercase tracking-[0.18em]"
            onClick={() => void handleUseCurrentLocation()}
            disabled={disabled || locating}
          >
            {locating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="mr-2 h-3.5 w-3.5" />}
            Use Current Location
          </Button>
        </div>
      </div>

      <div className="relative">
        {!mapReady && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-surface-container-low/80 backdrop-blur-sm">
            <div className="inline-flex items-center gap-2 rounded-full bg-surface-container px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-on-surface">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading map
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          className={cn("h-[320px] w-full", disabled && "pointer-events-none")}
        />
      </div>
    </div>
  )
}

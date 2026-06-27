// Robust geolocation for attendance check-in/out.
//
// iOS Safari (and some Androids) frequently TIME OUT a single high-accuracy getCurrentPosition call
// indoors / on weak GPS — even when the user has allowed location for the site. The old code did one
// high-accuracy call with no fallback and showed a generic "ditolak/timeout" message, which looks like
// a permission problem when it usually isn't. This helper tries high-accuracy first, then falls back to
// a coarser / recently-cached fix, and surfaces a clear, actionable message for the real failure mode.

export type GeoFix = { lat: number; lng: number; accuracy: number };

export class GeoError extends Error {}

function getPos(opts: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
}

export async function getAttendanceFix(): Promise<GeoFix> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new GeoError("This browser doesn't support GPS.");
  }
  try {
    // 1) Precise GPS — best for the geofence radius.
    const p = await getPos({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
  } catch (e) {
    const err = e as GeolocationPositionError;
    if (err && err.code === 1) {
      throw new GeoError("Location access denied. Allow location for this site in Settings, then try again.");
    }
    // Timeout (3) / position-unavailable (2): retry with coarse accuracy + accept a recent cached fix
    // (wifi/cell positioning is usually fast and accurate enough for geofencing).
    try {
      const p = await getPos({ enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
      return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
    } catch (e2) {
      const err2 = e2 as GeolocationPositionError;
      if (err2 && err2.code === 1) {
        throw new GeoError("Location access denied. Allow location for this site in Settings, then try again.");
      }
      if (err2 && err2.code === 3) {
        throw new GeoError("GPS timed out. Turn on Location Services + Precise Location for your browser, move near a window / open area, then try again.");
      }
      throw new GeoError("Couldn't get your location (weak signal). Make sure Location Services & Precise Location are on for your browser, then try again.");
    }
  }
}

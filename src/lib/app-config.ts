import { getAppSetting } from "@/lib/app-setting"

/**
 * Remote config for the apps (owner, 28 Sep 2026: "prioritize server-side so we don't submit to Apple
 * for every change"). GET /api/app/config serves DEFAULTS below deep-merged with the AppSetting row
 * "app-config", then that row's `platforms.<ios|android|web>` block. Change a flag, a number or a
 * sentence there and every app picks it up at its next launch/foreground — no App Store review.
 *
 * Rules for adding a key:
 *   • the apps ship with the same default, so an app that cannot reach the server behaves exactly as
 *     the default says; a key the app does not know is ignored (never an error);
 *   • texts come in both languages; an app shows its language, else English, else its own copy;
 *   • nothing secret goes here — the route is public.
 */
export type AppConfig = {
  flags: {
    /** Check-in refused until location is "Always" + Precise (iOS) / "Allow all the time" + precise (Android). */
    requireAlwaysLocation: boolean
    /** Logout refused while a workday is running. */
    blockSignOutDuringWorkday: boolean
    /** Control Room › Fake GPS tab. */
    fakeGpsReview: boolean
  }
  values: {
    /** Local alert on the phone this many minutes into an outside episode (0 = off). */
    outsideHourAlertMinutes: number
  }
  texts: Record<"en" | "id", Record<string, string>>
  /** One app-wide notice at the top of Home, or null. `id` changes → shown again to people who closed it. */
  banner: null | { id: string; tone: "info" | "warning" | "danger"; title: string; message: string; link?: string | null }
}

export const APP_CONFIG_DEFAULTS: AppConfig = {
  flags: { requireAlwaysLocation: true, blockSignOutDuringWorkday: true, fakeGpsReview: true },
  values: { outsideHourAlertMinutes: 60 },
  texts: {
    en: {
      "location.always.title": "Turn on location “Always”",
      "location.always.body": "NEXUS needs your location set to “Always” with Precise Location on to check you in. It is used only between check-in and check-out: about once an hour at the office, and your route while you are out of it.",
      "location.always.button": "Open Settings",
      "signout.blocked.title": "Check out first",
      "signout.blocked.body": "You're checked in, so your workday and live location are still running. You can't sign out until you check out — check out on the Attendance screen, then sign out.",
    },
    id: {
      "location.always.title": "Nyalakan lokasi “Selalu”",
      "location.always.body": "NEXUS butuh izin lokasi “Selalu” dengan Lokasi Akurat menyala untuk check in. Lokasi hanya dipakai antara check-in dan check-out: sekitar sejam sekali di kantor, dan rutemu selama di luar kantor.",
      "location.always.button": "Buka Pengaturan",
      "signout.blocked.title": "Check out dulu",
      "signout.blocked.body": "Kamu sedang check in, jadi jam kerja dan lokasi live masih berjalan. Kamu tidak bisa keluar dari akun sebelum check out — check out dulu di layar Absensi, lalu keluar.",
    },
  },
  banner: null,
}

type Stored = Partial<AppConfig> & { platforms?: Partial<Record<"ios" | "android" | "web", Partial<AppConfig>>> }

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T))
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : v
  return out as T
}

export async function getAppConfig(platform: "ios" | "android" | "web" | null): Promise<AppConfig & { updatedAt: string | null }> {
  const stored = (await getAppSetting<Stored>("app-config").catch(() => null)) ?? {}
  const { platforms, ...shared } = stored
  let cfg = merge(APP_CONFIG_DEFAULTS, shared)
  if (platform && platforms?.[platform]) cfg = merge(cfg, platforms[platform])
  return { ...cfg, updatedAt: null }
}

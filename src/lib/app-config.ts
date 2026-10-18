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
    /** The Calendar menu (master calendar, /api/calendar/**). Who actually gets data is decided per person on the server (rollout audience). */
    calendar: boolean
    /** The Calendar widgets (Home Screen, Lock Screen) and the Apple Watch calendar. */
    calendarWidgets: boolean
    /** The automatic offsite check-out after 2 h 30 outside the office. Off since 8 Oct 2026 (owner):
     *  staff who went out to a meeting after checking in at the office were being checked out. Off =
     *  the record stays open until they check out; they still get the 1 h 30 and 2 h reminders, and
     *  their attendance approvers one push at 1 h 30. The apps show no countdown while it is off. */
    outsideAutoCheckout: boolean
    /** Check-in/out refused from an Android phone's BROWSER (owner, 16 Oct 2026). Off until the big-release
     *  Android APK ships; desktop and iPhone/iPad browsers are always refused. The apps may ignore it. */
    blockAndroidBrowserAttendance: boolean
    /** GIDEON credits phase 2 (owner, 18 Oct 2026). Off = every answer is recorded and shown, nothing is
     *  refused. On = a person out of credits is answered by GIDEON Aphrodite (max 30 a day), then refused;
     *  GIDEON Model 0 stays free. BoD / One Above All are unlimited by default. */
    gideonCreditsEnforced: boolean
    /** Meeting notes, Beta (owner, 18 Oct 2026): GIDEON turns a meeting recording into minutes and tasks. Off = the
     *  entry points are hidden and new uploads are refused; meetings already made stay readable. */
    meetingNotesEnabled: boolean
    /** GIDEON Memory (owner, 19 Oct 2026): per-person memory. Off = an emergency kill switch: nothing is remembered or
     *  used, the memory tools refuse, Settings › GIDEON Memory still lists and deletes what is there. */
    gideonMemory: boolean
    /** GIDEON tools package (owner, 18 Oct 2026), one flag per group (lib/gideon-tools/meta.ts EXTRA_TOOL_GROUP).
     *  Off = those tools answer "not available yet" and their cards cannot be applied. */
    gideonToolsInbox: boolean
    gideonToolsChat: boolean
    gideonToolsReminders: boolean
    gideonToolsLeave: boolean
    gideonToolsBulkTasks: boolean
    gideonToolsPipeline: boolean
    gideonToolsOutletSocial: boolean
    gideonToolsLegal: boolean
    gideonToolsVault: boolean
    gideonToolsDocEdit: boolean
    gideonToolsForms: boolean
    gideonToolsPerformance: boolean
    gideonToolsAnnouncement: boolean
    gideonToolsSheets: boolean
    gideonToolsImages: boolean
    gideonToolsFiles: boolean
    /** Presence status (owner, 19 Oct 2026): Online / Away / Sick / Leave / Not checked in / Offline on avatars, profiles,
     *  DM headers, Control Room and GIDEON (get_person_status, set_my_status). Off = GET /api/presence answers
     *  enabled:false with no statuses, setting is refused, no realtime events; the apps hide every status. */
    presenceStatus: boolean
  }
  values: {
    /** Local alert on the phone this many minutes into an outside episode (0 = off). */
    outsideHourAlertMinutes: number
    /** How often an open Calendar screen asks again (ETag makes an unchanged answer a 304). */
    calendarPollSeconds: number
    /** Meeting notes: days the audio is kept after the minutes are saved (or after they were ready, if never saved). */
    meetingAudioRetentionDays: number
    /** Meeting notes: longest recording, in minutes. */
    meetingMaxMinutes: number
    /** Meeting notes: largest file, in MB. */
    meetingMaxMB: number
  }
  texts: Record<"en" | "id", Record<string, string>>
  /** One app-wide notice at the top of Home, or null. `id` changes → shown again to people who closed it. */
  banner: null | { id: string; tone: "info" | "warning" | "danger"; title: string; message: string; link?: string | null }
}

/** GIDEON tools groups (18 Oct 2026): on unless listed off here; prod opens the rest per runbook L.28. */
const GIDEON_TOOL_FLAG_DEFAULTS = {
  gideonToolsInbox: true, gideonToolsChat: true, gideonToolsReminders: true, gideonToolsLeave: true, gideonToolsBulkTasks: true,
  gideonToolsPipeline: true, gideonToolsOutletSocial: true, gideonToolsLegal: true, gideonToolsVault: true, gideonToolsDocEdit: true,
  gideonToolsForms: true, gideonToolsPerformance: true, gideonToolsAnnouncement: true, gideonToolsSheets: true, gideonToolsImages: true,
  gideonToolsFiles: true,
}

export const APP_CONFIG_DEFAULTS: AppConfig = {
  flags: { requireAlwaysLocation: true, blockSignOutDuringWorkday: true, fakeGpsReview: true, calendar: true, calendarWidgets: true, outsideAutoCheckout: false, blockAndroidBrowserAttendance: false, gideonCreditsEnforced: false, meetingNotesEnabled: true, gideonMemory: true, presenceStatus: true, ...GIDEON_TOOL_FLAG_DEFAULTS },
  values: { outsideHourAlertMinutes: 60, calendarPollSeconds: 60, meetingAudioRetentionDays: 30, meetingMaxMinutes: 180, meetingMaxMB: 500 },
  texts: {
    en: {
      "location.always.title": "Turn on location “Always”",
      "location.always.body": "NEXUS needs your location set to “Always” with Precise Location on to check you in. It is used only between check-in and check-out: about once an hour at the office, and your route while you are out of it.",
      "location.always.button": "Open Settings",
      "signout.blocked.title": "Check out first",
      "signout.blocked.body": "You're checked in, so your workday and live location are still running. You can't sign out until you check out — check out on the Attendance screen, then sign out.",
      "calendar.none.title": "Join your company's workspace",
      "calendar.none.body": "The Calendar shows the tasks of everyone in your company, grouped by the IP & Division Chart. Enter your workspace code to join it.",
      "calendar.off.title": "The Calendar is on its way",
      "calendar.off.body": "It opens for BoD and Managers first, then for everyone. Your own tasks are still in My Tasks.",
      "calendar.empty.title": "Nothing due in this month",
      "calendar.empty.body": "Tasks with a due date show up here as dots. Pick another month, or add a due date to a task.",
      "calendar.masked": "Internal task",
    },
    id: {
      "location.always.title": "Nyalakan lokasi “Selalu”",
      "location.always.body": "NEXUS butuh izin lokasi “Selalu” dengan Lokasi Akurat menyala untuk check in. Lokasi hanya dipakai antara check-in dan check-out: sekitar sejam sekali di kantor, dan rutemu selama di luar kantor.",
      "location.always.button": "Buka Pengaturan",
      "signout.blocked.title": "Check out dulu",
      "signout.blocked.body": "Kamu sedang check in, jadi jam kerja dan lokasi live masih berjalan. Kamu tidak bisa keluar dari akun sebelum check out — check out dulu di layar Absensi, lalu keluar.",
      "calendar.none.title": "Gabung ke workspace perusahaanmu",
      "calendar.none.body": "Kalender menampilkan tugas semua orang di perusahaanmu, dikelompokkan menurut Bagan IP & Divisi. Masukkan kode workspace untuk bergabung.",
      "calendar.off.title": "Kalender segera hadir",
      "calendar.off.body": "Dibuka untuk BoD dan Manager dulu, lalu untuk semua. Tugasmu sendiri tetap ada di Tugas Saya.",
      "calendar.empty.title": "Tidak ada tenggat di bulan ini",
      "calendar.empty.body": "Tugas yang punya tenggat muncul di sini sebagai titik. Pilih bulan lain, atau beri tenggat pada tugas.",
      "calendar.masked": "Tugas internal",
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

/** flags.blockAndroidBrowserAttendance as stored (shared block, default off); a settings read error keeps it off. */
export async function androidBrowserAttendanceBlocked(): Promise<boolean> {
  return (await getAppConfig(null).catch(() => null))?.flags.blockAndroidBrowserAttendance === true
}

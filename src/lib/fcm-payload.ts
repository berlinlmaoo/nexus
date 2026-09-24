/**
 * What an Android push looks like on the wire (FCM HTTP v1), and how to read FCM's refusals.
 *
 * Pure: no imports and no I/O, so fcm-payload.test.mjs can load it with plain node. The sender that
 * signs and posts these lives in fcm.ts.
 *
 * The payload carries the same fields the APNs payload does (apns.ts sendOne): title, body, type, and
 * when present taskId, projectId, link, category, plus the caller's extra `data` keys — which, as on
 * iOS, can never replace the fixed ones. It is a DATA-ONLY message (owner decision 24 Sep 2026,
 * nexus-android SERVER-REQUESTS R1):
 *   data             every field as a string (FCM requires string values), plus `channel` — the
 *                    notification channel the app files it under (androidChannelFor). With no
 *                    `notification` block the app's onMessageReceived runs in the foreground, the
 *                    background and when killed, so the app builds every notification itself (the
 *                    "File a permit" action, tap routing from `link`, marking `notificationId` read).
 *   android          priority HIGH only: required for delivery while the phone dozes. No
 *                    android.notification — that would make the system draw it again.
 */

export type AndroidChannelId =
  | "attendance_reminders"
  | "attendance_location"
  | "approvals"
  | "messages"
  | "tasks"
  | "tickets"
  | "announcements"
  | "system"

/** The channel ids the Android app creates (PRD §4.5). */
export const ANDROID_CHANNELS: readonly AndroidChannelId[] = [
  "attendance_reminders", "attendance_location", "approvals", "messages", "tasks", "tickets", "announcements", "system",
]

/** Outside-office pushes carry this category (attendance-outside.ts OUTSIDE_PUSH_CATEGORY). */
const OUTSIDE_OFFICE_CATEGORY = "NEXUS_OUTSIDE_OFFICE"

const EXACT: Record<string, AndroidChannelId> = {
  attendance_checkin_reminder: "attendance_reminders",
  attendance_checkout_reminder: "attendance_reminders",
  attendance_absent_recorded: "attendance_reminders",
  dayoff_quota_low: "attendance_reminders",
  red_date_quota_low: "attendance_reminders",
  attendance_override: "attendance_reminders",

  attendance_outside_reminder: "attendance_location",
  attendance_outside_warning: "attendance_location",
  attendance_auto_offsite_checkout: "attendance_location",

  attendance_request_pending: "approvals",
  attendance_request_reviewed: "approvals",
  attendance_request_escalated: "approvals",
  offsite_checkout_pending: "approvals",
  offsite_checkout_reviewed: "approvals",

  message: "messages",
  message_mention: "messages",
  feed_mention: "messages",
  feed_comment: "messages",

  project_invite: "tasks",
  status_update: "tasks",
  automation: "tasks",
  submission_status: "tasks",
  streak_at_risk: "tasks",
  quest_claimable: "tasks",

  system_gideon: "tickets",
  violation_announcement: "tickets",

  announcement: "announcements",

  app_update: "system",
  system_disk: "system",
  test_notification: "system",
}

const PREFIX: Array<[string, AndroidChannelId]> = [
  ["task_", "tasks"],
  ["comment_", "tasks"],
  ["booking_", "tasks"],
  ["complaint_", "tickets"],
  ["peer_report_", "tickets"],
  ["google_workspace_", "system"],
]

/**
 * The Android notification channel for a push (SERVER-REQUESTS R1 table). The outside-office
 * category wins over the type; then exact types; then the prefix families; anything else (including a
 * type added later that nobody mapped) → "system", so it is never lost. Case-insensitive.
 */
export function androidChannelFor(type: string | null | undefined, category?: string | null): AndroidChannelId {
  if (category === OUTSIDE_OFFICE_CATEGORY) return "attendance_location"
  const t = (type ?? "").trim().toLowerCase()
  const exact = EXACT[t]
  if (exact) return exact
  for (const [prefix, channel] of PREFIX) if (t.startsWith(prefix)) return channel
  return "system"
}

export interface FcmPushInput {
  title: string
  body: string
  type: string
  taskId?: string | null
  projectId?: string | null
  link?: string | null
  category?: string | null
  /** The in-app Notification row this push mirrors, so a tap can mark it read. */
  notificationId?: string | null
  data?: Record<string, string | number | boolean | null> | null
}

// FCM refuses a data message that uses these keys (or any key starting with "google." / "gcm.").
const FCM_RESERVED_DATA_KEYS = new Set(["from", "notification", "message_type", "collapse_key"])

function isReservedDataKey(key: string): boolean {
  return FCM_RESERVED_DATA_KEYS.has(key.toLowerCase()) || /^(google|gcm)\./i.test(key)
}

/** The body of POST https://fcm.googleapis.com/v1/projects/<id>/messages:send for one device. */
export function buildFcmMessage(token: string, p: FcmPushInput) {
  const data: Record<string, string> = {}
  // Extra keys first, fixed keys after: the same precedence as the APNs payload.
  for (const [k, v] of Object.entries(p.data ?? {})) {
    if (v === null || v === undefined || isReservedDataKey(k)) continue
    data[k] = String(v)
  }
  data.title = p.title
  data.body = p.body
  data.type = p.type
  if (p.taskId) data.taskId = p.taskId
  if (p.projectId) data.projectId = p.projectId
  if (p.link) data.link = p.link
  if (p.category) data.category = p.category
  if (p.notificationId) data.notificationId = p.notificationId
  data.channel = androidChannelFor(p.type, p.category)

  return {
    message: {
      token,
      data,
      android: { priority: "HIGH" as const },
    },
  }
}

export interface FcmFailure {
  status: number
  /** FcmError.errorCode (UNREGISTERED, INVALID_ARGUMENT, SENDER_ID_MISMATCH, QUOTA_EXCEEDED, …) or
   *  google.rpc status when FCM gave no FcmError detail. */
  errorCode: string | null
  message: string | null
  /** The token is dead: disable the device (mirrors APNs 410 / BadDeviceToken / Unregistered). */
  invalidToken: boolean
  /** Worth retrying later (429, 5xx); nothing is disabled. */
  transient: boolean
}

/**
 * Read an FCM v1 error response.
 *
 * Disabled (invalidToken):
 *   UNREGISTERED (404)       the app was uninstalled or the token expired/rotated.
 *   INVALID_ARGUMENT (400)   ONLY when FCM's message is about the registration token. The same code
 *                            also means "this message is malformed", and a payload bug must not wipe
 *                            every Android device in one send; that case is logged, not disabled.
 * Not disabled: SENDER_ID_MISMATCH (a wrong service account would otherwise disable everyone — fix the
 * env instead), auth errors (401/403: configuration), QUOTA_EXCEEDED / UNAVAILABLE / INTERNAL (transient).
 */
export function classifyFcmError(status: number, body: unknown): FcmFailure {
  const err = (body && typeof body === "object" ? (body as { error?: unknown }).error : null) as
    | { status?: unknown; message?: unknown; details?: unknown }
    | null
    | undefined
  const details = Array.isArray(err?.details) ? (err!.details as Array<Record<string, unknown>>) : []
  const fcmDetail = details.find((d) => typeof d?.errorCode === "string")
  const errorCode = (fcmDetail?.errorCode as string | undefined) ?? (typeof err?.status === "string" ? err.status : null)
  const message = typeof err?.message === "string" ? err.message : null

  const invalidToken =
    errorCode === "UNREGISTERED" ||
    (errorCode === "INVALID_ARGUMENT" && /registration token/i.test(message ?? ""))
  const transient = !invalidToken && (status === 429 || status >= 500 || errorCode === "UNAVAILABLE" || errorCode === "INTERNAL" || errorCode === "QUOTA_EXCEEDED")
  return { status, errorCode, message, invalidToken, transient }
}

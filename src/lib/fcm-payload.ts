/**
 * What an Android push looks like on the wire (FCM HTTP v1), and how to read FCM's refusals.
 *
 * Pure: no imports and no I/O, so fcm-payload.test.mjs can load it with plain node. The sender that
 * signs and posts these lives in fcm.ts.
 *
 * The payload carries the same fields the APNs payload does (apns.ts sendOne): title, body, type, and
 * when present taskId, projectId, link, category, plus the caller's extra `data` keys — which, as on
 * iOS, can never replace the fixed ones. It is a notification + data message:
 *   notification     title/body, so the system shows it while the app is in the background or killed;
 *   data             every field as a string (FCM requires string values), for tap routing and for
 *                    onMessageReceived while the app is in the foreground;
 *   android          high priority, and the channel the app files it under (androidChannelFor).
 */

export type AndroidChannelId = "attendance" | "messages" | "general"

/**
 * The Android notification channel for a notification type. The Android app must create channels
 * with exactly these ids (a message naming a channel that does not exist falls back to the app's
 * default channel, so an unknown id is not fatal, but the user's per-channel settings would not apply).
 *   attendance_*, attendance, offsite_checkout_*   → "attendance"
 *   MESSAGE, MESSAGE_MENTION (chat)                → "messages"
 *   everything else                                → "general"
 */
export function androidChannelFor(type: string | null | undefined): AndroidChannelId {
  const t = (type ?? "").toLowerCase()
  if (t === "attendance" || t.startsWith("attendance_") || t.startsWith("offsite_checkout_")) return "attendance"
  if (t === "message" || t.startsWith("message_")) return "messages"
  return "general"
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

  return {
    message: {
      token,
      notification: { title: p.title, body: p.body },
      data,
      android: {
        priority: "HIGH" as const,
        notification: { channel_id: androidChannelFor(p.type), sound: "default" },
      },
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

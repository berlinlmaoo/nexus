import { connect, constants as http2Constants, type ClientHttp2Session } from "node:http2"
import { createPrivateKey, sign } from "node:crypto"
import { readFileSync } from "node:fs"
import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"
import { fcmConfigured, sendFcm } from "@/lib/fcm"
import { badgeAllowedFor } from "@/lib/chat-rules"

const log = createLogger("apns")

export type PushPayload = {
  title: string
  body: string
  type: string
  taskId?: string | null
  projectId?: string | null
  link?: string | null
  /** aps.category — iOS shows the actions registered for it (NEXUS_OUTSIDE_OFFICE → FILE_PERMIT). */
  category?: string | null
  /** Extra top-level custom keys (e.g. recordId). Can never replace aps, type, taskId, projectId or link. */
  data?: Record<string, string | number | boolean | null> | null
  /** The in-app Notification row id. Sent to Android (FCM data) only; the APNs payload is unchanged. */
  notificationId?: string | null
  /** aps.thread-id: notifications sharing it stack together (chat: the conversation id). */
  threadId?: string | null
  /**
   * The app-icon number. aps.badge on iPhones that manage their own badge (chat-rules
   * badgeAllowedFor: iOS 0.1.7+ — older builds never clear it), `badge` in the FCM data on Android.
   * Absent = the icon is left as it is, which is what every push before chat did.
   */
  badge?: number | null
}

// Android devices while NEXUS_FCM_SERVICE_ACCOUNT_JSON is unset: said once per process, not per push.
let fcmMissingLogged = false

let cachedJWT: { value: string; createdAt: number } | null = null

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url")
}

function providerJWT(): string | null {
  const teamId = process.env.APNS_TEAM_ID
  const keyId = process.env.APNS_KEY_ID
  if (!teamId || !keyId) return null

  const now = Math.floor(Date.now() / 1000)
  if (cachedJWT && now - cachedJWT.createdAt < 50 * 60) return cachedJWT.value

  let rawKey = process.env.APNS_PRIVATE_KEY
  if (!rawKey && process.env.APNS_PRIVATE_KEY_PATH) {
    try {
      rawKey = readFileSync(process.env.APNS_PRIVATE_KEY_PATH, "utf8")
    } catch (error) {
      console.error("[apns] unable to read private key file", { error: String(error) })
      return null
    }
  }
  if (!rawKey) return null

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }))
  const claims = base64url(JSON.stringify({ iss: teamId, iat: now }))
  const unsigned = `${header}.${claims}`
  const key = createPrivateKey(rawKey.replace(/\\n/g, "\n"))
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" })
  const value = `${unsigned}.${base64url(signature)}`
  cachedJWT = { value, createdAt: now }
  return value
}

/** The JSON body Apple receives. Exported for tests; `data` can never replace the fixed keys. */
export function buildApnsBody(payload: PushPayload, opts: { badge?: boolean } = {}) {
  const withBadge = opts.badge !== false && typeof payload.badge === "number" && Number.isFinite(payload.badge)
  return {
    ...(payload.data ?? {}),
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      ...(payload.category ? { category: payload.category } : {}),
      ...(payload.threadId ? { "thread-id": payload.threadId } : {}),
      ...(withBadge ? { badge: Math.max(0, Math.floor(payload.badge as number)) } : {}),
    },
    type: payload.type,
    ...(payload.taskId ? { taskId: payload.taskId } : {}),
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
    ...(payload.link ? { link: payload.link } : {}),
  }
}

// ── one HTTP/2 session per Apple endpoint, reused ──────────────────────────────────────────────
//
// Until 8 Oct 2026 every push opened its own TLS + HTTP/2 connection to Apple and closed it again,
// with no timeout anywhere: a message to a 40-person group was 40+ handshakes, and a stalled
// connection held the sender's request open (the push was awaited before the reply). Apple's own
// guidance is to keep the connection open and reuse it. One session per origin (production and
// sandbox), opened on first use, dropped on error/GOAWAY/close and reopened on the next push,
// closed after IDLE_CLOSE_MS without traffic.

const CONNECT_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 10_000
const IDLE_CLOSE_MS = 5 * 60_000
/** Concurrent pushes in flight per process (APNs + FCM). Apple allows far more; this is our side. */
const MAX_IN_FLIGHT = 16

type SessionEntry = { session: ClientHttp2Session; ready: Promise<ClientHttp2Session> }
const sessions = new Map<string, SessionEntry>()

function dropSession(origin: string, session: ClientHttp2Session, destroy = false) {
  if (sessions.get(origin)?.session === session) sessions.delete(origin)
  if (destroy) {
    if (!session.destroyed) session.destroy()
  } else if (!session.closed && !session.destroyed) {
    session.close()
  }
}

function getSession(origin: string): Promise<ClientHttp2Session> {
  const cached = sessions.get(origin)
  if (cached && !cached.session.closed && !cached.session.destroyed) return cached.ready

  const session = connect(origin)
  const ready = new Promise<ClientHttp2Session>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`APNs connect timeout after ${CONNECT_TIMEOUT_MS} ms`))
      dropSession(origin, session, true)
    }, CONNECT_TIMEOUT_MS)
    session.once("connect", () => { clearTimeout(timer); resolve(session) })
    session.once("error", (error) => { clearTimeout(timer); reject(error) })
    session.once("close", () => { clearTimeout(timer); reject(new Error("APNs session closed before it connected")) })
  })
  // Never without an 'error' listener: an unhandled 'error' on the session would take the server down.
  session.on("error", (error) => {
    log.warn("APNs session error — reconnecting on the next push", { origin, error: String(error) })
    dropSession(origin, session, true)
  })
  session.on("goaway", () => dropSession(origin, session))
  session.on("close", () => { if (sessions.get(origin)?.session === session) sessions.delete(origin) })
  session.setTimeout(IDLE_CLOSE_MS, () => dropSession(origin, session))
  // An idle push connection must not keep a script (or a test) alive.
  session.unref()
  ready.catch(() => dropSession(origin, session, true))
  sessions.set(origin, { session, ready })
  return ready
}

function createLimiter(max: number) {
  let active = 0
  const waiting: Array<() => void> = []
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}
const inFlight = createLimiter(MAX_IN_FLIGHT)

async function sendOne(
  token: string,
  environment: string,
  bundleId: string,
  payload: PushPayload,
  badge: boolean,
): Promise<{ status: number; reason?: string }> {
  const jwt = providerJWT()
  if (!jwt) return { status: 0, reason: "APNs is not configured" }

  const origin = environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com"

  const session = await getSession(origin)
  return new Promise((resolve, reject) => {
    let request: ReturnType<ClientHttp2Session["request"]>
    try {
      request = session.request({
        [http2Constants.HTTP2_HEADER_METHOD]: "POST",
        [http2Constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
      })
    } catch (error) {
      // The session died between being handed out and being used.
      dropSession(origin, session, true)
      reject(error)
      return
    }
    let status = 0
    let response = ""
    let settled = false
    request.setEncoding("utf8")
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      if (settled) return
      settled = true
      request.close(http2Constants.NGHTTP2_CANCEL)
      // Nothing back in 10 s: the connection is most likely half-dead. The retry gets a fresh one.
      dropSession(origin, session, true)
      reject(new Error(`APNs request timeout after ${REQUEST_TIMEOUT_MS} ms`))
    })
    request.on("response", (headers) => { status = Number(headers[http2Constants.HTTP2_HEADER_STATUS] || 0) })
    request.on("data", (chunk) => { response += chunk })
    request.on("end", () => {
      if (settled) return
      settled = true
      let reason: string | undefined
      try { reason = response ? JSON.parse(response).reason : undefined } catch { reason = response || undefined }
      // A refused provider token is ours to replace, not the device's fault.
      if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") cachedJWT = null
      resolve({ status, reason })
    })
    request.on("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    // A stream torn down with its session (reset, GOAWAY mid-flight) can close with neither 'end' nor
    // 'error'; without this the push would wait forever and hold its slot.
    request.on("close", () => {
      if (settled) return
      settled = true
      reject(new Error(`APNs stream closed without an answer (code ${request.rstCode ?? "?"})`))
    })
    request.end(JSON.stringify(buildApnsBody(payload, { badge })))
  })
}

/**
 * `sendOne` dengan dua kali coba ulang, HANYA saat transport putus sebelum Apple menjawab (koneksi
 * HTTP/2 ditutup/di-reset, "The pending stream has been canceled", timeout). 24 Sep 2026: pengingat
 * "Masih di luar kantor" hilang dari iPhone karena satu stream batal dan tidak dicoba lagi.
 * Jawaban Apple apa pun (200, 400, 410, …) TIDAK diulang — itu keputusan, bukan kecelakaan.
 */
async function sendOneWithRetry(
  token: string,
  environment: string,
  bundleId: string,
  payload: PushPayload,
  badge: boolean,
): Promise<{ status: number; reason?: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 700))
    try {
      return await sendOne(token, environment, bundleId, payload, badge)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

type Installation = {
  id: string
  userId: string
  platform: string
  token: string
  environment: string
  bundleId: string
  appVersion: string | null
}

type Tally = { sent: number; failed: number; disabled: number; skippedIos: number; skippedAndroid: number; alasan: string[] }

/** Every device in `installations`, each with its own owner's payload. Never throws. */
async function deliver(
  installations: Installation[],
  payloadFor: (installation: Installation) => PushPayload,
  apnsReady: boolean,
  fcmReady: boolean,
): Promise<Tally> {
  const t: Tally = { sent: 0, failed: 0, disabled: 0, skippedIos: 0, skippedAndroid: 0, alasan: [] }

  const results = await Promise.allSettled(installations.map((installation) => inFlight(async () => {
    const payload = payloadFor(installation)
    if (installation.platform === "android") {
      if (!fcmReady) { t.skippedAndroid++; return }
      const result = await sendFcm(installation.token, payload)
      if (result.ok) {
        t.sent++
      } else if (result.invalidToken) {
        await prisma.deviceInstallation.update({
          where: { id: installation.id },
          data: { disabledAt: new Date() },
        })
        t.disabled++
        t.alasan.push(`fcm:${result.errorCode ?? result.status}(dimatikan)`)
      } else {
        t.failed++
        t.alasan.push(`fcm:${result.status}${result.errorCode ? " " + result.errorCode : ""}`)
      }
      return
    }
    if (!apnsReady) { t.skippedIos++; return }
    const result = await sendOneWithRetry(
      installation.token,
      installation.environment,
      installation.bundleId,
      payload,
      badgeAllowedFor(installation.platform, installation.appVersion),
    )
    if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered") {
      await prisma.deviceInstallation.update({
        where: { id: installation.id },
        data: { disabledAt: new Date() },
      })
      t.disabled++
      t.alasan.push(`${installation.environment}:${result.reason ?? result.status}(dimatikan)`)
    } else if (result.status === 200) {
      t.sent++
    } else {
      t.failed++
      t.alasan.push(`${installation.environment}:${result.status}${result.reason ? " " + result.reason : ""}`)
    }
  })))

  // Inilah yang dulu hilang: `allSettled` tidak pernah melempar, jadi penolakan harus DIBACA.
  // Tanpa lingkaran ini, koneksi yang gagal ke Apple tidak meninggalkan jejak apa pun.
  for (const r of results) {
    if (r.status === "rejected") {
      t.failed++
      t.alasan.push(`transport: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    }
  }
  return t
}

const installationSelect = {
  id: true, userId: true, platform: true, token: true, environment: true, bundleId: true, appVersion: true,
} as const

function logTally(t: Tally, ringkas: Record<string, unknown>, type: string) {
  if (t.skippedIos > 0) {
    log.error("APNs tidak terkonfigurasi — push iOS TIDAK dikirim", { ...ringkas, perangkatIos: t.skippedIos, type })
  }
  if (t.skippedAndroid > 0 && !fcmMissingLogged) {
    fcmMissingLogged = true
    log.warn("NEXUS_FCM_SERVICE_ACCOUNT_JSON tidak diisi — push ke perangkat Android dilewati (baris ini sekali per proses)")
  }
  const line = {
    ...ringkas, terkirim: t.sent, gagal: t.failed, dimatikan: t.disabled,
    ...(t.skippedIos || t.skippedAndroid ? { dilewati: t.skippedIos + t.skippedAndroid } : {}),
  }
  if (t.failed > 0 || t.disabled > 0) {
    log.error("push sebagian/seluruhnya gagal", { ...line, alasan: t.alasan.slice(0, 5) })
  } else {
    log.info("push terkirim", line)
  }
}

/**
 * Kirim satu push ke SEMUA perangkat aktif milik seseorang.
 *
 * Fungsi ini pernah gagal dalam dua cara yang sama-sama tak berjejak, dan keduanya menghabiskan
 * berhari-hari untuk diselidiki karena log-nya bersih:
 *
 *   1. `if (!providerJWT()) return` — kunci APNs tidak terbaca, fungsi keluar diam-diam, dan
 *      tidak ada satu baris pun yang menyebut bahwa push memang tidak pernah dicoba.
 *   2. `sendOne` MELEMPAR kalau koneksi ke Apple gagal, dan `Promise.allSettled` menelan
 *      lemparan itu. Jaringan ke Apple putus = setiap push mati total = log kosong bersih.
 *
 * Sekarang setiap jalan meninggalkan satu baris ringkasan. Bukan satu baris per perangkat —
 * itu membanjiri log pada pengumuman ke 48 orang — melainkan satu baris per pemanggilan, yang
 * cukup untuk menjawab "push-nya jalan tidak?" dalam sepuluh detik.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  // Two providers: APNs for iOS rows, FCM for Android rows (DeviceInstallation.platform). Each is
  // checked on its own, so a missing FCM key never stops iOS and the other way round.
  const apnsReady = providerJWT() !== null
  const fcmReady = fcmConfigured()
  if (!apnsReady && !fcmReady) {
    // Diam di sini pernah berarti berminggu-minggu mengira push berfungsi.
    log.error("APNs tidak terkonfigurasi — push TIDAK dikirim", { userId, type: payload.type })
    return
  }
  const installations = await prisma.deviceInstallation.findMany({
    where: { userId, disabledAt: null },
    select: installationSelect,
  })
  if (installations.length === 0) {
    // Bukan galat: banyak orang memang belum pernah memasang aplikasinya. Tapi kalau SEORANG
    // pemakai mengeluh tidak dapat notifikasi, ini baris yang menjawabnya.
    log.info("tidak ada perangkat aktif — push dilewati", { userId, type: payload.type })
    return
  }
  const t = await deliver(installations, () => payload, apnsReady, fcmReady)
  logTally(t, { userId, type: payload.type, perangkat: installations.length }, payload.type)
}

/**
 * Many people, each with their own payload (a chat message: own badge, own type for a mention), in
 * one device query and ONE summary line — a busy group must not write a line per member per message.
 */
export async function sendPushToUsers(items: Array<{ userId: string; payload: PushPayload }>, label: string): Promise<void> {
  if (items.length === 0) return
  const apnsReady = providerJWT() !== null
  const fcmReady = fcmConfigured()
  if (!apnsReady && !fcmReady) {
    log.error("APNs tidak terkonfigurasi — push TIDAK dikirim", { label, penerima: items.length })
    return
  }
  const byUser = new Map(items.map((i) => [i.userId, i.payload]))
  const installations = await prisma.deviceInstallation.findMany({
    where: { userId: { in: Array.from(byUser.keys()) }, disabledAt: null },
    select: installationSelect,
  })
  if (installations.length === 0) {
    log.info("tidak ada perangkat aktif — push dilewati", { label, penerima: byUser.size })
    return
  }
  const t = await deliver(installations, (i) => byUser.get(i.userId)!, apnsReady, fcmReady)
  logTally(t, { label, penerima: byUser.size, perangkat: installations.length }, label)
}

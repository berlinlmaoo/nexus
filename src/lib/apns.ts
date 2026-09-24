import { connect, constants as http2Constants } from "node:http2"
import { createPrivateKey, sign } from "node:crypto"
import { readFileSync } from "node:fs"
import prisma from "@/lib/prisma"
import { createLogger } from "@/lib/logger"

const log = createLogger("apns")

type PushPayload = {
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
}

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

async function sendOne(
  token: string,
  environment: string,
  bundleId: string,
  payload: PushPayload,
): Promise<{ status: number; reason?: string }> {
  const jwt = providerJWT()
  if (!jwt) return { status: 0, reason: "APNs is not configured" }

  const origin = environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com"

  return new Promise((resolve, reject) => {
    const client = connect(origin)
    client.once("error", reject)
    const request = client.request({
      [http2Constants.HTTP2_HEADER_METHOD]: "POST",
      [http2Constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
    })
    let status = 0
    let response = ""
    request.setEncoding("utf8")
    request.on("response", (headers) => { status = Number(headers[http2Constants.HTTP2_HEADER_STATUS] || 0) })
    request.on("data", (chunk) => { response += chunk })
    request.on("end", () => {
      client.close()
      let reason: string | undefined
      try { reason = response ? JSON.parse(response).reason : undefined } catch { reason = response || undefined }
      resolve({ status, reason })
    })
    request.on("error", (error) => { client.close(); reject(error) })
    request.end(JSON.stringify({
      ...(payload.data ?? {}),
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
        ...(payload.category ? { category: payload.category } : {}),
      },
      type: payload.type,
      ...(payload.taskId ? { taskId: payload.taskId } : {}),
      ...(payload.projectId ? { projectId: payload.projectId } : {}),
      ...(payload.link ? { link: payload.link } : {}),
    }))
  })
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
  if (!providerJWT()) {
    // Diam di sini pernah berarti berminggu-minggu mengira push berfungsi.
    log.error("APNs tidak terkonfigurasi — push TIDAK dikirim", { userId, type: payload.type })
    return
  }
  const installations = await prisma.deviceInstallation.findMany({
    where: { userId, disabledAt: null },
  })
  if (installations.length === 0) {
    // Bukan galat: banyak orang memang belum pernah memasang aplikasinya. Tapi kalau SEORANG
    // pemakai mengeluh tidak dapat notifikasi, ini baris yang menjawabnya.
    log.info("tidak ada perangkat aktif — push dilewati", { userId, type: payload.type })
    return
  }

  let sent = 0
  let failed = 0
  let disabled = 0
  const alasan: string[] = []

  const results = await Promise.allSettled(installations.map(async (installation) => {
    const result = await sendOne(
      installation.token,
      installation.environment,
      installation.bundleId,
      payload,
    )
    if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered") {
      await prisma.deviceInstallation.update({
        where: { id: installation.id },
        data: { disabledAt: new Date() },
      })
      disabled++
      alasan.push(`${installation.environment}:${result.reason ?? result.status}(dimatikan)`)
    } else if (result.status === 200) {
      sent++
    } else {
      failed++
      alasan.push(`${installation.environment}:${result.status}${result.reason ? " " + result.reason : ""}`)
    }
  }))

  // Inilah yang dulu hilang: `allSettled` tidak pernah melempar, jadi penolakan harus DIBACA.
  // Tanpa lingkaran ini, koneksi yang gagal ke Apple tidak meninggalkan jejak apa pun.
  for (const r of results) {
    if (r.status === "rejected") {
      failed++
      alasan.push(`transport: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    }
  }

  const ringkas = { userId, type: payload.type, perangkat: installations.length, terkirim: sent, gagal: failed, dimatikan: disabled }
  if (failed > 0 || disabled > 0) {
    log.error("push sebagian/seluruhnya gagal", { ...ringkas, alasan: alasan.slice(0, 5) })
  } else {
    log.info("push terkirim", ringkas)
  }
}

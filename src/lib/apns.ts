import { connect, constants as http2Constants } from "node:http2"
import { createPrivateKey, sign } from "node:crypto"
import prisma from "@/lib/prisma"

type PushPayload = {
  title: string
  body: string
  type: string
  taskId?: string | null
  projectId?: string | null
  link?: string | null
}

let cachedJWT: { value: string; createdAt: number } | null = null

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url")
}

function providerJWT(): string | null {
  const teamId = process.env.APNS_TEAM_ID
  const keyId = process.env.APNS_KEY_ID
  const rawKey = process.env.APNS_PRIVATE_KEY
  if (!teamId || !keyId || !rawKey) return null

  const now = Math.floor(Date.now() / 1000)
  if (cachedJWT && now - cachedJWT.createdAt < 50 * 60) return cachedJWT.value

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
      aps: { alert: { title: payload.title, body: payload.body }, sound: "default" },
      type: payload.type,
      ...(payload.taskId ? { taskId: payload.taskId } : {}),
      ...(payload.projectId ? { projectId: payload.projectId } : {}),
      ...(payload.link ? { link: payload.link } : {}),
    }))
  })
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!providerJWT()) return
  const installations = await prisma.deviceInstallation.findMany({
    where: { userId, disabledAt: null },
  })
  await Promise.allSettled(installations.map(async (installation) => {
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
    } else if (result.status && result.status !== 200) {
      console.error("[apns] delivery failed", { status: result.status, reason: result.reason })
    }
  }))
}

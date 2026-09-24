import { createSign } from "node:crypto"
import { createLogger } from "@/lib/logger"
import { buildFcmMessage, classifyFcmError, type FcmFailure, type FcmPushInput } from "@/lib/fcm-payload"

/**
 * Android push through Firebase Cloud Messaging, HTTP v1.
 *
 * Credential: NEXUS_FCM_SERVICE_ACCOUNT_JSON — the Firebase project's service-account key file,
 * base64-encoded (one line, so it survives .env files and `docker inspect`). The project id comes from
 * the file. A dedicated name on purpose: GOOGLE_SERVICE_ACCOUNT_* belongs to finance and
 * GOOGLE_DIRECTORY_* / GOOGLE_OAUTH_* to the Workspace directory and Sheets sync; none of them is read
 * here, and this key must never be reused for them either.
 *
 * Unset → fcmConfigured() is false and apns.ts sendPushToUser skips Android devices (one warning per
 * process). Nothing else changes.
 *
 * Auth: a self-signed RS256 JWT exchanged at the token_uri for an OAuth2 access token with the
 * firebase.messaging scope, cached until five minutes before it expires (~55 min).
 */

const log = createLogger("fcm")

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

let accountMemo: { raw: string | undefined; account: ServiceAccount | null } | null = null

/** The decoded service account, or null when unset or unreadable (logged once per value). */
export function fcmServiceAccount(): ServiceAccount | null {
  const raw = process.env.NEXUS_FCM_SERVICE_ACCOUNT_JSON
  if (accountMemo && accountMemo.raw === raw) return accountMemo.account
  let account: ServiceAccount | null = null
  if (raw?.trim()) {
    try {
      const text = raw.trim().startsWith("{") ? raw.trim() : Buffer.from(raw.trim(), "base64").toString("utf8")
      const json = JSON.parse(text) as Partial<ServiceAccount>
      if (typeof json.project_id === "string" && typeof json.client_email === "string" && typeof json.private_key === "string") {
        account = { project_id: json.project_id, client_email: json.client_email, private_key: json.private_key, token_uri: json.token_uri }
      } else {
        log.error("NEXUS_FCM_SERVICE_ACCOUNT_JSON has no project_id/client_email/private_key — Android push is off")
      }
    } catch (error) {
      log.error("NEXUS_FCM_SERVICE_ACCOUNT_JSON is not base64 JSON — Android push is off", { error: String(error) })
    }
  }
  accountMemo = { raw, account }
  return account
}

export function fcmConfigured(): boolean {
  return fcmServiceAccount() !== null
}

let tokenCache: { value: string; expiresAt: number; email: string } | null = null
let tokenInflight: Promise<string> | null = null

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url")
}

async function fetchAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const tokenUri = account.token_uri || DEFAULT_TOKEN_URI
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }),
  )}`
  const signer = createSign("RSA-SHA256")
  signer.update(unsigned)
  const assertion = `${unsigned}.${b64url(signer.sign(account.private_key.replace(/\\n/g, "\n")))}`
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    signal: AbortSignal.timeout(10_000),
  })
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null
  if (!res.ok || !json?.access_token) {
    throw new Error(`FCM OAuth token request failed: ${res.status} ${json?.error ?? ""}`.trim())
  }
  const ttl = Math.max(60, (json.expires_in ?? 3600) - 300)
  tokenCache = { value: json.access_token, expiresAt: Date.now() + ttl * 1000, email: account.client_email }
  return json.access_token
}

async function accessToken(account: ServiceAccount): Promise<string> {
  if (tokenCache && tokenCache.email === account.client_email && Date.now() < tokenCache.expiresAt) return tokenCache.value
  if (!tokenInflight) {
    tokenInflight = fetchAccessToken(account).finally(() => {
      tokenInflight = null
    })
  }
  return tokenInflight
}

export type FcmSendResult = { ok: true } | ({ ok: false } & FcmFailure)

/**
 * Send one push to one FCM registration token. Throws only on transport failure (no answer from
 * Google), exactly like apns.ts sendOne, so the caller's allSettled accounting stays the same.
 */
export async function sendFcm(token: string, payload: FcmPushInput): Promise<FcmSendResult> {
  const account = fcmServiceAccount()
  if (!account) return { ok: false, status: 0, errorCode: "NOT_CONFIGURED", message: null, invalidToken: false, transient: false }
  const bearer = await accessToken(account)
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(buildFcmMessage(token, payload)),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => null)
  // A rejected access token: drop it so the next send mints a new one.
  if (res.status === 401) tokenCache = null
  return { ok: false, ...classifyFcmError(res.status, body) }
}

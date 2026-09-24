// @vitest-environment node
import { createVerify, generateKeyPairSync } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The FCM sender end to end with Google stubbed: service-account decoding, the signed OAuth assertion,
// token caching, the send URL/body, and how refusals come back. No network.

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const SA = {
  type: "service_account",
  project_id: "nexus-test",
  client_email: "fcm@nexus-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
}
const FCM_TOKEN = "dQw4w9WgXcQ:APA91bH" + "Zx-9_kLmNoPqRsTuVwXyZ0123456789".repeat(4)

type Call = { url: string; init: RequestInit }

function stubGoogle(sendResponses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (url === SA.token_uri) {
      return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3599, token_type: "Bearer" }), { status: 200 })
    }
    const next = sendResponses.shift() ?? { status: 200, body: { name: "projects/nexus-test/messages/1" } }
    return new Response(JSON.stringify(next.body), { status: next.status })
  })
  vi.stubGlobal("fetch", fetchMock)
  return calls
}

describe("fcm sender", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEXUS_FCM_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(SA)).toString("base64")
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.NEXUS_FCM_SERVICE_ACCOUNT_JSON
  })

  it("is off without the env and never calls Google", async () => {
    delete process.env.NEXUS_FCM_SERVICE_ACCOUNT_JSON
    const calls = stubGoogle([])
    const fcm = await import("@/lib/fcm")
    expect(fcm.fcmConfigured()).toBe(false)
    const r = await fcm.sendFcm(FCM_TOKEN, { title: "t", body: "b", type: "x" })
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it("signs a valid RS256 assertion, caches the access token, posts the v1 message", async () => {
    const calls = stubGoogle([])
    const fcm = await import("@/lib/fcm")
    expect(fcm.fcmConfigured()).toBe(true)
    const payload = { title: "Budi approved your leave", body: "1 Oct", type: "attendance_request_reviewed", link: "/attendance?request=r1", notificationId: "n1" }
    expect(await fcm.sendFcm(FCM_TOKEN, payload)).toEqual({ ok: true })
    expect(await fcm.sendFcm(FCM_TOKEN, payload)).toEqual({ ok: true })

    const tokenCalls = calls.filter((c) => c.url === SA.token_uri)
    expect(tokenCalls).toHaveLength(1) // cached for the second send
    const assertion = new URLSearchParams(String(tokenCalls[0].init.body)).get("assertion")!
    const [h, c, sig] = assertion.split(".")
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" })
    const claims = JSON.parse(Buffer.from(c, "base64url").toString())
    expect(claims.iss).toBe(SA.client_email)
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging")
    expect(claims.aud).toBe(SA.token_uri)
    const v = createVerify("RSA-SHA256")
    v.update(`${h}.${c}`)
    expect(v.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true)

    const sends = calls.filter((c) => c.url.startsWith("https://fcm.googleapis.com/"))
    expect(sends).toHaveLength(2)
    expect(sends[0].url).toBe("https://fcm.googleapis.com/v1/projects/nexus-test/messages:send")
    expect((sends[0].init.headers as Record<string, string>).authorization).toBe("Bearer ya29.test")
    const msg = JSON.parse(String(sends[0].init.body)).message
    expect(msg.token).toBe(FCM_TOKEN) // case kept
    expect(msg.data).toMatchObject({ type: "attendance_request_reviewed", link: "/attendance?request=r1", notificationId: "n1" })
    expect(msg.android.notification.channel_id).toBe("attendance")
  })

  it("reports UNREGISTERED as a dead token and a quota error as transient", async () => {
    stubGoogle([
      { status: 404, body: { error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found.", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } } },
      { status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "QUOTA_EXCEEDED" }] } } },
    ])
    const fcm = await import("@/lib/fcm")
    const dead = await fcm.sendFcm(FCM_TOKEN, { title: "t", body: "b", type: "x" })
    expect(dead).toMatchObject({ ok: false, status: 404, errorCode: "UNREGISTERED", invalidToken: true })
    const busy = await fcm.sendFcm(FCM_TOKEN, { title: "t", body: "b", type: "x" })
    expect(busy).toMatchObject({ ok: false, status: 429, invalidToken: false, transient: true })
  })
})

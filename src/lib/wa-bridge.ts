import http from "node:http"

// The Hermes WhatsApp bridge (bridge.js) binds loopback-only AND rejects any request whose Host header
// isn't a loopback alias — a DNS-rebinding guard added in a Hermes security update (GHSA-ppp5-vxwm-4cf7).
// From inside Docker we reach the bridge via `host.docker.internal:3001`, so fetch() would send
// `Host: host.docker.internal` → 400 "Invalid Host header. Bridge accepts loopback hosts only.".
//
// fetch()/undici FORBIDS setting the Host header, so we POST with raw node:http and override Host to a
// loopback alias the bridge accepts (the TCP target stays host.docker.internal — only the header changes).
// Used by every WA sender (notifications, attendance reminders, the Gideon bot replies, digest).
export function postWaBridge(webhookUrl: string, payload: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(webhookUrl)
    const data = JSON.stringify(payload)
    const port = u.port || "80"
    const req = http.request(
      {
        hostname: u.hostname, // actual TCP target (e.g. host.docker.internal)
        port,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Host: `127.0.0.1:${port}`, // loopback alias the bridge's allowlist accepts
        },
        timeout: 10_000,
      },
      (res) => {
        let chunks = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (chunks += c))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: chunks }))
      },
    )
    req.on("error", reject)
    req.on("timeout", () => req.destroy(new Error("bridge timeout")))
    req.write(data)
    req.end()
  })
}

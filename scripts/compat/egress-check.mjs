// Proves the compat network cannot reach anything outside itself BEFORE the candidate app is started.
//
// Run in a throwaway container attached to the compat network (same network the app will sit on):
//   docker run --rm --network <net> -e PROBE_HOST_IPS="..." -v <dir>:/compat:ro --entrypoint node <image> /compat/egress-check.mjs
//
// Every probe must FAIL. One success = exit 3, and run.sh aborts before the app ever boots.
//
// What is probed and why:
//   - DNS for every outward service the app knows how to talk to (APNs, SMTP, Slack, WhatsApp bridge
//     hosts, Nominatim, Google, Sentry). No name resolution = no email, no push, no webhook, even for a
//     URL hard-coded in source (reverse-geocode.ts hard-codes nominatim.openstreetmap.org).
//   - Raw TCP to public IPs (Cloudflare, Google DNS, Apple push range). Catches a resolver-less route out.
//   - TCP to every IP the HOST owns on the ports production listens on (5432 Postgres on the Tailscale
//     IP, 3002 the live app on loopback, 3001 the WA bridge). The app is never given production
//     credentials anyway, but this makes "cannot even open a socket to prod" a checked fact, not a hope.
import dns from "node:dns/promises"
import net from "node:net"

const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 2500)

const names = [
  "api.push.apple.com",
  "api.sandbox.push.apple.com",
  "smtp.gmail.com",
  "smtp.zoho.com",
  "hooks.slack.com",
  "graph.facebook.com",
  "nominatim.openstreetmap.org",
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "itunes.apple.com",
  "sentry.io",
  "nexus.znetworks.id",
  "registry.npmjs.org",
]
const publicTargets = [
  ["1.1.1.1", 443],
  ["8.8.8.8", 53],
  ["17.253.144.10", 443], // Apple
  ["142.250.4.108", 587], // Google SMTP range
]
const hostIps = (process.env.PROBE_HOST_IPS || "").split(/[\s,]+/).filter((ip) => ip && !ip.includes(":"))
const hostTargets = hostIps.flatMap((ip) => [[ip, 5432], [ip, 3002], [ip, 3001], [ip, 443]])

function tcp(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    const done = (ok, why) => { s.destroy(); resolve({ ok, why }) }
    s.setTimeout(TIMEOUT_MS, () => done(false, "timeout"))
    s.once("connect", () => done(true, "CONNECTED"))
    s.once("error", (e) => done(false, e.code || e.message))
  })
}

async function lookup(name) {
  try {
    const r = await Promise.race([
      dns.lookup(name),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), TIMEOUT_MS)),
    ])
    return { ok: true, why: `RESOLVED ${r.address}` }
  } catch (e) {
    return { ok: false, why: e.code || e.message }
  }
}

const results = []
await Promise.all([
  ...names.map(async (n) => results.push({ kind: "dns", target: n, ...(await lookup(n)) })),
  ...publicTargets.map(async ([h, p]) => results.push({ kind: "tcp", target: `${h}:${p}`, ...(await tcp(h, p)) })),
  ...hostTargets.map(async ([h, p]) => results.push({ kind: "tcp-host", target: `${h}:${p}`, ...(await tcp(h, p)) })),
])

const leaks = results.filter((r) => r.ok)
for (const r of results.sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target))) {
  console.log(`  ${r.ok ? "LEAK " : "block"}  ${r.kind.padEnd(8)} ${r.target.padEnd(32)} ${r.why}`)
}
if (leaks.length) {
  console.log(`EGRESS CHECK FAILED: ${leaks.length} probe(s) got out. Not starting the candidate app.`)
  process.exit(3)
}
console.log(`egress check: ${results.length} probes, all blocked`)

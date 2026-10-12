// node src/lib/network-family.test.mjs
//
// Plain node, no test runner, no internet. Rebuilds the attendance-sheet failure of Sep–Oct 2026 locally:
// a host with an IPv4 address that answers and an IPv6 address that cannot, and an event loop that is
// busy for 300 ms right after the connect starts (what the Next server does under load). With Node's
// default happy eyeballs the IPv4 attempt is abandoned after 250 ms and the connect fails; after
// preferSingleIpv4Connect() it succeeds.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"
import net from "node:net"
import dns from "node:dns"

const here = path.dirname(fileURLToPath(import.meta.url))

async function load(file) {
  const tsPath = path.join(here, file)
  try {
    return await import(pathToFileURL(tsPath).href)
  } catch {
    const require = createRequire(import.meta.url)
    const ts = require("typescript")
    const src = await readFile(tsPath, "utf8")
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

const busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end); }

const server = net.createServer((s) => s.end())
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const port = server.address().port

// A dual-stack name: IPv4 = our server, IPv6 = 100::1 (discard prefix, RFC 6666: never answers).
// The resolver hands both out and then stalls the loop for 300 ms: the IPv4 connect is already in
// flight (as it is for ~230 ms against Google), but its completion has not been processed yet.
function lookup(_host, opts, cb) {
  const all = [{ address: "127.0.0.1", family: 4 }, { address: "100::1", family: 6 }]
  if (opts && opts.all) cb(null, all)
  else cb(null, all[0].address, all[0].family)
  busy(300)
}

/** Connect while the loop is stalled for 300 ms; "ok" or the error code. */
function connectUnderLoad() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "dual-stack.nexus.invalid", port, lookup })
    const guard = setTimeout(() => { socket.destroy(); resolve("timeout") }, 5000)
    const done = (v) => { clearTimeout(guard); socket.destroy(); resolve(v) }
    socket.once("connect", () => done("ok"))
    socket.once("error", (e) => done(e.code || e.name || "error"))
  })
}

const { preferSingleIpv4Connect } = await load("network-family.ts")
let passed = 0

if (typeof net.getDefaultAutoSelectFamily === "function" && net.getDefaultAutoSelectFamily()) {
  // Node's default (no --no-network-family-autoselection): the bug.
  const before = await connectUnderLoad()
  assert.notEqual(before, "ok", "with happy eyeballs on, a stalled loop should lose the IPv4 attempt")
  passed++
}

const applied = preferSingleIpv4Connect()
assert.equal(applied.autoSelectFamily, false)
assert.equal(net.getDefaultAutoSelectFamily(), false)
if (applied.resultOrder !== null) assert.equal(applied.resultOrder, "ipv4first")
if (typeof dns.getDefaultResultOrder === "function") assert.equal(dns.getDefaultResultOrder(), "ipv4first")
passed++

for (let i = 0; i < 3; i++) assert.equal(await connectUnderLoad(), "ok", "IPv4 connect must survive a stalled loop")
passed++

server.close()
console.log(`network-family: ${passed} checks passed`)

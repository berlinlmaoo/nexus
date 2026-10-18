// node --experimental-strip-types src/lib/gideon-shim-retry.test.mjs
import assert from "node:assert/strict"
import {
  SHIM_RESTART, isNonModelFailure, isShimRestartResponse, isShimStoppedResponse, isGatewayDown, connectionDropKind, retryDelayMs,
  fetchShim, shimFailureKind, shimRestartedSince, ShimRestartError,
} from "./gideon-shim-retry.ts"

const H = (o = {}) => new Headers(o)
const fetchError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) })

// ── Classification ──
assert.equal(isNonModelFailure("shim_restart"), true)
assert.equal(isNonModelFailure("model0_unavailable"), true)
assert.equal(isNonModelFailure("shim 502"), false)
assert.equal(isNonModelFailure("terminated"), false)
assert.equal(isNonModelFailure("empty reply"), false)
assert.equal(isNonModelFailure(null), false)

assert.equal(isShimRestartResponse(503, H({ "x-gideon-shim": "restarting" })), true)
assert.equal(isShimRestartResponse(503, H()), false, "Model 0's 503 is not a restart")
assert.equal(isShimRestartResponse(200, H({ "x-gideon-shim": "restarting" })), false)
assert.equal(isShimStoppedResponse(503, H({ "x-gideon-shim": "stopped" })), true)
assert.equal(isShimStoppedResponse(503, H({ "x-gideon-shim": "restarting" })), false)
assert.equal(isGatewayDown(502, H()), true)
assert.equal(isGatewayDown(502, H({ "x-gideon-shim": "ready" })), false)
assert.equal(isGatewayDown(500, H()), false)

assert.equal(connectionDropKind(fetchError("ECONNREFUSED")), "refused")
assert.equal(connectionDropKind(fetchError("ECONNRESET")), "dropped")
assert.equal(connectionDropKind(fetchError("UND_ERR_SOCKET")), "dropped")
assert.equal(connectionDropKind(new TypeError("terminated")), "dropped")
assert.equal(connectionDropKind(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), null)
assert.equal(connectionDropKind(Object.assign(new Error("aborted"), { name: "AbortError" })), null)
assert.equal(connectionDropKind(new Error("Unexpected token")), null)
assert.equal(connectionDropKind(null), null)

assert.equal(retryDelayMs(null), 2000)
assert.equal(retryDelayMs("3"), 3000)
assert.equal(retryDelayMs("120"), 6000)
assert.equal(retryDelayMs("0"), 1000)
assert.equal(retryDelayMs("soon"), 2000)

// ── fetchShim ──
const noSleep = async () => {}
const resp = (status, headers = {}, body = "{}") => new Response(body, { status, headers })
const scripted = (steps) => {
  const calls = []
  const impl = async (url, init) => {
    calls.push(String(url))
    const s = steps.shift()
    if (!s) throw new Error("unexpected call " + url)
    if (s instanceof Error) throw s
    return typeof s === "function" ? s() : s
  }
  return { impl, calls }
}
const URL_STREAM = "http://relay:8766/chat-stream"
const URL_CHAT = "http://relay:8766/chat"

{ // restarting → retried once → answered
  const { impl, calls } = scripted([resp(503, { "x-gideon-shim": "restarting", "retry-after": "2" }), resp(200)])
  const r = await fetchShim(URL_STREAM, { method: "POST" }, { stream: true, fetchImpl: impl, sleepImpl: noSleep })
  assert.equal(r.res.status, 200); assert.equal(r.retried, true); assert.equal(r.restarting, false); assert.equal(calls.length, 2)
}
{ // still restarting after the retry → restarting = true (recorded as shim_restart), no third try
  const { impl, calls } = scripted([resp(503, { "x-gideon-shim": "restarting" }), resp(503, { "x-gideon-shim": "restarting" })])
  const r = await fetchShim(URL_CHAT, { method: "POST" }, { stream: false, fetchImpl: impl, sleepImpl: noSleep })
  assert.equal(r.restarting, true); assert.equal(calls.length, 2)
}
{ // a run stopped at the drain cap (it had started) → restarting, but never retried
  const { impl, calls } = scripted([resp(503, { "x-gideon-shim": "stopped" }, '{"error":"shim_restart"}')])
  const r = await fetchShim(URL_CHAT, { method: "POST" }, { stream: false, fetchImpl: impl, sleepImpl: noSleep })
  assert.equal(r.restarting, true); assert.equal(r.retried, false); assert.equal(calls.length, 1)
}
{ // Model 0 unavailable (503 without the marker) is passed through untouched
  const { impl, calls } = scripted([resp(503, {}, '{"error":"model0_unavailable"}')])
  const r = await fetchShim(URL_CHAT, { method: "POST" }, { stream: false, fetchImpl: impl, sleepImpl: noSleep })
  assert.equal(r.res.status, 503); assert.equal(r.restarting, false); assert.equal(calls.length, 1)
}
{ // refused → retried, for /chat too
  const { impl, calls } = scripted([fetchError("ECONNREFUSED"), resp(200)])
  const r = await fetchShim(URL_CHAT, { method: "POST" }, { stream: false, fetchImpl: impl, sleepImpl: noSleep })
  assert.equal(r.res.status, 200); assert.equal(r.retried, true); assert.equal(calls.length, 2)
}
{ // dropped on /chat (may have been mid-answer) → no retry; health says freshly started → ShimRestartError
  const later = new Date(Date.now() + 5000).toISOString()
  const { impl } = scripted([fetchError("ECONNRESET"), resp(200, { "x-gideon-shim": "ready", "x-gideon-shim-started": later }, "ok")])
  await assert.rejects(fetchShim(URL_CHAT, { method: "POST" }, { stream: false, fetchImpl: impl, sleepImpl: noSleep }), (e) => e instanceof ShimRestartError)
}
{ // dropped on /chat, shim has been up for an hour → the original error (a real failure)
  const old = new Date(Date.now() - 3600_000).toISOString()
  const { impl } = scripted([fetchError("ECONNRESET"), resp(200, { "x-gideon-shim": "ready", "x-gideon-shim-started": old }, "ok")])
  await assert.rejects(fetchShim(URL_CHAT, { method: "POST" }, { stream: false, fetchImpl: impl, sleepImpl: noSleep }), (e) => e.message === "fetch failed")
}
{ // dropped before a stream started → retried
  const { impl, calls } = scripted([fetchError("ECONNRESET"), resp(200)])
  const r = await fetchShim(URL_STREAM, { method: "POST" }, { stream: true, fetchImpl: impl, sleepImpl: noSleep })
  assert.equal(r.res.status, 200); assert.equal(calls.length, 2)
}
{ // relay 502 on a stream → retried → ok
  const { impl, calls } = scripted([resp(502, {}, "bad gateway"), resp(200)])
  const r = await fetchShim(URL_STREAM, { method: "POST" }, { stream: true, fetchImpl: impl, sleepImpl: noSleep })
  assert.equal(r.res.status, 200); assert.equal(calls[1], URL_STREAM)
}
{ // a timeout is never retried and never a restart
  const { impl, calls } = scripted([Object.assign(new Error("timeout"), { name: "TimeoutError" })])
  await assert.rejects(fetchShim(URL_STREAM, { method: "POST" }, { stream: true, fetchImpl: impl, sleepImpl: noSleep }), (e) => e.name === "TimeoutError")
  assert.equal(calls.length, 1)
}
{ // a plain 500 is passed through, no retry
  const { impl, calls } = scripted([resp(500)])
  const r = await fetchShim(URL_STREAM, { method: "POST" }, { stream: true, fetchImpl: impl, sleepImpl: noSleep })
  assert.equal(r.res.status, 500); assert.equal(r.restarting, false); assert.equal(calls.length, 1)
}

// ── shimRestartedSince / shimFailureKind ──
{
  const { impl, calls } = scripted([resp(200, { "x-gideon-shim": "draining" }, "ok")])
  assert.equal(await shimRestartedSince(URL_STREAM, Date.now(), { fetchImpl: impl }), true)
  assert.equal(calls[0], "http://relay:8766/health")
}
{ // an old shim (no headers) → not provably a restart
  const { impl } = scripted([resp(200, {}, "ok")])
  assert.equal(await shimRestartedSince(URL_STREAM, Date.now(), { fetchImpl: impl }), false)
}
{ // a mid-stream "terminated" while the shim drains → shim_restart; with a long-running shim → the message
  const { impl } = scripted([resp(200, { "x-gideon-shim": "draining" }, "ok")])
  assert.equal(await shimFailureKind(new TypeError("terminated"), URL_STREAM, Date.now(), impl), SHIM_RESTART)
  const old = new Date(Date.now() - 3600_000).toISOString()
  const s2 = scripted([resp(200, { "x-gideon-shim": "ready", "x-gideon-shim-started": old }, "ok")])
  assert.equal(await shimFailureKind(new TypeError("terminated"), URL_STREAM, Date.now(), s2.impl), "terminated")
  assert.equal(await shimFailureKind(new Error("Unexpected token"), URL_STREAM, Date.now(), s2.impl), "Unexpected token")
  assert.equal(await shimFailureKind(new ShimRestartError(), URL_STREAM, Date.now()), SHIM_RESTART)
}

console.log("gideon-shim-retry: all assertions passed")

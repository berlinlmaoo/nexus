/**
 * One streamed GIDEON answer from the shim (GIDEON_STREAM_URL, NDJSON `delta` / `reset` / `final` / `error`),
 * falling back to the one-shot GIDEON_CHAT_URL. Used by the editor's "Ask AI" (/api/gideon/write) — the
 * chat route keeps its own copy because it also relays tool steps.
 */
export async function streamShim(
  payload: Record<string, unknown>,
  handlers: { onDelta?: (text: string) => void | Promise<void>; onReset?: () => void | Promise<void> },
  timeoutMs = 120_000,
): Promise<{ reply: string; error: string | null; tokens: number | null; usage?: unknown }> {
  const url = process.env.GIDEON_CHAT_URL
  const streamUrl = process.env.GIDEON_STREAM_URL
  if (!url) return { reply: "", error: "not configured", tokens: null }
  const headers = { "Content-Type": "application/json", "x-oracle-secret": process.env.ORACLE_LLM_SECRET || "" }
  const body = JSON.stringify(payload)
  if (!streamUrl) {
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { reply: "", error: `shim ${res.status}`, tokens: null }
    const data = (await res.json()) as { reply?: string; usage?: unknown }
    const reply = (data.reply || "").trim()
    if (reply) await handlers.onDelta?.(reply)
    return { reply, error: reply ? null : "empty reply", tokens: null, usage: data.usage }
  }
  const res = await fetch(streamUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok || !res.body) return { reply: "", error: `shim ${res.status}`, tokens: null }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  let acc = ""
  let reply = ""
  let tokens: number | null = null
  let upstreamError: string | null = null
  // The shim's last line (18 Oct 2026): what the run cost, for GIDEON credits. Older shims never send it.
  let usage: unknown = undefined
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl).trim()
      pending = pending.slice(nl + 1)
      if (!line) continue
      let ev: { t?: string; c?: string; usage?: { total_tokens?: number } & Record<string, unknown> }
      try { ev = JSON.parse(line) } catch { continue }
      if (ev.t === "delta" && typeof ev.c === "string") {
        acc += ev.c
        await handlers.onDelta?.(ev.c)
      } else if (ev.t === "reset") {
        if (acc) await handlers.onReset?.()
        acc = ""
      } else if (ev.t === "final" && typeof ev.c === "string") {
        reply = ev.c.trim()
        tokens = typeof ev.usage?.total_tokens === "number" ? ev.usage.total_tokens : null
      } else if (ev.t === "usage") {
        usage = ev.usage
      } else if (ev.t === "error") {
        upstreamError = String(ev.c || "failed").slice(0, 300)
      }
    }
  }
  if (!reply) reply = acc.trim()
  return { reply, error: reply ? null : upstreamError || "empty reply", tokens, usage }
}

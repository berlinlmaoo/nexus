/**
 * One door to GIDEON for server-side jobs: the Hermes shim behind GIDEON_CHAT_URL.
 *
 * Extracted from gideon-ticket.ts so that reflections (and whatever comes next) go through the
 * same chain with the same secret, the same model tier and the same "empty reply means the agent
 * failed" reading — never a direct provider key.
 */
export async function askGideon(input: {
  prompt: string
  /** Display name of the person this is about; the shim uses it for addressing. */
  user?: string
  /** GIDEON acts with this person's visibility, never more. */
  actorEmail?: string
  model?: "luna" | "experimental"
  timeoutMs?: number
  /** Appears in the log line when the shim refuses or answers empty. */
  tag?: string
}): Promise<string | null> {
  const url = process.env.GIDEON_CHAT_URL
  const secret = process.env.ORACLE_LLM_SECRET || ""
  if (!url) return null
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-oracle-secret": secret },
    body: JSON.stringify({
      prompt: input.prompt,
      model: input.model ?? "luna",
      user: input.user ?? "",
      actorEmail: input.actorEmail ?? "",
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 240_000),
  })
  if (!res.ok) {
    console.error(`gideon-chat: shim refused (${input.tag ?? "untagged"})`, { status: res.status })
    return null
  }
  const reply = ((await res.json()) as { reply?: string }).reply?.trim()
  if (!reply) {
    console.error(`gideon-chat: balasan kosong dari shim (${input.tag ?? "untagged"}) — agen Hermes kemungkinan gagal (cek journal gideon-shim di VM agents)`)
    return null
  }
  return reply
}

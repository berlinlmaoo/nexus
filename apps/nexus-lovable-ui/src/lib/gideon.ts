// Streaming client for the Gideon AI assistant (POST /api/gideon, SSE response).
// Backend emits `data: {json}\n\n` lines with {type:'text'|'tool_result'|'done'|'error', content}.

export type GideonMessage = { role: "user" | "assistant"; content: string };
export type GideonEvent =
  | { type: "text"; content: string }
  | { type: "tool_result"; content?: unknown; name?: string }
  | { type: "done" }
  | { type: "error"; content?: string };

export async function streamGideon(
  messages: GideonMessage[],
  onEvent: (event: GideonEvent) => void,
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const res = await fetch("/api/gideon", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ messages, model: opts.model ?? "sonnet" }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    onEvent({ type: "error", content: `Request failed (${res.status})` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json) as GideonEvent);
      } catch {
        // ignore malformed frame
      }
    }
  }
}

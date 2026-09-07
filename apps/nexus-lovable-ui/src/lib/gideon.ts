// Streaming client for the Gideon AI assistant (POST /api/gideon, SSE response).
// Backend emits `data: {json}\n\n` lines with {type:'text'|'tool_result'|'done'|'error', content}.

/** The three GIDEON tiers. Which model each one runs is decided on the server side. */
export const GIDEON_TIERS = [
  { id: "astra", name: "Astra", blurb: "Paling dalam. Untuk analisis dan keputusan." },
  { id: "luna", name: "Luna", blurb: "Sehari-hari." },
  { id: "terra", name: "Terra", blurb: "Ringan. Pertanyaan pendek." },
  // Runs on the RTX 5070 in the office, not on anybody's API. Measurably weaker than the hosted
  // tiers — it got a task count wrong that Luna got right — so the label says experimental and
  // means it.
  { id: "experimental", name: "Experimental", blurb: "Model lokal di kantor. Lambat dan bisa keliru." },
] as const;

export type GideonTier = (typeof GIDEON_TIERS)[number]["id"];
export const GIDEON_DEFAULT_TIER: GideonTier = "luna";

export type GideonMessage = { role: "user" | "assistant"; content: string };
export type GideonTurn = GideonMessage & { tools?: string[] };

export type GideonEvent =
  | { type: "text"; content: string }
  | { type: "tool_result"; content?: unknown; name?: string }
  | { type: "done" }
  | { type: "error"; content?: string };

/**
 * A document attachment — PDF, Office, or plain text. Separate from an image, and both may ride in
 * the same request. `data` is a data URL or bare base64; the route accepts either.
 */
export type GideonFile = {
  /** Filename WITH extension, e.g. "invoice-agustus.pdf". This is what the route reads the type off. */
  name: string;
  /** MIME type from the picker. Only consulted when `name` has no usable extension. */
  type: string;
  /** A data URL or bare base64 of the file's bytes. */
  data: string;
};

/**
 * Extensions the route accepts. Mirrors DOC_EXTENSIONS in /api/gideon, which refuses anything else
 * with a 415: Hermes reaches a document through a converter, and a type that converter cannot decode
 * arrives as bytes the model will confidently describe without having read.
 * The server stays the authority — this copy only ever prevents an upload, never permits one.
 */
export const GIDEON_FILE_EXTENSIONS: readonly string[] = [
  "pdf",
  "txt", "md", "csv", "tsv", "json", "log", "yml", "yaml", "xml", "html",
  "docx", "doc", "xlsx", "xls", "pptx", "ppt",
  "odt", "ods", "odp", "rtf", "epub", "ipynb",
];

/** The route's own limit. Checked here too, so a 10 MB upload is not sent to be told it was too big. */
export const GIDEON_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** For a file input's `accept` attribute — a hint to the picker, not the check. */
export const GIDEON_FILE_ACCEPT = GIDEON_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");

/**
 * Whether a picked file is one GIDEON can read.
 *
 * Judged from the filename alone, unlike the route, which falls back to the MIME type when the name
 * has no extension: that fallback exists for iOS document providers, and a file handed over by a
 * browser file input always carries the name it had on disk.
 */
export function isAcceptedGideonFile(name: string): boolean {
  const ext = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  return Boolean(ext && GIDEON_FILE_EXTENSIONS.includes(ext));
}

export async function streamGideon(
  messages: GideonMessage[],
  onEvent: (event: GideonEvent) => void,
  opts: { model?: string; signal?: AbortSignal; image?: string | null; file?: GideonFile | null } = {},
): Promise<void> {
  const res = await fetch("/api/gideon", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      messages,
      model: opts.model ?? GIDEON_DEFAULT_TIER,
      ...(opts.image ? { image: opts.image } : {}),
      ...(opts.file ? { file: opts.file } : {}),
    }),
    signal: opts.signal,
  });

  // A refused attachment arrives as plain JSON with a real HTTP status BEFORE any stream exists, so
  // the status is settled before a byte of SSE is parsed. The route writes its own sentence for a
  // 415 or a 413 — which file, and what to do about it — and replacing that with "Request failed"
  // would throw away the only half that helps.
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body?.error === "string" && body.error.trim()) message = body.error.trim();
    } catch {
      // Not JSON — a gateway page, or a body already consumed. The status is all there is to say.
    }
    onEvent({ type: "error", content: message });
    return;
  }

  if (!res.body) {
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

// Chat history is stored server-side per user (GET/DELETE /api/gideon/history), so a conversation
// survives closing the panel, a refresh, and switching devices.
export async function loadGideonHistory(): Promise<GideonTurn[]> {
  try {
    const res = await fetch("/api/gideon/history", { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: GideonTurn[] };
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    // An unreachable history endpoint must not block a fresh chat.
    return [];
  }
}

export async function clearGideonHistory(): Promise<boolean> {
  try {
    const res = await fetch("/api/gideon/history", { method: "DELETE", credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

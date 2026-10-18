/**
 * Files in chat (owner, 18 Oct 2026: "chat di web app kenapa baru send foto doang? gaada send doc").
 *
 * What may be sent, how it is recognised, what it is stored and served as, and how a message that
 * carries a document reads to an app that only knows pictures.
 *
 *   pictures   PNG, JPG, WEBP, GIF            up to 8 MB (unchanged since chat began)
 *   documents  PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, CSV, TXT, ZIP   up to 25 MB
 *
 * A document is judged by its EXTENSION (the allowlist) AND its first bytes (the format really is
 * that), never by the Content-Type a client put on the part: a program renamed "invoice.pdf" starts
 * with "MZ", not "%PDF-", and is refused. The type stored on the message is the one this table names
 * for the extension, not the client's.
 *
 * Pure: no imports, so `node src/lib/chat-files.test.mjs` can load it directly.
 */

export const CHAT_IMAGE_MAX_BYTES = 8 * 1024 * 1024
/** 25 MB: a long PDF or a deck with pictures fits; anything bigger belongs in Z Vault (95 MB per file). */
export const CHAT_FILE_MAX_BYTES = 25 * 1024 * 1024

/** The path every chat upload is served under. sendMessage accepts nothing else as an attachment. */
export const CHAT_FILE_PREFIX = "/api/files/chat/"

type DocFormat = "pdf" | "ole" | "zip" | "text"

type DocSpec = { mime: string; format: DocFormat; label: string; /** OOXML: a part name the archive must contain. */ part?: string }

/** The documents chat accepts, by extension (lower case, no dot). */
export const CHAT_DOC_TYPES: Readonly<Record<string, DocSpec>> = {
  pdf: { mime: "application/pdf", format: "pdf", label: "PDF" },
  doc: { mime: "application/msword", format: "ole", label: "Word" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", format: "zip", label: "Word", part: "word/" },
  xls: { mime: "application/vnd.ms-excel", format: "ole", label: "Excel" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", format: "zip", label: "Excel", part: "xl/" },
  ppt: { mime: "application/vnd.ms-powerpoint", format: "ole", label: "PowerPoint" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", format: "zip", label: "PowerPoint", part: "ppt/" },
  csv: { mime: "text/csv", format: "text", label: "CSV" },
  txt: { mime: "text/plain", format: "text", label: "Text" },
  zip: { mime: "application/zip", format: "zip", label: "ZIP" },
}

const IMAGE_EXT: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}
export const CHAT_IMAGE_TYPES = Object.keys(IMAGE_EXT)
export function imageExtensionOf(type: string): string {
  return IMAGE_EXT[type] ?? "png"
}

/** What the web picker offers: every extension above, pictures included. */
export const CHAT_ACCEPT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ...Object.keys(CHAT_DOC_TYPES).map((e) => `.${e}`)].join(",")

/** How many leading bytes the checks below look at (text: NUL scan; zip: the local header). */
export const CHAT_SNIFF_BYTES = 8192

/** "Laporan Q3.PDF" → "pdf"; no dot, or a dot at the very start only → "". */
export function extensionOfName(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? ""
  const i = base.lastIndexOf(".")
  return i <= 0 ? "" : base.slice(i + 1).toLowerCase()
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false
  return true
}

function contains(bytes: Uint8Array, needle: string): boolean {
  const n = Array.from(needle, (c) => c.charCodeAt(0))
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer
    return true
  }
  return false
}

/** Text the way a CSV or a note is: no NUL byte, and not one of the binary formats in disguise. */
function looksLikeText(head: Uint8Array): boolean {
  if (startsWith(head, [0x4d, 0x5a])) return false // "MZ": a Windows program
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return false // ELF
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return false
  return true
}

/**
 * Whether these bytes really are the format the extension says.
 * `whole` (the entire file) lets an Office Open XML file be checked for its own folder ("word/" for a
 * .docx) — the central directory at the end of the archive names every part. Without it the ZIP
 * signature alone is required.
 */
export function bytesMatchDoc(ext: string, head: Uint8Array, whole?: Uint8Array): boolean {
  const spec = CHAT_DOC_TYPES[ext]
  if (!spec) return false
  switch (spec.format) {
    case "pdf":
      // "%PDF-". Some writers put a few bytes of junk first; Acrobat allows 1024, so does this.
      return contains(head.subarray(0, 1024), "%PDF-")
    case "ole":
      // OLE2 compound file (.doc/.xls/.ppt of Office 97-2003): D0 CF 11 E0 A1 B1 1A E1.
      return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    case "zip": {
      // Local file header "PK\3\4", or an empty archive "PK\5\6".
      const zip = startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])
      if (!zip) return false
      if (spec.part && whole) return contains(whole, "[Content_Types].xml") && contains(whole, spec.part)
      return true
    }
    case "text":
      return looksLikeText(head)
  }
}

export type ChatUploadVerdict =
  | { ok: true; kind: "image" | "file"; type: string; ext: string; maxBytes: number }
  | { ok: false; code: "UNSUPPORTED_TYPE" }

/**
 * Picture or document, from the file's name and the image type already resolved by image-sniff
 * (null when it is not a picture). Size and content are checked by the caller with the verdict.
 */
export function classifyChatUpload(name: string, imageType: string | null): ChatUploadVerdict {
  if (imageType) return { ok: true, kind: "image", type: imageType, ext: imageExtensionOf(imageType), maxBytes: CHAT_IMAGE_MAX_BYTES }
  const ext = extensionOfName(name)
  const spec = CHAT_DOC_TYPES[ext]
  if (!spec) return { ok: false, code: "UNSUPPORTED_TYPE" }
  return { ok: true, kind: "file", type: spec.mime, ext, maxBytes: CHAT_FILE_MAX_BYTES }
}

/**
 * A file name fit to store and to put in Content-Disposition: no folders, no control characters, at
 * most 180 characters with the extension kept, and never empty.
 */
export function cleanFileName(raw: string | null | undefined, ext: string): string {
  let name = String(raw ?? "").split(/[\\/]/).pop() ?? ""
  name = name.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim()
  if (!name || name === "." || name === "..") name = "file"
  const suffix = ext ? `.${ext}` : ""
  if (suffix && !name.toLowerCase().endsWith(suffix)) name += suffix
  if (name.length > 180) {
    const stem = name.slice(0, name.length - suffix.length)
    name = stem.slice(0, 180 - suffix.length).trimEnd() + suffix
  }
  return name
}

/** A message's document, when it is one: the extension of the stored path is in CHAT_DOC_TYPES. */
export function docSpecOfPath(url: string | null | undefined): (DocSpec & { ext: string }) | null {
  if (!url || !url.startsWith(CHAT_FILE_PREFIX)) return null
  const ext = extensionOfName(url.slice(CHAT_FILE_PREFIX.length))
  const spec = CHAT_DOC_TYPES[ext]
  return spec ? { ...spec, ext } : null
}

/** Only the random names this server writes: <uuid>.<ext>. Anything else is not a chat upload. */
export const CHAT_STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/

/** "1,2 MB", "830 KB", "12 B": Indonesian decimal comma, as every other size in NEXUS. */
export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
}

// ── apps that only know pictures ───────────────────────────────────────────────────────────────

/**
 * Whether the caller draws a document message as a file. The web (`X-Nexus-Client: web/…`) does from
 * this release; a phone says so with `X-Nexus-Caps: chat-files` once it has the file card (queued
 * for the native round). Everyone else — every iOS build in the App Store today, which draws ANY
 * attachmentUrl as a photo, and the Android builds — is "old".
 */
export function clientDrawsChatFiles(clientTag: string | null | undefined, caps: string | null | undefined): boolean {
  if (/^\s*web\//i.test(clientTag ?? "")) return true
  return (caps ?? "").split(",").some((c) => c.trim().toLowerCase() === "chat-files")
}

/** The one line an old app shows for a document: "📎 Laporan.pdf · 1,2 MB". */
export function fileFallbackLine(name: string | null | undefined, size: number | null | undefined): string {
  const n = (name ?? "").trim() || "File"
  const s = formatBytes(size)
  return s ? `📎 ${n} · ${s}` : `📎 ${n}`
}

type Shapeable = {
  content?: string | null
  attachmentUrl?: string | null
  attachmentType?: string | null
  attachmentName?: string | null
  attachmentSize?: number | null
}

/**
 * A message (or a quote of one) as an old app should get it. A document's path is taken away — the
 * App Store iOS app would try to draw it as a photo and show "Photo couldn't load" — and its name
 * goes into the text instead, after the caption. Pictures and plain text are returned unchanged.
 */
export function shapeForOldApp<T extends Shapeable>(m: T): T {
  if (!m || !docSpecOfPath(m.attachmentUrl)) return m
  const line = fileFallbackLine(m.attachmentName, m.attachmentSize)
  const caption = (m.content ?? "").trim()
  return { ...m, attachmentUrl: null, content: caption ? `${caption}\n${line}` : line }
}

/** shapeForOldApp on a message and its quote. */
export function shapeMessageForOldApp<T extends Shapeable & { replyTo?: Shapeable | null }>(m: T): T {
  const out = shapeForOldApp(m)
  return out.replyTo ? { ...out, replyTo: shapeForOldApp(out.replyTo) } : out
}

import { NextRequest, NextResponse } from "next/server"
import { stat } from "fs/promises"
import { createReadStream, existsSync } from "fs"
import { Readable } from "stream"

// ─────────────────────────────────────────────────────────────────────────────
// Serving bytes off disk, in one place.
//
// Extracted from src/app/api/files/[...path]/route.ts when Z Vault needed to serve files through a
// different authorization path. The alternative was a second copy of the Range arithmetic, and a
// second copy is how one of them quietly drifts — the symptom being a video that plays in one part
// of the app and shows the "can't play" icon in another, months later, with nothing to point at.
//
// This module deliberately knows NOTHING about permissions. Every caller decides who may read the
// file before calling; this only turns a path into a correct HTTP response.
// ─────────────────────────────────────────────────────────────────────────────

export const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  // Phone photos (HEIC/HEIF) and AVIF: Safari draws all three inline, so they are named as what they
  // are instead of falling through to octet-stream and being downloaded (9 Oct 2026).
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
}

// Only these may render inline in the browser. Everything else (notably .svg/.html/.xml, which can
// carry active content) is served as a download so a direct navigation to a random .svg can't execute
// script in the app origin. nosniff is also set so the browser never re-interprets the type.
export const INLINE_OK = new Set<string>([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".avif", ".pdf",
  ".mp4", ".mov", ".m4v", ".webm", ".mp3", ".wav", ".m4a", ".aac",
  ".txt", ".csv",
])

export function extensionOf(filePath: string): string {
  const i = filePath.lastIndexOf(".")
  return i === -1 ? "" : filePath.substring(i).toLowerCase()
}

/** A type as stored or sent, bare and lower-case: "Text/Plain; charset=utf-8" → "text/plain". */
export function normalizeMime(raw: string | null | undefined): string {
  return (raw || "").split(";")[0].trim().toLowerCase()
}

/** Other spellings phones and browsers send for a type in the table above. */
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/mp3": "audio/mpeg",
  "audio/x-aac": "audio/aac",
  "video/mov": "video/quicktime",
}

/** Every type the table knows, by its bare name → the exact header value to send for it. */
const KNOWN_MIME = new Map<string, string>(Object.values(MIME_TYPES).map((v) => [normalizeMime(v), v]))
for (const [alias, canonical] of Object.entries(MIME_ALIASES)) KNOWN_MIME.set(alias, canonical)

/** The bare types that may render inline: exactly the INLINE_OK extensions' types, nothing more. */
const INLINE_MIME = new Set<string>(Array.from(INLINE_OK, (ext) => normalizeMime(MIME_TYPES[ext])))

/**
 * What to send a file as, and whether it may render inline.
 *
 * A stored type (the vault keeps one per file) wins over the extension, but ONLY when it is a type
 * the table above already knows: the stored value came from whoever uploaded the file, and an
 * arbitrary "text/html" from a client must never become the header. Anything unknown falls back to
 * the extension exactly as before, and inline-or-not is decided by the type actually sent — so a
 * ".png" uploaded as "image/svg+xml" goes out as an SVG attachment, and an ".html" uploaded as
 * "image/png" goes out as a PNG that nosniff stops anybody reading as a page.
 */
export function servedTypeOf(filePath: string, storedMime?: string | null): { contentType: string; inlineOk: boolean } {
  const stored = KNOWN_MIME.get(normalizeMime(storedMime))
  if (stored) return { contentType: stored, inlineOk: INLINE_MIME.has(normalizeMime(stored)) }
  const ext = extensionOf(filePath)
  return { contentType: MIME_TYPES[ext] || "application/octet-stream", inlineOk: INLINE_OK.has(ext) }
}

export type PreviewKind = "image" | "video" | "audio" | "pdf"

/**
 * Whether a browser can SHOW this file rather than only save it: a picture, a film, a sound or a PDF
 * that may be served inline. Text is inline-safe but has no viewer, and SVG is never inline here.
 * A view-only share link serves only these (vault-share.ts); everything else would be a download by
 * another name.
 */
export function previewKindOf(filePath: string, storedMime?: string | null): PreviewKind | null {
  const { contentType, inlineOk } = servedTypeOf(filePath, storedMime)
  if (!inlineOk) return null
  const type = normalizeMime(contentType)
  if (type === "application/pdf") return "pdf"
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  return null
}

/** Stream a byte range straight off disk (constant memory) instead of buffering the whole file.
 *  `end` is inclusive for createReadStream. Returned as a web ReadableStream so NextResponse pipes it. */
function fileStream(filePath: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
}

export interface ServeFileOptions {
  /** The file's REAL name, used for Content-Disposition instead of the opaque on-disk one.
   *  Unlike the legacy `?download=` query param this does NOT by itself force a download —
   *  an inline-safe type still previews, just with a proper name attached. */
  filename?: string | null
  /** Force `attachment` even for an inline-safe type. */
  forceDownload?: boolean
  /** Force `inline` and ignore `?download=` — a share link that previews but forbids downloading. */
  forceInline?: boolean
  /** Override the cache policy. A public share link is not "private" in the CDN sense. */
  cacheControl?: string
  /** Override the extension-derived Content-Type (e.g. an APK, which MIME_TYPES deliberately lacks). */
  contentType?: string
  /** The type stored with the file (Z Vault). Preferred over the extension when MIME_TYPES knows it;
   *  see servedTypeOf. Unlike `contentType` it also decides inline-or-attachment. */
  mimeType?: string | null
  /** Strong validator. When given, ETag is sent and an `If-Range` that does not match it (nor
   *  lastModified) turns a Range request into a full 200 — a resumed download never splices two files. */
  etag?: string
  lastModified?: Date
}

/**
 * Turn a path on disk into a correct HTTP response, Range and all.
 *
 * The caller has already decided this request is allowed. Nothing here re-checks.
 */
export async function serveFile(
  req: NextRequest,
  filePath: string,
  opts: ServeFileOptions = {},
): Promise<NextResponse> {
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const stats = await stat(filePath)
    if (!stats.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const fileSize = stats.size
    const served = servedTypeOf(filePath, opts.mimeType)
    const contentType = opts.contentType || served.contentType
    // `?download=<name>` is the app's existing "save this" link. It carries the real name AND means
    // attachment — that second half is load-bearing: today it is the only way to download an image
    // instead of opening it. `opts.filename` is the newer, weaker form: a real name that leaves the
    // inline/attachment decision alone, so a vault preview reads "Logo.pdf" instead of a uuid.
    // An explicit opts.filename wins over the query param entirely, so a caller that already knows
    // the real name (the vault, which stores it) is not at the mercy of whatever ?download= carries.
    const explicitName = opts.filename ?? null
    const downloadParam =
      opts.forceInline || explicitName ? null : req.nextUrl.searchParams.get("download")
    const asAttachment = !served.inlineOk || Boolean(opts.forceDownload) || Boolean(downloadParam)
    // forceInline (a view-only vault link) never makes an unsafe type inline: an SVG/HTML served
    // inline on this origin runs its script with the viewer's session (security audit, 29 Sep 2026).
    const kind = (opts.forceInline && served.inlineOk) || !asAttachment ? "inline" : "attachment"

    // Strip CRLF/quotes to avoid header injection; add an ASCII fallback + RFC 5987 filename* so a
    // unicode name survives.
    const rawName = explicitName ?? downloadParam
    let contentDisposition: string = kind
    if (rawName) {
      const clean = rawName.replace(/[\r\n"\\]/g, "").trim().slice(0, 255) || "download"
      const ascii = clean.replace(/[^\x20-\x7E]/g, "_")
      contentDisposition = `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
    }

    // Range-sensitive types (video / audio / PDF) must reach the ORIGIN for every Range request: if
    // Cloudflare caches a full 200 and serves it back for a Range, iOS/Safari <video> playback breaks
    // (the "can't play" icon) AND Safari's PDF viewer renders blank white. `no-store` keeps every Range
    // request flowing to the origin, which answers with a correct 206. Images/docs keep the long cache.
    const rangeSensitive =
      contentType.startsWith("video/") || contentType.startsWith("audio/") || contentType === "application/pdf"
    // `private` by default, not `public`: these routes require a session, so a shared/CDN cache must NOT
    // store an authenticated response and replay it to an unauthenticated requester at the same URL.
    // A public share link overrides this — it is the one case where a shared cache is correct.
    // A caller's override applies ONLY to types where caching is safe. For video/audio/PDF the
    // no-store rule wins no matter what was asked for: an edge copy of a full 200 served back for a
    // Range request is what breaks <video> on iOS and renders a PDF blank in Safari, and a public
    // share link — a deck sent to a client — is precisely where that would be noticed first.
    const cacheControl = rangeSensitive
      ? "no-store"
      : (opts.cacheControl ?? "private, max-age=31536000, immutable")

    const common: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
      "Content-Disposition": contentDisposition,
      "X-Content-Type-Options": "nosniff",
    }
    const lastModified = opts.lastModified ? opts.lastModified.toUTCString() : null
    if (opts.etag) common["ETag"] = opts.etag
    if (lastModified) common["Last-Modified"] = lastModified

    if (fileSize === 0) {
      return new NextResponse(null, { status: 200, headers: { ...common, "Content-Length": "0" } })
    }

    // iOS Safari REQUIRES HTTP Range support to play <video>/<audio> and to page through a PDF. Serve
    // 206 Partial Content when a Range header is present (streaming only the requested slice).
    // If-Range (RFC 9110 §13.1.5) is honoured only for callers that supply a validator; everyone else
    // keeps the old behaviour exactly.
    const ifRange = opts.etag ? req.headers.get("if-range")?.trim() : null
    const rangeStillValid = !ifRange || ifRange === opts.etag || (lastModified !== null && ifRange === lastModified)
    const rangeHeader = rangeStillValid ? req.headers.get("range") : null
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      if (match && (match[1] !== "" || match[2] !== "")) {
        let start = match[1] === "" ? NaN : parseInt(match[1], 10)
        let end = match[2] === "" ? fileSize - 1 : parseInt(match[2], 10)
        // Suffix range "bytes=-N" → last N bytes.
        if (Number.isNaN(start)) {
          const suffix = parseInt(match[2], 10)
          start = Math.max(0, fileSize - suffix)
          end = fileSize - 1
        }
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
          return new NextResponse(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}`, "Accept-Ranges": "bytes" },
          })
        }
        end = Math.min(end, fileSize - 1)
        const chunkSize = end - start + 1
        return new NextResponse(fileStream(filePath, start, end), {
          status: 206,
          headers: {
            ...common,
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Content-Length": String(chunkSize),
          },
        })
      }
    }

    return new NextResponse(fileStream(filePath, 0, fileSize - 1), {
      status: 200,
      headers: { ...common, "Content-Length": String(fileSize) },
    })
  } catch {
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 })
  }
}

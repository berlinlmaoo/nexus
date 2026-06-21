export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { stat } from 'fs/promises'
import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import { join, resolve, sep } from 'path'
import { auth } from '@/lib/auth'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
}

// Only these may render inline in the browser. Everything else (notably .svg/.html/.xml, which can carry
// active content) is served as a download so a direct navigation to /api/files/...<rand>.svg can't execute
// script in the app origin. nosniff is also set globally so the browser never re-interprets the type.
const INLINE_OK = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
  '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a',
  '.txt', '.csv',
])

// Stream a byte range straight off disk (constant memory) instead of buffering the whole file. `end` is
// inclusive for createReadStream. Returned as a web ReadableStream so NextResponse pipes it through.
function fileStream(filePath: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Require a logged-in session. This is a JWT-only check (cookie decode, NO database hit) so streaming
  // throughput / Range latency is unaffected — but a leaked file URL no longer works for anyone who
  // isn't authenticated. (Per-file project authz was intentionally NOT added here to keep downloads
  // fast; the random on-disk filename remains the in-tenant obscurity layer.) All file URLs are loaded
  // same-origin by the app, so the session cookie rides along automatically.
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { path: segments } = await params
  const base = join(process.cwd(), 'public', 'uploads')
  const filePath = resolve(base, ...segments)

  // Security: prevent path traversal. Resolve first, then require the result to be the base dir
  // itself or strictly under it (base + separator) — so a sibling like "uploads2" can't sneak past.
  if (filePath !== base && !filePath.startsWith(base + sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const stats = await stat(filePath)
    if (!stats.isFile()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const fileSize = stats.size
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    // Render inline only for known-safe types; force-download everything else (anti stored-XSS).
    const disposition = INLINE_OK.has(ext) ? 'inline' : 'attachment'

    // Attachment links pass ?download=<original name>. Honor it so the browser saves the file under its
    // REAL name instead of the opaque on-disk name (e.g. "1781163721415-f38q0a"). Strip CRLF/quotes to
    // avoid header injection; add an ASCII fallback + RFC 5987 filename* for unicode names.
    const downloadName = req.nextUrl.searchParams.get('download')
    let contentDisposition = disposition
    if (downloadName) {
      const clean = downloadName.replace(/[\r\n"\\]/g, '').trim().slice(0, 255) || 'download'
      const ascii = clean.replace(/[^\x20-\x7E]/g, '_')
      contentDisposition = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
    }

    // Range-sensitive types (video / audio / PDF) must reach the ORIGIN for every Range request: if
    // Cloudflare caches a full 200 and serves it back for a Range, iOS/Safari <video> playback breaks
    // (the "can't play" icon) AND Safari's PDF viewer renders blank white. `no-store` keeps every Range
    // request flowing to the origin, which answers with a correct 206. Images/docs keep the long cache.
    const rangeSensitive =
      contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType === 'application/pdf'
    // `private`, not `public`: the route now requires a session, so a shared/CDN cache (Cloudflare) must
    // NOT store an authenticated response and replay it to an unauthenticated requester at the same URL.
    // The user's own browser still caches it for a year (the repeat-load win we actually care about).
    const cacheControl = rangeSensitive ? 'no-store' : 'private, max-age=31536000, immutable'

    const common: Record<string, string> = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
      'Content-Disposition': contentDisposition,
      'X-Content-Type-Options': 'nosniff',
    }

    if (fileSize === 0) {
      return new NextResponse(null, { status: 200, headers: { ...common, 'Content-Length': '0' } })
    }

    // iOS Safari REQUIRES HTTP Range support to play <video>/<audio> and to page through a PDF. Serve
    // 206 Partial Content when a Range header is present (streaming only the requested slice).
    const rangeHeader = req.headers.get('range')
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      if (match && (match[1] !== '' || match[2] !== '')) {
        let start = match[1] === '' ? NaN : parseInt(match[1], 10)
        let end = match[2] === '' ? fileSize - 1 : parseInt(match[2], 10)
        // Suffix range "bytes=-N" → last N bytes.
        if (Number.isNaN(start)) {
          const suffix = parseInt(match[2], 10)
          start = Math.max(0, fileSize - suffix)
          end = fileSize - 1
        }
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
          return new NextResponse(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}`, 'Accept-Ranges': 'bytes' },
          })
        }
        end = Math.min(end, fileSize - 1)
        const chunkSize = end - start + 1
        return new NextResponse(fileStream(filePath, start, end), {
          status: 206,
          headers: { ...common, 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Content-Length': String(chunkSize) },
        })
      }
    }

    return new NextResponse(fileStream(filePath, 0, fileSize - 1), {
      status: 200,
      headers: { ...common, 'Content-Length': String(fileSize) },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}

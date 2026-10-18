export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { join, resolve, sep } from 'path'
import { auth } from '@/lib/auth'
import { serveFile } from '@/lib/file-response'
import { avatarThumbnail, avatarThumbWidth } from '@/lib/avatar-thumb'
import prisma from '@/lib/prisma'
import { conversationAccess } from '@/lib/chat-access'
import { CHAT_FILE_PREFIX, docSpecOfPath } from '@/lib/chat-files'

// This route is now only two things: an authorization gate and a path-traversal guard. Turning a path
// into bytes (MIME types, inline-vs-attachment, Range/206) lives in src/lib/file-response.ts so the
// vault routes serve files through exactly the same code instead of a second copy that drifts.

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

  // Evidence photos from the retired Integrity feature (removed 12 Oct 2026) stay on disk but are no
  // longer served: nothing in NEXUS links to them and they name the person who was reported.
  if (filePath === join(base, 'peer-reports') || filePath.startsWith(join(base, 'peer-reports') + sep)) {
    return NextResponse.json({ error: 'Gone', message: 'This feature was removed.' }, { status: 410 })
  }

  // Legal files (14 Oct 2026) are served only through /api/legal/*, behind its invitation gate.
  const legalDir = join(base, 'attachments', 'legal')
  if (filePath === legalDir || filePath.startsWith(legalDir + sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Documents sent in chat (18 Oct 2026) are stricter than pictures: only someone who can read the
  // conversation of a message that carries the file gets it (the same rule as reading the messages),
  // under the name it was sent as, as a download (`?inline=1` lets a PDF open in the browser's viewer).
  // A file no message carries yet (uploaded, not sent) or any more (its group deleted) is a 404 —
  // a restore from Audit brings the message back and with it the download.
  const chatDir = join(base, 'chat')
  if (filePath.startsWith(chatDir + sep)) {
    const url = CHAT_FILE_PREFIX + filePath.slice(chatDir.length + 1)
    const doc = docSpecOfPath(url)
    if (doc) {
      const rows = await prisma.message.findMany({
        where: { attachmentUrl: url },
        select: { conversationId: true, attachmentName: true },
        orderBy: { createdAt: 'asc' },
        take: 5,
      })
      let carrier: (typeof rows)[number] | null = null
      for (const r of rows) {
        if ((await conversationAccess(session.user.id, r.conversationId)).ok) { carrier = r; break }
      }
      if (!carrier) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return serveFile(req, filePath, {
        filename: carrier.attachmentName || `file.${doc.ext}`,
        forceDownload: req.nextUrl.searchParams.get('inline') !== '1',
        mimeType: doc.mime,
        ...(doc.ext === 'zip' ? { contentType: 'application/zip' } : {}),
        // Access can be taken away (removed from the group): never answer from a cache.
        cacheControl: 'private, no-store',
      })
    }
  }

  // Avatar thumbnails (perf pass, 12 Oct 2026): `?w=` on an avatar answers a small WebP instead of the
  // full photo (1-2.5 MB). Without it nothing changes: the released apps use the plain URL.
  // Project icons too (a 2 MB PNG drawn at 36 px in the sidebar, 85 of them for some people).
  const thumbDirs = [join(base, 'avatars'), join(base, 'project-icons')]
  const w = avatarThumbWidth(req.nextUrl.searchParams.get('w'))
  if (w && thumbDirs.some((d) => filePath.startsWith(d + sep))) {
    const thumb = await avatarThumbnail(filePath, w)
    if (thumb) {
      if (req.headers.get('if-none-match') === thumb.etag) {
        return new NextResponse(null, { status: 304, headers: { ETag: thumb.etag } })
      }
      // The file name is `<userId>.<ext>` and is reused on re-upload; the app's URL carries `?t=<upload
      // time>`, which makes that URL unique, so it may be cached for good. Without `t`: revalidate hourly.
      const cacheControl = req.nextUrl.searchParams.get('t') ? 'private, max-age=31536000, immutable' : 'private, max-age=3600'
      return serveFile(req, thumb.path, { contentType: 'image/webp', cacheControl, etag: thumb.etag, lastModified: thumb.mtime })
    }
  }

  return serveFile(req, filePath)
}

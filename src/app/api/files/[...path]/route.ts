export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'
import { join, resolve, sep } from 'path'
import { auth } from '@/lib/auth'
import { serveFile } from '@/lib/file-response'

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

  return serveFile(req, filePath)
}

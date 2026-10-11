import { NextResponse } from "next/server"

/**
 * GET /api/system-avatars/<name>.png — avatars of the system identities (12 Oct 2026). Public and
 * immutable: a picture, nothing else. "automation.png" = the ⚡ of lib/automation-identity.ts.
 */
const AVATARS: Record<string, string> = {
  "automation.png": "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",
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const b64 = AVATARS[name]
  if (!b64) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return new NextResponse(Buffer.from(b64, "base64"), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" },
  })
}

export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

/**
 * The NEXUS WhatsApp feature (link / unlink, quick commands, digest, inbound bot, WhatsApp
 * notifications) was removed on 12 Oct 2026 (owner: "fitur whatsapp, webhooks hapus aja").
 *
 * Every former /api/notifications/wa/* route answers 410 Gone with a plain message instead of a 404,
 * so an old browser tab or a stray caller gets a clear answer. No released iOS/Android build calls
 * these routes. The `linked: false` field keeps an old web build's "WhatsApp" card in its unlinked state.
 */
function gone() {
  return NextResponse.json(
    { error: "WhatsApp in NEXUS has been removed.", code: "FEATURE_REMOVED", linked: false },
    { status: 410 },
  )
}

export const GET = gone
export const POST = gone
export const PUT = gone
export const PATCH = gone
export const DELETE = gone

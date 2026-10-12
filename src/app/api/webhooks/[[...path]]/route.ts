export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

/**
 * Project/global webhooks were removed on 12 Oct 2026 (owner: "fitur whatsapp, webhooks hapus aja"):
 * nothing is sent to outside URLs any more. Every former /api/webhooks route answers 410 Gone with a
 * plain message instead of a 404, so an old browser tab gets a clear answer. No released iOS/Android
 * build calls these routes. The Webhook / WebhookDelivery tables are dropped at release time by
 * prisma/sql/2026-10-12-retire-wa-webhooks-DROP.sql.
 */
function gone() {
  return NextResponse.json({ error: "Webhooks have been removed from NEXUS.", code: "FEATURE_REMOVED" }, { status: 410 })
}

export const GET = gone
export const POST = gone
export const PUT = gone
export const PATCH = gone
export const DELETE = gone

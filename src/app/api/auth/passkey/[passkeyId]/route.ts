import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

/**
 * Revoke one passkey — the thing to reach for when a device is lost.
 *
 * Deleting the last one is allowed on purpose: password sign-in never goes away, so an account can
 * never be locked out this way, and a rule that stopped you removing a key you no longer control
 * would be protecting the wrong person.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ passkeyId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { passkeyId } = await params
  // Scoped by userId in the same query rather than fetch-then-check: there is no window here in
  // which someone else's passkey could be deleted.
  const deleted = await prisma.passkey.deleteMany({
    where: { id: passkeyId, userId: session.user.id },
  })
  if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await logAudit({
    action: "delete",
    entityType: "passkey",
    entityId: passkeyId,
    userId: session.user.id,
    metadata: { via: "settings" },
  }).catch(() => null)

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}

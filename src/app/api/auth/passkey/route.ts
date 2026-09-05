import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"

/**
 * The passkeys on this account.
 *
 * Only ever this person's own, and only the parts a human needs to recognise one: the credential
 * id and public key stay on the server, because nothing on a settings screen has any use for them.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const passkeys = await prisma.passkey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  })

  return NextResponse.json({ passkeys }, { headers: { "Cache-Control": "no-store" } })
}

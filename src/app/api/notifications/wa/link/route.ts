export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { randomInt } from "crypto"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

// Unambiguous alphabet (no 0/O/1/I/L) — codes are read off a screen and typed on a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
function genCode() {
  let s = ""
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}

// Current link status for the logged-in user.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { whatsappId: true } })
  return NextResponse.json({ linked: !!u?.whatsappId })
}

// Generate a short-lived link code (10 min). User sends it to the bot as `/link <code>`.
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const code = genCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await prisma.user.update({ where: { id: session.user.id }, data: { waLinkCode: code, waLinkExpiresAt: expiresAt } })
  const botNumber = (process.env.NEXUS_WA_BOT_NUMBER || "").replace(/\D/g, "")
  const deepLink = botNumber ? `https://wa.me/${botNumber}?text=${encodeURIComponent(`/link ${code}`)}` : null
  return NextResponse.json({ code, expiresAt, deepLink, botNumber: botNumber || null })
}

// Unlink the logged-in user's WhatsApp.
export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await prisma.user.update({ where: { id: session.user.id }, data: { whatsappId: null } })
  return NextResponse.json({ ok: true })
}

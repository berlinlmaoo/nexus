export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { randomBytes } from "crypto"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { orgRoleOf } from "@/lib/org"

// An SP (surat peringatan) is a letter, a few pages at most.
const MAX_SIZE = 10 * 1024 * 1024

async function isBoD(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role === "ADMIN") return true
  // Company workspace only: every sign-up is One Above All of their own personal workspace.
  const role = await orgRoleOf(userId)
  return role === "BOD" || role === "ONE_ABOVE_ALL"
}

/**
 * POST /api/announcements/attachment   multipart, field `file`   BoD / One Above All (+ system admin).
 *
 * A PDF for an announcement (kind "sp"). Stored under uploads/attachments/announcements/ with a
 * random name and served by /api/files (session required). The URL returned is the only kind
 * POST /api/announcements accepts as `attachmentUrl`.
 *
 * → 201 { url, name, size }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await isBoD(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: "File kosong." }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "PDF maksimal 10 MB." }, { status: 413 })
    const buffer = Buffer.from(await file.arrayBuffer())
    // The bytes decide, not the name or the declared type: a PDF starts with "%PDF-".
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return NextResponse.json({ error: "Hanya PDF yang bisa dilampirkan." }, { status: 415 })
    }

    const dir = path.join(process.cwd(), "public", "uploads", "attachments", "announcements")
    await mkdir(dir, { recursive: true })
    const stored = `${Date.now()}-${randomBytes(6).toString("hex")}.pdf`
    await writeFile(path.join(dir, stored), buffer)

    // Display name only; never used as a path.
    const base = (file.name || "SP.pdf").replace(/[\r\n\t]/g, " ").trim().slice(0, 120) || "SP.pdf"
    const name = /\.pdf$/i.test(base) ? base : `${base}.pdf`
    return NextResponse.json({ url: `/api/files/attachments/announcements/${stored}`, name, size: file.size }, { status: 201 })
  } catch (error) {
    console.error("announcement attachment upload error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

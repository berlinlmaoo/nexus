export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { randomBytes } from "crypto"
import prisma from "@/lib/prisma"
import { findUnit, orgChartGuard } from "@/lib/org-chart"

const MAX_SIZE = 2 * 1024 * 1024

/** The bytes decide the type, never the name or the declared type. No SVG (it can carry script). */
function sniff(b: Buffer): "png" | "jpg" | "webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG") return "png"
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg"
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp"
  return null
}

/** POST multipart { unitId, file } → 201 { unit } with the new logoUrl. */
export async function POST(req: NextRequest) {
  const g = await orgChartGuard("write")
  if (g instanceof NextResponse) return g
  try {
    const form = await req.formData().catch(() => null)
    const unitId = form?.get("unitId")
    const file = form?.get("file")
    if (typeof unitId !== "string" || !unitId) return NextResponse.json({ error: "unitId wajib ada." }, { status: 400 })
    if (!(await findUnit(unitId))) return NextResponse.json({ error: "IP/Team tidak ditemukan." }, { status: 404 })
    if (!file || typeof file === "string") return NextResponse.json({ error: "Pilih file logonya." }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: "File kosong." }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "Logo maksimal 2 MB." }, { status: 413 })
    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = sniff(buffer)
    if (!ext) return NextResponse.json({ error: "Logo harus PNG, JPG, atau WebP." }, { status: 415 })

    const dir = path.join(process.cwd(), "public", "uploads", "attachments", "org-units")
    await mkdir(dir, { recursive: true })
    const stored = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`
    await writeFile(path.join(dir, stored), buffer)
    const unit = await prisma.orgUnit.update({
      where: { id: unitId },
      data: { logoUrl: `/api/files/attachments/org-units/${stored}` },
      select: { id: true, name: true, logoUrl: true, parentId: true, position: true },
    })
    return NextResponse.json({ unit }, { status: 201 })
  } catch (error) {
    console.error("[admin/org-chart] logo", error)
    return NextResponse.json({ error: "Gagal mengunggah logo." }, { status: 500 })
  }
}

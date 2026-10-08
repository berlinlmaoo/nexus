export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { existsSync } from "fs"
import { mkdir, rename, unlink, writeFile } from "fs/promises"
import path from "path"
import sharp from "sharp"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { serveFile } from "@/lib/file-response"
import { getVaultActor, canReadItem, canThumbnail, storagePath, thumbPath, thumbWidthFor } from "@/lib/vault"

// GET /api/vault/items/<id>/thumb?w=320[&v=<updatedAt>]
//
// A small WebP of a vault picture (owner, 9 Oct 2026: a folder of photos showed as rows of icons),
// so a grid of thumbnails costs a few KB each instead of every original coming down whole. Same
// access rule as /raw: a vault member who may read the item. The client takes the address from
// the item's `thumbUrl`; `w` is rounded up to one of VAULT_THUMB_WIDTHS.
//
// Made on the first request and kept on disk under the vault (lib/vault.ts thumbPath), so it costs
// one resize per file and width, ever. A file sharp cannot read leaves a `.failed` marker beside it
// and is answered 415 from then on, without decoding it again on every page view.
//
// Caching: `private, max-age=1y, immutable` (serveFile's default for an image). The address carries
// `v=<updatedAt>`, so a changed row is a new address. nginx passes /api/vault/ through unbuffered.

/** At most this many resizes at once in this process: a first look at a folder of 60 photos must
 *  not take every core from the requests around it. Further ones wait their turn. */
const MAX_PARALLEL = 2
let running = 0
const waiting: Array<() => void> = []
/** One resize per output file, however many requests ask for it at the same moment. */
const inflight = new Map<string, Promise<boolean>>()

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((go) => waiting.push(go))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** Make the thumbnail at `out` from `source`. True when it exists afterwards. */
function makeThumb(source: string, out: string, width: number): Promise<boolean> {
  const pending = inflight.get(out)
  if (pending) return pending
  const job = inTurn(async () => {
    if (existsSync(out)) return true
    await mkdir(path.dirname(out), { recursive: true })
    // Written under a temporary name and renamed into place: a reader never gets half a file.
    const temp = `${out}.${randomUUID()}.partial`
    try {
      await sharp(source, { failOn: "none", animated: false })
        .rotate() // a phone photo's EXIF orientation, applied, so it is not drawn on its side
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(temp)
      await rename(temp, out)
      return true
    } catch (error) {
      await unlink(temp).catch(() => {})
      console.warn("[vault] thumbnail failed:", String(error))
      await writeFile(`${out}.failed`, "").catch(() => {})
      return false
    }
  }).finally(() => inflight.delete(out))
  inflight.set(out, job)
  return job
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const actor = await getVaultActor(session.user.id)
    if (!actor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })

    const { itemId } = await params
    const item = await prisma.vaultItem.findFirst({
      where: { id: itemId, workspaceId: actor.workspaceId, kind: "FILE", deletedAt: null },
      select: { id: true, name: true, mimeType: true, storageKey: true },
    })
    if (!item?.storageKey) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!(await canReadItem(actor, item.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!canThumbnail(item.mimeType, item.name)) {
      return NextResponse.json({ error: "No thumbnail for this kind of file" }, { status: 415 })
    }

    const source = storagePath(item.storageKey)
    // The original is missing (a restore still in flight, a disk problem): no marker, so the next
    // request tries again once it is back.
    if (!existsSync(source)) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const width = thumbWidthFor(request.nextUrl.searchParams.get("w"))
    const out = thumbPath(item.storageKey, width)
    if (!existsSync(out)) {
      if (existsSync(`${out}.failed`) || !(await makeThumb(source, out, width))) {
        return NextResponse.json({ error: "No thumbnail for this file" }, { status: 415 })
      }
    }

    const stem = item.name.replace(/\.[^.]{1,8}$/, "") || "thumbnail"
    return serveFile(request, out, { filename: `${stem}.webp`, contentType: "image/webp" })
  } catch (error) {
    console.error("[vault] thumb failed:", error)
    return NextResponse.json({ error: "Failed to make a thumbnail" }, { status: 500 })
  }
}

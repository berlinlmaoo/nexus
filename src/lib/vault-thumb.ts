import { randomUUID } from "crypto"
import { existsSync } from "fs"
import { mkdir, rename, unlink, writeFile } from "fs/promises"
import path from "path"
import sharp from "sharp"
import { canThumbnail, storagePath, thumbPath, thumbWidthFor } from "@/lib/vault"

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnails of vault pictures, made once per file and width and kept on disk under the vault
// (lib/vault.ts thumbPath). Moved out of /api/vault/items/<id>/thumb on 9 Oct 2026 when a share link
// needed the same pictures (/api/vault/public/<slug>/thumb): one resize queue for both doors, so a
// shared folder of photos opened by a client and the same folder opened by staff never resize twice.
//
// A file sharp cannot read leaves a `.failed` marker beside it and is answered "none" from then on,
// without decoding it again on every page view.
// ─────────────────────────────────────────────────────────────────────────────

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

export type ThumbResult =
  | { ok: true; path: string; filename: string }
  | { ok: false; status: number; error: string }

/**
 * The thumbnail of a vault file at about `rawWidth` pixels (rounded up to VAULT_THUMB_WIDTHS), made
 * on the first request. The caller has already decided the request may see this file.
 */
export async function vaultThumbnail(
  item: { name: string; mimeType: string | null; storageKey: string | null },
  rawWidth: string | null,
): Promise<ThumbResult> {
  if (!item.storageKey) return { ok: false, status: 404, error: "Not found" }
  if (!canThumbnail(item.mimeType, item.name)) {
    return { ok: false, status: 415, error: "No thumbnail for this kind of file" }
  }
  const source = storagePath(item.storageKey)
  // The original is missing (a restore still in flight, a disk problem): no marker, so the next
  // request tries again once it is back.
  if (!existsSync(source)) return { ok: false, status: 404, error: "Not found" }

  const width = thumbWidthFor(rawWidth)
  const out = thumbPath(item.storageKey, width)
  if (!existsSync(out)) {
    if (existsSync(`${out}.failed`) || !(await makeThumb(source, out, width))) {
      return { ok: false, status: 415, error: "No thumbnail for this file" }
    }
  }
  const stem = item.name.replace(/\.[^.]{1,8}$/, "") || "thumbnail"
  return { ok: true, path: out, filename: `${stem}.webp` }
}

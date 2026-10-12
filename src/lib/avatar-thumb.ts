import { randomUUID } from "crypto"
import { existsSync } from "fs"
import { mkdir, rename, stat, unlink, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import sharp from "sharp"

// ─────────────────────────────────────────────────────────────────────────────
// Small avatar thumbnails (perf pass, 12 Oct 2026). Profile photos are stored as the phone took them
// (1–2.5 MB JPEGs) and every list on the web drew them at 24–40 px. `GET /api/files/avatars/<file>?w=`
// now answers a WebP of at most w×w instead. Without `?w=` nothing changes (the released apps use the
// plain URL).
//
// The cache lives OUTSIDE the uploads directory (os.tmpdir()), so it never ends up in a backup or a
// sync, and is simply rebuilt after a container restart. The source's mtime and size are part of the
// cache name: an avatar file name is `<userId>.<ext>` and is reused on re-upload, so a new photo must
// never be answered with the old thumbnail.
// ─────────────────────────────────────────────────────────────────────────────

export const AVATAR_THUMB_WIDTHS = [64, 128, 256] as const

/** `?w=` → a width bucket (the next one up, at most 256), or null when the param is absent/invalid. */
export function avatarThumbWidth(raw: string | null): number | null {
  if (raw === null || raw === "") return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return AVATAR_THUMB_WIDTHS.find((w) => w >= n) ?? AVATAR_THUMB_WIDTHS[AVATAR_THUMB_WIDTHS.length - 1]
}

const CACHE_DIR = path.join(os.tmpdir(), "nexus-avatar-thumbs")
const MAX_PARALLEL = 2
let running = 0
const waiting: Array<() => void> = []
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

function make(source: string, out: string, width: number): Promise<boolean> {
  const pending = inflight.get(out)
  if (pending) return pending
  const job = inTurn(async () => {
    if (existsSync(out)) return true
    await mkdir(path.dirname(out), { recursive: true })
    const temp = `${out}.${randomUUID()}.partial`
    try {
      await sharp(source, { failOn: "none", animated: false })
        .rotate()
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(temp)
      await rename(temp, out)
      return true
    } catch (error) {
      await unlink(temp).catch(() => {})
      console.warn("[avatar] thumbnail failed:", String(error))
      await writeFile(`${out}.failed`, "").catch(() => {})
      return false
    }
  }).finally(() => inflight.delete(out))
  inflight.set(out, job)
  return job
}

/**
 * The thumbnail path for an avatar file at `width`, made on first request; null when it can't be made
 * (not an image sharp reads, or an earlier attempt failed) — the caller then serves the original.
 */
export async function avatarThumbnail(source: string, width: number): Promise<{ path: string; etag: string; mtime: Date } | null> {
  let st
  try {
    st = await stat(source)
  } catch {
    return null
  }
  if (!st.isFile() || st.size === 0) return null
  const base = path.basename(source).replace(/[^A-Za-z0-9._-]/g, "_")
  const stamp = `${Math.floor(st.mtimeMs)}-${st.size}`
  const out = path.join(CACHE_DIR, `${base}-${stamp}-${width}.webp`)
  if (existsSync(`${out}.failed`)) return null
  const ok = existsSync(out) || (await make(source, out, width))
  return ok ? { path: out, etag: `"av-${stamp}-${width}"`, mtime: st.mtime } : null
}

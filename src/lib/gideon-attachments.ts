// Files a GIDEON question carried, kept after the question was answered.
//
// WHAT is kept: the bytes, not just the name. A chip that comes back after a reload and then opens
// nothing is worse than the blank message it replaced — it promises a file it cannot produce. So an
// attachment stored here is a real handle onto a real file, openable for as long as the turn exists.
//
// The IMAGE stored is the downscaled JPEG the route already produced, not the original upload. That
// is exactly what GIDEON was shown, it is what the chip's thumbnail already draws, and it is a
// fraction of the size — keeping the original as well would double the disk for a picture nobody
// would notice was sharper.
//
// WHERE, and why not a `gideon/` kind of its own: /api/files reads out of public/uploads, and only
// the directories bind-mounted into the container survive a redeploy (docker-compose.prod.yml and
// scripts/recreate-beta.sh list them one by one). `attachments` is mounted in every one of those; a
// new top-level kind would need the mount added AND the container recreated with it, and until that
// happened every file written here would land in the container's writable layer and disappear on the
// next deploy — a chip that silently stops opening, which is the exact failure this feature exists
// to remove. Two other features park their uploads one level down for the same reason:
// custom-fields at attachments/cf/, the Buffer exports at attachments/social-buffer/.
//
// RETENTION: none of its own. A file lives as long as the GideonMessage row that names it and goes
// when that row goes — see deleteGideonAttachmentFiles, called from DELETE /api/gideon/history.
// There is deliberately no age-based sweeper: "openable at any time" and "deleted after N days" are
// the same sentence twice, and the owner asked for the first.

import { mkdir, writeFile, unlink } from "fs/promises"
import { randomUUID } from "crypto"
import path from "path"
import { resolveMime } from "@/lib/mime"

/** Where the files land, relative to public/uploads. */
const DIR_SEGMENTS = ["attachments", "gideon"] as const

/** What a stored url looks like. Anything not starting with this is not ours and is never unlinked. */
const URL_PREFIX = `/api/files/${DIR_SEGMENTS.join("/")}/`

/** The on-disk names this module mints: a uuid and an extension, nothing else. */
const SAFE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

function uploadDir(): string {
  return path.join(process.cwd(), "public", "uploads", ...DIR_SEGMENTS)
}

/**
 * One kept attachment, as it is written into GideonMessage.attachments and handed to a client.
 *
 * `url` is a PATH and never a full URL: the host is added by whoever renders it, so a file keeps
 * working when the app is reached over the office LAN under a different name.
 */
export type StoredGideonAttachment = {
  kind: "image" | "document"
  url: string
  /** The name the user's own file had, for the chip's label. Empty for a photo, which had none. */
  name: string
  /** A hint for the client picking a viewer. /api/files sets the real Content-Type off the extension. */
  mime: string
  size: number
}

/** Filenames and labels come from a picker on somebody's phone; keep control characters out of both. */
function cleanName(value: string | null | undefined): string {
  return (value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 200)
}

/**
 * Writes whatever this turn carried and returns what to record on the row.
 *
 * Each file is attempted on its own: a photo that fails to write must not also cost the document
 * that succeeded. A failure is logged and simply produces no chip, which is the behaviour every
 * GIDEON message had until today — never an error the user sees, because by the time this runs the
 * answer has already been delivered.
 *
 * `documentExt` must already have been validated against DOC_EXTENSIONS by the caller; it is used
 * to build a filename, so an unchecked value would be a path.
 */
export async function storeGideonAttachments(input: {
  imageBase64?: string | null
  documentBase64?: string | null
  documentExt?: string | null
  documentName?: string | null
  documentMime?: string | null
}): Promise<StoredGideonAttachment[]> {
  const kept: StoredGideonAttachment[] = []
  const dir = uploadDir()

  // Image first, then document — the order the composer's own strip lists them in, so a sent
  // message shows its attachments in the order they were attached.
  const jobs: { kind: "image" | "document"; base64: string; ext: string; name: string; mime: string }[] = []
  if (input.imageBase64) {
    jobs.push({ kind: "image", base64: input.imageBase64, ext: "jpg", name: "", mime: "image/jpeg" })
  }
  if (input.documentBase64 && input.documentExt) {
    const ext = String(input.documentExt).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)
    if (ext) {
      const name = cleanName(input.documentName)
      jobs.push({
        kind: "document",
        base64: input.documentBase64,
        ext,
        name: name || `file.${ext}`,
        mime: cleanName(input.documentMime).slice(0, 128),
      })
    }
  }
  if (jobs.length === 0) return kept

  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    console.error("gideon attachment mkdir failed:", error)
    return kept
  }

  for (const job of jobs) {
    // Random rather than derived from the user or the message, for the same reason chat uploads are:
    // a guessable name would let anyone with a session fish for somebody else's file, and /api/files
    // checks the session but not who owns the row.
    const fileName = `${randomUUID()}.${job.ext}`
    try {
      const bytes = Buffer.from(job.base64, "base64")
      if (bytes.length === 0) continue
      await writeFile(path.join(dir, fileName), bytes)
      kept.push({
        kind: job.kind,
        url: `${URL_PREFIX}${fileName}`,
        name: job.name,
        mime: resolveMime(job.mime || null, job.name || fileName),
        size: bytes.length,
      })
    } catch (error) {
      console.error("gideon attachment write failed:", error)
    }
  }
  return kept
}

/**
 * Reads back what was recorded on a row. The column is jsonb, so what comes out of it is whatever
 * was put in — parsed defensively rather than cast, and anything that is not one of ours is dropped.
 */
export function parseGideonAttachments(value: unknown): StoredGideonAttachment[] {
  if (!Array.isArray(value)) return []
  const out: StoredGideonAttachment[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Record<string, unknown>
    const url = typeof item.url === "string" ? item.url : ""
    if (!basenameOf(url)) continue
    out.push({
      kind: item.kind === "image" ? "image" : "document",
      url,
      name: typeof item.name === "string" ? item.name : "",
      mime: typeof item.mime === "string" ? item.mime : "application/octet-stream",
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
    })
  }
  return out
}

/**
 * The one place that decides whether a stored url names a file this module may touch.
 *
 * Returns the basename only for a url of exactly the shape this module writes. Everything else —
 * a different prefix, a nested path, a `..`, an empty tail — returns null and is left alone. The
 * values checked here were written by this file, but they have been through a jsonb column that
 * anything with database access can edit, and this function is what stands between that column and
 * unlink().
 */
function basenameOf(url: string): string | null {
  if (typeof url !== "string" || !url.startsWith(URL_PREFIX)) return null
  const tail = url.slice(URL_PREFIX.length)
  if (!SAFE_BASENAME.test(tail)) return null
  if (tail.includes("..")) return null
  return tail
}

/**
 * Deletes the files named by rows that are going away.
 *
 * Called AFTER the rows are gone, on purpose: a file left behind by a failed unlink is 10 MB nobody
 * can reach, while a row left behind by a failed delete is a chip pointing at a file that no longer
 * exists. Of the two, the wasted megabytes are the one the user never sees.
 *
 * Returns how many files it removed, for the caller's log.
 */
export async function deleteGideonAttachmentFiles(values: unknown[]): Promise<number> {
  const dir = uploadDir()
  let removed = 0
  for (const value of values) {
    for (const item of parseGideonAttachments(value)) {
      const base = basenameOf(item.url)
      if (!base) continue
      try {
        await unlink(path.join(dir, base))
        removed++
      } catch (error) {
        // ENOENT is the normal case for a file already gone; anything else is worth a line.
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          console.error("gideon attachment unlink failed:", base, error)
        }
      }
    }
  }
  return removed
}

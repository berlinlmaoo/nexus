import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises"
import { randomUUID } from "crypto"
import path from "path"

/**
 * Files GIDEON makes for a person (18 Oct 2026: a Doc or an answer as PDF / DOCX / XLSX), downloadable from the GIDEON
 * chat at /api/gideon/files/<id> by that person only.
 *
 * Kept under public/uploads/attachments/gideon/exports/ — `attachments` is bind-mounted in every deployment, so a file
 * survives a redeploy (see lib/gideon-attachments.ts on why not a new top-level dir). Each file has a sidecar
 * <id>.json naming its owner; the download route serves it only to them. No table: a file is a convenience copy
 * (the Doc / the answer stays the source), kept 30 days, swept on the next export. Saving it to Z Vault (a card)
 * makes the lasting copy.
 */

export const GIDEON_FILE_KEEP_MS = 30 * 86400e3
export const GIDEON_FILE_MAX_BYTES = 25 * 1024 * 1024

export const FILE_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

export type GideonFileMeta = { id: string; userId: string; name: string; ext: string; mime: string; size: number; createdAt: string; source: string }

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function dir(): string {
  return path.join(process.cwd(), "public", "uploads", "attachments", "gideon", "exports")
}

/** A file name people can read and every OS accepts. */
export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\u0000-\u001F\u007F\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "GIDEON"
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

export async function storeGideonFile(userId: string, name: string, ext: string, bytes: Buffer, source: string): Promise<GideonFileMeta> {
  if (bytes.length > GIDEON_FILE_MAX_BYTES) throw new Error("The file is too big (over 25 MB).")
  await mkdir(dir(), { recursive: true })
  void sweepGideonFiles().catch(() => {})
  const id = randomUUID()
  const meta: GideonFileMeta = { id, userId, name: safeFileName(name, ext), ext, mime: FILE_MIME[ext] ?? "application/octet-stream", size: bytes.length, createdAt: new Date().toISOString(), source: source.slice(0, 200) }
  await writeFile(path.join(dir(), `${id}.${ext}`), bytes, { mode: 0o640 })
  await writeFile(path.join(dir(), `${id}.json`), JSON.stringify(meta), { mode: 0o640 })
  return meta
}

/** The file's facts, for its owner only (null for anyone else or an unknown id). */
export async function gideonFileFor(userId: string, id: string): Promise<GideonFileMeta | null> {
  if (!ID_RE.test(id)) return null
  try {
    const meta = JSON.parse(await readFile(path.join(dir(), `${id}.json`), "utf8")) as GideonFileMeta
    if (meta.userId !== userId || meta.id !== id || !FILE_MIME[meta.ext]) return null
    if (Date.now() - new Date(meta.createdAt).getTime() > GIDEON_FILE_KEEP_MS) return null
    return meta
  } catch {
    return null
  }
}

export async function gideonFileBytes(meta: GideonFileMeta): Promise<Buffer> {
  return readFile(path.join(dir(), `${meta.id}.${meta.ext}`))
}

export const gideonFileUrl = (id: string) => `/api/gideon/files/${id}`

/** Drop files older than GIDEON_FILE_KEEP_MS. */
export async function sweepGideonFiles(now = Date.now()): Promise<number> {
  let n = 0
  for (const f of await readdir(dir()).catch(() => [] as string[])) {
    const full = path.join(dir(), f)
    const st = await stat(full).catch(() => null)
    if (st && now - st.mtimeMs > GIDEON_FILE_KEEP_MS) { await unlink(full).catch(() => {}); n++ }
  }
  return n
}

import path from "path"
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises"
import { newStorageKey } from "@/lib/vault"

// Where Legal keeps its files: templates, kops, generated DOCX/PDF and uploaded documents. Same scheme as
// Z Vault (server-generated `YYYY/MM/<uuid><ext>` keys, never a path from a request), in its own directory
// under `attachments/`, which is already bind-mounted into the container (see VAULT_DIR in lib/vault.ts).
// Not Vault items: nothing legal is reachable through Vault's own rules or its share links.

export const LEGAL_DIR = path.join(process.cwd(), "public", "uploads", "attachments", "legal")

export const LEGAL_MAX_TEMPLATE_BYTES = 20 * 1024 * 1024
export const LEGAL_MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const PDF_MIME = "application/pdf"

export function legalStoragePath(storageKey: string): string {
  const full = path.resolve(LEGAL_DIR, storageKey)
  if (!full.startsWith(LEGAL_DIR + path.sep)) throw new Error("Legal storageKey escaped the legal directory")
  return full
}

/** Write bytes under a fresh key (temp file + rename, so a crash never leaves half a file under the key). */
export async function storeLegalFile(fileName: string, bytes: Buffer): Promise<string> {
  const key = newStorageKey(fileName)
  const full = legalStoragePath(key)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(`${full}.partial`, bytes)
  await rename(`${full}.partial`, full)
  return key
}

export async function readLegalFile(storageKey: string): Promise<Buffer> {
  return readFile(legalStoragePath(storageKey))
}

export async function deleteLegalFile(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return
  try {
    await unlink(legalStoragePath(storageKey))
  } catch {
    /* already gone */
  }
}

/** "Kontrak: v2 / final?.docx" → "Kontrak- v2 - final-.docx" — safe in a Content-Disposition and on disk. */
export function safeFileName(name: string, fallback = "document"): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150)
  return cleaned || fallback
}

/** A .docx is a zip: "PK\x03\x04". Checked on the bytes, never trusted from the name or the browser's type. */
export const looksLikeZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
export const looksLikePdf = (b: Buffer) => b.length > 4 && b.subarray(0, 5).toString("latin1") === "%PDF-"

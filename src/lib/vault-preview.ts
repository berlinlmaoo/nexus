import { randomUUID } from "crypto"
import { existsSync } from "fs"
import { mkdir, readFile, rename, stat, writeFile } from "fs/promises"
import path from "path"
import { canOfficePreview, previewPath, storagePath } from "@/lib/vault"
import { GOTENBERG_URL, PdfError } from "@/lib/legal/pdf"

// ─────────────────────────────────────────────────────────────────────────────
// Office files in the vault, previewed as a PDF on the web (UI round 19 Oct 2026, U-5: a .docx opened
// as a download). Converted once per stored file through the same Gotenberg sidecar the legal
// documents use, and kept beside the thumbnails (`.previews/YYYY/MM/<uuid>.pdf`). A replace gives the
// bytes a new storageKey, so a stale preview is never served; deleteStoredFile removes it.
// A file the converter refuses leaves a `.failed` marker and is answered "no preview" from then on.
// ─────────────────────────────────────────────────────────────────────────────

/** Above this the conversion takes too long for someone waiting on a dialog. */
export const OFFICE_PREVIEW_MAX_BYTES = 40 * 1024 * 1024

/** One conversion at a time in this process (LibreOffice is heavy); one per file however many ask. */
let chain: Promise<unknown> = Promise.resolve()
const inflight = new Map<string, Promise<boolean>>()

async function convert(source: string, name: string, out: string): Promise<boolean> {
  if (!GOTENBERG_URL) throw new PdfError("not configured")
  const bytes = await readFile(source)
  const ext = path.extname(name).toLowerCase() || ".docx"
  const form = new FormData()
  form.append("files", new Blob([new Uint8Array(bytes)]), `document${ext}`)
  const res = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`conversion failed (${res.status})`)
  const pdf = Buffer.from(await res.arrayBuffer())
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("converter returned something that is not a PDF")
  await mkdir(path.dirname(out), { recursive: true })
  const temp = `${out}.${randomUUID()}.partial`
  await writeFile(temp, pdf)
  await rename(temp, out)
  return true
}

export type PreviewResult = { ok: true; path: string; filename: string } | { ok: false; status: number; error: string }

/** The PDF preview of an office file, made on the first request. The caller has checked access. */
export async function vaultOfficePreview(item: { name: string; storageKey: string | null; size?: bigint | number | null }): Promise<PreviewResult> {
  if (!item.storageKey) return { ok: false, status: 404, error: "Not found" }
  if (!canOfficePreview(item.name)) return { ok: false, status: 415, error: "No preview for this kind of file" }
  if (!GOTENBERG_URL) return { ok: false, status: 501, error: "Previews are not set up on this server" }
  const source = storagePath(item.storageKey)
  if (!existsSync(source)) return { ok: false, status: 404, error: "Not found" }
  if ((await stat(source)).size > OFFICE_PREVIEW_MAX_BYTES) return { ok: false, status: 413, error: "Too big to preview" }
  const out = previewPath(item.storageKey)
  const stem = item.name.replace(/\.[^.]{1,8}$/, "") || "preview"
  if (existsSync(out)) return { ok: true, path: out, filename: `${stem}.pdf` }
  if (existsSync(`${out}.failed`)) return { ok: false, status: 415, error: "This file could not be previewed" }
  let job = inflight.get(out)
  if (!job) {
    job = (chain = chain.catch(() => {}).then(() => (existsSync(out) ? true : convert(source, item.name, out))))
      .then(() => true)
      .catch(async (error) => {
        console.warn("[vault] preview failed:", String(error))
        // A down converter is not the file's fault: no marker then, so the next open tries again.
        if (!(error instanceof PdfError) && !/fetch failed|timeout|aborted/i.test(String(error))) {
          await mkdir(path.dirname(out), { recursive: true }).catch(() => {})
          await writeFile(`${out}.failed`, "").catch(() => {})
        }
        return false
      })
      .finally(() => inflight.delete(out)) as Promise<boolean>
    inflight.set(out, job)
  }
  if (!(await job)) return { ok: false, status: 502, error: "This file could not be previewed" }
  return { ok: true, path: out, filename: `${stem}.pdf` }
}

import path from "path"
import { mkdir } from "fs/promises"
import type { NextRequest } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { emitPipelineChanged } from "@/lib/socket-emitter"
import { LINK_TYPES } from "@/lib/pipeline"
import { newStorageKey } from "@/lib/vault"

/**
 * A deal's "Documents & links" (owner, 9 Oct 2026: "kenapa document sama links ini cuma paste document?
 * kenapa ga attach documentnya jg?"). PipelineDeal.links stays the one list, and an entry is either a
 * pasted link or an attached file — same type (SPK / Kontrak / MOU / Invoice / Lainnya) and optional name:
 *
 *   stored: { id, type, label, url }                                                    a link
 *           { id, type, label, file: storageKey, fileName, mimeType, size, uploadedAt, uploadedById }
 *   wire:   { id, type, label, url, kind: "link" }
 *           { id, type, label, url: <download path>, kind: "file", fileName, mimeType, size, uploadedAt }
 *
 * A file entry carries a `url` on the wire (its members-only download route) so a client that only knows
 * links still decodes the list, shows the entry and can open it — and when it PATCHes the list back with
 * that url, the entry is recognised by its id and kept. The storage key never leaves the server.
 *
 * Files come in only through the chunked upload (/api/attachments/chunk?target=pipeline, which adds the
 * entry itself) and go out only through DELETE …/documents/:docId. A PATCH of `links` edits links and
 * relabels files but never adds or drops a file: an editor holding a stale list (a colleague uploaded a
 * contract a second ago) must not silently remove it.
 *
 * Removing an entry or deleting the deal never unlinks the bytes (the Audit restore rule, 8 Oct 2026):
 * the 90-day purge does, once no live deal and no restorable copy refers to them —
 * deletion-snapshot.ts purgeDeletionSnapshots reads `file` from deal snapshots and from
 * "document.removed" history rows.
 */

/** Under attachments/, the directory already bind-mounted into the container (see lib/vault.ts VAULT_DIR). */
export const PIPELINE_FILES_DIR = path.join(process.cwd(), "public", "uploads", "attachments", "pipeline")

/** A deal holds at most this many documents and links together — a guard, not a business rule. */
export const MAX_DEAL_DOCUMENTS = 50

/** Absolute path of a stored file. Keys are server-made; the guard is defence in depth. */
export function pipelineFilePath(storageKey: string): string {
  const full = path.resolve(PIPELINE_FILES_DIR, storageKey)
  if (!full.startsWith(PIPELINE_FILES_DIR + path.sep)) throw new Error("Pipeline storageKey escaped its directory")
  return full
}

/** A new key (`YYYY/MM/<uuid><ext>`, the Vault's format) and its directory, created. */
export async function newPipelineFile(fileName: string): Promise<{ storageKey: string; fullPath: string }> {
  const storageKey = newStorageKey(fileName)
  const fullPath = pipelineFilePath(storageKey)
  await mkdir(path.dirname(fullPath), { recursive: true })
  return { storageKey, fullPath }
}

export type StoredLink = { id: string; type: string; label: string; url: string }
export type StoredFile = {
  id: string
  type: string
  label: string
  file: string
  fileName: string
  mimeType: string
  size: number
  uploadedAt: string
  uploadedById: string | null
}
export type StoredDoc = StoredLink | StoredFile

export function isFileDoc(d: StoredDoc): d is StoredFile {
  return typeof (d as StoredFile).file === "string"
}

/** The stored list, tolerant of anything odd in the column. */
export function storedDocs(raw: unknown): StoredDoc[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((d): d is StoredDoc => {
    if (!d || typeof d !== "object") return false
    const o = d as Record<string, unknown>
    return typeof o.id === "string" && (typeof o.url === "string" || typeof o.file === "string")
  })
}

const enc = encodeURIComponent

/** Where a file is downloaded: members-only, the project's read rule (…/documents/[docId]/route.ts). */
export function documentPath(projectId: string, dealId: string, docId: string): string {
  return `/api/projects/${enc(projectId)}/pipeline/${enc(dealId)}/documents/${enc(docId)}`
}

/** An entry as every client receives it. */
export function documentOut(projectId: string, dealId: string, d: StoredDoc) {
  if (isFileDoc(d)) {
    return {
      id: d.id,
      type: d.type,
      label: d.label,
      url: documentPath(projectId, dealId, d.id),
      kind: "file" as const,
      fileName: d.fileName,
      mimeType: d.mimeType,
      size: d.size,
      uploadedAt: d.uploadedAt,
    }
  }
  return { id: d.id, type: d.type, label: d.label, url: d.url, kind: "link" as const }
}

export function documentsOut(projectId: string, dealId: string, raw: unknown) {
  return storedDocs(raw).map((d) => documentOut(projectId, dealId, d))
}

/** An entry as the history shows it: never the storage key or the uploader's id. */
function documentForHistory(d: unknown): unknown {
  if (!d || typeof d !== "object") return d
  const { file: _file, uploadedById: _by, ...rest } = d as Record<string, unknown>
  void _file
  void _by
  return rest
}

/** History rows that hold documents ("links", "document.added", "document.removed"), cleaned for the wire. */
export function documentHistoryValue(field: string, v: unknown): unknown {
  if (field === "links" && Array.isArray(v)) return v.map(documentForHistory)
  if (field === "document.added" || field === "document.removed") return documentForHistory(v)
  return v
}

/** A link list as a PATCH's history row keeps it: the cleaned entries (a kept file's key stays out). */
export function linksForHistory(v: unknown): Prisma.InputJsonValue {
  return (Array.isArray(v) ? v.map(documentForHistory) : []) as Prisma.InputJsonValue
}

function linkType(v: unknown): string | null {
  return typeof v === "string" && (LINK_TYPES as readonly string[]).includes(v) ? v : null
}

function cleanLabel(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 200) : ""
}

/**
 * The list a PATCH (or a create) sends, against the stored one. Links: as before — http(s) only (a
 * javascript: or data: link on a shared board would run in a colleague's browser). Files: an entry whose
 * id is a stored file keeps that file, with the type and name sent; a stored file the list leaves out is
 * kept where it was (files leave only through DELETE …/documents/:docId). Anything else is refused.
 */
export function mergeDocuments(current: StoredDoc[], sent: unknown): StoredDoc[] | undefined {
  if (!Array.isArray(sent) || sent.length > MAX_DEAL_DOCUMENTS) return undefined
  const files = new Map(current.filter(isFileDoc).map((f) => [f.id, f]))
  const seen = new Set<string>()
  const out: StoredDoc[] = []
  for (const raw of sent) {
    if (!raw || typeof raw !== "object") return undefined
    const l = raw as Record<string, unknown>
    const id = typeof l.id === "string" && l.id.length > 0 && l.id.length <= 40 ? l.id : null
    const file = id ? files.get(id) : undefined
    if (file) {
      if (seen.has(file.id)) continue
      seen.add(file.id)
      out.push({ ...file, type: linkType(l.type) ?? file.type, label: "label" in l ? cleanLabel(l.label) : file.label })
      continue
    }
    const url = typeof l.url === "string" ? l.url.trim() : ""
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return undefined
    out.push({
      id: id && !files.has(id) ? id : `lnk${Math.random().toString(36).slice(2, 10)}`,
      type: linkType(l.type) ?? "Lainnya",
      label: cleanLabel(l.label),
      url,
    })
  }
  // A file the sender did not list (it had not seen it yet, or is an older app): back where it was.
  current.forEach((d, i) => {
    if (isFileDoc(d) && !seen.has(d.id)) out.splice(Math.min(i, out.length), 0, d)
  })
  if (out.length > MAX_DEAL_DOCUMENTS) return undefined
  return out
}

/** "SPK · Kontrak_final.pdf" — how a document is named in the audit trail. */
function auditName(d: StoredDoc): string {
  return `${d.type} · ${isFileDoc(d) ? d.label || d.fileName : d.label || d.url}`
}

type Tx = Prisma.TransactionClient

/** The deal's list, read under a row lock so two uploads (or an upload and a remove) never lose one. */
async function lockedDocs(tx: Tx, projectId: string, dealId: string): Promise<{ code: string; name: string; docs: StoredDoc[] } | null> {
  const rows = await tx.$queryRaw<{ code: string; name: string; links: unknown }[]>`
    select code, name, links from "PipelineDeal" where id = ${dealId} and "projectId" = ${projectId} for update`
  if (!rows.length) return null
  const links = typeof rows[0].links === "string" ? JSON.parse(rows[0].links) : rows[0].links
  return { code: rows[0].code, name: rows[0].name, docs: storedDocs(links) }
}

export type AddFileResult =
  | { ok: true; doc: StoredFile }
  | { ok: false; code: "DEAL_NOT_FOUND" | "TOO_MANY_DOCUMENTS" }

/**
 * A finished upload becomes an entry at the end of the deal's list, with one history row
 * ("document.added") and an audit line — in the same transaction, so a file is never on the deal
 * without its trace. The caller has already checked write access and published the bytes.
 */
export async function addFileDocument(input: {
  projectId: string
  dealId: string
  userId: string
  storageKey: string
  fileName: string
  mimeType: string
  size: number
  type: string | null
  label: string | null
  request?: NextRequest
}): Promise<AddFileResult> {
  const doc: StoredFile = {
    id: `doc${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    type: linkType(input.type) ?? "Lainnya",
    label: cleanLabel(input.label),
    file: input.storageKey,
    fileName: input.fileName.slice(0, 255),
    mimeType: input.mimeType,
    size: input.size,
    uploadedAt: new Date().toISOString(),
    uploadedById: input.userId,
  }
  const result = await prisma.$transaction(async (tx) => {
    const deal = await lockedDocs(tx, input.projectId, input.dealId)
    if (!deal) return { ok: false as const, code: "DEAL_NOT_FOUND" as const }
    if (deal.docs.length >= MAX_DEAL_DOCUMENTS) return { ok: false as const, code: "TOO_MANY_DOCUMENTS" as const }
    await tx.pipelineDeal.update({
      where: { id: input.dealId },
      data: { links: [...deal.docs, doc] as unknown as Prisma.InputJsonValue, updatedById: input.userId },
    })
    await tx.pipelineDealChange.create({
      data: { dealId: input.dealId, userId: input.userId, field: "document.added", after: documentForHistory(doc) as Prisma.InputJsonValue },
    })
    return { ok: true as const, deal }
  })
  if (!result.ok) return result
  logAudit({
    action: "update",
    entityType: "pipeline_deal",
    entityId: input.dealId,
    entityName: `${result.deal.code} ${result.deal.name}`,
    userId: input.userId,
    request: input.request,
    metadata: { projectId: input.projectId, fields: ["links"], document: auditName(doc), size: input.size, chunked: true },
  })
  emitPipelineChanged(input.projectId, input.dealId, input.userId)
  return { ok: true, doc }
}

/**
 * Takes one entry (a link or a file) off the deal. The history row "document.removed" keeps the whole
 * entry — for a file, its storage key too: that row is what tells the 90-day purge the bytes may go once
 * nothing else refers to them. The bytes themselves stay on disk until then.
 */
export async function removeDocument(input: {
  projectId: string
  dealId: string
  docId: string
  userId: string
  request?: NextRequest
}): Promise<StoredDoc | null> {
  const result = await prisma.$transaction(async (tx) => {
    const deal = await lockedDocs(tx, input.projectId, input.dealId)
    const doc = deal?.docs.find((d) => d.id === input.docId)
    if (!deal || !doc) return null
    await tx.pipelineDeal.update({
      where: { id: input.dealId },
      data: { links: deal.docs.filter((d) => d.id !== input.docId) as unknown as Prisma.InputJsonValue, updatedById: input.userId },
    })
    await tx.pipelineDealChange.create({
      data: { dealId: input.dealId, userId: input.userId, field: "document.removed", before: doc as unknown as Prisma.InputJsonValue },
    })
    return { deal, doc }
  })
  if (!result) return null
  logAudit({
    action: "update",
    entityType: "pipeline_deal",
    entityId: input.dealId,
    entityName: `${result.deal.code} ${result.deal.name}`,
    userId: input.userId,
    request: input.request,
    metadata: { projectId: input.projectId, fields: ["links"], removedDocument: auditName(result.doc) },
  })
  emitPipelineChanged(input.projectId, input.dealId, input.userId)
  return result.doc
}

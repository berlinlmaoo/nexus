import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { diffParagraphs } from "@/lib/legal/diff"
import { pdfLater } from "@/lib/legal/generate"
import { applyParagraphEdits, paragraphTexts, ParagraphEditError, readParagraphs, type ParagraphChange } from "@/lib/legal/paragraphs"
import { deleteLegalFile, readLegalFile, storeLegalFile } from "@/lib/legal/storage"
import { storeUpload, type StoredUpload } from "@/lib/legal/uploads"

// Review after generation (owner, 14 Oct 2026): every change — a manual edit, an approved GIDEON proposal, an
// uploaded file, a restore — is a new version with its author and time. Versions are never changed or
// deleted, so any two can be compared and any one restored (as a new version on top).

export class LegalVersionError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

export async function loadDocForVersions(documentId: string) {
  const doc = await prisma.legalDocument.findFirst({ where: { id: documentId, deletedAt: null } })
  if (!doc) throw new LegalVersionError("Document not found", 404)
  return doc
}

/** A Word file that can't be read (not really a .docx, too large) is the caller's 422, not a 500. */
export function asVersionError<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (error instanceof ParagraphEditError) throw new LegalVersionError(error.message, error.status)
    throw error
  }
}

/** What may never change by an edit: the paragraph that prints the document's number. */
export const lockedTextsOf = (doc: { number: string }) => (doc.number ? [doc.number] : [])

export async function versionDocx(documentId: string, version: number): Promise<Buffer> {
  const v = await prisma.legalDocumentVersion.findUnique({ where: { documentId_version: { documentId, version } } })
  if (!v) throw new LegalVersionError("No such version", 404)
  if (!v.docxKey) throw new LegalVersionError("This version is not a Word file (an uploaded scan or PDF), so it can't be read or edited here", 409)
  return readLegalFile(v.docxKey)
}

/** The body paragraphs of one version (default: the current one), with which may be edited. */
export async function documentParagraphs(documentId: string, version?: number) {
  const doc = await loadDocForVersions(documentId)
  const v = version ?? doc.currentVersion
  const docx = await versionDocx(documentId, v)
  return { version: v, current: doc.currentVersion, paragraphs: asVersionError(() => readParagraphs(docx, lockedTextsOf(doc))) }
}

type NewVersion = {
  kind: "MANUAL" | "GIDEON" | "UPLOAD" | "RESTORE"
  files: Pick<StoredUpload, "docxKey" | "pdfKey" | "fileKey" | "fileName" | "mimeType" | "size">
  note: string
  changes?: Prisma.InputJsonValue
  status?: string
}

/**
 * Put a version on top, only if nobody else did since `baseVersion` (two people editing at once: the second
 * gets a 409 and reloads instead of silently undoing the first). Deletes the new files when it refuses.
 */
async function addVersion(actorId: string, documentId: string, baseVersion: number, v: NewVersion): Promise<number> {
  const next = baseVersion + 1
  try {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.legalDocument.updateMany({
        where: { id: documentId, currentVersion: baseVersion, deletedAt: null },
        data: { currentVersion: next, updatedById: actorId, ...(v.status ? { status: v.status } : {}) },
      })
      if (moved.count !== 1) throw new LegalVersionError("Someone changed this document meanwhile. Reload to see their version.", 409)
      await tx.legalDocumentVersion.create({
        data: {
          documentId,
          version: next,
          kind: v.kind,
          docxKey: v.files.docxKey,
          pdfKey: v.files.pdfKey,
          fileKey: v.files.fileKey,
          fileName: v.files.fileName,
          mimeType: v.files.mimeType,
          size: v.files.size,
          note: v.note.slice(0, 500),
          changes: v.changes,
          authorId: actorId,
        },
      })
    })
  } catch (error) {
    await Promise.all([deleteLegalFile(v.files.docxKey), deleteLegalFile(v.files.pdfKey), deleteLegalFile(v.files.fileKey)])
    throw error
  }
  return next
}

/** Save edited paragraphs as a new version (a person's edit, or an approved GIDEON proposal). */
export async function saveParagraphEdits(
  actorId: string,
  documentId: string,
  input: { baseVersion: number; edits: { index: number; text: string }[]; note?: string; kind?: "MANUAL" | "GIDEON"; extraChanges?: Record<string, unknown> },
): Promise<{ version: number; changes: ParagraphChange[]; pdfError: string | null }> {
  const doc = await loadDocForVersions(documentId)
  if (input.baseVersion !== doc.currentVersion) throw new LegalVersionError("Someone changed this document meanwhile. Reload to see their version.", 409)
  if (!Array.isArray(input.edits) || !input.edits.length) throw new LegalVersionError("Nothing to save", 400)
  const base = await prisma.legalDocumentVersion.findUniqueOrThrow({ where: { documentId_version: { documentId, version: doc.currentVersion } } })
  let edited: ReturnType<typeof applyParagraphEdits>
  try {
    edited = applyParagraphEdits(await versionDocx(documentId, doc.currentVersion), input.edits, lockedTextsOf(doc))
  } catch (error) {
    if (error instanceof ParagraphEditError) throw new LegalVersionError(error.message, error.status)
    throw error
  }
  if (!edited.changes.length) throw new LegalVersionError("Nothing changed", 400)
  const docxKey = await storeLegalFile(base.fileName, edited.docx)
  const version = await addVersion(actorId, documentId, doc.currentVersion, {
    kind: input.kind ?? "MANUAL",
    files: { docxKey, pdfKey: null, fileKey: null, fileName: base.fileName, mimeType: base.mimeType, size: edited.docx.length },
    note: input.note?.trim() ?? "",
    changes: { paragraphs: edited.changes, ...(input.extraChanges ?? {}) } as Prisma.InputJsonValue,
  })
  return { version, changes: edited.changes, pdfError: pdfLater(documentId, version, edited.docx, base.fileName) }
}

/** Upload a file as the new version — the signed scan of a generated contract, or a Word file edited outside. */
export async function uploadVersion(actorId: string, documentId: string, form: FormData) {
  const doc = await loadDocForVersions(documentId)
  const baseVersion = Number(form.get("baseVersion"))
  if (baseVersion !== doc.currentVersion) throw new LegalVersionError("Someone changed this document meanwhile. Reload to see their version.", 409)
  const status = typeof form.get("status") === "string" ? String(form.get("status")) : undefined
  if (status && !["DRAFT", "FINAL", "SENT", "SIGNED", "VOID"].includes(status)) throw new LegalVersionError("Unknown status", 400)
  const stored = await storeUpload(form.get("file"))
  const note = typeof form.get("note") === "string" ? String(form.get("note")) : ""
  const version = await addVersion(actorId, documentId, baseVersion, { kind: "UPLOAD", files: stored, note, status })
  return { version, pdfError: stored.docx ? pdfLater(documentId, version, stored.docx, stored.fileName) : null }
}

/** Bring back an old version as a new one on top (its files are copied: versions never share a file). */
export async function restoreVersion(actorId: string, documentId: string, fromVersion: number, baseVersion: number) {
  const doc = await loadDocForVersions(documentId)
  if (baseVersion !== doc.currentVersion) throw new LegalVersionError("Someone changed this document meanwhile. Reload to see their version.", 409)
  if (fromVersion === doc.currentVersion) throw new LegalVersionError("That is already the current version", 400)
  const from = await prisma.legalDocumentVersion.findUnique({ where: { documentId_version: { documentId, version: fromVersion } } })
  if (!from) throw new LegalVersionError("No such version", 404)
  const copy = async (key: string | null) => (key ? storeLegalFile(from.fileName, await readLegalFile(key)) : null)
  const files = { docxKey: await copy(from.docxKey), pdfKey: await copy(from.pdfKey), fileKey: await copy(from.fileKey), fileName: from.fileName, mimeType: from.mimeType, size: from.size }
  const version = await addVersion(actorId, documentId, baseVersion, { kind: "RESTORE", files, note: "", changes: { restoredFrom: fromVersion } })
  return { version }
}

/** Paragraph-by-paragraph difference between two Word versions. */
export async function compareVersions(documentId: string, a: number, b: number) {
  await loadDocForVersions(documentId)
  const [pa, pb] = await Promise.all([versionDocx(documentId, a), versionDocx(documentId, b)])
  return { a, b, diff: asVersionError(() => diffParagraphs(paragraphTexts(pa), paragraphTexts(pb))) }
}

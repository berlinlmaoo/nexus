import type { Prisma } from "@/generated/prisma/client"
import { downloadBaseName, revisionLabel } from "@/lib/legal/rules"

// Legal documents: how a row reads to the clients. Generation: generate.ts; edits/versions: versions.ts.

const person = { select: { id: true, name: true, avatar: true } } as const

export const documentInclude = {
  company: { select: { id: true, code: true, name: true } },
  series: { select: { id: true, key: true, label: true } },
  templateVersion: { select: { version: true, template: { select: { id: true, name: true } } } },
  project: { select: { id: true, name: true } },
  deal: { select: { id: true, code: true, name: true, projectId: true } },
  createdBy: person,
  updatedBy: person,
  versions: { orderBy: { version: "desc" }, include: { author: person } },
  signedBy: person,
  numberReusedBy: { select: { id: true, number: true, title: true } },
  numberReusedFrom: { select: { id: true, number: true, title: true } },
  parentDocument: { select: { id: true, number: true, title: true, status: true, docType: true } },
  addenda: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, number: true, title: true, status: true, docDate: true, signedAt: true, addendumSeq: true, numberReleasedAt: true },
  },
} satisfies Prisma.LegalDocumentInclude

export const documentListInclude = {
  company: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, name: true } },
  deal: { select: { id: true, code: true, name: true, projectId: true } },
  createdBy: person,
  signedBy: person,
  numberReusedBy: { select: { id: true, number: true, title: true } },
  parentDocument: { select: { id: true, number: true, title: true, status: true, docType: true } },
  _count: { select: { addenda: { where: { deletedAt: null } } } },
} satisfies Prisma.LegalDocumentInclude

type DocRow = Prisma.LegalDocumentGetPayload<{ include: typeof documentInclude }>
type DocListRow = Prisma.LegalDocumentGetPayload<{ include: typeof documentListInclude }>

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null
/** docDate is a calendar day; send it as YYYY-MM-DD so no client shifts it a day across time zones. */
export const dayOf = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d) : null

/** "2026-10-14" → that day at noon in Jakarta (stable whatever the server's time zone). */
export const dateFromDay = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00+07:00`)

export function serializeDocumentSummary(d: DocListRow | DocRow) {
  const addendaCount = "_count" in d ? d._count.addenda : d.addenda.length
  return {
    id: d.id,
    number: d.number,
    docType: d.docType,
    title: d.title,
    counterparty: d.counterparty,
    docDate: dayOf(d.docDate),
    status: d.status,
    source: d.source,
    company: d.company,
    project: d.project,
    deal: d.deal,
    currentVersion: d.currentVersion,
    createdBy: d.createdBy,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    /** The signed copy: when it was uploaded and by whom (status SIGNED). */
    signedAt: iso(d.signedAt),
    signedBy: d.signedBy,
    voidedAt: iso(d.voidedAt),
    /** Voided before it was signed: the number went back to its series (and maybe to `numberReusedBy`). */
    numberReleased: !!d.numberReleasedAt,
    numberReusedBy: d.numberReusedBy,
    /** An addendum: the signed document it amends. */
    parent: d.parentDocument,
    addendumNo: d.addendumSeq,
    addendaCount,
  }
}

export function serializeDocument(d: DocRow) {
  return {
    ...serializeDocumentSummary(d),
    notes: d.notes,
    series: d.series,
    template: d.templateVersion ? { id: d.templateVersion.template.id, name: d.templateVersion.template.name, version: d.templateVersion.version } : null,
    fieldValues: d.fieldValues,
    finalVersion: d.finalVersion,
    signedVersion: d.signedVersion,
    hasNumber: !!d.documentNumberId,
    /** The numbers this document took from voided ones (normally none or one). */
    numberReusedFrom: d.numberReusedFrom,
    addenda: d.addenda.map((a) => ({ ...a, docDate: dayOf(a.docDate), signedAt: iso(a.signedAt), numberReleased: !!a.numberReleasedAt, numberReleasedAt: undefined })),
    updatedBy: d.updatedBy,
    versions: d.versions.map((v) => ({
      version: v.version,
      kind: v.kind,
      fileName: v.fileName,
      /** "REV n" / "FINAL" / "SIGNED" — what the download is called (owner, 14 Oct 2026). */
      label: revisionLabel(d, v.version),
      /** The download's name without extension; the server sends it in Content-Disposition too. */
      downloadName: versionDownloadBase(d, v.version),
      mimeType: v.mimeType,
      size: v.size,
      hasDocx: !!v.docxKey,
      hasPdf: !!v.pdfKey,
      hasFile: !!v.fileKey,
      note: v.note,
      changes: v.changes,
      author: v.author,
      createdAt: iso(v.createdAt),
    })),
  }
}

/** A version's download name without its extension: "<number> - <title> REV 2" / "… FINAL" / "… SIGNED". */
export function versionDownloadBase(
  d: { number: string; title: string; status: string; currentVersion: number; finalVersion: number | null; signedVersion: number | null },
  version: number,
): string {
  return downloadBaseName(d.number, d.title, revisionLabel(d, version))
}

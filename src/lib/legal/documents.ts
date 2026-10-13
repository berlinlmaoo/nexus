import type { Prisma } from "@/generated/prisma/client"

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
} satisfies Prisma.LegalDocumentInclude

export const documentListInclude = {
  company: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, name: true } },
  deal: { select: { id: true, code: true, name: true, projectId: true } },
  createdBy: person,
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
    hasNumber: !!d.documentNumberId,
    updatedBy: d.updatedBy,
    versions: d.versions.map((v) => ({
      version: v.version,
      kind: v.kind,
      fileName: v.fileName,
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

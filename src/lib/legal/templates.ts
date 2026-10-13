import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { carryOverFields, type TemplateField } from "@/lib/legal/filters"
import { inspectTemplate } from "@/lib/legal/template"
import { isLegalDocType } from "@/lib/legal/rules"
import { LEGAL_MAX_TEMPLATE_BYTES, looksLikeZip, safeFileName, storeLegalFile } from "@/lib/legal/storage"

// Legal templates (owner, 14 Oct 2026): a .docx with {{PLACEHOLDERS}} uploaded from the app, fields detected
// automatically, versioned. A document records the version it was made from, so a new upload never
// changes what was already made.

export class LegalTemplateError extends Error {
  constructor(message: string, readonly status = 422, readonly problems: string[] = []) {
    super(message)
  }
}

const person = { select: { id: true, name: true, avatar: true } } as const

export const templateInclude = {
  company: { select: { id: true, code: true, name: true } },
  series: { select: { id: true, key: true, label: true, format: true } },
  createdBy: person,
  versions: { orderBy: { version: "desc" }, include: { createdBy: person } },
  _count: { select: { versions: true } },
} satisfies Prisma.LegalTemplateInclude

type TemplateRow = Prisma.LegalTemplateGetPayload<{ include: typeof templateInclude }>

export function serializeTemplate(t: TemplateRow) {
  const current = t.versions.find((v) => v.version === t.currentVersion) ?? t.versions[0]
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    docType: t.docType,
    company: t.company,
    series: t.series,
    currentVersion: t.currentVersion,
    archived: !!t.archivedAt,
    fields: (current?.fields ?? []) as unknown as TemplateField[],
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    versions: t.versions.map((v) => ({
      version: v.version,
      fileName: v.fileName,
      size: v.size,
      note: v.note,
      fieldCount: Array.isArray(v.fields) ? v.fields.length : 0,
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
    })),
  }
}

/** Read the uploaded file from a multipart body and check it is a fillable template. */
export async function readTemplateUpload(form: FormData): Promise<{ bytes: Buffer; fileName: string; fields: TemplateField[] }> {
  const file = form.get("file")
  if (!file || typeof file === "string") throw new LegalTemplateError("Choose a .docx file", 400)
  if (file.size > LEGAL_MAX_TEMPLATE_BYTES) throw new LegalTemplateError("The template is larger than 20 MB", 413)
  const bytes = Buffer.from(await file.arrayBuffer())
  const fileName = safeFileName(file.name || "template.docx", "template.docx")
  if (!looksLikeZip(bytes) || !/\.docx$/i.test(fileName)) throw new LegalTemplateError("Templates must be Word (.docx) files", 415)
  try {
    return { bytes, fileName, fields: inspectTemplate(bytes) }
  } catch (error) {
    const e = error as { message?: string; problems?: string[] }
    throw new LegalTemplateError(e.message ?? "The template has errors", 422, e.problems ?? [])
  }
}

/** Company and series must agree: a series belongs to one company, and the template's company (if set) is it. */
export async function checkCompanyAndSeries(companyId: string | null, seriesId: string | null) {
  if (companyId) {
    const co = await prisma.legalCompany.findUnique({ where: { id: companyId }, select: { id: true } })
    if (!co) throw new LegalTemplateError("Company not found", 404)
  }
  if (seriesId) {
    const s = await prisma.legalSeries.findUnique({ where: { id: seriesId }, select: { companyId: true } })
    if (!s) throw new LegalTemplateError("Numbering series not found", 404)
    if (companyId && s.companyId !== companyId) throw new LegalTemplateError("That numbering series belongs to another company")
    if (!companyId) throw new LegalTemplateError("Pick the company before its numbering series")
  }
}

export function readTemplateMeta(input: Record<string, unknown>) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 150) : undefined
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 1000) : undefined
  const docType = input.docType === undefined ? undefined : String(input.docType)
  if (docType !== undefined && !isLegalDocType(docType)) throw new LegalTemplateError("Unknown document type", 400)
  const idOrNull = (v: unknown) => (v === undefined ? undefined : typeof v === "string" && v ? v : null)
  return { name, description, docType, companyId: idOrNull(input.companyId), seriesId: idOrNull(input.seriesId) }
}

export async function createTemplate(actorId: string, form: FormData) {
  const meta = readTemplateMeta(Object.fromEntries(form.entries()))
  const upload = await readTemplateUpload(form)
  const name = meta.name || upload.fileName.replace(/\.docx$/i, "")
  if (!meta.docType) throw new LegalTemplateError("Pick the document type", 400)
  await checkCompanyAndSeries(meta.companyId ?? null, meta.seriesId ?? null)
  const storageKey = await storeLegalFile(upload.fileName, upload.bytes)
  return prisma.legalTemplate.create({
    data: {
      name,
      description: meta.description ?? "",
      docType: meta.docType,
      companyId: meta.companyId ?? null,
      seriesId: meta.seriesId ?? null,
      currentVersion: 1,
      createdById: actorId,
      versions: {
        create: {
          version: 1,
          storageKey,
          fileName: upload.fileName,
          size: upload.bytes.length,
          fields: upload.fields as unknown as Prisma.InputJsonValue,
          createdById: actorId,
        },
      },
    },
    include: templateInclude,
  })
}

/** Upload a new version. Field settings people made carry over by field name. */
export async function addTemplateVersion(actorId: string, templateId: string, form: FormData) {
  const template = await prisma.legalTemplate.findUnique({
    where: { id: templateId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  })
  if (!template) throw new LegalTemplateError("Template not found", 404)
  const upload = await readTemplateUpload(form)
  const previous = (template.versions[0]?.fields ?? []) as unknown as TemplateField[]
  const fields = carryOverFields(upload.fields, previous)
  const note = typeof form.get("note") === "string" ? String(form.get("note")).trim().slice(0, 500) : ""
  const storageKey = await storeLegalFile(upload.fileName, upload.bytes)
  const version = (template.versions[0]?.version ?? 0) + 1
  await prisma.$transaction([
    prisma.legalTemplateVersion.create({
      data: { templateId, version, storageKey, fileName: upload.fileName, size: upload.bytes.length, fields: fields as unknown as Prisma.InputJsonValue, note, createdById: actorId },
    }),
    prisma.legalTemplate.update({ where: { id: templateId }, data: { currentVersion: version } }),
  ])
  return prisma.legalTemplate.findUniqueOrThrow({ where: { id: templateId }, include: templateInclude })
}

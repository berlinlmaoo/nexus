import { after } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import type { LegalActor } from "@/lib/legal/access"
import {
  DOC_DATE_FIELD, humanizeFieldName, validateFormValues, type FieldErrors, type FormValues, type TemplateField,
} from "@/lib/legal/filters"
import { assertWellFormed, fillTemplate, TemplateFileError } from "@/lib/legal/template"
import { applyKop, KopError } from "@/lib/legal/kop"
import { allocateAddendumNumber, allocateLegalNumber, LegalNumberError, peekAddendum, peekLegalNumber, type IssuedLegalNumber } from "@/lib/legal/numbering"
import { ADDENDUM_DOC_TYPE, downloadBaseName, formatFieldNames, NumberFormatError, ordinalWord, renderNumber } from "@/lib/legal/rules"
import { addendumPrefill, parentAutoValues, type AddendumParent } from "@/lib/legal/addenda"
import { deleteLegalFile, DOCX_MIME, readLegalFile, storeLegalFile } from "@/lib/legal/storage"
import { docxToPdf, pdfConfigured } from "@/lib/legal/pdf"
import { dateFromDay } from "@/lib/legal/documents"
import { linkProblem } from "@/lib/legal/links"

// Make a document from a template (owner, 14 Oct 2026). Order is deliberate:
//   1. check EVERYTHING — the form, the number's own fields, and a dry run of the fill — before a number
//      exists, so a request that fails never spends one;
//   2. in ONE transaction: take the number (advisory-locked), fill the template with it, add the kop, store
//      the DOCX, write the document and its version 1. Any failure rolls the number back with it: no gaps;
//   3. after the response, the PDF (Gotenberg). LibreOffice can take long on a cold start; waiting for it
//      made a timed-out request look failed, and a retry then took a second number. A PDF failure leaves a
//      good DOCX, and the PDF can be made again from the document screen.

export class LegalGenerateError extends Error {
  constructor(message: string, readonly status = 422, readonly fieldErrors: FieldErrors = {}, readonly problems: string[] = []) {
    super(message)
  }
}

type GenerateInput = {
  templateId: string
  companyId?: string | null
  values: unknown
  title?: string
  counterparty?: string
  projectId?: string | null
  dealId?: string | null
  /** An addendum: the signed document it amends. */
  parentDocumentId?: string | null
}

const parentSelect = {
  id: true, number: true, title: true, docType: true, docDate: true, status: true, counterparty: true, companyId: true,
  fieldValues: true, projectId: true, dealId: true, deletedAt: true,
} as const

/** The signed document an addendum amends. */
async function resolveParent(parentDocumentId: string): Promise<AddendumParent> {
  const parent = await prisma.legalDocument.findUnique({ where: { id: parentDocumentId }, select: parentSelect })
  if (!parent || parent.deletedAt) throw new LegalGenerateError("The document this addendum amends was not found", 404)
  if (parent.status !== "SIGNED") throw new LegalGenerateError("An addendum is made from a signed document. Upload its signed copy first.", 409)
  if (!parent.number) throw new LegalGenerateError("The document this addendum amends has no number", 409)
  return parent
}

/** The template, its company and the series its number comes from (an addendum: its parent instead). */
async function resolve(templateId: string, companyId: string | null | undefined, parentDocumentId?: string | null) {
  const template = await prisma.legalTemplate.findUnique({
    where: { id: templateId },
    include: { versions: true, series: true },
  })
  if (!template || template.archivedAt) throw new LegalGenerateError("Template not found", 404)
  const version = template.versions.find((v) => v.version === template.currentVersion)
  if (!version) throw new LegalGenerateError("Template has no file", 409)
  if (template.docType === ADDENDUM_DOC_TYPE || parentDocumentId) {
    if (template.docType !== ADDENDUM_DOC_TYPE) throw new LegalGenerateError("Only an addendum template makes an addendum", 400)
    if (!parentDocumentId) throw new LegalGenerateError("An addendum is made from its signed document: open it and choose Create addendum.", 400)
    const parent = await resolveParent(parentDocumentId)
    // The parent's company (and so its kop), whatever the template or the request says.
    const company = await prisma.legalCompany.findUnique({ where: { id: parent.companyId } })
    if (!company) throw new LegalGenerateError("Company not found", 404)
    return { template, version, company, series: null, parent }
  }
  const coId = template.companyId ?? companyId
  if (!coId) throw new LegalGenerateError("Pick the issuing company", 400)
  if (template.companyId && companyId && companyId !== template.companyId) {
    throw new LegalGenerateError("This template belongs to another company", 400)
  }
  const company = await prisma.legalCompany.findUnique({ where: { id: coId } })
  if (!company || !company.active) throw new LegalGenerateError("Company not found", 404)
  const series =
    template.series && template.series.companyId === company.id && template.series.active
      ? template.series
      : await prisma.legalSeries.findFirst({
          where: { companyId: company.id, docType: template.docType, active: true },
          orderBy: [{ position: "asc" }, { label: "asc" }],
        })
  if (!series) throw new LegalGenerateError(`${company.name} has no numbering series for ${template.docType}. Add one in Settings.`, 409)
  return { template, version, company, series, parent: null }
}

/** The form: the template's fields, plus any field the number format needs that the template doesn't ask. */
export function formFields(templateFields: TemplateField[], seriesFormat: string): TemplateField[] {
  const have = new Set(templateFields.map((f) => f.name.toUpperCase()))
  const extra = formatFieldNames(seriesFormat)
    .filter((n) => !have.has(n))
    .map((name): TemplateField => ({ name, label: humanizeFieldName(name), type: "text", required: true, help: "Used in the document number" }))
  return [...templateFields, ...extra]
}

function autoValues(company: { code: string; name: string; legalName: string; address: string }, number: string): FormValues {
  return {
    NOMOR: number,
    NAMA_PERUSAHAAN: company.name,
    PT_PERUSAHAAN: company.legalName || company.name,
    ALAMAT_PERUSAHAAN: company.address,
    KODE_PERUSAHAAN: company.code,
  }
}

/** What the New document form needs: its fields, the series, and the number it would get now. For an
 *  addendum also its parent and `prefill` (the parties, from the parent; the person may change them). */
export async function prepareDocument(input: { templateId: string; companyId?: string | null; values?: unknown; parentDocumentId?: string | null }) {
  const { template, version, company, series, parent } = await resolve(input.templateId, input.companyId, input.parentDocumentId)
  const fields = formFields(version.fields as unknown as TemplateField[], series?.format ?? "")
  const { values } = validateFormValues(fields, input.values ?? {})
  const day = typeof values[DOC_DATE_FIELD] === "string" ? (values[DOC_DATE_FIELD] as string) : null
  const peekAdd = parent ? await peekAddendum(parent) : null
  const numberPreview = series ? await peekLegalNumber(series, company.code, values, day ? dateFromDay(day) : new Date()) : peekAdd!.number
  return {
    template: { id: template.id, name: template.name, docType: template.docType, version: version.version },
    company: { id: company.id, code: company.code, name: company.name, hasKop: !!company.kopStorageKey },
    series: series ? { id: series.id, key: series.key, label: series.label, format: series.format, resetPeriod: series.resetPeriod } : null,
    fields,
    numberPreview,
    parent: parent ? { id: parent.id, number: parent.number, title: parent.title, docType: parent.docType, addendumNo: peekAdd!.seq } : null,
    prefill: parent ? addendumPrefill(parent, fields) : {},
  }
}

export async function generateLegalDocument(actor: LegalActor, input: GenerateInput) {
  const { template, version, company, series, parent } = await resolve(input.templateId, input.companyId, input.parentDocumentId)
  const fields = formFields(version.fields as unknown as TemplateField[], series?.format ?? "")

  // 1. Checks.
  const { values, errors } = validateFormValues(fields, input.values)
  if (Object.keys(errors).length) throw new LegalGenerateError("Some fields need attention", 422, errors)
  const day = values[DOC_DATE_FIELD] as string
  const docDate = dateFromDay(day)
  try {
    if (series) renderNumber({ format: series.format, seq: 1, year: 2000, month: 1, companyCode: company.code, fields: values })
  } catch (error) {
    if (error instanceof NumberFormatError) {
      throw new LegalGenerateError("The document number needs more fields", 422, Object.fromEntries(error.missing.map((m) => [m, "Required"])))
    }
    throw error
  }
  const counterparty = ((input.counterparty ?? "").trim() || parent?.counterparty || "").slice(0, 200)
  const peek = parent ? await peekAddendum(parent) : null
  const title = (
    (input.title ?? "").trim() ||
    (parent ? `${template.name} ${ordinalWord(peek!.seq)} — ${parent.title}` : `${template.name}${counterparty ? ` — ${counterparty}` : ""}`)
  ).slice(0, 200)
  // An addendum stays with its parent's project / deal unless told otherwise (and only one this person can open).
  let projectId = input.projectId || null
  let dealId = input.dealId || null
  if (parent && !projectId && !dealId && (parent.projectId || parent.dealId) && !(await linkProblem(actor, parent.projectId, parent.dealId))) {
    projectId = parent.projectId
    dealId = parent.dealId
  }
  const badLink = await linkProblem(actor, projectId, dealId)
  if (badLink) throw new LegalGenerateError(badLink, 404)
  const templateBytes = await readLegalFile(version.storageKey)
  const kopBytes = company.kopStorageKey ? await readLegalFile(company.kopStorageKey) : null
  try {
    const dry = fillTemplate(templateBytes, fields, { ...values, ...autoValues(company, "000/DRY-RUN"), ...(parent ? parentAutoValues(parent, peek!.seq) : {}) })
    assertWellFormed(kopBytes ? applyKop(dry, kopBytes) : dry)
  } catch (error) {
    if (error instanceof TemplateFileError) throw new LegalGenerateError(error.message, 422, {}, error.problems)
    if (error instanceof KopError) throw new LegalGenerateError(`The company's kop can't be used: ${error.message}`, 422)
    throw error
  }

  // 2. Number + file + rows, all or nothing.
  let storedKey: string | null = null
  let created: { id: string; number: string; docx: Buffer; fileName: string }
  try {
    created = await prisma.$transaction(
      async (tx) => {
        const issued: IssuedLegalNumber = series
          ? await allocateLegalNumber(tx, { series, companyCode: company.code, fields: values, at: docDate, issuedById: actor.userId, subject: title })
          : await allocateAddendumNumber(tx, { parent: parent!, issuedById: actor.userId, subject: title })
        let docx = fillTemplate(templateBytes, fields, { ...values, ...autoValues(company, issued.number), ...(parent ? parentAutoValues(parent, issued.seq) : {}) })
        if (kopBytes) docx = applyKop(docx, kopBytes)
        const fileName = `${downloadBaseName(issued.number, title, "REV 1")}.docx`
        storedKey = await storeLegalFile(fileName, docx)
        const doc = await tx.legalDocument.create({
          data: {
            companyId: company.id,
            seriesId: series?.id ?? null,
            parentDocumentId: parent?.id ?? null,
            addendumSeq: parent ? issued.seq : null,
            documentNumberId: issued.id,
            number: issued.number,
            docType: template.docType,
            title,
            counterparty,
            docDate,
            status: "DRAFT",
            source: "GENERATED",
            templateVersionId: version.id,
            fieldValues: values as Prisma.InputJsonValue,
            projectId,
            dealId,
            currentVersion: 1,
            createdById: actor.userId,
            updatedById: actor.userId,
            versions: {
              create: { version: 1, kind: "GENERATED", docxKey: storedKey, fileName, mimeType: DOCX_MIME, size: docx.length, authorId: actor.userId },
            },
          },
          select: { id: true },
        })
        // A number a voided document gave back: show on the voided one who took it.
        if (issued.reusedFromDocumentId) {
          await tx.legalDocument.updateMany({ where: { id: issued.reusedFromDocumentId }, data: { numberReusedById: doc.id } })
        }
        return { id: doc.id, number: issued.number, docx, fileName }
      },
      { timeout: 30_000, maxWait: 15_000 },
    )
  } catch (error) {
    await deleteLegalFile(storedKey)
    if (error instanceof LegalNumberError) throw new LegalGenerateError(error.message, 409)
    if (error instanceof NumberFormatError) throw new LegalGenerateError("The document number needs more fields", 422)
    if (error instanceof TemplateFileError) throw new LegalGenerateError(error.message, 422, {}, error.problems)
    throw error
  }

  // 3. PDF, after the response.
  return { id: created.id, number: created.number, pdfError: pdfLater(created.id, 1, created.docx, created.fileName) }
}

/**
 * Make a version's PDF once the response is on its way (outside a request — tests, scripts — right away).
 * Answers what the client is told now: null = it is being made, else why there will be none.
 */
export function pdfLater(documentId: string, version: number, docx?: Buffer, fileName?: string): string | null {
  if (!pdfConfigured()) return "PDF conversion is not set up on this server"
  const run = async () => {
    const error = await makePdfForVersion(documentId, version, docx, fileName)
    if (error) console.warn(`Legal PDF for ${documentId} v${version} not made: ${error}`)
  }
  try {
    after(run)
  } catch {
    void run()
  }
  return null
}

/** Make (or remake) the PDF of one version from its DOCX. Returns the error text, or null. */
export async function makePdfForVersion(documentId: string, version: number, docx?: Buffer, fileName?: string): Promise<string | null> {
  if (!pdfConfigured()) return "PDF conversion is not set up on this server"
  const row = await prisma.legalDocumentVersion.findUnique({ where: { documentId_version: { documentId, version } } })
  if (!row?.docxKey) return "This version has no DOCX"
  try {
    const pdf = await docxToPdf(docx ?? (await readLegalFile(row.docxKey)))
    const key = await storeLegalFile((fileName ?? row.fileName).replace(/\.docx$/i, ".pdf"), pdf)
    const old = row.pdfKey
    await prisma.legalDocumentVersion.update({ where: { id: row.id }, data: { pdfKey: key } })
    await deleteLegalFile(old)
    return null
  } catch (error) {
    console.error("Legal PDF conversion failed:", error)
    return (error as Error).message
  }
}

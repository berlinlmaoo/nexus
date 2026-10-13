import { after } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import type { LegalActor } from "@/lib/legal/access"
import {
  DOC_DATE_FIELD, humanizeFieldName, validateFormValues, type FieldErrors, type FormValues, type TemplateField,
} from "@/lib/legal/filters"
import { assertWellFormed, fillTemplate, TemplateFileError } from "@/lib/legal/template"
import { applyKop, KopError } from "@/lib/legal/kop"
import { allocateLegalNumber, LegalNumberError, peekLegalNumber } from "@/lib/legal/numbering"
import { formatFieldNames, NumberFormatError, renderNumber } from "@/lib/legal/rules"
import { deleteLegalFile, DOCX_MIME, readLegalFile, safeFileName, storeLegalFile } from "@/lib/legal/storage"
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
}

/** The template, its company and the series its number comes from. */
async function resolve(templateId: string, companyId: string | null | undefined) {
  const template = await prisma.legalTemplate.findUnique({
    where: { id: templateId },
    include: { versions: true, series: true },
  })
  if (!template || template.archivedAt) throw new LegalGenerateError("Template not found", 404)
  const version = template.versions.find((v) => v.version === template.currentVersion)
  if (!version) throw new LegalGenerateError("Template has no file", 409)
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
  return { template, version, company, series }
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

/** What the New document form needs: its fields, the series, and the number it would get now. */
export async function prepareDocument(input: { templateId: string; companyId?: string | null; values?: unknown }) {
  const { template, version, company, series } = await resolve(input.templateId, input.companyId)
  const fields = formFields(version.fields as unknown as TemplateField[], series.format)
  const { values } = validateFormValues(fields, input.values ?? {})
  const day = typeof values[DOC_DATE_FIELD] === "string" ? (values[DOC_DATE_FIELD] as string) : null
  const numberPreview = await peekLegalNumber(series, company.code, values, day ? dateFromDay(day) : new Date())
  return {
    template: { id: template.id, name: template.name, docType: template.docType, version: version.version },
    company: { id: company.id, code: company.code, name: company.name, hasKop: !!company.kopStorageKey },
    series: { id: series.id, key: series.key, label: series.label, format: series.format, resetPeriod: series.resetPeriod },
    fields,
    numberPreview,
  }
}

export async function generateLegalDocument(actor: LegalActor, input: GenerateInput) {
  const { template, version, company, series } = await resolve(input.templateId, input.companyId)
  const fields = formFields(version.fields as unknown as TemplateField[], series.format)

  // 1. Checks.
  const { values, errors } = validateFormValues(fields, input.values)
  if (Object.keys(errors).length) throw new LegalGenerateError("Some fields need attention", 422, errors)
  const day = values[DOC_DATE_FIELD] as string
  const docDate = dateFromDay(day)
  try {
    renderNumber({ format: series.format, seq: 1, year: 2000, month: 1, companyCode: company.code, fields: values })
  } catch (error) {
    if (error instanceof NumberFormatError) {
      throw new LegalGenerateError("The document number needs more fields", 422, Object.fromEntries(error.missing.map((m) => [m, "Required"])))
    }
    throw error
  }
  const counterparty = (input.counterparty ?? "").trim().slice(0, 200)
  const title = ((input.title ?? "").trim() || `${template.name}${counterparty ? ` — ${counterparty}` : ""}`).slice(0, 200)
  const projectId = input.projectId || null
  const dealId = input.dealId || null
  const badLink = await linkProblem(actor, projectId, dealId)
  if (badLink) throw new LegalGenerateError(badLink, 404)
  const templateBytes = await readLegalFile(version.storageKey)
  const kopBytes = company.kopStorageKey ? await readLegalFile(company.kopStorageKey) : null
  try {
    const dry = fillTemplate(templateBytes, fields, { ...values, ...autoValues(company, "000/DRY-RUN") })
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
        const issued = await allocateLegalNumber(tx, {
          series,
          companyCode: company.code,
          fields: values,
          at: docDate,
          issuedById: actor.userId,
          subject: title,
        })
        let docx = fillTemplate(templateBytes, fields, { ...values, ...autoValues(company, issued.number) })
        if (kopBytes) docx = applyKop(docx, kopBytes)
        const fileName = safeFileName(`${issued.number.replace(/\//g, "-")} ${title}`.slice(0, 140)) + ".docx"
        storedKey = await storeLegalFile(fileName, docx)
        const doc = await tx.legalDocument.create({
          data: {
            companyId: company.id,
            seriesId: series.id,
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

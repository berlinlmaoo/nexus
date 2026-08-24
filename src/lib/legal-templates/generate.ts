// Generate a Legal document (invoice / PKS) from a request task.
//
// Order of operations is deliberate:
//   1. validate EVERYTHING first — a number spent on a request that then fails validation is a
//      permanent hole in the monthly sequence;
//   2. allocate the number (short transaction, advisory-locked);
//   3. fill the Google Docs copy, verify by reading it back, export PDF + DOCX;
//   4. attach both files to the task and write the number into its "Nomor Dokumen" field.
//
// If step 3 fails the number is released again (it's the newest seq for that month, so releasing it
// keeps the sequence gap-free) and nothing is attached.
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import prisma from "@/lib/prisma"
import { allocateDocumentNumber, DOCUMENT_SERIES, type DocumentSeriesKey } from "@/lib/document-numbers"
import { fillDocTemplate, docsConfigured } from "@/lib/legal-templates/google-docs"
import {
  LEGAL_FIELDS, readLegalFields, missingLegalFields, seriesForDocTypeLabel, legalFieldByKey,
} from "@/lib/legal-templates/fields"
import {
  TEMPLATES, isSeriesReady, seriesNotReadyReason, verifyValues, STALE_TEMPLATE_VALUES, dueDateFrom, idDate,
} from "@/lib/legal-templates/registry"

export class LegalGenerateError extends Error {
  constructor(message: string, readonly status = 422) { super(message) }
}

export type GenerateResult = {
  number: string
  series: DocumentSeriesKey
  seriesLabel: string
  documentId: string
  webViewLink: string
  attachments: { id: string; filename: string; url: string }[]
}

export async function generateLegalDocument(opts: { taskId: string; actorId: string }): Promise<GenerateResult> {
  if (!docsConfigured()) {
    throw new LegalGenerateError("Google Docs belum dikonfigurasi di server ini.", 503)
  }

  const task = await prisma.task.findUnique({
    where: { id: opts.taskId },
    select: {
      id: true, title: true,
      // Task has no projectId of its own — it belongs to a TaskList, which belongs to the project.
      taskList: { select: { projectId: true } },
      customFieldValues: { select: { value: true, customField: { select: { id: true, name: true, type: true } } } },
    },
  })
  if (!task) throw new LegalGenerateError("Task-nya nggak ketemu.", 404)

  const vals = readLegalFields(task.customFieldValues)

  // 1. Which document? The "Jenis Dokumen" answer decides the series AND the template.
  if (!vals.docType) {
    throw new LegalGenerateError(`Field "${legalFieldByKey("docType").name}" belum diisi.`)
  }
  const series = seriesForDocTypeLabel(vals.docType)
  if (!series) throw new LegalGenerateError(`Jenis dokumen "${vals.docType}" nggak dikenali.`)
  if (!isSeriesReady(series)) throw new LegalGenerateError(seriesNotReadyReason(series))

  const def = TEMPLATES[series]
  const missing = missingLegalFields(def.kind, vals, series)
  if (missing.length) {
    throw new LegalGenerateError(`Masih ada yang kosong: ${missing.join(", ")}.`)
  }

  // 2. Number — but only for series that print one. A real MOU Event carries no document number, so
  //    asking the register for one would invent a number their books don't have.
  const dateSource = vals.invoiceDate ?? vals.mouSignDate
  const docDateAt = dateSource ? new Date(dateSource) : new Date()
  if (Number.isNaN(docDateAt.getTime())) throw new LegalGenerateError("Tanggal dokumennya nggak valid.")

  const issued = DOCUMENT_SERIES[series].numbered
    ? await prisma.$transaction((tx) => allocateDocumentNumber(tx, {
        series,
        issuedById: opts.actorId,
        clientCode: vals.clientCode,
        subject: task.title,
        taskId: task.id,
        at: docDateAt,
      }))
    : null

  try {
    // 3. Fill + verify + export.
    const ctx = {
      number: issued?.number ?? "",
      docDate: idDate(docDateAt),
      // An explicit due date wins; otherwise it's invoice date + the payment term in days.
      dueDate: vals.dueDate
        ? idDate(new Date(vals.dueDate))
        : idDate(dueDateFrom(docDateAt, vals.paymentTermDays ?? vals.paymentTerm)),
    }
    const generated = await fillDocTemplate({
      masterId: def.masterId,
      name: def.fileName(vals, ctx.number),
      replacements: def.tokens(vals, ctx),
      mustAppear: verifyValues(series, vals, ctx.number),
      mustNotAppear: STALE_TEMPLATE_VALUES,
    })

    // 4. Attach both formats to the task, and record the number on it.
    const attachments = await attachToTask({
      taskId: task.id,
      uploaderId: opts.actorId,
      baseName: def.fileName(vals, ctx.number),
      files: [
        { ext: "pdf", mimeType: "application/pdf", data: generated.pdf },
        { ext: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: generated.docx },
      ],
    })
    if (issued) await writeNumberField(task.id, task.taskList.projectId, issued.number)

    return {
      number: ctx.number,
      series,
      seriesLabel: DOCUMENT_SERIES[series].label,
      documentId: generated.documentId,
      webViewLink: generated.webViewLink,
      attachments,
    }
  } catch (err) {
    // Release the number so the month's sequence stays gap-free. Best-effort: if another document was
    // issued in between, the hole is unavoidable and the register still tells the true story.
    if (issued) await prisma.documentNumber.delete({ where: { id: issued.id } }).catch(() => {})
    throw err
  }
}

async function attachToTask(opts: {
  taskId: string
  uploaderId: string
  baseName: string
  files: { ext: string; mimeType: string; data: Buffer }[]
}) {
  // Same directory (and container mount) the form-submission uploader already uses.
  const dir = path.join(process.cwd(), "public", "uploads", "attachments")
  await mkdir(dir, { recursive: true })

  const out: { id: string; filename: string; url: string }[] = []
  for (const f of opts.files) {
    const safe = `legal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${f.ext}`
    await writeFile(path.join(dir, safe), f.data)
    const row = await prisma.attachment.create({
      data: {
        filename: `${opts.baseName}.${f.ext}`,
        url: `/api/files/attachments/${safe}`,
        mimeType: f.mimeType,
        size: f.data.length,
        kind: "GENERAL",
        taskId: opts.taskId,
        uploaderId: opts.uploaderId,
      },
      select: { id: true, filename: true, url: true },
    })
    out.push(row)
  }
  return out
}

/** Write the issued number into the task's "Nomor Dokumen" custom field, if the project has one. */
async function writeNumberField(taskId: string, projectId: string, number: string) {
  const name = legalFieldByKey("documentNumber").name
  const field = await prisma.customField.findFirst({
    where: { projectId, name, type: "TEXT" },
    select: { id: true },
  })
  if (!field) return
  await prisma.customFieldValue.upsert({
    where: { customFieldId_taskId: { customFieldId: field.id, taskId } },
    create: { customFieldId: field.id, taskId, value: number },
    update: { value: number },
  })
}

/** Field names the UI can show as "belum lengkap" before anyone clicks generate. */
export function requiredFieldNames(kind: "INVOICE" | "CONTRACT") {
  return LEGAL_FIELDS.filter((f) => f.required && f.docs.includes(kind)).map((f) => f.name)
}

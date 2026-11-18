import { after } from "next/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { legalActor } from "@/lib/legal/access"
import { bodyAccess, loadBody } from "@/lib/block-bodies"
import { docxToPdf, htmlToPdf, pdfConfigured, PdfError } from "@/lib/legal/pdf"
import { readLegalFile, PDF_MIME, looksLikePdf } from "@/lib/legal/storage"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { createLogger } from "@/lib/logger"
import { canPrint, type PrintAccessDeps, type PrintKind, type PrintVerdict } from "@/lib/print/access"
import { PRINT_LIMITS, printerConfig, type PrinterConfig } from "@/lib/print/config"
import { docToPrintHtml } from "@/lib/print/doc-html"
import { countPdfPages } from "@/lib/print/pdf-pages"
import {
  JOB_STATE, attrOf, attrValues, encodeGetJobAttributes, encodePrintJob, ippPost, ippStatusText, isIppSuccess, type ColorMode,
} from "@/lib/print/ipp"

/**
 * Print to the office printer (owner, 18 Nov 2026). One request = render the PDF (a Legal document's file, or a Doc
 * page through Gotenberg's Chromium), check the caps, write the PrintJob row, send it over IPP, and keep an eye on
 * the CUPS job until it is done or failed. Every job that got as far as rendering is logged (PrintJob + an AuditLog
 * row "print"), failures included.
 */

const log = createLogger("print")

export type PrintJobRow = {
  id: string; userId: string; workspaceId: string; kind: string; refId: string; title: string; pages: number; copies: number
  colorMode: string; status: string; ippJobId: number | null; error: string | null; createdAt: Date; finishedAt: Date | null
}

export function serializeJob(j: PrintJobRow, user?: { id: string; name: string; avatar: string | null } | null) {
  return {
    id: j.id, kind: j.kind, refId: j.refId, title: j.title, pages: j.pages, copies: j.copies, colorMode: j.colorMode,
    status: j.status, ippJobId: j.ippJobId, error: j.error, createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null, userId: j.userId, ...(user !== undefined ? { user } : {}),
  }
}

/** The real access rules (lib/print/access.ts says which). */
export const printAccessDeps: PrintAccessDeps = {
  hasLegal: async (userId) => (await legalActor(userId)) !== null,
  legalDocExists: async (id) => (await prisma.legalDocument.count({ where: { id, deletedAt: null } })) > 0,
  docAccess: async (userId, id) => {
    const a = await bodyAccess(userId, "doc", id)
    return { exists: a.exists, read: a.read }
  },
}

export function printAccess(userId: string, kind: PrintKind, refId: string): Promise<PrintVerdict> {
  return canPrint(userId, kind, refId, printAccessDeps)
}

export class PrintError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message)
  }
}

type Rendered = { pdf: Buffer; title: string; workspaceId: string }

/** A Legal document's file: the version asked for, else the primary one (signed copy, else Final, else current —
 *  what the document screen shows). Its PDF; a version with only a DOCX is converted now (not stored); an uploaded
 *  original prints when it is a PDF. */
async function renderLegal(documentId: string, version: number | null): Promise<Rendered> {
  const doc = await prisma.legalDocument.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { number: true, title: true, currentVersion: true, finalVersion: true, signedVersion: true },
  })
  if (!doc) throw new PrintError("Document not found", 404, "NOT_FOUND")
  const v = version ?? doc.signedVersion ?? doc.finalVersion ?? doc.currentVersion
  const row = await prisma.legalDocumentVersion.findUnique({ where: { documentId_version: { documentId, version: v } } })
  if (!row) throw new PrintError("No such version", 404, "NOT_FOUND")
  const title = [doc.number, doc.title].filter(Boolean).join(" - ")
  let pdf: Buffer | null = null
  if (row.pdfKey) pdf = await readLegalFile(row.pdfKey)
  else if (row.docxKey) {
    if (!pdfConfigured()) throw new PrintError("PDF conversion is not set up on this server", 503, "PDF_NOT_CONFIGURED")
    pdf = await docxToPdf(await readLegalFile(row.docxKey))
  } else if (row.fileKey && row.mimeType === PDF_MIME) pdf = await readLegalFile(row.fileKey)
  if (!pdf || !looksLikePdf(pdf)) throw new PrintError("This version has no file that can be printed (only PDF or Word files print)", 422, "NOT_PRINTABLE")
  return { pdf, title, workspaceId: ORG_WORKSPACE_ID }
}

function stamp(lang: "en" | "id"): string {
  return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date())
}

/** A Doc page: its block document (the stored body, as the editor loads it) through doc-html → Gotenberg Chromium. */
async function renderDoc(docId: string, userName: string, lang: "en" | "id"): Promise<Rendered> {
  const body = await loadBody("doc", docId)
  if (!body) throw new PrintError("Not found", 404, "NOT_FOUND")
  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { name: true, workspaceId: true } })
  if (!pdfConfigured()) throw new PrintError("PDF conversion is not set up on this server", 503, "PDF_NOT_CONFIGURED")
  const title = body.title.trim() || (lang === "id" ? "Tanpa judul" : "Untitled")
  const meta = [project?.name, `${lang === "id" ? "Dicetak oleh" : "Printed by"} ${userName}`, `${stamp(lang)} WIB`].filter(Boolean).join(" · ")
  const pdf = await htmlToPdf(docToPrintHtml({ title, content: body.json, meta, lang }))
  return { pdf, title, workspaceId: project?.workspaceId ?? ORG_WORKSPACE_ID }
}

export type PrintRequest = {
  user: { id: string; name: string }
  kind: PrintKind
  refId: string
  copies: number
  colorMode: ColorMode
  /** Legal only: a version other than the primary one. */
  version?: number | null
  lang: "en" | "id"
  request?: Request
}

/** Render, check, log, send. Throws PrintError for a refusal (nothing logged); a failure after rendering is a
 *  logged job with status failed. */
export async function submitPrint(req: PrintRequest): Promise<PrintJobRow> {
  const printer = printerConfig()
  if (!printer) throw new PrintError("Printer belum diatur di server ini", 503, "PRINT_NOT_CONFIGURED")

  let rendered: Rendered | null = null
  let renderError: string | null = null
  try {
    rendered = req.kind === "legal" ? await renderLegal(req.refId, req.version ?? null) : await renderDoc(req.refId, req.user.name, req.lang)
  } catch (error) {
    if (error instanceof PrintError) throw error
    renderError = error instanceof PdfError ? error.message : `Could not prepare the file: ${(error as Error).message}`
    log.error("Print render failed", { kind: req.kind, refId: req.refId, error: String(error) })
  }

  let pages = 0
  if (rendered) {
    const n = countPdfPages(rendered.pdf)
    if (n === null) throw new PrintError("Couldn't read the number of pages of this file", 422, "PAGES_UNKNOWN")
    if (n > PRINT_LIMITS.maxPages) {
      throw new PrintError(`This file has ${n} pages. One print can have at most ${PRINT_LIMITS.maxPages} pages.`, 422, "TOO_MANY_PAGES")
    }
    pages = n
  }

  // The hourly cap and the row in one transaction under a per-person lock: two taps at once can't both slip under it.
  const title = rendered?.title ?? (await fallbackTitle(req.kind, req.refId))
  const job = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print|${req.user.id}`})::int8)`
    const recent = await tx.printJob.count({ where: { userId: req.user.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })
    if (recent >= PRINT_LIMITS.jobsPerHour) return null
    return tx.printJob.create({
      data: {
        userId: req.user.id, workspaceId: rendered?.workspaceId ?? ORG_WORKSPACE_ID, kind: req.kind, refId: req.refId, title: title.slice(0, 300),
        pages, copies: req.copies, colorMode: req.colorMode, status: renderError ? "failed" : "queued",
        error: renderError, finishedAt: renderError ? new Date() : null,
      },
    })
  })
  if (!job) throw new PrintError(`You can print at most ${PRINT_LIMITS.jobsPerHour} times an hour. Try again later.`, 429, "PRINT_RATE_LIMIT")

  await logAudit({
    action: "print",
    entityType: req.kind === "legal" ? "legal_document" : "doc",
    entityId: req.refId,
    entityName: job.title,
    userId: req.user.id,
    metadata: { printJobId: job.id, pages, copies: req.copies, colorMode: req.colorMode, printer: printer.name, ...(renderError ? { error: renderError } : {}) },
    request: req.request,
  })
  if (!rendered) return job
  return send(job, rendered.pdf, printer, req.user.name)
}

async function fallbackTitle(kind: PrintKind, refId: string): Promise<string> {
  if (kind === "legal") {
    const d = await prisma.legalDocument.findUnique({ where: { id: refId }, select: { number: true, title: true } })
    return [d?.number, d?.title].filter(Boolean).join(" - ") || "Legal document"
  }
  return (await prisma.doc.findUnique({ where: { id: refId }, select: { title: true } }))?.title || "Untitled"
}

async function finish(id: string, data: { status: "printing" | "done" | "failed"; ippJobId?: number; error?: string | null }): Promise<PrintJobRow> {
  const terminal = data.status === "done" || data.status === "failed"
  // Only a job that is still open moves; a finished one keeps its ending (two pollers at once).
  await prisma.printJob.updateMany({
    where: { id, status: { in: ["queued", "printing"] } },
    data: { ...data, ...(terminal ? { finishedAt: new Date() } : {}) },
  })
  return (await prisma.printJob.findUnique({ where: { id } }))!
}

async function send(job: PrintJobRow, pdf: Buffer, printer: PrinterConfig, userName: string): Promise<PrintJobRow> {
  try {
    const res = await ippPost(printer.http, encodePrintJob({
      printerUri: printer.printerUri, userName, jobName: `NEXUS - ${job.title}`, copies: job.copies,
      colorMode: job.colorMode === "color" ? "color" : "mono", pdf,
    }), 120_000)
    if (!isIppSuccess(res.code)) {
      const why = String(attrOf(res, "status-message") ?? "") || ippStatusText(res.code)
      return finish(job.id, { status: "failed", error: `The printer refused the job: ${why}` })
    }
    const ippJobId = Number(attrOf(res, "job-id"))
    if (!Number.isFinite(ippJobId) || ippJobId <= 0) return finish(job.id, { status: "failed", error: "The printer did not return a job number" })
    const updated = await finish(job.id, { status: "printing", ippJobId })
    watchLater(updated.id)
    return updated
  } catch (error) {
    log.error("Print send failed", { jobId: job.id, error: String(error) })
    return finish(job.id, { status: "failed", error: (error as Error).message })
  }
}

/** Ask CUPS once how a printing job is doing; moves it to done / failed when CUPS says so. */
export async function refreshJob(job: PrintJobRow): Promise<PrintJobRow> {
  if (job.status !== "printing" || !job.ippJobId) return job
  const printer = printerConfig()
  if (!printer) return job
  try {
    const res = await ippPost(printer.http, encodeGetJobAttributes({ printerUri: printer.printerUri, userName: "nexus", jobId: job.ippJobId }), 10_000)
    if (res.code === 0x0406) {
      // CUPS forgets finished jobs after a while (PreserveJobHistory); a job it no longer knows was done long ago.
      return Date.now() - job.createdAt.getTime() > 10 * 60_000 ? finish(job.id, { status: "done" }) : job
    }
    if (!isIppSuccess(res.code)) return job
    const state = Number(attrOf(res, "job-state"))
    if (state === JOB_STATE.COMPLETED) return finish(job.id, { status: "done", error: null })
    if (state === JOB_STATE.CANCELED || state === JOB_STATE.ABORTED) {
      const reasons = attrValues(res, "job-state-reasons").map(String).filter((r) => r && r !== "none")
      const msg = String(attrOf(res, "job-state-message") ?? attrOf(res, "job-printer-state-message") ?? "")
      return finish(job.id, { status: "failed", error: [state === JOB_STATE.CANCELED ? "Canceled at the printer" : "The printer stopped the job", msg || reasons.join(", ")].filter(Boolean).join(": ") })
    }
    return job
  } catch (error) {
    log.warn("Print status check failed", { jobId: job.id, error: String(error) })
    return job
  }
}

/** After the response: look at the job every 3 s for 3 minutes. A job still printing after that is looked at again
 *  whenever someone opens it or the log (refreshJob). */
function watchLater(id: string) {
  const run = async () => {
    const until = Date.now() + 180_000
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 3000))
      const row = await prisma.printJob.findUnique({ where: { id } })
      if (!row || row.status !== "printing") return
      const next = await refreshJob(row)
      if (next.status !== "printing") return
    }
  }
  try {
    after(run)
  } catch {
    void run()
  }
}

import { randomBytes } from "crypto"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { ORG_WORKSPACE_ID, orgRoleOf } from "@/lib/org"
import { emitWorkspaceChanged } from "@/lib/socket-emitter"
import { notifyLegalRequestNew, notifyLegalRequestStage } from "@/lib/notification-service"
import { LEGAL_ROOT_EMAILS } from "@/lib/legal/access"
import { DOC_DATE_FIELD, validateFormValues, type FieldErrors, type TemplateField } from "@/lib/legal/filters"
import { ADDENDUM_DOC_TYPE } from "@/lib/legal/rules"
import { dateFromDay, dayOf } from "@/lib/legal/documents"
import { linkProblem, redactLinks, type LinkViewer } from "@/lib/legal/links"
import { deleteLegalFile } from "@/lib/legal/storage"
import { storeUpload, type StoredUpload } from "@/lib/legal/uploads"
import {
  autoColumn, cleanParentNumber, linkPath, shouldPushStage, requestStage, requesterFileVersion, type LinkedDoc, type RequestStage,
} from "@/lib/legal/request-rules"

// Legal requests (owner, 14 Oct 2026). Anyone who has a request link (/f/legal-<token>) and signs in can ask
// Legal for a document; the request shows in their My Submissions, and Legal works it on the board.
//
//   - The requester never sees a Legal document other than what their own request produced: the form lists
//     templates (types and field labels) and companies, nothing from the archive. An addendum request carries
//     the parent's number as typed text, and nothing ever looks it up — the answer is the same whatever the
//     number, so numbers can't be probed.
//   - Legal links the real parent, makes the document from the request (generate prefilled), and the card
//     follows the document: a document made → In Progress, SIGNED → Done (syncRequestForDocument).
//   - Rules without the database: request-rules.ts.

export class LegalRequestError extends Error {
  constructor(message: string, readonly status = 422, readonly code?: string, readonly fieldErrors: FieldErrors = {}) {
    super(message)
  }
}

const person = { select: { id: true, name: true, avatar: true } } as const

// ── Links ───────────────────────────────────────────────────────────────────────────────────────────

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

/** 24 random base62 characters (~143 bits), unbiased. */
export function newLinkToken(): string {
  let out = ""
  while (out.length < 24) {
    for (const b of randomBytes(32)) {
      if (b < 248 && out.length < 24) out += ALPHABET[b % 62]
    }
  }
  return out
}

export type RequestLinkRow = Prisma.LegalRequestLinkGetPayload<{ include: { company: { select: { id: true; code: true; name: true; active: true } } } }>

export function serializeLink(l: RequestLinkRow) {
  return {
    scope: l.scope,
    company: l.company ? { id: l.company.id, code: l.company.code, name: l.company.name } : null,
    path: linkPath(l.token),
    accepting: l.accepting,
    rotatedAt: l.rotatedAt?.toISOString() ?? null,
    updatedAt: l.updatedAt.toISOString(),
  }
}

/** The general link and one per active company, made on first use. */
export async function ensureRequestLinks(actorId: string): Promise<RequestLinkRow[]> {
  const companies = await prisma.legalCompany.findMany({ where: { active: true }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true } })
  const scopes = ["general", ...companies.map((c) => c.id)]
  const have = await prisma.legalRequestLink.findMany({ where: { scope: { in: scopes } }, select: { scope: true } })
  const missing = scopes.filter((s) => !have.some((h) => h.scope === s))
  for (const scope of missing) {
    await prisma.legalRequestLink
      .create({ data: { scope, token: newLinkToken(), companyId: scope === "general" ? null : scope, createdById: actorId } })
      .catch(() => null) // two people opening the panel at once: the other one made it
  }
  const rows = await prisma.legalRequestLink.findMany({
    where: { scope: { in: scopes } },
    include: { company: { select: { id: true, code: true, name: true, active: true } } },
  })
  return scopes.map((s) => rows.find((r) => r.scope === s)).filter((r): r is RequestLinkRow => !!r)
}

/** The link a URL names, by its token (unknown or regenerated: null). */
export async function linkByUrlId(token: string) {
  return prisma.legalRequestLink.findUnique({
    where: { token },
    include: { company: { select: { id: true, code: true, name: true, active: true } } },
  })
}

// ── The form ────────────────────────────────────────────────────────────────────────────────────────

/** A template's fields as the requester fills them: all optional (Legal completes them), and without the
 *  document date (Legal sets it when the document is made). */
export function requesterFields(fields: TemplateField[]): TemplateField[] {
  return fields
    .filter((f) => f.name !== DOC_DATE_FIELD)
    .map((f) => ({ ...f, required: false, ...(f.columns ? { columns: f.columns.map((c) => ({ ...c, required: false })) } : {}) }))
}

async function activeTemplates() {
  const rows = await prisma.legalTemplate.findMany({
    where: { archivedAt: null },
    orderBy: [{ docType: "asc" }, { name: "asc" }],
    include: { versions: { select: { version: true, fields: true } } },
  })
  return rows.map((t) => {
    const v = t.versions.find((x) => x.version === t.currentVersion)
    return { row: t, version: t.currentVersion, fields: requesterFields((v?.fields as unknown as TemplateField[]) ?? []) }
  })
}

/** What the signed-in requester's form needs: the companies (or the locked one) and the document types. */
export async function requestForm(link: NonNullable<Awaited<ReturnType<typeof linkByUrlId>>>) {
  const [companies, templates] = await Promise.all([
    prisma.legalCompany.findMany({ where: { active: true }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true } }),
    activeTemplates(),
  ])
  return {
    companies: link.companyId ? companies.filter((c) => c.id === link.companyId) : companies,
    templates: templates
      .filter((t) => !link.companyId || !t.row.companyId || t.row.companyId === link.companyId)
      .map((t) => ({
        id: t.row.id,
        name: t.row.name,
        description: t.row.description,
        docType: t.row.docType,
        companyId: t.row.companyId,
        isAddendum: t.row.docType === ADDENDUM_DOC_TYPE,
        fields: t.fields,
      })),
  }
}

export type RequestInput = {
  templateId?: unknown
  companyId?: unknown
  values?: unknown
  purpose?: unknown
  deadline?: unknown
  projectId?: unknown
  dealId?: unknown
  parentNumber?: unknown
}

export const MAX_REQUEST_FILES = 5

/** The requester's own visibility for "related project / deal": the same rule as everywhere else. */
export async function requesterViewer(userId: string): Promise<LinkViewer> {
  return { userId, orgRole: await orgRoleOf(userId) }
}

/**
 * Send a request. Checks everything before storing a file; an addendum's parent number is stored as typed and
 * never looked up (the answer is the same whatever it is). Returns the request id (an Idempotency-Key repeat
 * returns the first one).
 */
export async function createLegalRequest(
  requester: { id: string; name: string },
  link: NonNullable<Awaited<ReturnType<typeof linkByUrlId>>>,
  input: RequestInput,
  files: File[],
  idempotencyKey: string | null,
): Promise<{ id: string; duplicate: boolean }> {
  if (!link.accepting || (link.company && !link.company.active)) throw new LegalRequestError("This link isn't accepting requests right now", 403, "LEGAL_LINK_CLOSED")
  if (idempotencyKey) {
    const seen = await prisma.legalRequest.findUnique({ where: { requesterId_idempotencyKey: { requesterId: requester.id, idempotencyKey } }, select: { id: true } })
    if (seen) return { id: seen.id, duplicate: true }
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const companyId = link.companyId ?? str(input.companyId)
  if (link.companyId && str(input.companyId) && str(input.companyId) !== link.companyId) throw new LegalRequestError("This link is for another company", 400)
  if (!companyId) throw new LegalRequestError("Pick the company", 400, undefined, { companyId: "Required" })
  const company = await prisma.legalCompany.findFirst({ where: { id: companyId, active: true }, select: { id: true, name: true } })
  if (!company) throw new LegalRequestError("Company not found", 404)

  const templateId = str(input.templateId)
  if (!templateId) throw new LegalRequestError("Pick the document type", 400, undefined, { templateId: "Required" })
  const template = await prisma.legalTemplate.findFirst({
    where: { id: templateId, archivedAt: null },
    include: { versions: { select: { version: true, fields: true } } },
  })
  if (!template) throw new LegalRequestError("Document type not found", 404)
  if (template.companyId && template.companyId !== company.id) throw new LegalRequestError("This document type is for another company", 400)
  const version = template.versions.find((v) => v.version === template.currentVersion)
  const fields = requesterFields((version?.fields as unknown as TemplateField[]) ?? [])
  const { values, errors } = validateFormValues(fields, input.values)
  if (Object.keys(errors).length) throw new LegalRequestError("Some fields need attention", 422, undefined, errors)

  const isAddendum = template.docType === ADDENDUM_DOC_TYPE
  const parentNumberText = isAddendum ? cleanParentNumber(input.parentNumber) : ""
  if (isAddendum && !parentNumberText) {
    throw new LegalRequestError("Type the number of the document to amend", 422, undefined, { parentNumber: "Required" })
  }
  const purpose = str(input.purpose).slice(0, 5000)
  const deadlineDay = str(input.deadline)
  if (deadlineDay && !/^\d{4}-\d{2}-\d{2}$/.test(deadlineDay)) throw new LegalRequestError("Not a valid date", 422, undefined, { deadline: "Not a valid date" })
  const projectId = str(input.projectId) || null
  const dealId = str(input.dealId) || null
  const viewer = await requesterViewer(requester.id)
  const badLink = await linkProblem(viewer, projectId, dealId)
  if (badLink) throw new LegalRequestError(badLink, 404)

  if (files.length > MAX_REQUEST_FILES) throw new LegalRequestError(`At most ${MAX_REQUEST_FILES} files`, 413)
  // The Legal upload rules: a PDF, a Word file or a photo, checked on the bytes, 50 MB each.
  const stored: StoredUpload[] = []
  try {
    for (const f of files) stored.push(await storeUpload(f))
  } catch (error) {
    await Promise.all(stored.flatMap((s) => [deleteLegalFile(s.docxKey), deleteLegalFile(s.pdfKey), deleteLegalFile(s.fileKey)]))
    throw error
  }
  const attachments = stored.map((s) => ({
    id: randomBytes(9).toString("base64url"),
    storageKey: s.docxKey ?? s.pdfKey ?? s.fileKey,
    fileName: s.fileName,
    mimeType: s.mimeType,
    size: s.size,
  }))

  let row: { id: string }
  try {
    row = await prisma.legalRequest.create({
      data: {
        requesterId: requester.id,
        linkId: link.id,
        companyId: company.id,
        templateId: template.id,
        templateVersion: template.currentVersion,
        templateName: template.name,
        docType: template.docType,
        isAddendum,
        parentNumberText,
        fieldValues: values as Prisma.InputJsonValue,
        purpose,
        deadline: deadlineDay ? dateFromDay(deadlineDay) : null,
        attachments: attachments as Prisma.InputJsonValue,
        projectId,
        dealId,
        idempotencyKey,
      },
      select: { id: true },
    })
  } catch (error) {
    await Promise.all(stored.flatMap((s) => [deleteLegalFile(s.docxKey), deleteLegalFile(s.pdfKey), deleteLegalFile(s.fileKey)]))
    // The same attempt raced itself (double tap): answer with the first one.
    if (idempotencyKey && (error as { code?: string })?.code === "P2002") {
      const seen = await prisma.legalRequest.findUnique({ where: { requesterId_idempotencyKey: { requesterId: requester.id, idempotencyKey } }, select: { id: true } })
      if (seen) return { id: seen.id, duplicate: true }
    }
    throw error
  }

  const members = await legalMemberUserIds()
  await notifyLegalRequestNew({
    requestId: row.id, memberIds: members, requesterId: requester.id, requesterName: requester.name,
    subject: template.name, companyName: company.name,
  }).catch(() => null)
  pingRequestChange(members, requester.id, requester.id)
  return { id: row.id, duplicate: false }
}

// ── Who is told ─────────────────────────────────────────────────────────────────────────────────────

/** Everyone with Legal today: the root(s) and the active invited members who are still in the company. */
export async function legalMemberUserIds(): Promise<string[]> {
  const [roots, rows] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: LEGAL_ROOT_EMAILS, mode: "insensitive" }, deactivatedAt: null }, select: { id: true } }),
    prisma.legalMember.findMany({
      where: { revokedAt: null, user: { deactivatedAt: null, workspaceMembers: { some: { workspaceId: ORG_WORKSPACE_ID } } } },
      select: { userId: true },
    }),
  ])
  return [...new Set([...roots.map((r) => r.id), ...rows.map((r) => r.userId)])]
}

/** Live: the Legal board of every member (kind "legal") and the requester's My Submissions. Ids only. */
export function pingRequestChange(memberIds: string[], requesterId: string | null, actorId?: string) {
  try {
    emitWorkspaceChanged(null, { kind: "legal", ...(actorId ? { actorId } : {}) }, memberIds)
    if (requesterId) emitWorkspaceChanged(null, { kind: "submissions", ...(actorId ? { actorId } : {}) }, [requesterId])
  } catch {
    /* best effort */
  }
}

/** Move the stage on and tell the requester when it reached one they are told about. */
export async function applyStage(
  r: { id: string; requesterId: string | null; stage: string; templateName: string },
  stage: RequestStage,
  actorId: string | null,
  reason?: string | null,
) {
  if (r.stage === stage) return
  await prisma.legalRequest.update({ where: { id: r.id }, data: { stage } })
  if (r.requesterId && shouldPushStage(r.stage, stage)) {
    await notifyLegalRequestStage({
      requesterId: r.requesterId, requestId: r.id, subject: r.templateName || "Legal",
      stage: stage as "IN_PROGRESS" | "REVISION" | "FINAL" | "SIGNED" | "REJECTED", reason, actorId,
    }).catch(() => null)
  }
}

const docForStage = { select: { status: true, currentVersion: true, finalVersion: true, signedVersion: true, deletedAt: true } } as const

/**
 * The document a request produced changed (made, new version, status, signed copy): its card moves on by
 * itself (SIGNED → Done; a To Do card → In Progress), the requester's stage follows, and both sides refresh.
 * Best effort: never fails the write that caused it.
 */
export async function syncRequestForDocument(documentId: string, actorId: string | null) {
  try {
    const r = await prisma.legalRequest.findUnique({ where: { documentId }, include: { document: docForStage } })
    if (!r) return
    const doc: LinkedDoc = r.document && !r.document.deletedAt ? r.document : null
    const column = r.rejectedAt ? r.column : autoColumn(r.column, doc)
    if (column !== r.column) {
      await prisma.legalRequest.update({ where: { id: r.id }, data: { column, doneAt: column === "DONE" ? new Date() : null } })
    }
    await applyStage(r, requestStage({ column, rejectedAt: r.rejectedAt }, doc), actorId)
    pingRequestChange(await legalMemberUserIds(), r.requesterId, actorId ?? undefined)
  } catch (error) {
    console.error("Legal request sync failed:", error)
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────────

export const requestInclude = {
  requester: { select: { id: true, name: true, avatar: true, email: true } },
  pic: person,
  company: { select: { id: true, code: true, name: true } },
  document: { select: { id: true, number: true, title: true, status: true, docType: true, currentVersion: true, finalVersion: true, signedVersion: true, signedAt: true, deletedAt: true } },
} satisfies Prisma.LegalRequestInclude

type RequestRow = Prisma.LegalRequestGetPayload<{ include: typeof requestInclude }>

export type RequestAttachment = { id: string; storageKey: string | null; fileName: string; mimeType: string; size: number }
export const attachmentsOf = (r: { attachments: unknown }): RequestAttachment[] =>
  Array.isArray(r.attachments) ? (r.attachments as RequestAttachment[]).filter((a) => a && typeof a.id === "string") : []

async function linkNames(rows: { projectId: string | null; dealId: string | null }[]) {
  const pIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))]
  const dIds = [...new Set(rows.map((r) => r.dealId).filter((x): x is string => !!x))]
  const [projects, deals] = await Promise.all([
    pIds.length ? prisma.project.findMany({ where: { id: { in: pIds } }, select: { id: true, name: true } }) : [],
    dIds.length ? prisma.pipelineDeal.findMany({ where: { id: { in: dIds } }, select: { id: true, code: true, name: true, projectId: true } }) : [],
  ])
  return { projects: new Map(projects.map((p) => [p.id, p])), deals: new Map(deals.map((d) => [d.id, d])) }
}

/** The template's fields of the version the request was made on, for labels. */
async function fieldsFor(rows: { templateId: string | null; templateVersion: number | null }[]) {
  const keys = rows.filter((r) => r.templateId && r.templateVersion).map((r) => ({ templateId: r.templateId!, version: r.templateVersion! }))
  if (!keys.length) return new Map<string, TemplateField[]>()
  const vs = await prisma.legalTemplateVersion.findMany({ where: { OR: keys }, select: { templateId: true, version: true, fields: true } })
  return new Map(vs.map((v) => [`${v.templateId}:${v.version}`, requesterFields(v.fields as unknown as TemplateField[])]))
}

const docSummary = (d: RequestRow["document"]) =>
  d && !d.deletedAt ? { id: d.id, number: d.number, title: d.title, status: d.status, docType: d.docType, signedAt: d.signedAt?.toISOString() ?? null } : null

/** One request as Legal sees it (board card + detail). Project / deal names follow the viewer's own access. */
export async function serializeForLegal(viewer: LinkViewer, rows: RequestRow[], opts: { detail?: boolean } = {}) {
  const names = await linkNames(rows)
  const fieldMap = opts.detail ? await fieldsFor(rows) : new Map<string, TemplateField[]>()
  const parentIds = opts.detail ? [...new Set(rows.map((r) => r.parentDocumentId).filter((x): x is string => !!x))] : []
  const parents = parentIds.length
    ? new Map((await prisma.legalDocument.findMany({ where: { id: { in: parentIds } }, select: { id: true, number: true, title: true, status: true, docType: true, companyId: true } })).map((p) => [p.id, p]))
    : new Map()
  const base = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    requester: r.requester ? { id: r.requester.id, name: r.requester.name, avatar: r.requester.avatar } : null,
    company: r.company,
    templateId: r.templateId,
    templateName: r.templateName,
    docType: r.docType,
    isAddendum: r.isAddendum,
    parentNumberText: r.parentNumberText,
    parent: r.parentDocumentId ? parents.get(r.parentDocumentId) ?? (opts.detail ? null : { id: r.parentDocumentId }) : null,
    deadline: dayOf(r.deadline),
    column: r.column,
    stage: r.stage,
    rejected: !!r.rejectedAt,
    rejectedAt: r.rejectedAt?.toISOString() ?? null,
    rejectReason: r.rejectReason,
    pic: r.pic,
    document: docSummary(r.document),
    doneAt: r.doneAt?.toISOString() ?? null,
    purpose: r.purpose,
    attachments: attachmentsOf(r).map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, size: a.size })),
    project: r.projectId ? names.projects.get(r.projectId) ?? null : null,
    deal: r.dealId ? names.deals.get(r.dealId) ?? null : null,
    ...(opts.detail
      ? {
          fieldValues: r.fieldValues,
          fields: (r.templateId && r.templateVersion ? fieldMap.get(`${r.templateId}:${r.templateVersion}`) : null) ?? [],
        }
      : {}),
  }))
  return redactLinks(viewer, base)
}

/** The requester's own request: never another document than the one it produced, and no Legal names. */
export async function serializeForRequester(userId: string, rows: RequestRow[], opts: { detail?: boolean } = {}) {
  const names = await linkNames(rows)
  const fieldMap = opts.detail ? await fieldsFor(rows) : new Map<string, TemplateField[]>()
  const base = rows.map((r) => {
    const doc = r.document && !r.document.deletedAt && r.document.status !== "VOID" ? r.document : null
    const fileVersion = requesterFileVersion(doc)
    const fields = opts.detail && r.templateId && r.templateVersion ? fieldMap.get(`${r.templateId}:${r.templateVersion}`) ?? [] : []
    const values = (r.fieldValues && typeof r.fieldValues === "object" ? r.fieldValues : {}) as Record<string, unknown>
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      company: { id: r.company.id, name: r.company.name },
      templateName: r.templateName,
      docType: r.docType,
      isAddendum: r.isAddendum,
      parentNumberText: r.parentNumberText,
      deadline: dayOf(r.deadline),
      stage: r.stage,
      rejectReason: r.rejectedAt ? r.rejectReason : null,
      /** Who at Legal handles it (a name only). */
      pic: r.pic ? { id: r.pic.id, name: r.pic.name, avatar: r.pic.avatar } : null,
      /** The document this request produced (only that one), once it exists and isn't void. */
      document: doc ? { number: doc.number, title: doc.title, status: doc.status } : null,
      /** The final / signed file is ready to download (GET …/file). */
      canDownload: fileVersion != null,
      purpose: r.purpose,
      attachments: attachmentsOf(r).map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, size: a.size })),
      project: r.projectId ? names.projects.get(r.projectId) ?? null : null,
      deal: r.dealId ? names.deals.get(r.dealId) ?? null : null,
      ...(opts.detail
        ? {
            answers: fields
              .filter((f) => values[f.name] !== undefined && values[f.name] !== "" && !(Array.isArray(values[f.name]) && (values[f.name] as unknown[]).length === 0))
              .map((f) => ({ name: f.name, label: f.label, type: f.type, value: values[f.name], columns: f.columns?.map((c) => ({ name: c.name, label: c.label, type: c.type })) })),
          }
        : {}),
    }
  })
  return redactLinks({ userId, orgRole: await orgRoleOf(userId) }, base)
}

/** The requester's own request row, or null (someone else's answers exactly like a missing one). */
export async function ownRequest(userId: string, id: string) {
  return prisma.legalRequest.findFirst({ where: { id, requesterId: userId }, include: requestInclude })
}

/** The version of the requester's own document they may download (FINAL / SIGNED), with the document. */
export async function requesterDownload(userId: string, id: string) {
  const r = await prisma.legalRequest.findFirst({
    where: { id, requesterId: userId },
    select: { document: { select: { id: true, number: true, title: true, status: true, currentVersion: true, finalVersion: true, signedVersion: true, deletedAt: true } } },
  })
  const doc = r?.document && !r.document.deletedAt && r.document.status !== "VOID" ? r.document : null
  const version = requesterFileVersion(doc)
  if (!doc || version == null) return null
  const v = await prisma.legalDocumentVersion.findUnique({ where: { documentId_version: { documentId: doc.id, version } } })
  return v ? { doc, v } : null
}

// ── The board (Legal) ───────────────────────────────────────────────────────────────────────────────

/** GET /api/legal/requests filters: column, docType, companyId, picId ("none" = unassigned), deadline
 *  (overdue | week | none), q (requester, type, purpose, typed parent number). */
export function boardWhere(sp: URLSearchParams): Prisma.LegalRequestWhereInput {
  const and: Prisma.LegalRequestWhereInput[] = []
  const list = (k: string) => (sp.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  if (list("column").length) and.push({ column: { in: list("column") } })
  if (list("docType").length) and.push({ docType: { in: list("docType") } })
  if (sp.get("companyId")) and.push({ companyId: sp.get("companyId")! })
  const pic = sp.get("picId")
  if (pic === "none") and.push({ picId: null })
  else if (pic) and.push({ picId: pic })
  const today = dateFromDay(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()))
  const startOfToday = new Date(today.getTime() - 12 * 3600e3)
  switch (sp.get("deadline")) {
    case "overdue": and.push({ deadline: { lt: startOfToday }, column: { not: "DONE" } }); break
    case "week": and.push({ deadline: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 8 * 864e5) } }); break
    case "none": and.push({ deadline: null }); break
  }
  const q = sp.get("q")?.trim().slice(0, 100)
  if (q) {
    and.push({
      OR: [
        { templateName: { contains: q, mode: "insensitive" } },
        { purpose: { contains: q, mode: "insensitive" } },
        { parentNumberText: { contains: q, mode: "insensitive" } },
        { requester: { name: { contains: q, mode: "insensitive" } } },
      ],
    })
  }
  return and.length ? { AND: and } : {}
}

/** What "Create document" starts from: the request's values, its template and company, and (for an
 *  addendum) the parent Legal picked. Project / deal only when this Legal member may link them. */
export async function generatePrefill(viewer: LinkViewer, r: RequestRow) {
  const link = await linkProblem(viewer, r.projectId, r.dealId)
  return {
    requestId: r.id,
    templateId: r.templateId,
    companyId: r.companyId,
    isAddendum: r.isAddendum,
    parentDocumentId: r.parentDocumentId,
    values: r.fieldValues,
    projectId: link ? null : r.projectId,
    dealId: link ? null : r.dealId,
  }
}

/** Stored attachment of a request, by its id. */
export function requestAttachment(r: { attachments: unknown }, attachmentId: string): RequestAttachment | null {
  return attachmentsOf(r).find((a) => a.id === attachmentId && !!a.storageKey) ?? null
}

// ── Create document from a request ──────────────────────────────────────────────────────────────────

/** Before generating from a request: it exists, isn't declined, has no live document yet, and an addendum
 *  request names its signed parent. Asked twice: up front (no dry run, no number for a request that can't
 *  be served), and again INSIDE the generate transaction under lockLegalRequest (race audit 16 Oct 2026,
 *  H5) — that second answer is the one that counts. */
export async function requestGenerateProblem(
  requestId: string,
  parentDocumentId: string | null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ status: number; error: string; code: string } | null> {
  const r = await client.legalRequest.findUnique({ where: { id: requestId }, include: { document: { select: { status: true, deletedAt: true } } } })
  if (!r) return { status: 404, error: "Request not found", code: "LEGAL_REQUEST_NOT_FOUND" }
  if (r.rejectedAt) return { status: 409, error: "This request was declined. Move it back to To Do or In Progress to work on it.", code: "LEGAL_REQUEST_DECLINED" }
  if (r.document && !r.document.deletedAt && r.document.status !== "VOID") {
    return { status: 409, error: "This request already has a document", code: "LEGAL_REQUEST_HAS_DOCUMENT" }
  }
  if (r.isAddendum && !parentDocumentId) return { status: 400, error: "Pick the signed document this addendum amends first", code: "LEGAL_ADDENDUM_PARENT_REQUIRED" }
  return null
}

/**
 * One "Create document" per request at a time (race audit 16 Oct 2026, H5). Two Legal members pressing it
 * together (or one double tap) both passed the up-front check, both took a number and both wrote a
 * document; the second link then overwrote the first, leaving an orphan document on a burned number. The
 * generate transaction takes this lock BEFORE the number's own lock, re-checks requestGenerateProblem
 * through `tx` and links the request in the same transaction: the second one waits, then sees the first
 * document and rolls back before it takes a number.
 */
export async function lockLegalRequest(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legalreq|${requestId}`})::int8)`
}

/** Inside the generate transaction (under lockLegalRequest): the request points at its new document, an
 *  addendum's parent is recorded, and whoever made it becomes the PIC when nobody was assigned. The card
 *  moves on afterwards (syncRequestForDocument, after the commit). */
export async function linkRequestToDocumentTx(
  tx: Prisma.TransactionClient,
  requestId: string,
  documentId: string,
  parentDocumentId: string | null,
  actorId: string,
): Promise<void> {
  const r = await tx.legalRequest.findUnique({ where: { id: requestId }, select: { picId: true } })
  await tx.legalRequest.update({
    where: { id: requestId },
    data: { documentId, ...(parentDocumentId ? { parentDocumentId } : {}), ...(r && !r.picId ? { picId: actorId } : {}) },
  })
}

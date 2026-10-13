import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { dateFromDay, documentListInclude, serializeDocumentSummary } from "@/lib/legal/documents"
import { isLegalDocType, isLegalStatus } from "@/lib/legal/rules"

// The Legal archive (owner, 14 Oct 2026): every legal document, generated here or uploaded, searchable by
// number, company, counterparty, type, title, date, status and its project / Pipeline deal.
//
// GET /api/legal/documents parameters (all optional, combined with AND):
//   q           number, title or counterparty contains (case-insensitive)
//   companyId   one company            docType   SPK | PKS | …, comma-separated
//   status      DRAFT | FINAL | SENT | SIGNED | VOID, comma-separated
//   source      GENERATED | UPLOADED   projectId / dealId   linked to
//   from / to   document date, YYYY-MM-DD, inclusive
//   sort        date (default, newest first) | created | number
//   page        1-based                limit     default 50, max 200

const list = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

export function archiveWhere(sp: URLSearchParams): Prisma.LegalDocumentWhereInput {
  const and: Prisma.LegalDocumentWhereInput[] = [{ deletedAt: null }]
  const q = sp.get("q")?.trim().slice(0, 200)
  if (q) {
    and.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { counterparty: { contains: q, mode: "insensitive" } },
      ],
    })
  }
  if (sp.get("companyId")) and.push({ companyId: sp.get("companyId")! })
  const types = list(sp.get("docType")).filter(isLegalDocType)
  if (types.length) and.push({ docType: { in: types } })
  const statuses = list(sp.get("status")).filter(isLegalStatus)
  if (statuses.length) and.push({ status: { in: statuses } })
  const source = sp.get("source")
  if (source === "GENERATED" || source === "UPLOADED") and.push({ source })
  if (sp.get("projectId")) and.push({ projectId: sp.get("projectId")! })
  if (sp.get("dealId")) and.push({ dealId: sp.get("dealId")! })
  const from = day(sp.get("from"))
  const to = day(sp.get("to"))
  if (from) and.push({ docDate: { gte: new Date(`${from}T00:00:00+07:00`) } })
  if (to) and.push({ docDate: { lte: new Date(dateFromDay(to).getTime() + 12 * 3600e3 - 1) } })
  return { AND: and }
}

export async function listDocuments(sp: URLSearchParams) {
  const where = archiveWhere(sp)
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200)
  const page = Math.max(Number(sp.get("page")) || 1, 1)
  const sort = sp.get("sort")
  const orderBy: Prisma.LegalDocumentOrderByWithRelationInput[] =
    sort === "created" ? [{ createdAt: "desc" }] : sort === "number" ? [{ number: "asc" }] : [{ docDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
  const [rows, total] = await Promise.all([
    prisma.legalDocument.findMany({ where, include: documentListInclude, orderBy, take: limit, skip: (page - 1) * limit }),
    prisma.legalDocument.count({ where }),
  ])
  return { documents: rows.map(serializeDocumentSummary), total, page, pageSize: limit }
}

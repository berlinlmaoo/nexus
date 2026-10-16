import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"

// Issuing companies and their numbering series (owner, 14 Oct 2026: Intoo, PATS, Suwara Lokal, The Z Networks,
// each with its own kop and number formats; "The Z Networks" is the TZN display name, owner 16 Oct 2026). Seeded by
// prisma/sql/2026-10-14-legal.sql; edited in Settings.

export const companyInclude = {
  series: { orderBy: [{ position: "asc" }, { label: "asc" }] },
  _count: { select: { documents: true } },
} satisfies Prisma.LegalCompanyInclude

type CompanyRow = Prisma.LegalCompanyGetPayload<{ include: typeof companyInclude }>

export function serializeCompany(c: CompanyRow) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    legalName: c.legalName,
    address: c.address,
    hasKop: !!c.kopStorageKey,
    kopFileName: c.kopFileName,
    kopUpdatedAt: c.kopUpdatedAt?.toISOString() ?? null,
    active: c.active,
    documentCount: c._count.documents,
    series: c.series.map((s) => ({
      id: s.id,
      key: s.key,
      docType: s.docType,
      label: s.label,
      format: s.format,
      resetPeriod: s.resetPeriod,
      active: s.active,
    })),
  }
}

export async function listCompanies() {
  const rows = await prisma.legalCompany.findMany({ include: companyInclude, orderBy: [{ position: "asc" }, { name: "asc" }] })
  return rows.map(serializeCompany)
}

import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { legalActor } from "@/lib/legal/access"
import { LegalGenerateError, prepareDocument } from "@/lib/legal/generate"
import { validateFormValues, type TemplateField } from "@/lib/legal/filters"
import { clip, str } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * A Legal document from a template, up to DRAFT (owner, 18 Oct 2026). GIDEON fills the template's form fields from
 * the chat; the card shows the template, company, the number it will get (a preview: the number is only issued when
 * the person taps Create draft) and every field. Apply is the Legal page's own POST /api/legal/documents through the
 * person's session — Legal access (invitation only), the form validation, the advisory-locked numbering with no gaps,
 * the kop, the stored DOCX and version 1 — and the document is created as DRAFT. Nothing here finalizes, sends or
 * signs: those stay on the Legal page.
 */

const NO_ACCESS = "This person has no access to Legal (it is by invitation only). Tell them so; do not prepare anything."

async function findTemplate(input: Input) {
  const id = str(input.templateId)
  if (id) {
    const t = await prisma.legalTemplate.findFirst({ where: { id, archivedAt: null }, select: { id: true, name: true, docType: true, companyId: true } })
    if (!t) throw new Error("No active Legal template has that id.")
    return t
  }
  const q = str(input.template) ?? str(input.templateName) ?? str(input.docType)
  if (!q) throw new Error("Say which template (name or document type, e.g. NDA, PKS, SPK). Templates: " + (await templateList()))
  const rows = await prisma.legalTemplate.findMany({
    where: { archivedAt: null, OR: [{ name: { contains: q, mode: "insensitive" } }, { docType: { equals: q.toUpperCase() } }] },
    select: { id: true, name: true, docType: true, companyId: true },
    take: 8,
  })
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase())
  const pick = exact.length === 1 ? exact : rows
  if (pick.length === 1) return pick[0]
  if (!pick.length) throw new Error(`No Legal template is named like "${q}". Templates: ${await templateList()}`)
  throw new Error(`Several templates match "${q}": ${pick.map((r) => `${r.name} (${r.docType})`).join("; ")}. Ask which one.`)
}

async function templateList(): Promise<string> {
  const rows = await prisma.legalTemplate.findMany({ where: { archivedAt: null }, select: { name: true, docType: true }, orderBy: { name: "asc" }, take: 30 })
  return rows.map((r) => `${r.name} (${r.docType})`).join("; ")
}

async function findCompany(input: Input, fixed: string | null) {
  if (fixed) return fixed
  const id = str(input.companyId)
  if (id) return id
  const q = str(input.company)
  const companies = await prisma.legalCompany.findMany({ where: { active: true }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } })
  if (q) {
    const hit = companies.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.code.toLowerCase() === q.toLowerCase())
    if (hit.length === 1) return hit[0].id
    if (!hit.length) throw new Error(`No issuing company is named like "${q}". Companies: ${companies.map((c) => c.name).join("; ")}`)
    throw new Error(`Several companies match "${q}": ${hit.map((c) => c.name).join("; ")}. Ask which one.`)
  }
  if (companies.length === 1) return companies[0].id
  throw new Error(`Which company issues it? ${companies.map((c) => c.name).join("; ")}`)
}

/** A field's value as the card shows it (lists as row counts, long text clipped). */
function show(f: TemplateField, v: unknown): string {
  if (v == null || v === "") return "—"
  if (f.type === "list" && Array.isArray(v)) return `${v.length} row${v.length === 1 ? "" : "s"}`
  if (typeof v === "number") return v.toLocaleString("id-ID")
  return clip(String(v), 200) ?? "—"
}

async function describeLegalDraft(actor: User, input: Input) {
  if (!(await legalActor(actor.id))) throw new Error(NO_ACCESS)
  const template = await findTemplate(input)
  const companyId = await findCompany(input, template.companyId)
  const raw = input.values && typeof input.values === "object" && !Array.isArray(input.values) ? (input.values as Record<string, unknown>) : {}
  let prep
  try {
    prep = await prepareDocument({ templateId: template.id, companyId, values: raw })
  } catch (e) {
    if (e instanceof LegalGenerateError) throw new Error(e.message)
    throw e
  }
  if (prep.template.docType === "ADD") throw new Error("An addendum is made from its signed document on the Legal page (Create addendum), not from chat.")
  const { values, errors } = validateFormValues(prep.fields, raw)
  if (Object.keys(errors).length) {
    const label = (name: string) => prep.fields.find((f) => f.name === name.split(".")[0])?.label ?? name
    const missing = Object.entries(errors).slice(0, 12).map(([k, m]) => `${label(k)} (${k}): ${m}`).join("; ")
    const form = prep.fields.map((f) => `${f.name}${f.required ? "*" : ""} = ${f.label} [${f.type}${f.options?.length ? `: ${f.options.join("/")}` : ""}]`).join("; ")
    throw new Error(`Some fields need values before a draft can be prepared — ask the person for them, never invent them. Problems: ${missing}. The form (* = required; pass them in values by NAME; dates YYYY-MM-DD; amounts as numbers): ${form}`)
  }
  const title = str(input.title)
  const counterparty = str(input.counterparty)
  const diff: { field: string; to: string }[] = [
    { field: "Template", to: `${prep.template.name} (${prep.template.docType})` },
    { field: "Company", to: prep.company.name },
    { field: "Number", to: `${prep.numberPreview} (issued when you create the draft)` },
    ...(title ? [{ field: "Title", to: title }] : []),
    ...(counterparty ? [{ field: "Counterparty", to: counterparty }] : []),
    { field: "Status", to: "Draft" },
  ]
  for (const f of prep.fields) {
    if (values[f.name] === undefined || values[f.name] === "") continue
    diff.push({ field: f.label || f.name, to: show(f, values[f.name]) })
  }
  return {
    summary: `Create a ${prep.template.docType} draft from “${prep.template.name}”${counterparty ? ` for ${counterparty}` : ""}`.slice(0, 300),
    diff,
    store: { templateId: template.id, companyId: prep.company.id, values, ...(title ? { title } : {}), ...(counterparty ? { counterparty } : {}), numberPreview: prep.numberPreview },
    note: "NOT created yet. It waits on the card below; the number is issued only when the person taps Create draft, and it stays a DRAFT (finalizing, sending and signing are done on the Legal page). Say so in one sentence.",
  }
}

export const legalTools: Record<string, ExtraTool> = {
  create_legal_draft: {
    describe: describeLegalDraft,
    stepArg: (i) => str(i.template) ?? str(i.templateName) ?? str(i.docType) ?? null,
    web: async (input, call) => {
      const r = await call({
        method: "POST",
        path: "/api/legal/documents",
        json: {
          templateId: input.templateId,
          companyId: input.companyId,
          values: input.values ?? {},
          ...(typeof input.title === "string" ? { title: input.title } : {}),
          ...(typeof input.counterparty === "string" ? { counterparty: input.counterparty } : {}),
        },
      })
      if (!r.ok) {
        const fe = r.body?.fieldErrors && typeof r.body.fieldErrors === "object" ? Object.entries(r.body.fieldErrors as Record<string, string>).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join("; ") : ""
        return { ok: false, message: `${webError(r, "Couldn't create the draft")}${fe ? ` — ${fe}` : ""}` }
      }
      const id = r.body?.id as string | undefined
      return { ok: true, link: id ? `/legal?doc=${id}` : "/legal", result: { documentId: id ?? null, number: r.body?.number ?? null } }
    },
  },
}

import PizZip from "pizzip"
import Docxtemplater from "docxtemplater"
import InspectModule from "docxtemplater/js/inspect-module.js"
import {
  DOC_DATE_FIELD, FilterError, humanizeFieldName, inferFieldType, isAutoField, parseTag, renderTagValue, unknownFilters,
  type FieldType, type TemplateField,
} from "@/lib/legal/filters"

// Reading and filling a Legal .docx template (docxtemplater, MIT). The placeholder language and value
// formatting are in filters.ts; this file is the docx side: find the placeholders, check them, fill them.

export const TEMPLATE_DELIMITERS = { start: "{{", end: "}}" }

export class TemplateFileError extends Error {
  constructor(message: string, readonly problems: string[] = []) {
    super(message)
  }
}

type Part = { type: string; value: string; module?: string; subparsed?: Part[] }

function openZip(buf: Buffer): PizZip {
  try {
    const zip = new PizZip(buf)
    if (!zip.file("word/document.xml")) throw new Error("no document.xml")
    return zip
  } catch {
    throw new TemplateFileError("This is not a Word (.docx) file")
  }
}

/** docxtemplater's own error list → one line per problem, in words a template author can act on. */
function explain(error: unknown): string[] {
  type Props = { explanation?: string; id?: string; xtag?: string; context?: string }
  const e = error as { properties?: Props & { errors?: unknown[] } }
  const list = e?.properties?.errors ?? [error]
  return list.map((x) => {
    const p = (x as { properties?: Props })?.properties
    if (!p) return String((x as Error)?.message ?? x)
    if (p.id === "unclosed_tag") return `“${p.context ?? p.xtag ?? ""}” is never closed with }}`
    if (p.id === "unopened_tag") return `“${p.context ?? p.xtag ?? ""}” is never opened with {{`
    if (p.id === "unclosed_loop" || p.id === "closing_tag_does_not_match_opening_tag") return `Section “${p.xtag ?? ""}” is not closed with {{/${p.xtag ?? ""}}}`
    if (p.id === "unopened_loop") return `{{/${p.xtag ?? ""}}} closes a section that was never opened`
    return p.explanation ?? "Template error"
  })
}

function compile(zip: PizZip, extra: object = {}) {
  return new Docxtemplater(zip, {
    delimiters: TEMPLATE_DELIMITERS,
    paragraphLoop: true,
    linebreaks: true,
    errorLogging: false,
    ...extra,
  })
}

/** The placeholders of a template, as form fields. Throws TemplateFileError listing every problem. */
export function inspectTemplate(buf: Buffer): TemplateField[] {
  const zip = openZip(buf)
  const inspect = new InspectModule()
  try {
    compile(zip, { modules: [inspect] })
  } catch (error) {
    throw new TemplateFileError("The template has errors", explain(error))
  }
  const parts = inspect.getAllStructuredTags() as unknown as Part[]
  const problems: string[] = []
  const fields = collect(parts, problems, true)
  if (problems.length) throw new TemplateFileError("The template has errors", [...new Set(problems)])
  if (!parts.length) {
    throw new TemplateFileError("No {{PLACEHOLDERS}} found", ["Write {{NAME}} where a value goes, e.g. {{NAMA_PIHAK_KEDUA}}"])
  }
  return fields
}

function collect(parts: Part[], problems: string[], top: boolean): TemplateField[] {
  const byName = new Map<string, { filters: string[]; field?: TemplateField }>()
  const order: string[] = []
  const add = (name: string) => {
    if (!byName.has(name)) {
      byName.set(name, { filters: [] })
      order.push(name)
    }
    return byName.get(name)!
  }
  for (const part of parts) {
    if (part.type !== "placeholder") continue
    const tag = parseTag(part.value)
    if (!tag) {
      problems.push(`“{{${part.value}}}” is not a valid placeholder: use letters, digits and _ (e.g. {{NAMA_LENGKAP}})`)
      continue
    }
    const bad = unknownFilters(tag.filters)
    if (bad.length) problems.push(`{{${part.value}}}: unknown filter ${bad.map((b) => `“${b}”`).join(", ")}`)
    if (part.module === "loop" || part.subparsed) {
      if (tag.filters.length) problems.push(`Section {{#${part.value}}} can't have filters`)
      const columns = collect(part.subparsed ?? [], problems, false)
      const slot = add(tag.name)
      slot.field = columns.length
        ? { name: tag.name, label: humanizeFieldName(tag.name), type: "list", required: true, columns }
        : { name: tag.name, label: humanizeFieldName(tag.name), type: "boolean", required: false }
      continue
    }
    add(tag.name).filters.push(...tag.filters)
  }
  const out: TemplateField[] = []
  for (const name of order) {
    if (top && isAutoField(name)) continue
    const slot = byName.get(name)!
    out.push(slot.field ?? { name, label: humanizeFieldName(name), type: inferFieldType(name, slot.filters), required: true })
  }
  // The document date is asked in every form; put it first.
  if (top) {
    const i = out.findIndex((f) => f.name === DOC_DATE_FIELD)
    const docDate: TemplateField = i >= 0 ? { ...out.splice(i, 1)[0], type: "date", required: true } : { name: DOC_DATE_FIELD, label: "Tanggal Dokumen", type: "date", required: true }
    out.unshift(docDate)
  }
  return out
}

/** Types by field name, nested lists included, so a placeholder knows how to print its value. */
function typeIndex(fields: TemplateField[], into = new Map<string, FieldType>()) {
  for (const f of fields) {
    if (!into.has(f.name)) into.set(f.name, f.type)
    if (f.columns) typeIndex(f.columns, into)
  }
  return into
}

const AUTO_TYPES: Record<string, FieldType> = { NOMOR: "text" }

/**
 * Fill a template. `data` holds the form values (dates as YYYY-MM-DD, lists as arrays of row objects) and
 * the auto fields. Throws TemplateFileError when a filter can't be applied to a value.
 */
export function fillTemplate(buf: Buffer, fields: TemplateField[], data: Record<string, unknown>): Buffer {
  const zip = openZip(buf)
  const types = typeIndex(fields)
  const problems: string[] = []
  const doc = compile(zip, {
    parser: (raw: string) => {
      const tag = parseTag(raw)
      return {
        get(scope: unknown) {
          if (raw === ".") return scope
          if (!tag || scope == null || typeof scope !== "object") return undefined
          const value = (scope as Record<string, unknown>)[tag.name]
          if (value === undefined) return undefined
          // Lists and switches go to docxtemplater as they are; it loops / shows the section.
          if (Array.isArray(value) || typeof value === "boolean") return value
          try {
            return renderTagValue(tag, value, types.get(tag.name) ?? AUTO_TYPES[tag.name])
          } catch (error) {
            if (error instanceof FilterError) problems.push(`{{${raw}}}: ${error.message}`)
            else throw error
            return ""
          }
        },
      }
    },
    nullGetter: () => "",
  })
  try {
    doc.render(data)
  } catch (error) {
    throw new TemplateFileError("The template could not be filled", explain(error))
  }
  if (problems.length) throw new TemplateFileError("Some values don't fit their placeholders", [...new Set(problems)])
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer
}

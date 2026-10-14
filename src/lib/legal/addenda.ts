import type { TemplateField } from "@/lib/legal/filters"
import { DOC_TYPE_FULL_NAMES, ordinalWord } from "@/lib/legal/rules"
import { dayOf } from "@/lib/legal/documents"

// Addenda (owner, 14 Oct 2026): a new document that amends a SIGNED one. Its number is the parent's + "/ADD-n"
// (numbering.ts), its company and kop are the parent's, and the form starts filled from the parent.

export type AddendumParent = {
  id: string
  number: string
  title: string
  docType: string
  docDate: Date | null
  counterparty: string
  companyId: string
  fieldValues: unknown
  projectId: string | null
  dealId: string | null
}

/** The auto fields an addendum template prints about its parent (never asked in the form). */
export function parentAutoValues(parent: AddendumParent, n: number): Record<string, unknown> {
  return {
    NOMOR_INDUK: parent.number,
    JENIS_DOKUMEN_INDUK: DOC_TYPE_FULL_NAMES[parent.docType] ?? "Perjanjian",
    JUDUL_INDUK: parent.title,
    TANGGAL_INDUK: dayOf(parent.docDate) ?? undefined,
    KE: ordinalWord(n),
  }
}

// Where the parties usually are in the parent's form, by the field names the Legal templates use. First match
// wins; "=text" is a literal. The person checks and edits them in the form.
const NAME_AND_ROLE_1: [string, string][] = [
  ["NAMA_DIREKTUR_PROMOTER", "=Direktur"],
  ["NAMA_PEMBERI_KUASA", "JABATAN_PEMBERI_KUASA"],
  ["NAMA_PENANDATANGAN", "JABATAN_PENANDATANGAN"],
  ["NAMA_PEMBERI_PERINGATAN", "JABATAN_PEMBERI_PERINGATAN"],
  ["PIHAK_PERTAMA_NAMA", "PIHAK_PERTAMA_JABATAN"],
  ["NAMA_WAKIL_PIHAK_PERTAMA", "=Project Manager"],
]
const PARTY_2 = ["NAMA_BADAN_HUKUM_VENUE", "PIHAK_KEDUA_INSTANSI", "NAMA_PIHAK_KEDUA", "PIHAK_KEDUA_NAMA", "NAMA_TALENT", "NAMA_PENERIMA_KUASA", "NAMA_KARYAWAN"]
const ADDRESS_2 = ["ALAMAT_VENUE_PARTNER", "ALAMAT_PIHAK_KEDUA", "PIHAK_KEDUA_ALAMAT", "ALAMAT_PENERIMA_KUASA", "ALAMAT_VENUE"]
const NAME_AND_ROLE_2: [string, string][] = [
  ["NAMA_WAKIL_VENUE_PARTNER", "JABATAN_WAKIL_VENUE_PARTNER"],
  ["PIHAK_KEDUA_NAMA", "PIHAK_KEDUA_JABATAN"],
  ["NAMA_PIHAK_KEDUA", "=pribadi"],
  ["NAMA_TALENT", "=pribadi"],
]
const CITY = ["KOTA_TTD", "KOTA", "KOTA_EVENT"]

/** Starting values for an addendum's form, from its parent: only for fields the addendum template asks. */
export function addendumPrefill(parent: AddendumParent, fields: TemplateField[]): Record<string, unknown> {
  const v = (parent.fieldValues && typeof parent.fieldValues === "object" ? parent.fieldValues : {}) as Record<string, unknown>
  const str = (k: string) => (typeof v[k] === "string" || typeof v[k] === "number" ? String(v[k]).trim() : "")
  const first = (keys: string[]) => keys.map(str).find(Boolean) ?? ""
  const pair = (list: [string, string][]) => {
    for (const [name, role] of list) {
      if (str(name)) return [str(name), role.startsWith("=") ? role.slice(1) : str(role)]
    }
    return ["", ""]
  }
  const [wakil1, jabatan1] = pair(NAME_AND_ROLE_1)
  const [wakil2, jabatan2] = pair(NAME_AND_ROLE_2)
  const candidates: Record<string, string> = {
    NAMA_WAKIL_PIHAK_PERTAMA: wakil1,
    JABATAN_WAKIL_PIHAK_PERTAMA: jabatan1,
    NAMA_PIHAK_KEDUA: first(PARTY_2) || parent.counterparty,
    ALAMAT_PIHAK_KEDUA: first(ADDRESS_2),
    NAMA_WAKIL_PIHAK_KEDUA: wakil2,
    JABATAN_WAKIL_PIHAK_KEDUA: jabatan2,
    KOTA_TTD: first(CITY),
  }
  const asked = new Set(fields.map((f) => f.name))
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(candidates)) if (asked.has(k) && val) out[k] = val
  // Any other field the parent had under the same name (e.g. PENGADILAN_NEGERI).
  for (const f of fields) {
    if (out[f.name] === undefined && f.type !== "list" && f.type !== "boolean" && f.name !== "TANGGAL_DOKUMEN" && str(f.name)) out[f.name] = v[f.name]
  }
  return out
}

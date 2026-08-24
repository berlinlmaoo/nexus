// PKS (Perjanjian Kerja Sama) template — ported from the HR-Finance bot's generator at
// ~/.hermes/profiles/hr-finance/output/contracts/generate_contract.py.
//
// The 12 pasal below are copied VERBATIM from that script. They are the wording PATS/Jagain already
// send to clients, deliberately drafted to protect Jagain's side (scope limits, paid change requests,
// pause-on-late-payment, IP only after full payment, client indemnity for supplied materials,
// liability cap, Jakarta Selatan forum). Do not "improve" the legal language here — it is not
// generated text, it is the house contract. Only the {{TOKENS}} are variable.
//
// Output is a structured document, not a string: the same sections feed the Google Docs
// copy-then-batchUpdate path, a PDF renderer, or a plain-text preview.
import { formatIdr, terbilang } from "@/lib/document-numbers"

/** What a requester actually has to fill in. Everything else is template or derived. */
export type PksInput = {
  /** Client's legal entity name, as it should appear in the contract. */
  clientName: string
  clientAddress: string
  /** Client signatory + their title, plus contact details when supplied. */
  clientPic: string
  clientPicTitle: string
  clientEmail?: string
  clientPhone?: string
  /** Never invent this — "Soft copy menyusul" is the house placeholder when it isn't provided yet. */
  clientNpwp?: string
  /** Project / campaign name, printed in the title. */
  projectName: string
  /** What Jagain is delivering, one line. */
  scope: string
  amount: number
  /** Payment term as printed, e.g. "90 hari setelah invoice diterima". */
  paymentTerm: string
  /** The invoice this contract is based on (number + date), issued alongside it. */
  invoiceNumber: string
  invoiceDate: string
  /** Contract number from the register, and the date printed on it. */
  contractNumber: string
  contractDate: string
}

/** Jagain's own side of every contract — fixed, from the templates' letterhead + finance documents. */
export const JAGAIN_PARTY = {
  name: "PT. Jagain Karya Indonesia",
  address: "Jl. Mawar No.1, RT.5/RW.3, Cilandak Tim., Ps. Minggu, Jakarta Selatan, DKI Jakarta",
  phone: "085725404402",
  email: "riri@kitajagain.com",
  pic: "Henryca Aprillyana Mahardika Putri",
  picTitle: "Chief Executive Officer",
  bank: "Bank Central Asia (BCA)",
  accountNumber: "0706-5577-89",
  accountName: "PT. Jagain Karya Indonesia",
} as const

export const NPWP_PENDING = "Soft copy menyusul"

export type PksSection = { heading: string | null; body: string }
export type PksDocument = {
  title: string[]
  sections: PksSection[]
  signature: { left: string[]; right: string[] }
  /** Repeated on every page, same as the generated PDFs. */
  kop: string
}

/** Every variable slot, already stringified. Both the live document and the tokenized master go
 *  through this, so the clause text can never drift between the two. */
type PksSlots = {
  contractNumber: string; contractDate: string; projectName: string; scope: string
  clientName: string; clientAddress: string; clientPic: string; clientPicTitle: string
  contact: string; npwp: string; invoiceNumber: string; invoiceDate: string
  amount: string; words: string; paymentTerm: string
}

export function buildPks(input: PksInput): PksDocument {
  const contact = [
    input.clientEmail ? `email ${input.clientEmail}` : null,
    input.clientPhone ? `no. HP ${input.clientPhone}` : null,
  ].filter(Boolean).join(", ")
  return composePks({
    contractNumber: input.contractNumber,
    contractDate: input.contractDate,
    projectName: input.projectName,
    scope: input.scope,
    clientName: input.clientName,
    clientAddress: input.clientAddress,
    clientPic: input.clientPic,
    clientPicTitle: input.clientPicTitle,
    contact,
    npwp: input.clientNpwp?.trim() || NPWP_PENDING,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    amount: formatIdr(input.amount),
    words: terbilang(input.amount),
    paymentTerm: input.paymentTerm,
  })
}

/**
 * The same contract with {{TOKENS}} where the values go — used once to seed the Google Docs master.
 * Because it shares composePks() with buildPks(), a clause edited in one place is edited in both.
 */
export function buildPksTemplate(): PksDocument {
  return composePks({
    contractNumber: "{{NOMOR_PKS}}", contractDate: "{{TANGGAL_PKS}}",
    projectName: "{{PROJECT}}", scope: "{{SCOPE}}",
    clientName: "{{KLIEN}}", clientAddress: "{{ALAMAT_KLIEN}}",
    clientPic: "{{PIC_KLIEN}}", clientPicTitle: "{{JABATAN_PIC_KLIEN}}",
    contact: "email {{EMAIL_KLIEN}}, no. HP {{HP_KLIEN}}", npwp: "{{NPWP_KLIEN}}",
    invoiceNumber: "{{NOMOR_INVOICE}}", invoiceDate: "{{TANGGAL_INVOICE}}",
    amount: "{{NILAI}}", words: "{{TERBILANG}}", paymentTerm: "{{TOP}}",
  })
}

function composePks(input: PksSlots): PksDocument {
  const { amount, words, npwp, contact } = input

  const sections: PksSection[] = [
    {
      heading: null,
      body: `Perjanjian Kerja Sama ini dibuat pada tanggal ${input.contractDate} oleh dan antara:`,
    },
    {
      heading: "Para Pihak",
      body:
        `1. ${JAGAIN_PARTY.name}, berkedudukan di ${JAGAIN_PARTY.address}, dalam hal ini diwakili oleh ` +
        `${JAGAIN_PARTY.pic} selaku ${JAGAIN_PARTY.picTitle}, selanjutnya disebut PIHAK PERTAMA.\n\n` +
        `2. ${input.clientName}, beralamat di ${input.clientAddress}, dalam hal ini diwakili oleh ` +
        `${input.clientPic} selaku ${input.clientPicTitle}${contact ? `, ${contact}` : ""}, NPWP: ${npwp}, ` +
        `selanjutnya disebut PIHAK KEDUA.\n\n` +
        `PIHAK PERTAMA dan PIHAK KEDUA selanjutnya secara bersama-sama disebut Para Pihak.`,
    },
    {
      heading: "Pasal 1 - Dasar dan Ruang Lingkup Kerja Sama",
      body:
        `(1) Perjanjian ini dibuat berdasarkan Invoice No. ${input.invoiceNumber} tanggal ${input.invoiceDate}.\n` +
        `(2) PIHAK PERTAMA menyediakan jasa/pekerjaan untuk project ${input.projectName} dengan ruang lingkup: ${input.scope}.\n` +
        `(3) Detail teknis, timeline, output, kebutuhan venue, talent/crew, materi promosi, dan approval mengikuti brief tertulis, quotation, purchase order, email, atau dokumen lain yang disepakati Para Pihak.\n` +
        `(4) Pekerjaan tambahan di luar ruang lingkup wajib disepakati tertulis terlebih dahulu dan dapat dikenakan biaya tambahan.`,
    },
    {
      heading: "Pasal 2 - Nilai Kerja Sama dan Pajak",
      body:
        `(1) Nilai kerja sama untuk ruang lingkup sebagaimana Pasal 1 adalah sebesar ${amount} (${words}).\n` +
        `(2) Nilai tersebut merupakan nilai tertagih sesuai invoice. Harga belum termasuk pajak (PPN) kecuali dinyatakan lain dalam kesepakatan tertulis.\n` +
        `(3) Kewajiban perpajakan, pemotongan, pemungutan, dan/atau administrasi pajak mengikuti ketentuan yang berlaku dan dokumen pajak yang diterbitkan Para Pihak.`,
    },
    {
      heading: "Pasal 3 - Ketentuan Pembayaran",
      body:
        `(1) PIHAK KEDUA wajib melakukan pembayaran Full Payment sebesar ${amount} kepada PIHAK PERTAMA dengan TOP ${input.paymentTerm}.\n` +
        `(2) Pembayaran dilakukan ke rekening: ${JAGAIN_PARTY.bank}, No. Rekening ${JAGAIN_PARTY.accountNumber}, atas nama ${JAGAIN_PARTY.accountName}.\n` +
        `(3) PIHAK KEDUA wajib mencantumkan nomor invoice ${input.invoiceNumber} pada keterangan pembayaran dan mengirim bukti transfer kepada PIHAK PERTAMA.\n` +
        `(4) Apabila pembayaran terlambat, PIHAK PERTAMA berhak menunda penyerahan output, laporan, materi, atau pekerjaan lanjutan sampai pembayaran diterima, tanpa menghapus kewajiban PIHAK KEDUA untuk membayar penuh.`,
    },
    {
      heading: "Pasal 4 - Kewajiban PIHAK PERTAMA",
      body:
        "PIHAK PERTAMA berkewajiban melaksanakan pekerjaan secara profesional sesuai ruang lingkup yang disepakati, melakukan koordinasi pelaksanaan project, dan menyampaikan informasi progres atau kebutuhan approval kepada PIHAK KEDUA secara wajar.",
    },
    {
      heading: "Pasal 5 - Kewajiban PIHAK KEDUA",
      body:
        "PIHAK KEDUA berkewajiban memberikan brief, materi, logo, guideline brand, akses lokasi, approval, serta informasi lain yang diperlukan secara tepat waktu. Keterlambatan pemberian materi atau approval dapat berdampak pada timeline dan bukan merupakan kelalaian PIHAK PERTAMA.",
    },
    {
      heading: "Pasal 6 - Approval dan Perubahan Pekerjaan",
      body:
        "(1) Approval tertulis melalui email, pesan resmi, dokumen, atau platform kerja yang disepakati dianggap sah.\n" +
        "(2) Apabila PIHAK KEDUA menggunakan, mempublikasikan, menjalankan, atau menerima manfaat dari output pekerjaan, maka output tersebut dianggap telah diterima sepanjang tidak ada komplain tertulis yang spesifik dalam waktu 3 (tiga) hari kerja sejak disampaikan/digunakan.\n" +
        "(3) Revisi atau perubahan yang mengubah ruang lingkup, jadwal, biaya, lokasi, volume pekerjaan, atau kebutuhan produksi wajib disepakati tertulis terlebih dahulu.",
    },
    {
      heading: "Pasal 7 - Hak Kekayaan Intelektual dan Penggunaan Materi",
      body:
        "(1) Hak penggunaan output final untuk kebutuhan project diberikan kepada PIHAK KEDUA setelah seluruh pembayaran diterima penuh oleh PIHAK PERTAMA.\n" +
        "(2) File kerja, source file, metode kerja, konsep yang tidak digunakan, template internal, dan dokumen internal PIHAK PERTAMA tetap menjadi milik PIHAK PERTAMA kecuali disepakati tertulis lain.\n" +
        "(3) PIHAK KEDUA menjamin bahwa materi, logo, klaim produk, guideline brand, dan instruksi yang diberikan kepada PIHAK PERTAMA tidak melanggar hak pihak ketiga. PIHAK KEDUA bertanggung jawab atas klaim pihak ketiga yang timbul dari materi atau instruksi tersebut.",
    },
    {
      heading: "Pasal 8 - Kerahasiaan",
      body:
        "Para Pihak wajib menjaga kerahasiaan informasi bisnis, harga, data kontak, dokumen, strategi, dan informasi non-publik lain yang diterima dalam pelaksanaan kerja sama ini, kecuali diwajibkan oleh hukum atau telah mendapat persetujuan tertulis pihak yang memberikan informasi.",
    },
    {
      heading: "Pasal 9 - Pembatalan, Penundaan, dan Force Majeure",
      body:
        "(1) Pembatalan atau penundaan oleh PIHAK KEDUA setelah pekerjaan berjalan tidak menghapus kewajiban pembayaran atas biaya, pekerjaan, booking, produksi, dan komitmen pihak ketiga yang telah timbul.\n" +
        "(2) Para Pihak dibebaskan dari keterlambatan pelaksanaan akibat kejadian di luar kendali wajar, termasuk bencana alam, kebijakan pemerintah, gangguan keamanan, epidemi, kerusuhan, atau gangguan besar lain, sepanjang pihak terdampak segera memberitahukan secara tertulis dan berupaya memitigasi dampaknya.",
    },
    {
      heading: "Pasal 10 - Batas Tanggung Jawab",
      body:
        "Tanggung jawab PIHAK PERTAMA atas klaim yang timbul dari Perjanjian ini dibatasi maksimal sebesar nilai yang telah dibayarkan PIHAK KEDUA kepada PIHAK PERTAMA berdasarkan Perjanjian ini, kecuali kerugian terbukti timbul karena kesengajaan atau pelanggaran hukum berat dari PIHAK PERTAMA.",
    },
    {
      heading: "Pasal 11 - Penyelesaian Perselisihan",
      body:
        "Para Pihak sepakat menyelesaikan perselisihan terlebih dahulu secara musyawarah selama 30 (tiga puluh) hari kalender. Apabila tidak tercapai kesepakatan, Para Pihak sepakat memilih domisili hukum yang tetap dan umum di Pengadilan Negeri Jakarta Selatan.",
    },
    {
      heading: "Pasal 12 - Penutup",
      body:
        "Perjanjian ini berlaku mengikat bagi Para Pihak setelah ditandatangani. Segala perubahan atas Perjanjian ini hanya berlaku apabila disepakati secara tertulis oleh Para Pihak.",
    },
  ]

  return {
    kop: `${JAGAIN_PARTY.name} | ${JAGAIN_PARTY.address} | Telp: ${JAGAIN_PARTY.phone} | Email: ${JAGAIN_PARTY.email}`,
    title: ["PERJANJIAN KERJA SAMA", input.projectName.toUpperCase(), `Nomor: ${input.contractNumber}`],
    sections,
    signature: {
      left: ["PIHAK PERTAMA", JAGAIN_PARTY.name, "", "", "", JAGAIN_PARTY.pic, JAGAIN_PARTY.picTitle],
      right: ["PIHAK KEDUA", input.clientName, "", "", "", input.clientPic, input.clientPicTitle],
    },
  }
}

/**
 * Flatten to plain text — used for the requester's preview, and for verifying a generated file by
 * reading it back (the bot's workflow requires checking that new values are present and old template
 * values are absent before anything is sent out).
 */
export function pksToPlainText(doc: PksDocument): string {
  const parts = [doc.title.join("\n"), ""]
  for (const s of doc.sections) {
    if (s.heading) parts.push(s.heading)
    parts.push(s.body, "")
  }
  parts.push("TANDA TANGAN PARA PIHAK", "")
  parts.push(doc.signature.left.join("\n"), "", doc.signature.right.join("\n"))
  return parts.join("\n")
}

/**
 * Token map for the Google Docs path: the master gets `{{TOKEN}}` placeholders once, then every
 * generated copy is a `documents.batchUpdate` with these replacements. Preferred over find-replacing
 * the previous document's literal values, which is how a stale amount survives into a real invoice.
 */
export function pksTokens(input: PksInput): Record<string, string> {
  return {
    "{{NOMOR_PKS}}": input.contractNumber,
    "{{TANGGAL_PKS}}": input.contractDate,
    "{{PROJECT}}": input.projectName,
    "{{SCOPE}}": input.scope,
    "{{KLIEN}}": input.clientName,
    "{{ALAMAT_KLIEN}}": input.clientAddress,
    "{{PIC_KLIEN}}": input.clientPic,
    "{{JABATAN_PIC_KLIEN}}": input.clientPicTitle,
    "{{EMAIL_KLIEN}}": input.clientEmail || "-",
    "{{HP_KLIEN}}": input.clientPhone || "-",
    "{{NPWP_KLIEN}}": input.clientNpwp?.trim() || NPWP_PENDING,
    "{{NOMOR_INVOICE}}": input.invoiceNumber,
    "{{TANGGAL_INVOICE}}": input.invoiceDate,
    "{{NILAI}}": formatIdr(input.amount),
    "{{TERBILANG}}": terbilang(input.amount),
    "{{TOP}}": input.paymentTerm,
  }
}

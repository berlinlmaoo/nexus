// MOU Event — talent booking agreement between a venue (PIHAK PERTAMA) and a talent manager
// (PIHAK KEDUA). Text taken VERBATIM from the MOU PDF Bagas supplied 2026-07-30 (the Shelter Club /
// DJ.BBZ instance); only the slots below vary. Do not reword the pasal — it's the house contract.
//
// Confirmed variable by Bagas: riders AND akomodasi are filled per deal (they differ per talent),
// PIHAK KEDUA is per deal too (not always the same manager), DP/pelunasan dates are typed manually
// (not derived), and the minimum set duration varies.
//
// NOTE: real MOUs carry NO document number — there is none printed anywhere in the source document —
// so this series is deliberately unnumbered. Don't invent one.
export type MouInput = {
  /** Signing date. The day name is derived, matching "Minggu,02 November 2025". */
  signDate: string
  signCity: string
  // PIHAK PERTAMA — the venue / client
  p1Name: string
  p1Company: string
  p1Title: string
  p1Address: string
  // PIHAK KEDUA — the talent side
  p2Name: string
  p2Title: string
  p2Address: string
  p2Phone: string
  /** As printed, e.g. "0703727899 (BCA) a/n NITA ROSDIYANTI". */
  p2Account: string
  // The deal
  eventDate: string
  eventName: string
  venue: string
  talent: string
  fee: string
  /** Minimum set length in minutes, as printed. */
  durationMinutes: string
  dpDate: string
  settlementDate: string
  /** Free text, one item per line — becomes the akomodasi bullet list. */
  accommodation: string
  /** Free text, one item per line — becomes the riders bullet list. */
  riders: string
}

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]

/** "2025-11-02" → "Minggu,02 November 2025" — the exact shape the source document prints. */
export function idDayDate(input: string): string {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  const day = DAYS[d.getDay()]
  const rest = d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
  return `${day},${rest}`
}

export function mouTokens(v: MouInput): Record<string, string> {
  return {
    "{{TANGGAL_TTD}}": idDayDate(v.signDate),
    "{{KOTA_TTD}}": v.signCity,
    "{{TANGGAL_TTD_POLOS}}": new Date(v.signDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
    "{{P1_NAMA}}": v.p1Name,
    "{{P1_PERUSAHAAN}}": v.p1Company,
    "{{P1_JABATAN}}": v.p1Title,
    "{{P1_ALAMAT}}": v.p1Address,
    "{{P2_NAMA}}": v.p2Name,
    "{{P2_JABATAN}}": v.p2Title,
    "{{P2_ALAMAT}}": v.p2Address,
    "{{P2_TELP}}": v.p2Phone,
    "{{P2_REKENING}}": v.p2Account,
    "{{TANGGAL_ACARA}}": idDayDate(v.eventDate),
    "{{NAMA_EVENT}}": v.eventName,
    "{{VENUE}}": v.venue,
    "{{TALENT}}": v.talent,
    "{{FEE}}": v.fee,
    "{{DURASI_MENIT}}": v.durationMinutes,
    "{{TANGGAL_DP}}": v.dpDate,
    "{{TANGGAL_PELUNASAN}}": v.settlementDate,
    "{{AKOMODASI}}": bullets(v.accommodation),
    "{{RIDERS}}": bullets(v.riders),
  }
}

/** One item per line in, "- item" per line out — the sub-bullet style the source document uses. */
function bullets(raw: string): string {
  const items = raw.split(/\r?\n/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean)
  if (!items.length) return "-"
  return items.map((i) => `- ${i}`).join("\n")
}

/**
 * The MOU with {{TOKENS}} in place, used once to seed the Google Docs master. Text matches the source
 * document line for line except for the slots.
 */
export const MOU_TEMPLATE_TEXT = `MEMORANDUM OF UNDERSTANDING
( MOU )


Pada hari ini {{TANGGAL_TTD}} telah ditandatangani Surat Perjanjian Kerjasama antara pihak-pihak dibawah ini :

Nama\t: {{P1_NAMA}}
Perusahaan\t: {{P1_PERUSAHAAN}}
Jabatan\t: {{P1_JABATAN}}
Alamat\t: {{P1_ALAMAT}}
Selanjutnya bertindak untuk dan atas nama PIHAK PERTAMA.

Nama\t: {{P2_NAMA}}
Jabatan\t: {{P2_JABATAN}}
Alamat\t: {{P2_ALAMAT}}
No. Telp\t: {{P2_TELP}}
No. Rekening\t: {{P2_REKENING}}
Selanjutnya bertindak untuk dan atas nama PIHAK KEDUA.

Kedua belah pihak telah sepakat untuk mengikatkan diri dalam suatu perjanjian kerjasama dengan ketentuan-ketentuan sebagai berikut :

PASAL 1
LINGKUP PERJANJIAN

Perjanjian ini diadakan sehubungan dengan acara yang akan diadakan pada hari {{TANGGAL_ACARA}} di Event {{NAMA_EVENT}} bertempat di {{VENUE}}.

PASAL 2
HAK DAN KEWAJIBAN PIHAK PERTAMA

• Berkewajiban untuk menyediakan tempat untuk acara
• Berhak mendapatkan talent {{TALENT}} untuk tampil dalam event pada hari {{TANGGAL_ACARA}}.
• Berkewajiban memberikan Fee talent {{TALENT}}, produksi dan promosi Sebesar {{FEE}}
• DP sebesar 50% akan dibayarkan pada tanggal {{TANGGAL_DP}}. Dan sisanya akan dibayarkan H-1 sebelum event berlangsung (atau pada tanggal {{TANGGAL_PELUNASAN}}).
• Berkewajiban dan berhak melakukan promosi dengan menggunakan nama talent pada event tersebut.
• Berkewajiban menyediakan fasilitas akomodasi berupa :
{{AKOMODASI}}
• Berkewajiban menyediakan riders berupa :
{{RIDERS}}

PASAL 3
HAK DAN KEWAJIBAN PIHAK KEDUA

• Berkewajiban untuk menyediakan talent {{TALENT}}.
• Berkewajiban untuk bermain selama minimal {{DURASI_MENIT}} menit.
• Berkewajiban untuk tidak perform atau mengambil job di kota yang sama minimal 2 minggu sebelum tanggal perform di {{VENUE}}.
• Berkewajiban meminta persetujuan jika akan mengambil job di kota yang sama dalam waktu yang dilarang.
• Berhak mendapatkan fee Keperluan acara Sebesar {{FEE}} ke rekening yang terdapat pada data PIHAK KEDUA.

PASAL 4
SANKSI – SANKSI

1. Apabila terjadi pembatalan sepihak dari salah satu pihak dalam waktu H-10, maka pihak yang melakukan pembatalan akan dikenakan sanksi sebesar nilai kontraprestasi yang telah disepakati.
2. Sanksi – sanksi tersebut diatas berlaku kecuali terjadi Force Majeure.

PASAL 5
FORCE MAJEURE

Yang dimaksud Force Majeure adalah seperti bencana alam, wabah penyakit, sabotase, kebakaran atau yang disebabkan oleh diluar kekuasaan manusia, maka kedua belah pihak akan meninjau kembali isi perjanjian kerjasama ini.

PASAL 6
PERSELISIHAN DAN PENYELESAIAN

Apabila timbul suatu perselisihan dalam penafsiran dan atau pelaksanaan perjanjian, maka kedua belah pihak sepakat untuk menyelesaikan dengan jalan musyawarah dan apabila cara tersebut masih tidak dapat terselesaikan maka dapat diselesaikan melalui jalur hukum yang berlaku di Indonesia.

PASAL 7
PENUTUP

Demikian perjanjian kerjasama ini dibuat, disepakati dan ditandatangani kedua belah pihak bersifat mengikat, serta dibuat rangkap 2 ( dua ) serta bermaterai dan masing-masing Pihak memegang 1 ( satu ) copy dengan kekuatan hukum yang sama.


{{KOTA_TTD}}, {{TANGGAL_TTD_POLOS}}

\tPIHAK PERTAMA\t\t\t\tPIHAK KEDUA




\t{{P1_NAMA}}\t\t\t\t{{P2_NAMA}}
\t{{P1_JABATAN}}\t\t\t\t{{P2_JABATAN}}
`

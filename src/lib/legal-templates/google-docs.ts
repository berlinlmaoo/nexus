// Google Docs template filling for the Legal document flow (invoice / PKS).
//
// This mirrors the workflow the HR-Finance bot has been using by hand for months, and its rules are
// not stylistic — each one exists because breaking it produced a bad document:
//
//   1. NEVER touch the master. Copy it, fill the copy.
//   2. Fill via the Docs API on the native Google Doc. No DOCX/PDF round-tripping — that is what
//      destroys the layout of these letterhead documents.
//   3. Replace {{TOKENS}}, not the previous document's literal values. Find-replacing "Rp30.000.000"
//      is how a stale amount survives into a real invoice when the token appears twice.
//   4. Read the filled copy back and verify before anyone sees it.
//   5. Export PDF *and* DOCX from the verified copy.
//
// Separate credentials from src/lib/google-drive.ts on purpose: this needs `documents` + `drive`
// (copying a master the app didn't create), which the finance Drive token doesn't have.
import { google } from "googleapis"

const CLIENT_ID = process.env.GOOGLE_DOCS_CLIENT_ID || ""
const CLIENT_SECRET = process.env.GOOGLE_DOCS_CLIENT_SECRET || ""
const REFRESH_TOKEN = process.env.GOOGLE_DOCS_REFRESH_TOKEN || ""

export class DocsTemplateError extends Error {}

export const docsConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN)

/**
 * Long-lived refresh-token client. Access tokens are minted per call and never stored — googleapis
 * refreshes them on demand.
 */
function getAuth() {
  if (!docsConfigured()) {
    throw new DocsTemplateError(
      "Google Docs belum dikonfigurasi (butuh GOOGLE_DOCS_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN).",
    )
  }
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
  client.setCredentials({ refresh_token: REFRESH_TOKEN })
  return client
}

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const

export type GeneratedDocument = {
  /** Drive id of the generated copy — the master is untouched. */
  documentId: string
  webViewLink: string
  pdf: Buffer
  docx: Buffer
  /** Text read back from the filled copy, for logging/verification. */
  text: string
}

/**
 * Copy a master Google Doc, replace its tokens, verify, and export PDF + DOCX.
 *
 * @param replacements `{ "{{NOMOR_PKS}}": "PKS/JW/PTJKI/VII/2026/001", … }` — see pksTokens().
 * @param mustAppear   Values that MUST be present in the filled document (typically the number and
 *                     the amount). Generation fails loudly rather than handing over a document with
 *                     an unfilled field.
 * @param mustNotAppear Strings that must be gone — leftover `{{` tokens are checked automatically.
 */
export async function fillDocTemplate(opts: {
  masterId: string
  /** Filename for the copy, e.g. "Invoice PATS Entertainment - GOEDANG - 2026-07-30". */
  name: string
  /** Drive folder to drop the copy in; defaults to wherever the master lives. */
  folderId?: string
  replacements: Record<string, string>
  mustAppear?: string[]
  mustNotAppear?: string[]
}): Promise<GeneratedDocument> {
  const auth = getAuth()
  const drive = google.drive({ version: "v3", auth })
  const docs = google.docs({ version: "v1", auth })

  // 1. Copy the master (never edited).
  const copy = await drive.files.copy({
    fileId: opts.masterId,
    requestBody: { name: opts.name, ...(opts.folderId ? { parents: [opts.folderId] } : {}) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  })
  const documentId = copy.data.id
  if (!documentId) throw new DocsTemplateError("Drive nggak balikin id buat copy template-nya.")

  try {
    // 2. Fill the copy. matchCase:true — the tokens are uppercase by convention, and a
    //    case-insensitive match would also rewrite prose that happens to contain the word.
    const requests = Object.entries(opts.replacements).map(([token, value]) => ({
      replaceAllText: { containsText: { text: token, matchCase: true }, replaceText: value },
    }))
    if (requests.length) await docs.documents.batchUpdate({ documentId, requestBody: { requests } })

    // 3. Read back and verify before this document can reach a client.
    const text = await readDocText(docs, documentId)
    const missing = (opts.mustAppear ?? []).filter((v) => v && !text.includes(v))
    const leftover = (opts.mustNotAppear ?? []).filter((v) => v && text.includes(v))
    const unfilled = [...new Set(text.match(/\{\{[A-Z0-9_]+\}\}/g) ?? [])]
    if (missing.length || leftover.length || unfilled.length) {
      throw new DocsTemplateError(
        [
          "Dokumen hasil generate gagal verifikasi.",
          missing.length ? `Nggak ketemu: ${missing.join(", ")}.` : "",
          leftover.length ? `Masih ada nilai lama: ${leftover.join(", ")}.` : "",
          unfilled.length ? `Placeholder belum keisi: ${unfilled.join(", ")}.` : "",
        ].filter(Boolean).join(" "),
      )
    }

    // 4. Export both formats from the verified copy.
    const [pdf, docx] = await Promise.all([
      exportAs(drive, documentId, MIME.pdf),
      exportAs(drive, documentId, MIME.docx),
    ])
    if (!pdf.length || !docx.length) throw new DocsTemplateError("Hasil export PDF/DOCX kosong.")

    return { documentId, webViewLink: copy.data.webViewLink ?? "", pdf, docx, text }
  } catch (err) {
    // A copy that failed verification must not be left lying around in Drive looking official.
    await drive.files.delete({ fileId: documentId, supportsAllDrives: true }).catch(() => {})
    throw err
  }
}

/** Flatten a Doc's body to text — paragraphs and table cells, in reading order. */
async function readDocText(docs: ReturnType<typeof google.docs>, documentId: string): Promise<string> {
  const res = await docs.documents.get({ documentId })
  const out: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (elements: any[] | undefined) => {
    for (const el of elements ?? []) {
      for (const run of el.paragraph?.elements ?? []) {
        if (run.textRun?.content) out.push(run.textRun.content)
      }
      // Invoice templates keep every number inside a table, so skipping tables would "verify" nothing.
      for (const row of el.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) walk(cell.content)
      }
    }
  }
  walk(res.data.body?.content)
  return out.join("")
}

async function exportAs(
  drive: ReturnType<typeof google.drive>,
  fileId: string,
  mimeType: string,
): Promise<Buffer> {
  const res = await drive.files.export(
    { fileId, mimeType },
    { responseType: "arraybuffer" },
  )
  return Buffer.from(res.data as ArrayBuffer)
}

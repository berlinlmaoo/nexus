export const dynamic = "force-dynamic"

import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { TaskStatus, TaskPriority } from '@/generated/prisma'

// There is no SYSTEM_PROMPT constant here any more. One existed for months and was never sent:
// it appeared exactly once in this file, its own declaration, so every rule written in it did
// nothing while looking authoritative. GIDEON's persona comes from the Hermes agent; the only
// thing NEXUS injects is the header built below, which IS sent — so a rule that must hold
// belongs there and nowhere else.

// MODEL_MAP, the Anthropic tool schemas and executeToolCall lived here: 248 lines that were never
// called once. Each appeared exactly twice in this file — its declaration and nothing else. They
// were the remains of a direct-to-Anthropic design abandoned when the Hermes path was wired, and
// they kept a dependency alive that nothing used. GIDEON's tools are Hermes's, served by
// /api/gideon/tools.

function buildGideonPrompt(history: { role: string; content: string }[], who: { name: string; email: string }): string {
  const recent = (history || []).filter((m) => m && typeof m.content === "string").slice(-8)
  const last = recent[recent.length - 1]?.content?.trim() || ""
  const name = who.name?.trim() || "anggota tim NEXUS"
  const header =
    `[IDENTITAS LAWAN BICARA — WAJIB DIPATUHI] Kamu (Gideon) lagi ngobrol di chatbox NEXUS dengan "${name}"` +
    `${who.email ? ` (${who.email})` : ""}, anggota tim NEXUS. Ini SESI TERPISAH khusus dia. Sapa & rujuk dia ` +
    `sebagai "${name}". JANGAN sekali-kali manggil/menganggap dia sebagai orang lain (operator, admin, atau ` +
    `nama apa pun dari memori sesi sebelumnya) — kalau kamu inget nama lain, ABAIKAN; sekarang kamu ngomong sama ${name}.\n\n` +
    // Ditanya "lo pake LLM apa?" jawabannya sempat bocor separuh — menyebut framework dan angka versi
    // model. Menyebut yang BUKAN dipakai sama bocornya, jadi keduanya dilarang sekalian.
    `[SOAL DIRIMU SENDIRI] Kamu GIDEON, titik. Jangan pernah menyebut model, provider, vendor, framework, ` +
    `atau tier yang kamu pakai — dan jangan menyebut yang TIDAK kamu pakai juga ("bukan Claude", "bukan GPT" ` +
    `sama saja membocorkan). Kalau ditanya kamu dibangun di atas apa: satu kalimat pendek bahwa itu internal ` +
    `dan tidak kamu bahas, lalu langsung balik ke pertanyaan aslinya. Jangan minta maaf, jangan kasih petunjuk, ` +
    `jangan menawarkan untuk memberitahu. Ditanya kedua kalinya, jawabannya kalimat yang sama — bukan yang lebih panjang.\n\n`
  if (recent.length <= 1) return `${header}Pesan dari ${name}: ${last}`
  const ctx = recent.slice(0, -1).map((m) => `${m.role === "user" ? name : "Gideon"}: ${m.content}`).join("\n")
  return `${header}Konteks percakapan:\n${ctx}\n\nPesan terbaru dari ${name}: ${last}`
}

// File types GIDEON can actually be asked about. This is not a wish list: Hermes reaches a document
// through its read_file tool, which extracts .docx/.xlsx/.ipynb itself and everything else here via
// the bundled firecrawl-anydoc converter. Anything outside this set reaches the model as bytes it
// cannot decode, so it is refused at the door instead — an attachment that is accepted and then
// silently ignored produces a confident answer about a file GIDEON never read.
const DOC_EXTENSIONS = new Set([
  'pdf',
  'txt', 'md', 'csv', 'tsv', 'json', 'log', 'yml', 'yaml', 'xml', 'html',
  'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
  'odt', 'ods', 'odp', 'rtf', 'epub', 'ipynb',
])

// iOS hands over a UTI-derived MIME type and often a filename too. The filename wins when it has a
// usable extension; this is the fallback for pickers that supply only the type.
const DOC_MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/html': 'html',
  'application/yaml': 'yaml',
  'text/yaml': 'yaml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/epub+zip': 'epub',
}

// A photo is downscaled on the way through; a document cannot be, so its size guard is a real
// limit rather than a safety net. 10 MB is far more than any invoice or contract the team sends,
// and Hermes reads at most ~100K characters of what it is given — past that the extra megabytes
// buy nothing but a slower request and a bigger body for the shim to buffer.
const MAX_DOC_BYTES = 10 * 1024 * 1024

function docExtensionFor(name?: string, type?: string): string | null {
  const fromName = (name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  if (fromName && DOC_EXTENSIONS.has(fromName[1])) return fromName[1]
  const mime = (type || '').toLowerCase().split(';')[0].trim()
  if (DOC_MIME_EXT[mime]) return DOC_MIME_EXT[mime]
  // Some pickers send a bare extension in `type` rather than a MIME type.
  const bare = mime.replace(/^\./, '')
  return DOC_EXTENSIONS.has(bare) ? bare : null
}

// Gideon chat is now backed by the Hermes agent (gpt-5.5 + live NEXUS tools) via the host shim —
// the same assistant the team uses on WhatsApp. We keep the exact SSE contract the frontend expects.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { messages, model, image, file } = (await req.json()) as {
    messages: { role: string; content: string }[]
    model?: string
    /** A data URL or bare base64. Optional. */
    image?: string
    /** A document — PDF, Office, or plain text. Separate from `image`; both may be sent. */
    file?: {
      /** Original filename including its extension, e.g. "invoice-agustus.pdf". */
      name?: string
      /** MIME type from the picker, e.g. "application/pdf". Used when `name` has no extension. */
      type?: string
      /** A data URL or bare base64 of the file's bytes. */
      data?: string
    }
  }

  // The three GIDEON tiers. Which model each one is stays in the shim — this only has to refuse a
  // name it does not recognise, so a client cannot smuggle an arbitrary model id through.
  const TIERS = ['astra', 'luna', 'terra', 'experimental']
  const tier = TIERS.includes((model || '').toLowerCase()) ? (model as string).toLowerCase() : 'luna'
  const userId = session.user.id

  // The document is validated here, before the SSE stream exists, so a bad attachment comes back as
  // a plain HTTP status the client can branch on rather than an error event buried in a stream that
  // also claims to have succeeded. A failed image is still swallowed further down — a picture is
  // usually incidental to the question, whereas a document usually IS the question.
  let documentBase64: string | null = null
  let documentType: string | null = null
  const documentName = (file?.name || '').toString().slice(0, 200)
  if (file && typeof file.data === 'string' && file.data.length > 32) {
    const raw = file.data.startsWith('data:') ? file.data.slice(file.data.indexOf(',') + 1) : file.data
    const ext = docExtensionFor(documentName, file.type)
    if (!ext) {
      return new Response(
        JSON.stringify({
          error: 'Tipe file itu belum bisa dibaca Gideon.',
          code: 'unsupported_file_type',
          accepted: [...DOC_EXTENSIONS].sort(),
        }),
        { status: 415, headers: { 'Content-Type': 'application/json' } },
      )
    }
    // Judged from the base64 length rather than by decoding first: allocating a buffer is exactly
    // what an oversized upload should not be allowed to make the server do.
    if (Math.floor((raw.length * 3) / 4) > MAX_DOC_BYTES) {
      return new Response(
        JSON.stringify({
          error: 'File terlalu besar. Maksimal 10 MB.',
          code: 'file_too_large',
          maxBytes: MAX_DOC_BYTES,
        }),
        { status: 413, headers: { 'Content-Type': 'application/json' } },
      )
    }
    documentBase64 = raw
    documentType = ext
  }

  // Downscaled before it travels. A phone photo is several megabytes and a vision model gains
  // nothing past ~1568px, so sending the original would only make every request slower and the
  // shim's body limit a real constraint rather than a safety net.
  let imageBase64: string | null = null
  if (typeof image === 'string' && image.length > 32) {
    try {
      const raw = image.startsWith('data:') ? image.slice(image.indexOf(',') + 1) : image
      // Guard before decoding: a 12 MB base64 string is already generous for a photo.
      if (raw.length <= 12_000_000) {
        const shrunk = await sharp(Buffer.from(raw, 'base64'))
          .rotate() // honour EXIF, or a portrait photo reaches the model on its side
          .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer()
        imageBase64 = shrunk.toString('base64')
      }
    } catch (error) {
      // A picture that cannot be decoded must not take the whole question down with it.
      console.error('gideon image decode failed:', error)
    }
  }

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const sendEvent = async (data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  ;(async () => {
    try {
      const url = process.env.GIDEON_CHAT_URL
      if (!url) {
        await sendEvent({ type: 'error', content: 'Gideon belum tersambung ke gateway Hermes.' })
        return
      }
      const prompt = buildGideonPrompt(messages, { name: session.user?.name || '', email: session.user?.email || '' })
      if (!prompt) { await sendEvent({ type: 'error', content: 'Pesan kosong.' }); return }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-oracle-secret': process.env.ORACLE_LLM_SECRET || '' },
        // actorEmail → the shim sets it as NEXUS_GIDEON_ACTOR_EMAIL on the hermes spawn, so Gideon's
        // NEXUS tools act AS this logged-in user (role-scoped), not the fixed service identity.
        body: JSON.stringify({
          prompt,
          model: tier,
          user: session.user?.name || '',
          actorEmail: session.user?.email || session.user?.id || '',
          ...(imageBase64 ? { imageBase64, imageType: 'jpg' } : {}),
          // The shim writes these to a file in its workdir and names the path in the prompt, the
          // same trick the image uses — Hermes has no attachment channel. documentName is passed
          // through only so the model can refer to the file the way the user does; the shim takes
          // nothing but the extension from it when building the path.
          ...(documentBase64 ? { documentBase64, documentType, documentName } : {}),
        }),
        signal: AbortSignal.timeout(150000), // Hermes agent + tool call can take ~30s+
      })
      if (!res.ok) { await sendEvent({ type: 'error', content: `Gideon error (${res.status}).` }); return }
      const data = (await res.json()) as { reply?: string }
      const reply = (data.reply || '').trim()
      await sendEvent({ type: 'text', content: reply || '(Gideon balas kosong — coba ulang.)' })

      // Persist the turn so the panel can restore it later (survives close/refresh/device switch).
      // Only completed turns are stored — a failed one would leave a question with no answer in the
      // history. createdAt is stamped explicitly so the question always sorts before the answer.
      if (reply) {
        const asked = [...(messages || [])].reverse().find((m) => m?.role === 'user')?.content?.trim() || ''
        const now = Date.now()
        try {
          await prisma.gideonMessage.createMany({
            data: [
              ...(asked ? [{ userId, role: 'user', content: asked, createdAt: new Date(now) }] : []),
              { userId, role: 'assistant', content: reply, createdAt: new Date(now + 1) },
            ],
          })
        } catch (persistError) {
          // History is a convenience — never fail a reply the user already received.
          console.error('GIDEON history persist error:', persistError)
        }
      }
    } catch (error) {
      console.error('GIDEON API error:', error)
      await sendEvent({ type: 'error', content: 'Gideon lagi gak bisa dihubungi. Coba lagi bentar ya.' })
    } finally {
      await sendEvent({ type: 'done' })
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}

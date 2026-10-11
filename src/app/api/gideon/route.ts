export const dynamic = "force-dynamic"

import { NextRequest } from 'next/server'
import sharp from 'sharp'
import type { InputJsonValue } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { deleteGideonAttachmentFiles, storeGideonAttachments } from '@/lib/gideon-attachments'
import { checkProjectAccess } from '@/lib/rbac'
import {
  approvalPromptLine, finishRun, parseApprovalMode, publishRunEvent, recordStep, runMeta, startRun, subscribeRun, type ApprovalMode, type GideonRef, type RunEvent,
} from '@/lib/gideon-runs'
import { resolveGideonChat, gatherContext, personalPromptLines, touchGideonChat, type GideonContextRef } from '@/lib/gideon-assistant'
import { searchWorkspace } from '@/lib/workspace-search'

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

function buildGideonPrompt(history: { role: string; content: string }[], who: { name: string; email: string }, extra = ''): string {
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
  const head = extra ? `${header}${extra}\n\n` : header
  if (recent.length <= 1) return `${head}Pesan dari ${name}: ${last}`
  const ctx = recent.slice(0, -1).map((m) => `${m.role === "user" ? name : "Gideon"}: ${m.content}`).join("\n")
  return `${head}Konteks percakapan:\n${ctx}\n\nPesan terbaru dari ${name}: ${last}`
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

/** Hermes looking up its own tool catalogue: plumbing, not a step the person needs to see. */
const HERMES_INTERNAL_TOOLS = new Set(['tool_search', 'tool_describe', 'tool_list'])

// Gideon chat is now backed by the Hermes agent (gpt-5.5 + live NEXUS tools) via the host shim —
// the same assistant the team uses on WhatsApp. We keep the exact SSE contract the frontend expects.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { messages, model, image, file, stream: wantsStream, approvalMode: rawMode, context, chatId: rawChatId, newChat, search: wantsSearch } = (await req.json()) as {
    messages: { role: string; content: string }[]
    /**
     * The conversation (GideonChat, 12 Oct 2026). Absent = the person's most recent chat (what released
     * iOS / Android get: they keep one running conversation). `newChat: true` = start a new one.
     */
    chatId?: string
    newChat?: boolean
    /** Workspace Q&A: search what the person can see before answering, and cite it. Default on for `stream` clients. */
    search?: boolean
    model?: string
    /**
     * true = this client draws the new events (12 Oct 2026, web): `delta` text pieces, `reset`, `step`,
     * `sources`, `card`, `proposal`, then `final`. Absent (released iOS / Android) = the old contract:
     * one `text` with the whole answer, then `done`. Both get `run` first, which old clients ignore.
     */
    stream?: boolean
    /** always_ask | review | dont_ask. Absent = dont_ask: released apps have no approval card to show. */
    approvalMode?: string
    /**
     * Where the person opened GIDEON from: a project (and optionally a task in it), plus (12 Oct 2026) a doc and
     * any pages they @-mentioned in the composer (`refs`). Each is checked for access; what they cannot see is dropped.
     */
    context?: { projectId?: string; taskId?: string; docId?: string; refs?: GideonContextRef[] }
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
  const streamClient = wantsStream === true
  const approvalMode: ApprovalMode = parseApprovalMode(rawMode) ?? 'dont_ask'

  // The page GIDEON was opened from — only if the person can see it; otherwise it is silently dropped
  // rather than leaking a name through the prompt.
  let ctx: { projectId: string; projectName: string; taskId?: string; taskTitle?: string } | null = null
  try {
    const wantTask = typeof context?.taskId === 'string' ? context.taskId.slice(0, 40) : ''
    const wantProject = typeof context?.projectId === 'string' ? context.projectId.slice(0, 40) : ''
    if (wantTask) {
      const t = await prisma.task.findUnique({ where: { id: wantTask }, select: { id: true, title: true, taskList: { select: { project: { select: { id: true, name: true } } } } } })
      const p = t?.taskList?.project
      if (t && p && (await checkProjectAccess(userId, p.id, ['VIEWER'])).allowed) ctx = { projectId: p.id, projectName: p.name, taskId: t.id, taskTitle: t.title }
    } else if (wantProject) {
      const p = await prisma.project.findUnique({ where: { id: wantProject }, select: { id: true, name: true } })
      if (p && (await checkProjectAccess(userId, p.id, ['VIEWER'])).allowed) ctx = { projectId: p.id, projectName: p.name }
    }
  } catch {
    ctx = null
  }
  // Every page the question carries (the page it was opened from + @-mentions), read with the asker's access.
  const gathered = await gatherContext(userId, {
    projectId: typeof context?.projectId === 'string' ? context.projectId : undefined,
    taskId: typeof context?.taskId === 'string' ? context.taskId : undefined,
    docId: typeof context?.docId === 'string' ? context.docId : undefined,
    refs: Array.isArray(context?.refs) ? context.refs : [],
  }).catch(() => ({ lines: [] as string[], refs: [] as GideonRef[] }))

  // The document is validated here, before the SSE stream exists, so a bad attachment comes back as
  // a plain HTTP status the client can branch on rather than an error event buried in a stream that
  // also claims to have succeeded. A failed image is still swallowed further down — a picture is
  // usually incidental to the question, whereas a document usually IS the question.
  let documentBase64: string | null = null
  let documentType: string | null = null
  const documentName = (file?.name || '').toString().slice(0, 200)
  // Carried past the shim purely so the stored copy can say what it is: the extension decides how
  // the file is read here and how /api/files serves it, but a client choosing a viewer for a kept
  // attachment reads the type first, and re-deriving it there would be a second copy of this table.
  const documentMime = (file?.type || '').toString().slice(0, 128)
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
  // A client that went away (panel closed) must not abort the run: the answer is still saved to the
  // history and shows up when the panel is opened again. So a failed write is swallowed.
  let clientGone = false
  const sendEvent = async (data: Record<string, unknown>) => {
    if (clientGone) return
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch {
      clientGone = true
    }
  }

  ;(async () => {
    const asked = [...(messages || [])].reverse().find((m) => m?.role === 'user')?.content?.trim() || ''
    // The conversation this turn belongs to (created here when it is new, titled by the question).
    const chat = await resolveGideonChat(userId, { chatId: typeof rawChatId === 'string' ? rawChatId : null, newChat: newChat === true, title: asked }).catch(() => null)
    // Only clients that asked for the new contract: released apps keep exactly run → text → done.
    if (chat && streamClient) await sendEvent({ type: 'chat', id: chat.id, title: chat.title })
    const runId = await startRun({
      userId,
      trigger: 'CHAT',
      approvalMode,
      tier,
      title: asked.split('\n')[0] || null,
      projectId: ctx?.projectId ?? null,
      taskId: ctx?.taskId ?? null,
    })
    // Steps, sources, cards and proposals raised by /api/gideon/tools while this run is going.
    // Old clients get none of them (they would not know what to draw).
    const unsubscribe = runId && streamClient ? subscribeRun(runId, (ev: RunEvent) => { void sendEvent(ev as unknown as Record<string, unknown>).catch(() => {}) }) : () => {}
    let reply = ''
    let failure: string | null = null
    let tokens: number | null = null
    try {
      if (runId) await sendEvent({ type: 'run', id: runId })
      const url = process.env.GIDEON_CHAT_URL
      if (!url) {
        failure = 'not configured'
        await sendEvent({ type: 'error', content: 'Gideon belum tersambung ke gateway Hermes.' })
        return
      }
      // Workspace Q&A: what the person can see that matches the question, searched BEFORE the model answers so
      // the answer stands on real records (and cites them) instead of a guess. Skipped for a file question.
      const searchLines: string[] = []
      if (streamClient && wantsSearch !== false && asked && !documentBase64 && !imageBase64) {
        const started = Date.now()
        try {
          const { hits } = await searchWorkspace(userId, asked, { limit: 8 })
          if (hits.length) {
            searchLines.push('[HASIL PENCARIAN NEXUS — hanya yang boleh dilihat orang ini] Pakai ini sebagai sumber; sebut judulnya persis saat dipakai. Kalau tidak menjawab pertanyaannya, panggil nexus_search_workspace / tool lain dengan kata kunci lain. Jangan mengarang data yang tidak ada.')
            hits.forEach((h, i) => searchLines.push(`${i + 1}. [${h.kind}] "${h.title}"${h.projectName ? ` (project ${h.projectName})` : ''} — ${h.excerpt || '—'} (id ${h.id})`))
            const refs: GideonRef[] = hits.map((h) => ({ kind: h.kind, id: h.id, title: h.title, projectId: h.projectId ?? null, url: h.url, excerpt: h.excerpt || null }))
            if (runId) {
              const stepId = `ws${Date.now().toString(36)}`
              publishRunEvent(runId, { type: 'step', step: { id: stepId, tool: 'search_workspace', arg: asked.slice(0, 80), label: 'Searching the workspace', status: 'done' } })
              publishRunEvent(runId, { type: 'sources', sources: refs })
              await recordStep(runId, { tool: 'search_workspace', arg: asked.slice(0, 80), ok: true, durationMs: Date.now() - started, refs })
            }
          }
        } catch (error) {
          console.error('GIDEON pre-search failed:', error)
        }
      }
      const prefsLines = await personalPromptLines(userId, session.user?.name || '').catch(() => [] as string[])
      const extra = [
        ...prefsLines,
        ...gathered.lines,
        ...searchLines,
        ctx
          ? (ctx.taskId
            ? `[KONTEKS HALAMAN] ${session.user?.name || 'Dia'} membuka GIDEON dari task "${ctx.taskTitle}" (taskId: ${ctx.taskId}) di project "${ctx.projectName}" (projectId: ${ctx.projectId}). Kalau pertanyaannya tidak menyebut hal lain, anggap tentang task ini.`
            : `[KONTEKS HALAMAN] ${session.user?.name || 'Dia'} membuka GIDEON dari project "${ctx.projectName}" (projectId: ${ctx.projectId}). Kalau pertanyaannya tidak menyebut project lain, anggap tentang project ini.`)
          : '',
        approvalPromptLine(approvalMode),
        // Only for a client that renders Markdown; the released apps show the text as is.
        streamClient ? '[FORMAT] Jawab dalam Markdown yang ringkas: paragraf pendek, daftar berpoin bila perlu, **tebal** seperlunya. Sebut task, project dan dokumen dengan nama persisnya. Tanpa tabel lebar.' : '',
      ].filter(Boolean).join('\n\n')
      const prompt = buildGideonPrompt(messages, { name: session.user?.name || '', email: session.user?.email || '' }, extra)
      if (!prompt) { failure = 'empty'; await sendEvent({ type: 'error', content: 'Pesan kosong.' }); return }

      const payload = JSON.stringify({
        prompt,
        model: tier,
        user: session.user?.name || '',
        // actorEmail → the shim sets it as NEXUS_GIDEON_ACTOR_EMAIL on the hermes spawn, so Gideon's
        // NEXUS tools act AS this logged-in user (role-scoped), not the fixed service identity.
        actorEmail: session.user?.email || session.user?.id || '',
        // The run id rides beside the actor (shim → NEXUS_GIDEON_RUN_ID → plugin → x-gideon-run).
        ...(runId ? { runId } : {}),
        ...(imageBase64 ? { imageBase64, imageType: 'jpg' } : {}),
        // The shim writes these to a file in its workdir and names the path in the prompt, the
        // same trick the image uses — Hermes has no attachment channel. documentName is passed
        // through only so the model can refer to the file the way the user does; the shim takes
        // nothing but the extension from it when building the path.
        ...(documentBase64 ? { documentBase64, documentType, documentName } : {}),
      })
      const headers = { 'Content-Type': 'application/json', 'x-oracle-secret': process.env.ORACLE_LLM_SECRET || '' }
      const timeoutMs = tier === 'experimental' ? 440000 : 150000
      // Token-by-token when the shim offers it (GIDEON_STREAM_URL) and there is no document: the
      // streaming runner reads images but has no document reader.
      const streamUrl = process.env.GIDEON_STREAM_URL
      if (streamUrl && !documentBase64) {
        const res = await fetch(streamUrl, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok || !res.body) {
          failure = `shim ${res.status}`
          await sendEvent({ type: 'error', content: `Gideon error (${res.status}).` })
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        let acc = ''
        let upstreamError: string | null = null
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          pending += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, nl).trim()
            pending = pending.slice(nl + 1)
            if (!line) continue
            let ev: { t?: string; c?: string; usage?: { total_tokens?: number }; phase?: string; id?: string; name?: string }
            try { ev = JSON.parse(line) } catch { continue }
            if (ev.t === 'delta' && typeof ev.c === 'string') {
              acc += ev.c
              if (streamClient) await sendEvent({ type: 'delta', content: ev.c })
            } else if (ev.t === 'reset') {
              // A tool round starts: what streamed so far was the model thinking aloud, not the answer.
              if (acc && streamClient) await sendEvent({ type: 'reset' })
              acc = ''
            } else if (ev.t === 'tool' && streamClient && ev.name && !ev.name.startsWith('nexus_') && !HERMES_INTERNAL_TOOLS.has(ev.name)) {
              // Non-NEXUS tools (reading an attached image) have no tools-route step of their own.
              await sendEvent({ type: 'step', step: { id: `h${ev.id || ev.name}`, tool: ev.name, label: ev.name, status: ev.phase === 'done' ? 'done' : 'running' } })
            } else if (ev.t === 'final' && typeof ev.c === 'string') {
              reply = ev.c.trim()
              tokens = typeof ev.usage?.total_tokens === 'number' ? ev.usage.total_tokens : null
            } else if (ev.t === 'error') {
              upstreamError = String(ev.c || 'failed').slice(0, 300)
            }
          }
        }
        if (!reply && upstreamError) failure = upstreamError
      } else {
        const res = await fetch(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok) {
          failure = `shim ${res.status}`
          await sendEvent({ type: 'error', content: res.status === 415 ? 'Dokumen belum bisa dibaca GIDEON di server ini.' : `Gideon error (${res.status}).` })
          return
        }
        const data = (await res.json()) as { reply?: string }
        reply = (data.reply || '').trim()
      }
      if (!reply) failure = failure || 'empty reply'
      const finalText = reply || '(Gideon balas kosong — coba ulang.)'
      await sendEvent(streamClient ? { type: 'final', content: finalText } : { type: 'text', content: finalText })

      // Persist the turn so the panel can restore it later (survives close/refresh/device switch).
      // Only completed turns are stored — a failed one would leave a question with no answer in the
      // history. createdAt is stamped explicitly so the question always sorts before the answer.
      if (reply) {
        const now = Date.now()
        // The attachment is kept HERE and not on the way in, for the same reason the rows are: a
        // request that failed leaves nothing behind to sweep up. What is written is what GIDEON was
        // actually handed — the downscaled JPEG rather than the camera frame, and the document byte
        // for byte. The shim's own copy is untouched by this; it still writes its workdir file and
        // still deletes it in its finally.
        //
        // Only when there is a question to hang them on. With no user row, nothing could ever draw
        // the chip and the files would be unreachable the moment they were written.
        const stored = asked
          ? await storeGideonAttachments({
              imageBase64,
              documentBase64,
              documentExt: documentType,
              documentName,
              documentMime,
            })
          : []
        // What the run showed (steps, sources, cards, proposals) and the tools it used — the latter is
        // what Control Room › GIDEON counts; it was always 0 because nothing ever wrote it.
        const meta = runId ? await runMeta(runId).catch(() => null) : null
        const toolsUsed = meta ? [...new Set(meta.steps.map((st) => st.tool))] : []
        try {
          await prisma.gideonMessage.createMany({
            data: [
              ...(asked
                ? [{
                    userId,
                    ...(chat ? { chatId: chat.id } : {}),
                    role: 'user',
                    content: asked,
                    createdAt: new Date(now),
                    // Left off entirely when there is nothing, so a turn that carried no file keeps
                    // the NULL every existing row has rather than an empty array to special-case.
                    ...(stored.length ? { attachments: stored as unknown as InputJsonValue } : {}),
                  }]
                : []),
              {
                userId,
                ...(chat ? { chatId: chat.id } : {}),
                role: 'assistant',
                content: reply,
                createdAt: new Date(now + 1),
                tools: toolsUsed,
                ...(runId ? { runId } : {}),
                ...(meta && (meta.steps.length || meta.proposals.length) ? { meta: meta as unknown as InputJsonValue } : {}),
              },
            ],
          })
          if (chat) await touchGideonChat(chat.id)
        } catch (persistError) {
          // History is a convenience — never fail a reply the user already received.
          console.error('GIDEON history persist error:', persistError)
          // The row that would have named these files did not land, so nothing can ever reach them
          // again. Take them back out rather than leave megabytes nobody will look for.
          if (stored.length) {
            await deleteGideonAttachmentFiles([stored]).catch(() => {})
          }
        }
      }
    } catch (error) {
      console.error('GIDEON API error:', error)
      failure = failure || (error instanceof Error ? error.message : 'error')
      await sendEvent({ type: 'error', content: 'Gideon lagi gak bisa dihubungi. Coba lagi bentar ya.' })
    } finally {
      unsubscribe()
      await finishRun(runId, { ok: !failure && Boolean(reply), error: failure, replyChars: reply.length || null, tokens })
      await sendEvent({ type: 'done' })
      await writer.close().catch(() => {})
    }
  })()

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}

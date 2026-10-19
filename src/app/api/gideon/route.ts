export const dynamic = "force-dynamic"

import { NextRequest } from 'next/server'
import sharp from 'sharp'
import type { InputJsonValue } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import { getAppSetting } from '@/lib/app-setting'
import prisma from '@/lib/prisma'
import { deleteGideonAttachmentFiles, storeGideonAttachments } from '@/lib/gideon-attachments'
import { checkProjectAccess } from '@/lib/rbac'
import {
  approvalPromptLine, finishRun, markRouterRetry, parseApprovalMode, publishRunEvent, recordStep, runMeta, citedRefs, startRun, subscribeRun, type ApprovalMode, type GideonRef, type RunEvent,
} from '@/lib/gideon-runs'
import { datePromptLine } from '@/lib/gideon-dates'
import { resolveGideonChat, gatherContext, personalPromptLines, projectDigest, touchGideonChat, type GideonContextRef } from '@/lib/gideon-assistant'
import { searchWorkspace } from '@/lib/workspace-search'
import { creditNotice, decideTier, parseShimUsage, recordGideonUsage, type ShimUsage } from '@/lib/gideon-credits'
import { getTierStatus, tierUnavailableText } from '@/lib/gideon-tier-status'
import { fetchShim, shimFailureKind, SHIM_RESTART, SHIM_RESTART_TEXT } from '@/lib/gideon-shim-retry'
import { buildGideonPrompt, DEFAULT_HISTORY_MODE, HISTORY_MODES, type HistoryMode } from '@/lib/gideon-history'
import { dropRunQuestion, MEMORY_RULES, memoryFeatureOn, memoryPromptLines, parkRunQuestion, suggestMemoryFromQuestion } from '@/lib/gideon-memory'

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

// The prompt builder (cache order, long-history compaction, the person's standing rules) is pure and lives in
// src/lib/gideon-history.ts so it can be unit-tested; only the AppSetting lookup stays here.
/**
 * Which history shape to use: AppSetting "gideon-history" { mode } overrides the default (tests), else facts.
 * { standing: false } turns off the pinned block of the person's standing rules (kill switch; default on).
 */
async function historyOptions(): Promise<{ historyMode: HistoryMode; standingRules: boolean }> {
  const v = await getAppSetting<{ mode?: string; standing?: boolean }>("gideon-history").catch(() => null)
  return {
    historyMode: v?.mode && HISTORY_MODES.has(v.mode as HistoryMode) ? (v.mode as HistoryMode) : DEFAULT_HISTORY_MODE,
    standingRules: v?.standing !== false,
  }
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

  const { messages, model, image, file, stream: wantsStream, approvalMode: rawMode, context, chatId: rawChatId, newChat, search: wantsSearch, uiLang: rawUiLang } = (await req.json()) as {
    messages: { role: string; content: string }[]
    /**
     * The conversation (GideonChat, 12 Oct 2026). Absent = the person's most recent chat (what released
     * iOS / Android get: they keep one running conversation). `newChat: true` = start a new one.
     */
    chatId?: string
    newChat?: boolean
    /** Workspace Q&A: search what the person can see before answering, and cite it. Default on for `stream` clients. */
    search?: boolean
    /** The interface language of the client, "en" | "id" (12 Oct 2026, web). Absent = answer in the question's language. */
    uiLang?: string
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
  const requestedTier = TIERS.includes((model || '').toLowerCase()) ? (model as string).toLowerCase() : 'luna'
  const userId = session.user.id
  // GIDEON credits phase 2 (remote config gideonCreditsEnforced, default off): out of credits → GIDEON
  // Aphrodite answers instead (max 30 a day), then a refusal. Off = always the tier the person picked.
  const decision = await decideTier(userId, requestedTier).catch(() => ({ tier: requestedTier, fallback: false, blocked: false, summary: null }))
  const tier = decision.tier
  const uiLang = rawUiLang === 'en' ? 'en' : 'id'
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
    // Out of credits including the backup answers (phase 2 only): nothing is sent to the model.
    if (decision.blocked) {
      const notice = creditNotice('blocked', decision.summary)
      if (streamClient) {
        await sendEvent({ type: 'credits', summary: decision.summary, notice: { kind: 'blocked', ...notice } })
        await sendEvent({ type: 'error', content: notice[uiLang], code: 'credits_exhausted' })
      } else {
        await sendEvent({ type: 'text', content: notice[uiLang] })
      }
      await sendEvent({ type: 'done' })
      await writer.close().catch(() => {})
      return
    }
    // GIDEON Model 0 away (18 Oct 2026): the office GPU is transcribing a meeting, or Model 0 is loading again. Refused
    // at once with a reason (never a silent hang until the shim's 7-minute timeout); stream clients also get
    // `tier_unavailable` so they can offer GIDEON Phaëthon. Nothing is sent to the model, nothing is billed.
    if (tier === 'experimental') {
      const exp = (await getTierStatus().catch(() => null))?.experimental
      if (exp && !exp.available) {
        const txt = tierUnavailableText(exp.reason)
        if (streamClient) {
          await sendEvent({ type: 'tier_unavailable', tier: 'experimental', reason: exp.reason, since: exp.since, fallback: 'luna', label: txt.label, message: txt.send })
          await sendEvent({ type: 'error', content: txt.send[uiLang], code: 'model0_unavailable' })
        } else {
          await sendEvent({ type: 'text', content: txt.send[uiLang] })
        }
        await sendEvent({ type: 'done' })
        await writer.close().catch(() => {})
        return
      }
    }
    const fallbackNotice = decision.fallback ? creditNotice('fallback', decision.summary) : null
    if (fallbackNotice && streamClient) await sendEvent({ type: 'credits', summary: decision.summary, notice: { kind: 'fallback', ...fallbackNotice } })
    const runId = await startRun({
      userId,
      trigger: 'CHAT',
      approvalMode,
      tier,
      title: asked.split('\n')[0] || null,
      projectId: ctx?.projectId ?? null,
      taskId: ctx?.taskId ?? null,
    })
    // GIDEON Memory (19 Oct 2026): the tools route decides "did the PERSON ask to remember this?" from what they wrote.
    parkRunQuestion(runId, asked, chat?.id ?? null)
    // Steps, sources, cards and proposals raised by /api/gideon/tools while this run is going.
    // Old clients get none of them (they would not know what to draw).
    const unsubscribe = runId && streamClient ? subscribeRun(runId, (ev: RunEvent) => { void sendEvent(ev as unknown as Record<string, unknown>).catch(() => {}) }) : () => {}
    let reply = ''
    let failure: string | null = null
    let tokens: number | null = null
    // What the run cost, as the shim read it back from Hermes' state.db (GIDEON credits, 18 Oct 2026).
    let usage: ShimUsage | null = null
    // Which shim URL this answer went to, and when (a broken connection is checked against its /health: restart or not).
    let shimUrlUsed: string | null = null
    let shimSince = 0
    try {
      if (runId) await sendEvent({ type: 'run', id: runId })
      // No run = no approval mode the tools can check, and the tools then write with no card at all. Fail closed
      // (19 Oct 2026 privacy gate): the person sends the message again.
      if (!runId) {
        failure = 'no run'
        await sendEvent({ type: 'error', content: uiLang === 'en' ? 'GIDEON could not start this answer. Please send it again.' : 'GIDEON gagal memulai jawaban ini. Coba kirim lagi.' })
        return
      }
      const url = process.env.GIDEON_CHAT_URL
      if (!url) {
        failure = 'not configured'
        await sendEvent({ type: 'error', content: 'Gideon belum tersambung ke gateway Hermes.' })
        return
      }
      // Workspace Q&A: what the person can see that matches the question, searched BEFORE the model answers so
      // the answer stands on real records (and cites them) instead of a guess. Skipped for a file question.
      const searchLines: string[] = []
      // The attached project (the page GIDEON was opened from, or a project chip) is the PRIMARY scope
      // (owner, 12 Oct 2026): its digest is read here with the asker's access and the pre-search stays
      // inside it, so "ada task apa aja?" answers about that project, not whatever the whole workspace
      // search matched first.
      const scopeProjectId = ctx?.projectId ?? gathered.refs.find((r) => r.kind === 'project')?.id ?? null
      const scopeLines: string[] = []
      if (scopeProjectId && !ctx?.taskId) {
        const started = Date.now()
        const digest = await projectDigest(userId, scopeProjectId).catch(() => null)
        if (digest) {
          scopeLines.push(...digest.lines)
          if (runId) {
            const stepId = `ctx${Date.now().toString(36)}`
            publishRunEvent(runId, { type: 'step', step: { id: stepId, tool: 'read_context', arg: digest.name.slice(0, 80), label: `Reading ${digest.name}`, status: 'done' } })
            await recordStep(runId, { tool: 'read_context', arg: digest.name.slice(0, 80), ok: true, durationMs: Date.now() - started })
          }
        }
      }
      // The pre-search hits are offered to the model; only the ones its answer actually names become Sources.
      let preSearch: { stepId: string | null; refs: GideonRef[] } | null = null
      // Not for small talk ("halo", "makasih"): eight search hits about nothing were the biggest part of its bill.
      // Every word must be small talk ("halo gideon, apa kabar?"), so "halo, progress project X?" still searches.
      const SMALL_TALK = new Set(['halo', 'hallo', 'hai', 'hi', 'hello', 'hey', 'pagi', 'siang', 'sore', 'malam', 'selamat', 'makasih', 'thanks', 'thank', 'you', 'terima', 'kasih', 'ok', 'oke', 'okay', 'sip', 'mantap', 'gideon', 'ya', 'yah', 'kak', 'bro', 'apa', 'kabar', 'gimana', 'baik', 'banyak', 'dong', 'deh', 'nih', 'good', 'morning', 'how', 'are', 'test', 'tes'])
      const askedWords = asked.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
      const smallTalk = askedWords.length > 0 && askedWords.length <= 6 && askedWords.every((w) => SMALL_TALK.has(w))
      if (streamClient && wantsSearch !== false && asked && !smallTalk && !documentBase64 && !imageBase64) {
        const started = Date.now()
        try {
          const { hits } = await searchWorkspace(userId, asked, { limit: 8, ...(scopeProjectId ? { projectId: scopeProjectId } : {}) })
          if (hits.length) {
            searchLines.push('[HASIL PENCARIAN NEXUS — hanya yang boleh dilihat orang ini] Pakai ini sebagai sumber; sebut judulnya persis saat dipakai. Excerpt hanya potongan pendek isi/deskripsi: untuk merangkum dokumen atau menjelaskan isi task, baca dulu lengkapnya (nexus_get_doc / nexus_get_task); jangan menyimpulkan PIC, status atau isi dari excerpt. Kalau tidak menjawab pertanyaannya, panggil nexus_search_workspace / tool lain dengan kata kunci lain. Jangan mengarang data yang tidak ada.')
            // Task hits carry their status, PIC and due date (18 Oct 2026): a cheap tier answered "who has task X" from
            // the description excerpt and named the description as the person.
            const taskIds = hits.filter((h) => h.kind === 'task').map((h) => h.id)
            const taskFacts = new Map<string, string>()
            if (taskIds.length) {
              const rows = await prisma.task.findMany({
                where: { id: { in: taskIds } },
                select: { id: true, status: true, dueDate: true, taskList: { select: { name: true } }, assignees: { select: { user: { select: { name: true } } } } },
              }).catch(() => [])
              for (const t of rows) {
                const who = t.assignees.map((a) => a.user.name).filter(Boolean).join(', ')
                const due = t.dueDate ? new Date(t.dueDate.getTime() + 7 * 3600e3).toISOString().slice(0, 10) : null
                taskFacts.set(t.id, `status: ${t.taskList?.name || t.status}; PIC: ${who || 'belum ada'}${due ? `; tenggat ${due}` : ''}`)
              }
            }
            hits.forEach((h, i) => searchLines.push(`${i + 1}. [${h.kind}] "${h.title}"${h.projectName ? ` (project ${h.projectName})` : ''}${taskFacts.has(h.id) ? ` [${taskFacts.get(h.id)}]` : ''} — excerpt: ${h.excerpt || '—'} (id ${h.id})`))
            const refs: GideonRef[] = hits.map((h) => ({ kind: h.kind, id: h.id, title: h.title, projectId: h.projectId ?? null, url: h.url, excerpt: h.excerpt || null }))
            if (runId && !scopeProjectId) {
              const stepId = `ws${Date.now().toString(36)}`
              publishRunEvent(runId, { type: 'step', step: { id: stepId, tool: 'search_workspace', arg: asked.slice(0, 80), label: 'Searching the workspace', status: 'done' } })
              preSearch = { stepId: await recordStep(runId, { tool: 'search_workspace', arg: asked.slice(0, 80), ok: true, durationMs: Date.now() - started }), refs }
            } else if (runId) {
              // Searched inside the attached project only: no separate "workspace" step; the read step covers it.
              preSearch = { stepId: null, refs }
            }
          }
        } catch (error) {
          console.error('GIDEON pre-search failed:', error)
        }
      }
      const prefsLines = await personalPromptLines(userId, session.user?.name || '').catch(() => [] as string[])
      // GIDEON Memory (owner, 19 Oct 2026): THIS person's own memories only, after who-is-asking (cached prefix).
      // Kill switch (remote config flags.gideonMemory): off = no memory rules, nothing remembered is used.
      const memoryOn = await memoryFeatureOn()
      const memory = memoryOn
        ? await memoryPromptLines(userId, session.user?.name || '', { tier }).catch(() => ({ personal: [] as string[], dynamic: [] as string[] }))
        : { personal: [] as string[], dynamic: [] as string[] }
      // Static first (same text for every person and turn of this client/language/mode), dynamic last: see buildGideonPrompt.
      const rules = [
        // Only for a client that renders Markdown; the released apps show the text as is.
        streamClient ? '[FORMAT] Jawab dalam Markdown yang ringkas: paragraf pendek, daftar berpoin bila perlu, **tebal** seperlunya. Sebut task, project dan dokumen dengan nama persisnya. Tanpa tabel lebar. JANGAN tampilkan id apa pun (taskId, projectId, cuid/uuid, juga tidak dalam `code` atau kurung) dan JANGAN tampilkan nilai enum (TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED, URGENT, HIGH, MEDIUM, LOW, NONE): pakai nama kolom/status yang wajar (To do / In progress / In review / Done / Cancelled; prioritas Urgent / High / Medium / Low) dalam bahasa jawabanmu. Judul yang kamu sebut otomatis jadi tautan dan masuk Sources — sebut hanya yang benar-benar kamu pakai.' : '',
        rawUiLang === 'en'
          ? '[BAHASA ANTARMUKA] English. Reply in the language the person wrote their message in (Indonesian question → Indonesian answer). Use English only when the message language is unclear (a name, a link, an emoji). Titles stay as they are.'
          : rawUiLang === 'id'
            ? '[BAHASA ANTARMUKA] Bahasa Indonesia. Balas dalam bahasa yang dipakai di pesannya (pertanyaan berbahasa Inggris → jawab bahasa Inggris). Pakai bahasa Indonesia hanya kalau bahasa pesannya tidak jelas (cuma nama, tautan, emoji). Judul tetap apa adanya.'
            : '',
        approvalPromptLine(approvalMode),
        memoryOn ? MEMORY_RULES : '',
      ].filter(Boolean)
      const dynamic = [
        // Today's date and the weekday rule ("due Friday" said on a Friday = next week's), 16 Oct 2026.
        datePromptLine(new Date(), rawUiLang === 'en' ? 'en' : 'id'),
        ...gathered.lines,
        ...scopeLines,
        ...searchLines,
        ctx
          ? (ctx.taskId
            ? `[KONTEKS HALAMAN] ${session.user?.name || 'Dia'} membuka GIDEON dari task "${ctx.taskTitle}" (taskId: ${ctx.taskId}) di project "${ctx.projectName}" (projectId: ${ctx.projectId}). Kalau pertanyaannya tidak menyebut hal lain, anggap tentang task ini.`
            : `[KONTEKS HALAMAN] ${session.user?.name || 'Dia'} membuka GIDEON dari project "${ctx.projectName}" (projectId: ${ctx.projectId}). Ini CAKUPAN UTAMA: "project ini", "ini", "di sini", "task apa aja/apa saja", "yang belum selesai", "siapa yang pegang" dan pertanyaan tanpa nama project lain SELALU tentang "${ctx.projectName}" — jawab dari [KONTEKS UTAMA] di atas (task terbuka dulu, ringkas kalau banyak: kelompokkan per kolom/tenggat). Cari di project lain HANYA kalau pertanyaannya jelas menyebut project/task lain. Pertanyaan bisa salah ketik (mis. "aka" = "aja"): pahami maksudnya, jangan dijadikan kata kunci.`)
          : scopeProjectId
            ? `[KONTEKS LAMPIRAN] Project terlampir di [KONTEKS UTAMA] adalah cakupan utama pertanyaan ini; cari di tempat lain hanya kalau pertanyaannya jelas menyebut hal lain. Pertanyaan bisa salah ketik: pahami maksudnya.`
            : '',
      ].filter(Boolean)
      const prompt = buildGideonPrompt(messages, { name: session.user?.name || '', email: session.user?.email || '' }, { rules, personal: [...prefsLines, ...memory.personal], dynamic: [...dynamic, ...memory.dynamic], ...(await historyOptions()) })
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
      // The shim says Model 0 can't be reached (503 / "model0_unavailable", 18 Oct 2026): the GPU went to a meeting
      // transcript between the tier check above and this call. Said plainly, with the switch offer, never "error 503".
      const model0Refused = async () => {
        const txt = tierUnavailableText('transcribing')
        failure = 'model0_unavailable'
        if (streamClient) {
          await sendEvent({ type: 'tier_unavailable', tier: 'experimental', reason: null, since: null, fallback: 'luna', label: txt.label, message: txt.send })
          await sendEvent({ type: 'error', content: txt.send[uiLang], code: 'model0_unavailable' })
        } else {
          await sendEvent({ type: 'text', content: txt.send[uiLang] })
        }
      }
      // The shim restarted under this answer (18 Oct 2026, lib/gideon-shim-retry.ts): recorded as `shim_restart`, which
      // the Performance panel does not count as a model error, and said as what it is.
      const shimRestarted = async () => {
        failure = SHIM_RESTART
        await sendEvent({ type: 'error', content: SHIM_RESTART_TEXT[uiLang], code: SHIM_RESTART })
      }
      const timeoutMs = tier === 'experimental' ? 440000 : 150000
      // Token-by-token when the shim offers it (GIDEON_STREAM_URL) and there is no document: the
      // streaming runner reads images but has no document reader.
      const streamUrl = process.env.GIDEON_STREAM_URL
      if (streamUrl && !documentBase64) {
        shimUrlUsed = streamUrl
        shimSince = Date.now()
        // One quiet retry when the shim is restarting / unreachable before anything ran.
        const shim = await fetchShim(streamUrl, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(timeoutMs) }, { stream: true })
        const res = shim.res
        if (shim.restarting) { await shimRestarted(); return }
        if (tier === 'experimental' && res.status === 503) { await model0Refused(); return }
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
            } else if (ev.t === 'router_miss') {
              // The runner retried with every tool (18 Oct 2026): counted on Control Room › GIDEON › Performance.
              void markRouterRetry(runId)
            } else if (ev.t === 'usage') {
              usage = parseShimUsage((ev as { usage?: unknown }).usage)
            } else if (ev.t === 'error') {
              upstreamError = String(ev.c || 'failed').slice(0, 300)
            }
          }
        }
        if (!reply && upstreamError === 'model0_unavailable') { await model0Refused(); return }
        // The shim's drain cap stopped this run during a restart.
        if (!reply && upstreamError === SHIM_RESTART) { await shimRestarted(); return }
        if (!reply && upstreamError) failure = upstreamError
      } else {
        shimUrlUsed = url
        shimSince = Date.now()
        const shim = await fetchShim(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(timeoutMs) }, { stream: false })
        const res = shim.res
        if (shim.restarting) { await shimRestarted(); return }
        if (tier === 'experimental' && res.status === 503) { await model0Refused(); return }
        if (!res.ok) {
          failure = `shim ${res.status}`
          await sendEvent({ type: 'error', content: res.status === 415 ? 'Dokumen belum bisa dibaca GIDEON di server ini.' : `Gideon error (${res.status}).` })
          return
        }
        const data = (await res.json()) as { reply?: string; usage?: unknown }
        reply = (data.reply || '').trim()
        usage = parseShimUsage(data.usage)
      }
      // Hermes gives up on a model call and hands back its own error text as the "answer" (seen on Model 0 after
      // long tool rounds: "API call failed after 3 retries: HTTP 500: {…Jinja…}", QA final 19 Oct E-8). Never shown
      // to the person or stored as a turn: it is an error, said plainly.
      if (/^API call failed after \d+ retr/i.test(reply)) {
        failure = `upstream: ${reply.slice(0, 200)}`
        reply = ''
        // What the model calls before the failure used is still billed, like any failed run below.
        if (usage && runId) await recordGideonUsage({ userId, runId, trigger: 'CHAT', tier, requestedTier, fallback: decision.fallback, usage }).catch(() => null)
        if (streamClient) await sendEvent({ type: 'reset' })
        await sendEvent({
          type: 'error',
          content: tier === 'experimental'
            ? (uiLang === 'en' ? "GIDEON Model 0 couldn't finish this answer. Try again, or switch to GIDEON Phaëthon." : 'GIDEON Model 0 tidak bisa menyelesaikan jawaban ini. Coba lagi, atau pakai GIDEON Phaëthon.')
            : (uiLang === 'en' ? "GIDEON couldn't finish this answer. Try again." : 'GIDEON tidak bisa menyelesaikan jawaban ini. Coba lagi.'),
        })
        return
      }
      if (!reply) failure = failure || 'empty reply'
      if (reply && preSearch && runId) {
        const used = citedRefs(reply, preSearch.refs)
        if (used.length) {
          await sendEvent({ type: 'sources', sources: used })
          if (preSearch.stepId) await prisma.gideonRunStep.update({ where: { id: preSearch.stepId }, data: { refs: used as unknown as InputJsonValue } }).catch(() => {})
        }
      }
      // GIDEON Memory safety net (Model 0 rarely calls tools): a stated preference / "inget ya" with no memory tool call
      // becomes a Save / Don't save suggestion from the person's own words. Before runMeta, so the turn stores it.
      if (reply && runId && asked && tier === 'experimental' && memoryOn) {
        const suggested = await suggestMemoryFromQuestion(userId, asked, runId, chat?.id ?? null).catch(() => null)
        if (suggested && streamClient) await sendEvent({ type: 'memory', memory: suggested })
      }
      // What the run showed, with Sources cut down to what the reply cites (stored on the turn below too).
      const meta = reply && runId ? await runMeta(runId, { citedBy: reply }).catch(() => null) : null
      // Additive event (12 Oct 2026): the final Sources list, replacing the `sources` streamed while tools ran.
      // Clients that do not know it ignore it (released apps never get any of these).
      if (meta && streamClient) await sendEvent({ type: 'cited', sources: meta.sources })
      // Billed before the answer is closed, so the meter under the composer moves with the answer (the
      // socket `gideon-credits` carries the same summary to the person's other tabs and devices).
      // A run that failed after using the model still cost what it cost, so it is billed too.
      if (usage && runId) {
        const billed = await recordGideonUsage({ userId, runId, trigger: 'CHAT', tier, requestedTier, fallback: decision.fallback, usage })
        if (billed?.summary && streamClient) await sendEvent({ type: 'credits', summary: billed.summary, credits: billed.credits })
      }
      const finalText = reply || '(Gideon balas kosong — coba ulang.)'
      // Released apps draw no notice: the backup answer says so in its first line instead.
      const legacyText = fallbackNotice && reply ? `${fallbackNotice[uiLang]}\n\n${finalText}` : finalText
      await sendEvent(streamClient ? { type: 'final', content: finalText } : { type: 'text', content: legacyText })

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
      // A connection the shim broke by restarting (deploy, config change) is `shim_restart`, not a model error.
      failure = failure || (shimUrlUsed ? await shimFailureKind(error, shimUrlUsed, shimSince).catch(() => (error instanceof Error ? error.message : 'error')) : (error instanceof Error ? error.message : 'error'))
      await sendEvent(failure === SHIM_RESTART
        ? { type: 'error', content: SHIM_RESTART_TEXT[uiLang], code: SHIM_RESTART }
        : { type: 'error', content: 'Gideon lagi gak bisa dihubungi. Coba lagi bentar ya.' })
    } finally {
      unsubscribe()
      dropRunQuestion(runId)
      await finishRun(runId, { ok: !failure && Boolean(reply), error: failure, replyChars: reply.length || null, tokens, usage })
      await sendEvent({ type: 'done' })
      await writer.close().catch(() => {})
    }
  })()

  // No `Connection` header here: it is hop-by-hop and Node decides it. Forcing `keep-alive` overrode the
  // `Connection: close` nginx sends upstream, Node kept the socket, nginx (1.31 pools upstream connections
  // by default) reused it for the next request, and Node answered that one `400 Bad Request` ("data after
  // Connection: close"). Seen 18 Oct 2026 as a 400 on the request right after every GIDEON answer.
  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' },
  })
}

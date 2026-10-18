export const dynamic = "force-dynamic"

import { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { checkProjectAccess } from "@/lib/rbac"
import { canReadTask } from "@/lib/read-access"
import { finishRun, startRun } from "@/lib/gideon-runs"
import { streamShim } from "@/lib/gideon-stream"
import { markdownToTipTap } from "@/lib/tiptap-utils"
import { sanitizeDoc } from "@/lib/blockdoc"
import { parseActionItems, writePrompt, WRITE_ACTIONS, type WriteAction } from "@/lib/gideon-write"

/**
 * "Ask AI" inside the block editor (owner, 12 Oct 2026 — Notion AI parity): improve writing, fix spelling &
 * grammar, shorter / longer, change tone, summarise, translate, continue writing, explain, extract action
 * items, or a free instruction. The text comes from the person's own editor; GIDEON only rewrites it.
 *
 * POST { action, text, context?, docTitle?, tone?, language?, prompt?, docId?, taskId?, projectId? }
 * → SSE: { type: "run", id } · { type: "delta", content } · { type: "reset" } ·
 *        { type: "final", content, doc, items? } · { type: "error", content } · { type: "done" }
 * `doc` is the answer as editor JSON (paragraphs, headings, lists), ready for Replace / Insert below.
 * `items` (action_items only): [{ title, due?, owner? }] for "Create tasks" (each task is still created
 * by the person through the normal task API — that click is the approval).
 */
const PER_HOUR = 60

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  const userId = session.user.id
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action || "") as WriteAction
  if (!WRITE_ACTIONS.includes(action)) return Response.json({ error: "Unknown action" }, { status: 400 })
  const text = typeof body.text === "string" ? body.text.slice(0, 12000) : ""
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1000) : ""
  if (!text.trim() && action !== "continue" && !(action === "custom" && prompt)) return Response.json({ error: "Select some text first" }, { status: 400 })
  if (action === "custom" && !prompt) return Response.json({ error: "Tell GIDEON what to do" }, { status: 400 })

  const recent = await prisma.gideonRun.count({ where: { userId, trigger: "WRITE", startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } })
  if (recent >= PER_HOUR) return Response.json({ error: "That's a lot of AI edits in an hour. Try again a little later.", code: "rate_limited" }, { status: 429 })

  // The page it was asked from, for the run log only — and only if the person can open it.
  let projectId: string | null = null
  let taskId: string | null = null
  try {
    if (typeof body.taskId === "string" && (await canReadTask(userId, body.taskId)) === "ok") {
      taskId = body.taskId
      projectId = (await prisma.task.findUnique({ where: { id: taskId }, select: { taskList: { select: { projectId: true } } } }))?.taskList?.projectId ?? null
    } else if (typeof body.docId === "string") {
      const d = await prisma.doc.findUnique({ where: { id: body.docId }, select: { projectId: true } })
      if (d?.projectId && (await checkProjectAccess(userId, d.projectId, ["VIEWER"])).allowed) projectId = d.projectId
    }
  } catch { /* the log is a convenience */ }

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  let gone = false
  const send = async (data: Record<string, unknown>) => {
    if (gone) return
    try { await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { gone = true }
  }

  ;(async () => {
    const runId = await startRun({ userId, trigger: "WRITE", approvalMode: "always_ask", tier: "luna", title: `AI: ${action}${prompt ? ` · ${prompt}` : ""}`, projectId, taskId })
    let failure: string | null = null
    let reply = ""
    // What the run cost (GIDEON credits); billed by finishRun.
    let usage: unknown = undefined
    try {
      if (runId) await send({ type: "run", id: runId })
      const full = writePrompt({
        action,
        text,
        context: typeof body.context === "string" ? body.context.slice(0, 4000) : "",
        docTitle: typeof body.docTitle === "string" ? body.docTitle.slice(0, 200) : "",
        tone: typeof body.tone === "string" ? body.tone.slice(0, 40) : "",
        language: body.language === "en" || body.language === "id" ? body.language : null,
        prompt,
        person: session.user?.name || "",
      })
      let acc = ""
      const result = await streamShim(
        { prompt: full, model: "luna", user: session.user?.name || "", actorEmail: session.user?.email || userId, ...(runId ? { runId } : {}) },
        {
          onDelta: async (c) => { acc += c; await send({ type: "delta", content: c }) },
          onReset: async () => { acc = ""; await send({ type: "reset" }) },
        },
      )
      reply = (result.reply || acc).trim()
      failure = result.error
      usage = result.usage
      if (!reply) {
        await send({ type: "error", content: failure === "not configured" ? "GIDEON isn't connected on this server." : "GIDEON couldn't write that. Try again." })
        return
      }
      await send({
        type: "final",
        content: reply,
        doc: sanitizeDoc(markdownToTipTap(reply)),
        ...(action === "action_items" ? { items: parseActionItems(reply) } : {}),
      })
    } catch (error) {
      failure = error instanceof Error ? error.message : "error"
      await send({ type: "error", content: "GIDEON can't be reached right now. Try again in a moment." })
    } finally {
      await finishRun(runId, { ok: !failure && Boolean(reply), error: failure, replyChars: reply.length || null, usage })
      await send({ type: "done" })
      await writer.close().catch(() => {})
    }
  })()

  // No `Connection` header: hop-by-hop, Node owns it (see the note in ../route.ts: forcing keep-alive made
  // the next request on the proxied connection fail with 400).
  return new Response(stream.readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } })
}

import prisma from "@/lib/prisma"
import { finishRun, startRun, type ApprovalMode, type GideonTrigger } from "@/lib/gideon-runs"

/**
 * One door to GIDEON for server-side jobs: the Hermes shim behind GIDEON_CHAT_URL.
 *
 * Extracted from gideon-ticket.ts so that reflections (and whatever comes next) go through the
 * same chain with the same secret, the same model tier and the same "empty reply means the agent
 * failed" reading — never a direct provider key.
 */
export async function askGideon(input: {
  prompt: string
  /** Display name of the person this is about; the shim uses it for addressing. */
  user?: string
  /** GIDEON acts with this person's visibility, never more. */
  actorEmail?: string
  model?: "luna" | "experimental"
  timeoutMs?: number
  /** Appears in the log line when the shim refuses or answers empty. */
  tag?: string
  /** What started this, for the run log (Control Room › GIDEON › Insights). Default REFLECTION. */
  trigger?: GideonTrigger
  /** Which writes wait for approval (gideon-runs.ts needsApproval). Default dont_ask. */
  approvalMode?: ApprovalMode
  /** Run-log scope: the project this is about (leads see their projects' runs). */
  projectId?: string
  taskId?: string
  scheduleId?: string
  /** Run-log title. */
  title?: string
  /**
   * The prompt carries attendance (a check-out reflection, a ticket about a day). Refused outright on a
   * server where GIDEON must never see attendance (NEXUS_GIDEON_NO_ATTENDANCE=1 — the dev server).
   */
  touchesAttendance?: boolean
  /** Receives the run id as soon as it exists (callers that link the reply to the run). */
  onRun?: (runId: string | null) => void
}): Promise<string | null> {
  const url = process.env.GIDEON_CHAT_URL
  const secret = process.env.ORACLE_LLM_SECRET || ""
  if (!url) return null
  if (input.touchesAttendance && process.env.NEXUS_GIDEON_NO_ATTENDANCE === "1") return null

  // The actor as a user id, for the run log (the shim wants the email, the log wants the id).
  let userId: string | null = null
  if (input.actorEmail) {
    const u = await prisma.user
      .findFirst({ where: input.actorEmail.includes("@") ? { email: input.actorEmail } : { id: input.actorEmail }, select: { id: true } })
      .catch(() => null)
    userId = u?.id ?? null
  }
  const runId = await startRun({
    userId,
    trigger: input.trigger ?? "REFLECTION",
    approvalMode: input.approvalMode ?? "dont_ask",
    tier: input.model ?? "luna",
    title: input.title ?? input.tag ?? null,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    scheduleId: input.scheduleId ?? null,
  })
  input.onRun?.(runId)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-oracle-secret": secret },
      body: JSON.stringify({
        prompt: input.prompt,
        model: input.model ?? "luna",
        user: input.user ?? "",
        actorEmail: input.actorEmail ?? "",
        ...(runId ? { runId } : {}),
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 240_000),
    })
    if (!res.ok) {
      console.error(`gideon-chat: shim refused (${input.tag ?? "untagged"})`, { status: res.status })
      await finishRun(runId, { ok: false, error: `shim ${res.status}` })
      return null
    }
    const reply = ((await res.json()) as { reply?: string }).reply?.trim()
    if (!reply) {
      console.error(`gideon-chat: balasan kosong dari shim (${input.tag ?? "untagged"}) — agen Hermes kemungkinan gagal (cek journal gideon-shim di VM agents)`)
      await finishRun(runId, { ok: false, error: "empty reply" })
      return null
    }
    await finishRun(runId, { ok: true, replyChars: reply.length })
    return reply
  } catch (error) {
    await finishRun(runId, { ok: false, error: error instanceof Error ? error.message : "error" })
    throw error
  }
}

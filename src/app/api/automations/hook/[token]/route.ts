export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { runAutomationNow } from "@/lib/automation-engine"
import { normalizeTrigger } from "@/lib/automation-rules"
import { checkRateLimitByKey, trustedClientIp } from "@/lib/rate-limit"

/**
 * POST /api/automations/hook/<token> — the inbound webhook of a "Webhook received" automation (12 Oct 2026).
 *
 * No session: the token in the path IS the credential (24 random bytes, shown only to people who manage
 * the project, regenerable). The JSON body is handed to the actions as {payload.*}; `title` names a task to
 * create and `taskId` (a task of the same project) makes task actions act on it. 30 calls a minute per
 * automation and per IP; bodies over 64 KB are refused.
 */
const MAX_BODY = 64 * 1024

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    if (!token || token.length < 20) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const ip = trustedClientIp(req)
    if (!checkRateLimitByKey("automation-hook-ip", ip, { limit: 60, windowSeconds: 60 }).allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }
    const automation = await prisma.automation.findUnique({ where: { webhookToken: token }, select: { id: true, enabled: true, projectId: true, trigger: true } })
    if (!automation || normalizeTrigger(automation.trigger)?.type !== "WEBHOOK_RECEIVED") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (!automation.enabled) return NextResponse.json({ error: "This automation is turned off" }, { status: 409 })
    if (!checkRateLimitByKey("automation-hook", automation.id, { limit: 30, windowSeconds: 60 }).allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const text = await req.text()
    if (text.length > MAX_BODY) return NextResponse.json({ error: "Body too large" }, { status: 413 })
    let payload: unknown = {}
    if (text.trim()) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { text }
      }
    }
    let taskId: string | undefined
    const rawTaskId = payload && typeof payload === "object" ? (payload as { taskId?: unknown }).taskId : undefined
    if (typeof rawTaskId === "string" && rawTaskId) {
      const task = await prisma.task.findFirst({ where: { id: rawTaskId, taskList: { projectId: automation.projectId } }, select: { id: true } })
      if (!task) return NextResponse.json({ error: "taskId is not a task of this project" }, { status: 404 })
      taskId = task.id
    }
    const run = await runAutomationNow(automation.id, { kind: "webhook", actorId: null, taskId, payload })
    return NextResponse.json({ ok: true, runId: run?.runId ?? null, status: run?.status ?? "SKIPPED" })
  } catch (error) {
    console.error("Error in automation webhook:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

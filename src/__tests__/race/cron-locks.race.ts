import { afterAll, describe, expect, it, vi } from "vitest"
import { statusesOf } from "./world"

// Race audit 16 Oct 2026, PR 3 (fix/cron-locks): lib/cron-lock.ts itself — one run per job at a time
// across processes (a dedicated connection holds the lock), and the leader gate.

process.env.CRON_SECRET = "race-cron-secret"
vi.mock("@/lib/auth", async () => (await import("./world")).authMock)

import prisma from "@/lib/prisma"
import { runCronJob, withCronLock } from "@/lib/cron-lock"
import { NextResponse } from "next/server"

afterAll(async () => { await prisma.$disconnect() })

const leader = (on: boolean) => { if (on) process.env.NEXUS_SINGLETON_LOCK = "0"; else delete process.env.NEXUS_SINGLETON_LOCK }

describe("withCronLock", () => {
  it("three overlapping runs of one job: one runs, two are skipped; another job is not blocked", async () => {
    leader(true)
    let running = 0
    let maxRunning = 0
    let ran = 0
    const job = async () => {
      running++; ran++; maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 300))
      running--
      return NextResponse.json({ ok: true })
    }
    const [a, b, c, other] = await Promise.all([
      runCronJob("race-job", { fromCron: true }, job),
      runCronJob("race-job", { fromCron: true }, job),
      runCronJob("race-job", { fromCron: true }, job),
      withCronLock("race-other-job", async () => "other"),
    ])
    const bodies = (await statusesOf([a, b, c])).map((o) => o.body)
    console.log("[race] M22 overlapping runs:", bodies.map((x) => x.skipped ?? "ran"), "max at once", maxRunning)
    expect(ran).toBe(1)
    expect(maxRunning).toBe(1)
    expect(bodies.filter((x) => x.skipped === "already_running")).toHaveLength(2)
    expect(other).toEqual({ ran: true, value: "other" })
    // Released afterwards: the next tick runs.
    expect((await withCronLock("race-job", async () => 1)).ran).toBe(true)
  })

  it("a cron call on a slot that is not the singleton leader is skipped with 200", async () => {
    leader(false) // the election never started in this process, so it never leads
    let ran = 0
    const res = await runCronJob("race-job-2", { fromCron: true }, async () => { ran++; return NextResponse.json({ ok: true }) })
    const body = await res.json()
    console.log("[race] M22 not leader:", res.status, body)
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, skipped: "not_leader" })
    expect(ran).toBe(0)
    // A signed-in BoD's run-now is not leader-gated, only locked.
    const manual = await runCronJob("race-job-2", { fromCron: false }, async () => { ran++; return NextResponse.json({ ok: true }) })
    expect(manual.status).toBe(200)
    expect(ran).toBe(1)
    leader(true)
  }, 20_000)
})

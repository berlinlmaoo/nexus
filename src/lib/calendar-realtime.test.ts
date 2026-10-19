import { describe, expect, it, vi } from "vitest"
import { createCalendarPinger } from "@/lib/calendar-realtime"

describe("calendar-changed (B-12)", () => {
  const make = () => {
    const sent: unknown[] = []
    const lookups: string[] = []
    const p = createCalendarPinger({
      companyWorkspaceId: "org",
      emit: (x) => sent.push(x),
      workspaceOf: async (id) => { lookups.push(id); return id.startsWith("org-") ? "org" : "personal" },
      delayMs: 10,
    })
    return { p, sent, lookups }
  }

  it("folds a burst of company task changes into one ping", async () => {
    vi.useFakeTimers()
    const { p, sent, lookups } = make()
    await p.task("org-p1"); await p.task("org-p1"); await p.task("org-p2")
    p.workspace("org", "bookings", "u1")
    vi.advanceTimersByTime(20)
    expect(sent).toEqual([{ kinds: ["bookings", "tasks"], actorId: null }])
    expect(lookups).toEqual(["org-p1", "org-p2"])
    vi.useRealTimers()
  })

  it("ignores personal workspaces and unrelated kinds", async () => {
    vi.useFakeTimers()
    const { p, sent } = make()
    await p.task("x-p1")
    p.workspace("personal", "bookings", "u1")
    p.workspace("org", "vault", "u1")
    await p.task(null)
    vi.advanceTimersByTime(20)
    expect(sent).toEqual([])
    p.workspace("org", "bookings", "u7")
    vi.advanceTimersByTime(20)
    expect(sent).toEqual([{ kinds: ["bookings"], actorId: "u7" }])
    vi.useRealTimers()
  })
})

import { describe, expect, it, vi } from "vitest"
import { frames, parseFrame } from "@/lib/realtime-bridge"
import { eventBus, setBusPublisher, BUS_EVENTS } from "@/lib/event-bus"

// Race audit 16 Oct 2026, M19: the realtime bus between blue-green slots (lib/realtime-bridge.ts).

describe("realtime bridge framing", () => {
  it("splits under the NOTIFY limit and never between the halves of a surrogate pair", () => {
    const text = JSON.stringify(["message-created", { content: "😀".repeat(5000) + "x".repeat(3000) }])
    const parts = frames(text)
    expect(parts.join("")).toBe(text)
    for (const p of parts) {
      expect(Buffer.byteLength(`abcdefabcdef|123456|159|160|${p}`, "utf8")).toBeLessThan(8000)
      const last = p.charCodeAt(p.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
  })

  it("parses a frame and refuses malformed ones", () => {
    expect(parseFrame("o1|7|0|1|[\"a\",1]")).toEqual({ origin: "o1", seq: "7", i: 0, n: 1, chunk: "[\"a\",1]" })
    expect(parseFrame("o1|7|0|1|a|b")?.chunk).toBe("a|b")
    expect(parseFrame("o1|7|2|2|x")).toBeNull()
    expect(parseFrame("garbage")).toBeNull()
  })
})

describe("event bus publishing", () => {
  it("publishes named events once, and never re-publishes an event delivered from another process", () => {
    const published: string[] = []
    setBusPublisher((event) => published.push(event))
    const heard = vi.fn()
    eventBus.on(BUS_EVENTS.AUDIT_CHANGED, heard)
    try {
      eventBus.emit(BUS_EVENTS.AUDIT_CHANGED, { kind: "audit" })
      eventBus.deliverRemote(BUS_EVENTS.AUDIT_CHANGED, { kind: "audit" })
      eventBus.emit("not-a-bus-event", {})
      expect(heard).toHaveBeenCalledTimes(2)
      expect(published).toEqual([BUS_EVENTS.AUDIT_CHANGED])
    } finally {
      eventBus.off(BUS_EVENTS.AUDIT_CHANGED, heard)
      setBusPublisher(null)
    }
  })
})

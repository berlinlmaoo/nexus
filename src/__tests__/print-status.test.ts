// @vitest-environment node
import { describe, expect, it } from "vitest"
import { parseInks, parseReasons, summarize } from "@/lib/print/status"
import { IPP_OP, TAG, VT, attrOf, attrValues, decodeMessage, encodeGetJobs, encodeGetPrinterAttributes, encodeMessage, jobGroups } from "@/lib/print/ipp"

// Printer status panel (owner, 18 Nov 2026): state, reasons, who is printing, how many wait — and nothing about other
// people's files.

const nexus = new Map([
  [41, { id: "pj-a", userId: "ana", userName: "Ana", title: "Ana's contract.pdf" }],
  [43, { id: "pj-b", userId: "me", userName: "Me", title: "My memo.docx" }],
])

describe("printer status", () => {
  it("orders the queue (printing first), names NEXUS senders, hides other people's titles", () => {
    const s = summarize({ device: null, reachable: true, printerState: 4, reasons: ["none"], message: null, accepting: true, jobs: [
      { ippJobId: 43, state: 3 }, { ippJobId: 42, state: 3 }, { ippJobId: 41, state: 5 },
    ] }, nexus, "me")
    expect(s.state).toBe("printing")
    expect(s.waiting).toBe(2)
    expect(s.jobs.map((j) => [j.position, j.state, j.who?.name ?? null, j.mine])).toEqual([
      [1, "printing", "Ana", false], [2, "waiting", null, false], [3, "waiting", "Me", true],
    ])
    expect(s.jobs[0].title).toBeUndefined()
    expect(s.jobs[2]).toMatchObject({ title: "My memo.docx", nexusJobId: "pj-b" })
    expect(JSON.stringify(s)).not.toContain("Ana's contract")
  })

  it("is idle with an empty queue, stopped when paused, error when out of paper", () => {
    expect(summarize({ device: null, reachable: true, printerState: 3, reasons: ["none"], message: null, accepting: true, jobs: [] }, nexus, "me")).toMatchObject({ state: "idle", waiting: 0, jobs: [] })
    expect(summarize({ device: null, reachable: true, printerState: 5, reasons: ["paused"], message: null, accepting: true, jobs: [] }, nexus, "me").state).toBe("stopped")
    const paper = summarize({ device: null, reachable: true, printerState: 5, reasons: ["media-empty-error", "marker-supply-low-warning"], message: "Out of paper", accepting: true, jobs: [] }, nexus, "me")
    expect(paper.state).toBe("error")
    expect(paper.reasons).toEqual([{ keyword: "media-empty", severity: "error" }, { keyword: "marker-supply-low", severity: "warning" }])
    expect(paper.message).toBe("Out of paper")
  })

  it("says disconnected when CUPS waits for the printer (USB unplugged), never 'printing'", () => {
    // What CUPS answered on 18 Nov 2026 with the printer's USB unplugged: still "processing", reasons none.
    const s = summarize({ device: null, reachable: true, printerState: 4, reasons: ["none"], message: "Waiting for printer to become available.", accepting: true, jobs: [
      { ippJobId: 3, state: 5 }, { ippJobId: 43, state: 3 },
    ] }, nexus, "me")
    expect(s.state).toBe("disconnected")
    expect(s.jobs.map((j) => j.state)).toEqual(["stalled", "waiting"])
    expect(s.jobs[0].who).toBeNull()
    expect(summarize({ device: null, reachable: true, printerState: 3, reasons: ["offline-report"], message: null, accepting: true, jobs: [] }, nexus, "me").state).toBe("disconnected")
  })

  it("asks the printer itself: CUPS's 'idle' does not count when the printer doesn't answer", () => {
    const off = summarize({ device: { reachable: false, printerState: null, reasons: [], message: null, inks: [] }, reachable: true, printerState: 3, reasons: ["none"], message: null, accepting: true, jobs: [] }, nexus, "me")
    expect(off).toMatchObject({ state: "disconnected", source: "printer", inks: [] })
    const on = summarize({
      device: { reachable: true, printerState: 3, reasons: ["marker-supply-low-warning"], message: "", inks: [{ name: "Cyan", level: 12, color: "#00FFFF" }] },
      reachable: true, printerState: 3, reasons: ["none"], message: null, accepting: true, jobs: [],
    }, nexus, "me")
    expect(on).toMatchObject({ state: "idle", source: "printer", reasons: [{ keyword: "marker-supply-low", severity: "warning" }], inks: [{ name: "Cyan", level: 12 }] })
    const paper = summarize({ device: { reachable: true, printerState: 5, reasons: ["media-empty-error"], message: null, inks: [] }, reachable: true, printerState: 3, reasons: ["none"], message: null, accepting: true, jobs: [] }, nexus, "me")
    expect(paper.state).toBe("error")
  })

  it("reads ink levels; unknown levels are null", () => {
    expect(parseInks([80, -1, 5], ["Black", "Cyan"], ["#000000", "#00FFFF#000000", "nope"])).toEqual([
      { name: "Black", level: 80, color: "#000000" }, { name: "Cyan", level: null, color: "#00FFFF" }, { name: "Ink 3", level: 5, color: null },
    ])
  })

  it("says unreachable when CUPS does not answer", () => {
    expect(summarize({ device: null, reachable: false, printerState: null, reasons: [], message: null, accepting: false, jobs: [] }, nexus, "me")).toMatchObject({ reachable: false, state: "unreachable", jobs: [] })
  })

  it("drops CUPS housekeeping reasons", () => {
    expect(parseReasons(["none", "cups-waiting-for-job-completed", "offline-report"])).toEqual([{ keyword: "offline", severity: "report" }])
  })
})

describe("status IPP requests", () => {
  it("asks the printer for its state and the not-completed jobs", () => {
    const p = decodeMessage(encodeGetPrinterAttributes({ printerUri: "ipp://h/printers/p", userName: "nexus" }))
    expect(p.code).toBe(IPP_OP.GET_PRINTER_ATTRIBUTES)
    expect(attrValues(p, "requested-attributes")).toEqual(expect.arrayContaining(["printer-state", "printer-state-reasons", "queued-job-count"]))
    const j = decodeMessage(encodeGetJobs({ printerUri: "ipp://h/printers/p", userName: "nexus" }))
    expect(j.code).toBe(IPP_OP.GET_JOBS)
    expect(attrOf(j, "which-jobs")).toBe("not-completed")
  })

  it("reads each job group of a Get-Jobs answer", () => {
    const res = decodeMessage(encodeMessage({ version: [2, 0], code: 0, requestId: 1, groups: [
      { tag: TAG.OPERATION, attrs: [{ tag: VT.CHARSET, name: "attributes-charset", values: ["utf-8"] }] },
      { tag: TAG.JOB, attrs: [{ tag: VT.INTEGER, name: "job-id", values: [7] }, { tag: VT.ENUM, name: "job-state", values: [5] }] },
      { tag: TAG.JOB, attrs: [{ tag: VT.INTEGER, name: "job-id", values: [8] }, { tag: VT.ENUM, name: "job-state", values: [3] }] },
    ] }))
    expect(jobGroups(res)).toEqual([{ "job-id": 7, "job-state": 5 }, { "job-id": 8, "job-state": 3 }])
  })
})

import prisma from "@/lib/prisma"
import { printerConfig } from "@/lib/print/config"
import { attrOf, attrValues, encodeGetJobs, encodeGetPrinterAttributes, ippPost, isIppSuccess, jobGroups, JOB_STATE } from "@/lib/print/ipp"

/**
 * The office printer right now (owner, 18 Nov 2026: "is it printing, who is printing, how many are waiting"). One
 * Get-Printer-Attributes + one Get-Jobs (not-completed) to CUPS, at most every 3 seconds for everyone (cached), then
 * each CUPS job is matched to the PrintJob row NEXUS made for it. A job CUPS has that NEXUS did not send is "outside
 * NEXUS" (someone printing to the CUPS queue from a laptop). A phone or laptop printing straight to the printer over
 * WiFi never passes through CUPS, so it is NOT seen here at all — the panel says so.
 * Other people's jobs show who, never what (no file names); your own shows its title.
 */

/** disconnected = CUPS is up but cannot reach the printer (off, or out of the office WiFi): jobs wait and come out as
 *  soon as it is back. CUPS then often still says "processing" with the message "Waiting for printer to become available". */
export type PrinterState = "idle" | "printing" | "stopped" | "error" | "disconnected" | "unreachable"
export type PrinterReason = { keyword: string; severity: "error" | "warning" | "report" }
export type QueueJob = {
  /** 1 = printing now (or next). */
  position: number
  /** stalled = CUPS took it but the printer is not connected: nothing is coming out yet. */
  state: "printing" | "waiting" | "held" | "stopped" | "stalled"
  /** Sent from NEXUS: by whom. Null = outside NEXUS. */
  who: { id: string; name: string } | null
  mine: boolean
  /** Your own jobs only. */
  title?: string
  nexusJobId?: string
}
export type PrinterStatus = {
  reachable: boolean
  state: PrinterState
  reasons: PrinterReason[]
  message: string | null
  acceptingJobs: boolean
  /** Jobs waiting behind the one printing. */
  waiting: number
  jobs: QueueJob[]
  checkedAt: string
}

type Raw = {
  reachable: boolean
  printerState: number | null
  reasons: string[]
  message: string | null
  accepting: boolean
  jobs: Array<{ ippJobId: number; state: number }>
  at: number
}

/** "media-empty-error" → { keyword: "media-empty", severity: "error" }. CUPS's own housekeeping keywords are dropped. */
export function parseReasons(raw: string[]): PrinterReason[] {
  const out: PrinterReason[] = []
  for (const r of raw) {
    if (!r || r === "none" || r.startsWith("cups-")) continue
    const m = /^(.*)-(error|warning|report)$/.exec(r)
    out.push(m ? { keyword: m[1], severity: m[2] as PrinterReason["severity"] } : { keyword: r, severity: "error" })
  }
  return out
}

const JOB_LABEL: Record<number, QueueJob["state"]> = {
  [JOB_STATE.PENDING]: "waiting",
  [JOB_STATE.PENDING_HELD]: "held",
  [JOB_STATE.PROCESSING]: "printing",
  [JOB_STATE.PROCESSING_STOPPED]: "stopped",
}

const DISCONNECTED_REASONS = new Set(["offline", "connecting-to-device", "timed-out"])
// Since 18 Nov 2026 CUPS reaches the printer over WiFi (ipp://EPSONE0F00A.local:631/ipp/print): "disconnected" now means
// the printer is off or out of the office WiFi. These are what CUPS's usb/ipp backends say while they wait for it.
const DISCONNECTED_MESSAGE = /waiting for printer to become available|unable to (open|locate|connect|resolve)|printer (is )?(offline|not connected|not responding|busy)|no such device|not responding|host is (down|unreachable)|network (host|printer)[^.]*(busy|unreachable|not available)|looking for printer/i

/** CUPS can't reach the printer: a reason that says so, or the message CUPS shows while its backend waits for it. */
export function isDisconnected(reasons: PrinterReason[], message: string | null): boolean {
  return reasons.some((r) => DISCONNECTED_REASONS.has(r.keyword)) || DISCONNECTED_MESSAGE.test(message ?? "")
}

/** Pure: CUPS's answer + NEXUS's rows → what one viewer sees. Tested by src/__tests__/print-status.test.ts. */
export function summarize(
  raw: Omit<Raw, "at">,
  nexus: Map<number, { id: string; userId: string; userName: string; title: string }>,
  viewerId: string,
  now = new Date(),
): PrinterStatus {
  if (!raw.reachable) {
    return { reachable: false, state: "unreachable", reasons: [], message: null, acceptingJobs: false, waiting: 0, jobs: [], checkedAt: now.toISOString() }
  }
  const reasons = parseReasons(raw.reasons)
  const active = raw.jobs.filter((j) => JOB_LABEL[j.state]).sort((a, b) => {
    // The one printing first, then the rest in the order CUPS took them.
    const pa = a.state === JOB_STATE.PROCESSING ? 0 : 1
    const pb = b.state === JOB_STATE.PROCESSING ? 0 : 1
    return pa - pb || a.ippJobId - b.ippJobId
  })
  const jobs: QueueJob[] = active.map((j, i) => {
    const n = nexus.get(j.ippJobId)
    const mine = !!n && n.userId === viewerId
    return {
      position: i + 1,
      state: JOB_LABEL[j.state],
      who: n ? { id: n.userId, name: n.userName } : null,
      mine,
      ...(mine ? { title: n!.title, nexusJobId: n!.id } : {}),
    }
  })
  let state: PrinterState = raw.printerState === 4 ? "printing" : raw.printerState === 5 ? "stopped" : "idle"
  if (state === "idle" && jobs.some((j) => j.state === "printing")) state = "printing"
  if (state === "stopped" && reasons.some((r) => r.severity === "error" && r.keyword !== "paused")) state = "error"
  if (isDisconnected(reasons, raw.message)) {
    state = "disconnected"
    for (const j of jobs) if (j.state === "printing") j.state = "stalled"
  }
  return {
    reachable: true,
    state,
    reasons,
    message: raw.message || null,
    acceptingJobs: raw.accepting,
    waiting: jobs.filter((j) => j.state !== "printing" && j.state !== "stalled").length,
    jobs,
    checkedAt: now.toISOString(),
  }
}

let cache: Raw | null = null
let inflight: Promise<Raw> | null = null
const CACHE_MS = 3000

async function readCups(): Promise<Raw> {
  const printer = printerConfig()
  const at = Date.now()
  if (!printer) return { reachable: false, printerState: null, reasons: [], message: null, accepting: false, jobs: [], at }
  try {
    const [p, j] = await Promise.all([
      ippPost(printer.http, encodeGetPrinterAttributes({ printerUri: printer.printerUri, userName: "nexus" }), 5000),
      ippPost(printer.http, encodeGetJobs({ printerUri: printer.printerUri, userName: "nexus" }), 5000),
    ])
    if (!isIppSuccess(p.code)) return { reachable: false, printerState: null, reasons: [], message: null, accepting: false, jobs: [], at }
    const jobs = isIppSuccess(j.code)
      ? jobGroups(j).map((g) => ({ ippJobId: Number(g["job-id"]), state: Number(g["job-state"]) })).filter((x) => Number.isFinite(x.ippJobId))
      : []
    return {
      reachable: true,
      printerState: Number(attrOf(p, "printer-state")) || null,
      reasons: attrValues(p, "printer-state-reasons").map(String),
      message: String(attrOf(p, "printer-state-message") ?? "") || null,
      accepting: attrOf(p, "printer-is-accepting-jobs") !== false,
      jobs,
      at,
    }
  } catch {
    return { reachable: false, printerState: null, reasons: [], message: null, accepting: false, jobs: [], at }
  }
}

/** The status for one viewer; CUPS is asked at most once every 3 s whoever asks. */
export async function printerStatus(viewerId: string): Promise<PrinterStatus> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    inflight ??= readCups().finally(() => { inflight = null })
    cache = await inflight
  }
  const raw = cache
  const ids = raw.jobs.map((j) => j.ippJobId)
  const rows = ids.length
    ? await prisma.printJob.findMany({
        // CUPS job numbers only grow; a day's window keeps an old number from another server's history out.
        where: { ippJobId: { in: ids }, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
        select: { id: true, ippJobId: true, userId: true, title: true },
      })
    : []
  const users = rows.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } }) : []
  const nameOf = new Map(users.map((u) => [u.id, u.name]))
  const nexus = new Map(rows.map((r) => [r.ippJobId!, { id: r.id, userId: r.userId, userName: nameOf.get(r.userId) ?? "", title: r.title }]))
  return summarize(raw, nexus, viewerId)
}

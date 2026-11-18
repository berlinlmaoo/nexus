import prisma from "@/lib/prisma"
import { printerConfig, printerDeviceConfig } from "@/lib/print/config"
import { attrOf, attrValues, encodeGetDeviceAttributes, encodeGetJobs, encodeGetPrinterAttributes, ippPost, ippPostDevice, isIppSuccess, jobGroups, JOB_STATE } from "@/lib/print/ipp"

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
/** One ink (marker-*): level 0–100, or null when the printer doesn't know. */
export type InkLevel = { name: string; level: number | null; color: string | null }

export type PrinterStatus = {
  reachable: boolean
  /** Where the printer state comes from: the printer itself (PRINT_DEVICE_IPP_URL) or CUPS alone. */
  source: "printer" | "cups"
  /** Ink levels when the printer reports them. */
  inks: InkLevel[]
  state: PrinterState
  reasons: PrinterReason[]
  message: string | null
  acceptingJobs: boolean
  /** Jobs waiting behind the one printing. */
  waiting: number
  jobs: QueueJob[]
  checkedAt: string
}

/** The printer's own answer (null = not configured). */
export type DeviceRaw = {
  reachable: boolean
  printerState: number | null
  reasons: string[]
  message: string | null
  inks: InkLevel[]
}

type Raw = {
  device: DeviceRaw | null
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
  const source = raw.device ? "printer" as const : "cups" as const
  if (!raw.reachable) {
    return { reachable: false, source, inks: [], state: "unreachable", reasons: [], message: null, acceptingJobs: false, waiting: 0, jobs: [], checkedAt: now.toISOString() }
  }
  // Asked directly, the printer's own state and reasons win over CUPS's (which says "idle" for a printer that is off).
  const dev = raw.device
  const reasons = parseReasons(dev?.reachable ? dev.reasons : raw.reasons)
  const message = (dev?.reachable ? dev.message : raw.message) || null
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
  const printerState = dev?.reachable ? dev.printerState : raw.printerState
  let state: PrinterState = printerState === 4 ? "printing" : printerState === 5 ? "stopped" : "idle"
  if (state === "idle" && jobs.some((j) => j.state === "printing")) state = "printing"
  if (state === "stopped" && reasons.some((r) => r.severity === "error" && r.keyword !== "paused")) state = "error"
  if ((dev && !dev.reachable) || isDisconnected(parseReasons(raw.reasons), raw.message) || isDisconnected(reasons, message)) {
    state = "disconnected"
    for (const j of jobs) if (j.state === "printing") j.state = "stalled"
  }
  return {
    reachable: true,
    source,
    inks: dev?.reachable ? dev.inks : [],
    state,
    reasons: state === "disconnected" ? reasons.filter((r) => !DISCONNECTED_REASONS.has(r.keyword)) : reasons,
    message,
    acceptingJobs: raw.accepting,
    waiting: jobs.filter((j) => j.state !== "printing" && j.state !== "stalled").length,
    jobs,
    checkedAt: now.toISOString(),
  }
}

let cache: Raw | null = null
let inflight: Promise<Raw> | null = null
const CACHE_MS = 5000

/** marker-levels/names/colors → inks. -1/-2/-3 (unknown / some left) read as null. */
export function parseInks(levels: unknown[], names: unknown[], colors: unknown[]): InkLevel[] {
  return levels.map((lv, i) => {
    const n = Number(lv)
    const color = typeof colors[i] === "string" && /^#[0-9a-f]{6}/i.test(colors[i] as string) ? (colors[i] as string).slice(0, 7) : null
    return { name: String(names[i] ?? `Ink ${i + 1}`), level: Number.isFinite(n) && n >= 0 && n <= 100 ? n : null, color }
  })
}

/** The printer itself, a few seconds' budget: no answer = off or out of the office WiFi. */
async function readDevice(): Promise<DeviceRaw | null> {
  const device = printerDeviceConfig()
  if (!device) return null
  try {
    // 3 s: the printer's TLS handshake alone takes ~1 s over WiFi (measured 18 Nov 2026); later polls reuse the socket.
    const p = await ippPostDevice(device.http, encodeGetDeviceAttributes({ printerUri: device.printerUri }), { hostHeader: device.hostHeader, timeoutMs: 3000 })
    if (!isIppSuccess(p.code)) return { reachable: false, printerState: null, reasons: [], message: null, inks: [] }
    return {
      reachable: true,
      printerState: Number(attrOf(p, "printer-state")) || null,
      reasons: attrValues(p, "printer-state-reasons").map(String),
      message: String(attrOf(p, "printer-state-message") ?? "") || null,
      inks: parseInks(attrValues(p, "marker-levels"), attrValues(p, "marker-names"), attrValues(p, "marker-colors")),
    }
  } catch {
    return { reachable: false, printerState: null, reasons: [], message: null, inks: [] }
  }
}

async function readCups(): Promise<Raw> {
  const printer = printerConfig()
  const at = Date.now()
  if (!printer) return { device: null, reachable: false, printerState: null, reasons: [], message: null, accepting: false, jobs: [], at }
  try {
    const [p, j, device] = await Promise.all([
      ippPost(printer.http, encodeGetPrinterAttributes({ printerUri: printer.printerUri, userName: "nexus" }), 5000),
      ippPost(printer.http, encodeGetJobs({ printerUri: printer.printerUri, userName: "nexus" }), 5000),
      readDevice(),
    ])
    if (!isIppSuccess(p.code)) return { device, reachable: false, printerState: null, reasons: [], message: null, accepting: false, jobs: [], at }
    const jobs = isIppSuccess(j.code)
      ? jobGroups(j).map((g) => ({ ippJobId: Number(g["job-id"]), state: Number(g["job-state"]) })).filter((x) => Number.isFinite(x.ippJobId))
      : []
    return {
      device,
      reachable: true,
      printerState: Number(attrOf(p, "printer-state")) || null,
      reasons: attrValues(p, "printer-state-reasons").map(String),
      message: String(attrOf(p, "printer-state-message") ?? "") || null,
      accepting: attrOf(p, "printer-is-accepting-jobs") !== false,
      jobs,
      at,
    }
  } catch {
    return { device: null, reachable: false, printerState: null, reasons: [], message: null, accepting: false, jobs: [], at }
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

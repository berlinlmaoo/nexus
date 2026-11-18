/**
 * A small IPP client (RFC 8010 encoding, RFC 8011 semantics) for the office printer (owner, 18 Nov 2026). Just the
 * two operations NEXUS needs, against one CUPS queue:
 *   • Print-Job (0x0002): one PDF, copies, print-color-mode, job-name, requesting-user-name;
 *   • Get-Job-Attributes (0x0009): job-state of a job sent before.
 * No dependency: an IPP request is a binary header + attribute groups + the document, POSTed over HTTP with
 * Content-Type application/ipp. ipp://host[:631]/path is http://host:631/path, ipps:// is https://.
 *
 * Pure encode/decode (tested by src/__tests__/print-ipp.test.ts); ippPost is the only I/O.
 */

export const IPP_OP = { PRINT_JOB: 0x0002, GET_JOB_ATTRIBUTES: 0x0009, GET_JOBS: 0x000a, GET_PRINTER_ATTRIBUTES: 0x000b } as const

/** Delimiter tags (RFC 8010 §3.5.1). */
export const TAG = {
  OPERATION: 0x01,
  JOB: 0x02,
  END: 0x03,
  PRINTER: 0x04,
  UNSUPPORTED_GROUP: 0x05,
} as const

/** Value tags (RFC 8010 §3.5.2) used here. */
export const VT = {
  UNSUPPORTED: 0x10,
  UNKNOWN: 0x12,
  NO_VALUE: 0x13,
  INTEGER: 0x21,
  BOOLEAN: 0x22,
  ENUM: 0x23,
  OCTET_STRING: 0x30,
  DATE_TIME: 0x31,
  RESOLUTION: 0x32,
  RANGE: 0x33,
  BEG_COLLECTION: 0x34,
  TEXT_WITH_LANGUAGE: 0x35,
  NAME_WITH_LANGUAGE: 0x36,
  END_COLLECTION: 0x37,
  TEXT: 0x41,
  NAME: 0x42,
  KEYWORD: 0x44,
  URI: 0x45,
  URI_SCHEME: 0x46,
  CHARSET: 0x47,
  NATURAL_LANGUAGE: 0x48,
  MIME_MEDIA_TYPE: 0x49,
  MEMBER_ATTR_NAME: 0x4a,
} as const

/** job-state (RFC 8011 §5.3.7). */
export const JOB_STATE = { PENDING: 3, PENDING_HELD: 4, PROCESSING: 5, PROCESSING_STOPPED: 6, CANCELED: 7, ABORTED: 8, COMPLETED: 9 } as const

/** A rangeOfInteger value is [lower, upper]. */
export type IppValue = string | number | boolean | [number, number]
export type IppAttr = { tag: number; name: string; values: IppValue[] }
export type IppGroup = { tag: number; attrs: IppAttr[] }
export type IppMessage = { version: [number, number]; code: number; requestId: number; groups: IppGroup[]; data?: Buffer }

const INT_TAGS = new Set<number>([VT.INTEGER, VT.ENUM])
const OUT_OF_BAND = new Set<number>([VT.UNSUPPORTED, VT.UNKNOWN, VT.NO_VALUE])

// ---------------------------------------------------------------- encode

function u16(n: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return b
}

function valueBytes(tag: number, value: IppValue): Buffer {
  if (INT_TAGS.has(tag)) {
    const b = Buffer.alloc(4)
    b.writeInt32BE(Number(value))
    return b
  }
  if (tag === VT.BOOLEAN) return Buffer.from([value ? 1 : 0])
  if (tag === VT.RANGE) {
    const [lo, hi] = Array.isArray(value) ? value : [Number(value), Number(value)]
    const b = Buffer.alloc(8)
    b.writeInt32BE(lo, 0)
    b.writeInt32BE(hi, 4)
    return b
  }
  if (OUT_OF_BAND.has(tag)) return Buffer.alloc(0)
  return Buffer.from(String(value), "utf8")
}

/** One attribute: the first value carries the name, every further value an empty name (a 1setOf). */
export function encodeAttr(attr: IppAttr): Buffer {
  const parts: Buffer[] = []
  attr.values.forEach((value, i) => {
    const name = Buffer.from(i === 0 ? attr.name : "", "utf8")
    const v = valueBytes(attr.tag, value)
    if (name.length > 0xffff || v.length > 0xffff) throw new Error(`IPP attribute ${attr.name} is too long`)
    parts.push(Buffer.from([attr.tag]), u16(name.length), name, u16(v.length), v)
  })
  return Buffer.concat(parts)
}

export function encodeMessage(msg: IppMessage): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt8(msg.version[0], 0)
  head.writeUInt8(msg.version[1], 1)
  head.writeUInt16BE(msg.code, 2)
  head.writeInt32BE(msg.requestId, 4)
  const parts: Buffer[] = [head]
  for (const g of msg.groups) {
    parts.push(Buffer.from([g.tag]))
    for (const a of g.attrs) parts.push(encodeAttr(a))
  }
  parts.push(Buffer.from([TAG.END]))
  if (msg.data) parts.push(msg.data)
  return Buffer.concat(parts)
}

/** IPP names and text are at most 255 octets (RFC 8011 §5.1.2/5.1.3); cut on a character boundary. */
export function clip(text: string, max = 255): string {
  let out = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  while (Buffer.byteLength(out, "utf8") > max) out = out.slice(0, -1)
  return out
}

function operationAttrs(printerUri: string, userName: string): IppAttr[] {
  return [
    { tag: VT.CHARSET, name: "attributes-charset", values: ["utf-8"] },
    { tag: VT.NATURAL_LANGUAGE, name: "attributes-natural-language", values: ["en"] },
    { tag: VT.URI, name: "printer-uri", values: [printerUri] },
    { tag: VT.NAME, name: "requesting-user-name", values: [clip(userName) || "nexus"] },
  ]
}

export type ColorMode = "color" | "mono"

export type PrintJobInput = {
  printerUri: string
  userName: string
  jobName: string
  copies: number
  colorMode: ColorMode
  pdf: Buffer
  /** page-ranges (RFC 8011 §5.2.7): ascending, non-overlapping [first, last] pairs, 1-based. Omitted = every page. */
  pageRanges?: Array<[number, number]>
  requestId?: number
}

/** Print-Job with one PDF document. */
export function encodePrintJob(input: PrintJobInput): Buffer {
  return encodeMessage({
    version: [2, 0],
    code: IPP_OP.PRINT_JOB,
    requestId: input.requestId ?? 1,
    groups: [
      {
        tag: TAG.OPERATION,
        attrs: [
          ...operationAttrs(input.printerUri, input.userName),
          { tag: VT.NAME, name: "job-name", values: [clip(input.jobName) || "NEXUS"] },
          { tag: VT.MIME_MEDIA_TYPE, name: "document-format", values: ["application/pdf"] },
        ],
      },
      {
        tag: TAG.JOB,
        attrs: [
          { tag: VT.INTEGER, name: "copies", values: [input.copies] },
          { tag: VT.KEYWORD, name: "print-color-mode", values: [input.colorMode === "color" ? "color" : "monochrome"] },
          ...(input.pageRanges?.length ? [{ tag: VT.RANGE, name: "page-ranges", values: input.pageRanges }] : []),
        ],
      },
    ],
    data: input.pdf,
  })
}

/** Get-Job-Attributes for job-state and why. */
export function encodeGetJobAttributes(input: { printerUri: string; userName: string; jobId: number; requestId?: number }): Buffer {
  return encodeMessage({
    version: [2, 0],
    code: IPP_OP.GET_JOB_ATTRIBUTES,
    requestId: input.requestId ?? 1,
    groups: [
      {
        tag: TAG.OPERATION,
        attrs: [
          ...operationAttrs(input.printerUri, input.userName),
          { tag: VT.INTEGER, name: "job-id", values: [input.jobId] },
          { tag: VT.KEYWORD, name: "requested-attributes", values: ["job-state", "job-state-reasons", "job-state-message", "job-printer-state-message"] },
        ],
      },
    ],
  })
}

/** Get-Printer-Attributes: the printer's state for the status panel. */
export function encodeGetPrinterAttributes(input: { printerUri: string; userName: string; requestId?: number }): Buffer {
  return encodeMessage({
    version: [2, 0],
    code: IPP_OP.GET_PRINTER_ATTRIBUTES,
    requestId: input.requestId ?? 1,
    groups: [{
      tag: TAG.OPERATION,
      attrs: [
        ...operationAttrs(input.printerUri, input.userName),
        { tag: VT.KEYWORD, name: "requested-attributes", values: ["printer-state", "printer-state-reasons", "printer-state-message", "printer-is-accepting-jobs", "queued-job-count"] },
      ],
    }],
  })
}

/** Get-Jobs (which-jobs=not-completed): what is printing and waiting, oldest first. */
export function encodeGetJobs(input: { printerUri: string; userName: string; requestId?: number }): Buffer {
  return encodeMessage({
    version: [2, 0],
    code: IPP_OP.GET_JOBS,
    requestId: input.requestId ?? 1,
    groups: [{
      tag: TAG.OPERATION,
      attrs: [
        ...operationAttrs(input.printerUri, input.userName),
        { tag: VT.KEYWORD, name: "which-jobs", values: ["not-completed"] },
        { tag: VT.KEYWORD, name: "requested-attributes", values: ["job-id", "job-state", "job-state-reasons"] },
      ],
    }],
  })
}

/** Every job group of a Get-Jobs answer as a flat record (first value of each attribute). */
export function jobGroups(msg: IppMessage): Array<Record<string, IppValue | IppValue[]>> {
  return msg.groups.filter((g) => g.tag === TAG.JOB).map((g) => {
    const out: Record<string, IppValue | IppValue[]> = {}
    for (const a of g.attrs) out[a.name] = a.values.length > 1 ? a.values : a.values[0]
    return out
  })
}

// ---------------------------------------------------------------- decode

export class IppDecodeError extends Error {}

/** A response (or a request) back into groups. Collections are flattened to their member values; enough here. */
export function decodeMessage(buf: Buffer): IppMessage {
  if (buf.length < 9) throw new IppDecodeError("IPP response is too short")
  const msg: IppMessage = { version: [buf[0], buf[1]], code: buf.readUInt16BE(2), requestId: buf.readInt32BE(4), groups: [] }
  let i = 8
  let group: IppGroup | null = null
  let last: IppAttr | null = null
  while (i < buf.length) {
    const tag = buf[i++]
    if (tag === TAG.END) {
      if (i < buf.length) msg.data = buf.subarray(i)
      return msg
    }
    if (tag <= 0x0f) {
      group = { tag, attrs: [] }
      msg.groups.push(group)
      last = null
      continue
    }
    if (i + 2 > buf.length) throw new IppDecodeError("IPP response is cut off")
    const nameLen = buf.readUInt16BE(i)
    i += 2
    const name = buf.toString("utf8", i, i + nameLen)
    i += nameLen
    if (i + 2 > buf.length) throw new IppDecodeError("IPP response is cut off")
    const valueLen = buf.readUInt16BE(i)
    i += 2
    if (i + valueLen > buf.length) throw new IppDecodeError("IPP response is cut off")
    const raw = buf.subarray(i, i + valueLen)
    i += valueLen
    if (!group) throw new IppDecodeError("IPP attribute outside a group")
    let value: IppValue
    if (INT_TAGS.has(tag) && valueLen === 4) value = raw.readInt32BE(0)
    else if (tag === VT.BOOLEAN && valueLen === 1) value = raw[0] !== 0
    else if (tag === VT.RANGE && valueLen === 8) value = [raw.readInt32BE(0), raw.readInt32BE(4)]
    else if (OUT_OF_BAND.has(tag) || tag === VT.BEG_COLLECTION || tag === VT.END_COLLECTION) value = ""
    else if (tag === VT.TEXT_WITH_LANGUAGE || tag === VT.NAME_WITH_LANGUAGE) {
      // language length + language + text length + text
      const langLen = raw.length >= 2 ? raw.readUInt16BE(0) : 0
      const at = 2 + langLen
      const textLen = raw.length >= at + 2 ? raw.readUInt16BE(at) : 0
      value = raw.toString("utf8", at + 2, at + 2 + textLen)
    } else if (tag < 0x40) value = raw.toString("hex")
    else value = raw.toString("utf8")
    if (nameLen === 0 && last) last.values.push(value)
    else {
      last = { tag, name, values: [value] }
      group.attrs.push(last)
    }
  }
  return msg
}

/** First value of an attribute anywhere in the message. */
export function attrOf(msg: IppMessage, name: string): IppValue | undefined {
  for (const g of msg.groups) for (const a of g.attrs) if (a.name === name) return a.values[0]
  return undefined
}

export function attrValues(msg: IppMessage, name: string): IppValue[] {
  for (const g of msg.groups) for (const a of g.attrs) if (a.name === name) return a.values
  return []
}

/** 0x0000–0x00FF: successful-ok and its variants (RFC 8011 §B.1.2). */
export const isIppSuccess = (code: number) => code >= 0 && code <= 0xff

const STATUS_TEXT: Record<number, string> = {
  0x0400: "bad request",
  0x0401: "forbidden",
  0x0402: "not authenticated",
  0x0403: "not authorized",
  0x0404: "not possible",
  0x0405: "timeout",
  0x0406: "printer not found",
  0x0407: "gone",
  0x0408: "request too large",
  0x040a: "document format not supported",
  0x040b: "attributes or values not supported",
  0x0500: "internal printer error",
  0x0501: "operation not supported",
  0x0502: "service unavailable",
  0x0506: "printer busy",
  0x0507: "job canceled",
  0x0509: "printer is not accepting jobs",
}

export function ippStatusText(code: number): string {
  return STATUS_TEXT[code] ?? `IPP status 0x${code.toString(16).padStart(4, "0")}`
}

// ---------------------------------------------------------------- transport

/** ipp://host:631/printers/X → { http: "http://host:631/printers/X", printerUri: the ipp:// form }. Null when not IPP. */
export function parsePrinterUrl(raw: string | null | undefined): { http: string; printerUri: string; queue: string } | null {
  const text = raw?.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const secure = url.protocol === "ipps:" || url.protocol === "https:"
  if (!["ipp:", "ipps:", "http:", "https:"].includes(url.protocol)) return null
  const port = url.port || (url.protocol === "ipp:" || url.protocol === "ipps:" ? "631" : "")
  const hostPort = `${url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname}${port ? `:${port}` : ""}`
  const path = url.pathname || "/"
  const queue = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "")
  return {
    http: `${secure ? "https" : "http"}://${hostPort}${path}`,
    printerUri: `${secure ? "ipps" : "ipp"}://${hostPort}${path}`,
    queue,
  }
}

export class IppTransportError extends Error {}

/** POST one IPP request and decode the answer. */
export async function ippPost(httpUrl: string, body: Buffer, timeoutMs = 60_000): Promise<IppMessage> {
  let res: Response
  try {
    res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/ipp", Accept: "application/ipp" },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new IppTransportError(`Printer unreachable: ${(error as Error).message}`)
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  if (!res.ok) throw new IppTransportError(`Printer answered HTTP ${res.status}`)
  try {
    return decodeMessage(bytes)
  } catch (error) {
    throw new IppTransportError(`Printer sent an unreadable answer: ${(error as Error).message}`)
  }
}

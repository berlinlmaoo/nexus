import { createReadStream } from "fs"
import { stat } from "fs/promises"

// ─────────────────────────────────────────────────────────────────────────────
// "Download all" for a shared vault folder (9 Oct 2026): a .zip written straight onto the response,
// never assembled on disk or in memory.
//
// STORED, not deflated: what people keep in a shared drive is mostly pictures, films, PDFs and Office
// files, which are compressed already — deflate would cost CPU on this server to save almost nothing.
// Each file is read twice: once for its CRC-32, then again into the response. That keeps every entry's
// header complete (no data descriptors), which is the form every unzipper reads, including the ones
// that stream; the second read comes out of the page cache.
//
// No ZIP64, so the archive must stay under 4 GB: the route caps it far below (VAULT_ZIP_MAX_BYTES).
// ─────────────────────────────────────────────────────────────────────────────

/** The most a "Download all" will put in one archive — the same ceiling as one upload. */
export const VAULT_ZIP_MAX_BYTES = 1024 * 1024 * 1024
export const VAULT_ZIP_MAX_FILES = 1000

export type ZipEntry =
  /** `name` is the path inside the archive, "/"-separated, without a leading slash. */
  | { kind: "file"; name: string; path: string; modified: Date }
  | { kind: "folder"; name: string; modified: Date }

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crcUpdate(crc: number, buf: Uint8Array): number {
  let c = crc ^ -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

async function crcOfFile(path: string): Promise<number> {
  let crc = 0
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) crc = crcUpdate(crc, chunk as Buffer)
  return crc
}

/** MS-DOS date and time, as zip headers store them (local time, 2-second resolution, 1980+). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** One path segment safe on every desktop: no separators, no Windows-reserved characters, no "." or "..". */
export function zipSegment(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "").trim()
  return !cleaned || cleaned === "." || cleaned === ".." ? "_" : cleaned
}

const UTF8_FLAG = 0x0800
const VERSION = 20
const MADE_BY_UNIX = (3 << 8) | VERSION

function localHeader(name: Buffer, crc: number, size: number, t: { time: number; date: number }): Buffer {
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0)
  h.writeUInt16LE(VERSION, 4)
  h.writeUInt16LE(UTF8_FLAG, 6)
  h.writeUInt16LE(0, 8) // stored
  h.writeUInt16LE(t.time, 10)
  h.writeUInt16LE(t.date, 12)
  h.writeUInt32LE(crc, 14)
  h.writeUInt32LE(size, 18)
  h.writeUInt32LE(size, 22)
  h.writeUInt16LE(name.length, 26)
  h.writeUInt16LE(0, 28)
  return Buffer.concat([h, name])
}

function centralHeader(name: Buffer, crc: number, size: number, t: { time: number; date: number }, offset: number, folder: boolean): Buffer {
  const h = Buffer.alloc(46)
  h.writeUInt32LE(0x02014b50, 0)
  h.writeUInt16LE(MADE_BY_UNIX, 4)
  h.writeUInt16LE(VERSION, 6)
  h.writeUInt16LE(UTF8_FLAG, 8)
  h.writeUInt16LE(0, 10)
  h.writeUInt16LE(t.time, 12)
  h.writeUInt16LE(t.date, 14)
  h.writeUInt32LE(crc, 16)
  h.writeUInt32LE(size, 20)
  h.writeUInt32LE(size, 24)
  h.writeUInt16LE(name.length, 28)
  h.writeUInt16LE(0, 30) // extra
  h.writeUInt16LE(0, 32) // comment
  h.writeUInt16LE(0, 34) // disk
  h.writeUInt16LE(0, 36) // internal attributes
  // Unix mode in the high half (rw-r--r-- / rwxr-xr-x), the MS-DOS directory bit in the low one.
  h.writeUInt32LE(folder ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0, 38)
  h.writeUInt32LE(offset, 42)
  return Buffer.concat([h, name])
}

async function* zipChunks(entries: ZipEntry[]): AsyncGenerator<Uint8Array> {
  let offset = 0
  const central: Buffer[] = []
  for (const entry of entries) {
    const t = dosDateTime(entry.modified)
    if (entry.kind === "folder") {
      const name = Buffer.from(entry.name.endsWith("/") ? entry.name : `${entry.name}/`, "utf8")
      const header = localHeader(name, 0, 0, t)
      central.push(centralHeader(name, 0, 0, t, offset, true))
      offset += header.length
      yield header
      continue
    }
    // A file whose bytes are missing on disk is left out rather than failing the whole archive.
    let size: number
    try {
      const s = await stat(entry.path)
      if (!s.isFile()) continue
      size = s.size
    } catch {
      continue
    }
    const crc = await crcOfFile(entry.path)
    const name = Buffer.from(entry.name, "utf8")
    const header = localHeader(name, crc, size, t)
    central.push(centralHeader(name, crc, size, t, offset, false))
    yield header
    let sent = 0
    if (size > 0) {
      for await (const chunk of createReadStream(entry.path, { highWaterMark: 1 << 20, end: size - 1 })) {
        const buf = chunk as Buffer
        sent += buf.length
        yield buf
      }
    }
    if (sent !== size) throw new Error(`zip: ${entry.name} changed while it was being sent`)
    offset += header.length + size
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  yield Buffer.concat([cd, end])
}

/** The archive as a web stream, pulled at the reader's pace. A client that goes away stops the reads. */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const chunks = zipChunks(entries)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await chunks.return(undefined)
    },
  })
}

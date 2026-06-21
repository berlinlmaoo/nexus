export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { mkdir, writeFile, readFile, rm, stat, readdir, rename, unlink } from "fs/promises"
import { createReadStream, createWriteStream } from "fs"
import { Readable, Transform } from "stream"
import { pipeline } from "stream/promises"
import { tmpdir } from "os"
import path from "path"
import { resolveMime } from "@/lib/mime"
import { checkProjectAccess } from "@/lib/rbac"

// Chunked attachment upload — lets files larger than Cloudflare's ~100MB request-body cap through by
// splitting them client-side into sub-100MB chunks (each passes CF normally), then reassembling here.
// Stays fully behind Cloudflare (same-origin, same auth) — no origin exposure, no CORS.
//
// Wire contract: metadata in the query string, the chunk bytes as the RAW request body (NOT multipart),
// so the chunk streams straight to disk at constant memory instead of being buffered whole.
// Temp parts live under os.tmpdir()/nexus-chunk-uploads/<userId>/<uploadId>/ (NOT under public/uploads,
// so /api/files can never serve a half-uploaded part). The final file is published atomically into the
// mounted attachments dir and an Attachment row is created — same persisted shape as the single-shot route.

const MAX_SIZE = 1024 * 1024 * 1024 // 1GB final-file cap (chunks stay <100MB so Cloudflare passes them)
const MAX_CHUNK = 100 * 1024 * 1024 // per-chunk hard ceiling (CF lets <100MB through)
const MAX_CHUNKS = 64 // bounds a session
const MAX_SESSIONS_PER_USER = 4 // caps concurrent in-flight uploads per user (disk-DoS guard)
const CHUNK_ROOT = path.join(tmpdir(), "nexus-chunk-uploads")
const SWEEP_AGE_MS = 60 * 60 * 1000 // reap sessions idle >1h
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

// userId comes from the session (trusted); uploadId is regex-validated. Confine the dir to exactly
// CHUNK_ROOT/<userId>/<uploadId> — reject anything that resolves elsewhere (path-traversal guard).
function sessionDir(userId: string, uploadId: string): string {
  const root = path.resolve(CHUNK_ROOT)
  const dir = path.resolve(root, userId, uploadId)
  if (path.dirname(path.dirname(dir)) !== root) throw new Error("bad session path")
  return dir
}

// Reap abandoned sessions (tab closed, never finalized). Never throws.
async function sweepOld() {
  try {
    const now = Date.now()
    for (const u of await readdir(CHUNK_ROOT)) {
      const udir = path.join(CHUNK_ROOT, u)
      let sessions: string[] = []
      try {
        sessions = await readdir(udir)
      } catch {
        continue
      }
      for (const s of sessions) {
        const sdir = path.join(udir, s)
        try {
          if (now - (await stat(sdir)).mtimeMs > SWEEP_AGE_MS) await rm(sdir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
      try {
        if ((await readdir(udir)).length === 0) await rm(udir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* CHUNK_ROOT may not exist yet */
  }
}

// Proactive backstop: reap stale sessions even if no new upload ever starts (closes the "never send
// chunk 0" disk-fill vector). One unref'd timer per process.
const _g = globalThis as unknown as { __nexusChunkSweep?: ReturnType<typeof setInterval> }
if (!_g.__nexusChunkSweep) {
  _g.__nexusChunkSweep = setInterval(() => void sweepOld(), 15 * 60 * 1000)
  _g.__nexusChunkSweep.unref?.()
}

// Hard byte cap while streaming a chunk to disk (defense-in-depth vs a lying Content-Length).
function byteLimiter(maxBytes: number): Transform {
  let seen = 0
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length
      if (seen > maxBytes) cb(new Error("chunk exceeds size budget"))
      else cb(null, chunk)
    },
  })
}

// Sum on-disk part sizes, optionally excluding one index (so an idempotent re-upload of the same index
// doesn't double-count). Bounds total session disk against the declared size on every write.
async function partsBytes(dir: string, excludeIndex: number): Promise<number> {
  let total = 0
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    return 0
  }
  for (const f of entries) {
    if (!f.endsWith(".part") || f === `${excludeIndex}.part`) continue
    try {
      total += (await stat(path.join(dir, f))).size
    } catch {
      /* ignore */
    }
  }
  return total
}

// Stream-concat parts 0..n-1 into outPath (constant memory). On any read/write error, destroy the write
// stream (no fd leak) and unlink the partial output.
async function concatToFile(dir: string, totalChunks: number, outPath: string): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(outPath)
      const fail = (e: unknown) => {
        out.destroy()
        reject(e instanceof Error ? e : new Error(String(e)))
      }
      out.on("error", fail)
      out.on("finish", () => resolve())
      let i = 0
      const next = () => {
        if (i >= totalChunks) {
          out.end()
          return
        }
        const inp = createReadStream(path.join(dir, `${i}.part`))
        inp.on("error", fail)
        inp.on("end", () => {
          i += 1
          next()
        })
        inp.pipe(out, { end: false })
      }
      next()
    })
  } catch (e) {
    await rm(outPath, { force: true }).catch(() => {})
    throw e
  }
}

export async function POST(request: NextRequest) {
  let finalPath: string | null = null
  let committed = false
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const sp = request.nextUrl.searchParams
    const uploadId = sp.get("uploadId") ?? ""
    const chunkIndex = Number(sp.get("chunkIndex"))
    const totalChunks = Number(sp.get("totalChunks"))
    const totalSize = Number(sp.get("totalSize"))
    const filename = sp.get("filename") ?? ""
    const mimeType = sp.get("mime") || "application/octet-stream"
    const taskId = sp.get("taskId") ?? ""
    const contentLength = Number(request.headers.get("content-length") ?? "NaN")

    // ---- validate the envelope (fail closed on anything malformed) ----
    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: "Bad uploadId" }, { status: 400 })
    if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS)
      return NextResponse.json({ error: "Bad totalChunks" }, { status: 400 })
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks)
      return NextResponse.json({ error: "Bad chunkIndex" }, { status: 400 })
    if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > MAX_SIZE)
      return NextResponse.json({ error: "File too large. Maximum size is 1GB" }, { status: 400 })
    if (!filename) return NextResponse.json({ error: "filename is required" }, { status: 400 })
    if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 })
    if (!request.body) return NextResponse.json({ error: "No chunk body" }, { status: 400 })
    if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_CHUNK)
      return NextResponse.json({ error: "Bad chunk size" }, { status: 400 })

    const sdir = sessionDir(userId, uploadId)
    const donePath = path.join(sdir, ".done")

    // Idempotent short-circuit: a retried request after a successful finalize returns the stored row
    // (fixes lost-finalize-response → false failure + duplicate).
    try {
      const stored = JSON.parse(await readFile(donePath, "utf8"))
      if (stored?.id) return NextResponse.json(stored, { status: 200 })
    } catch {
      /* not finalized */
    }

    // Task must exist AND the user must be a member of its project — re-checked on EVERY chunk so a
    // "skip chunk 0" attacker can't bypass it (and can't upload into another workspace's task).
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { taskList: { select: { projectId: true } } } })
    if (!task?.taskList?.projectId) return NextResponse.json({ error: "Task not found" }, { status: 404 })
    if (!(await checkProjectAccess(userId, task.taskList.projectId, ["MEMBER"])).allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Per-user concurrent-session cap, enforced when opening a NEW session.
    let isNewSession = false
    try {
      await stat(sdir)
    } catch {
      isNewSession = true
    }
    if (isNewSession) {
      const userDir = path.join(CHUNK_ROOT, userId)
      const count = async () => {
        try {
          return (await readdir(userDir)).length
        } catch {
          return 0
        }
      }
      if ((await count()) >= MAX_SESSIONS_PER_USER) {
        await sweepOld()
        if ((await count()) >= MAX_SESSIONS_PER_USER)
          return NextResponse.json({ error: "Terlalu banyak upload berjalan. Coba lagi sebentar." }, { status: 429 })
      }
    }

    await mkdir(sdir, { recursive: true })

    // Running cumulative cap: existing parts (excluding this index for idempotent retry) + this chunk
    // must not exceed the declared size. Makes the 250MB ceiling real DURING upload, not just at finalize.
    const budgetCap = Math.min(totalSize, MAX_SIZE)
    const remaining = budgetCap - (await partsBytes(sdir, chunkIndex))
    if (remaining <= 0 || contentLength > remaining)
      return NextResponse.json({ error: "Exceeds declared size" }, { status: 413 })

    // Stream the chunk straight to disk (constant memory), capped at the remaining budget.
    const partPath = path.join(sdir, `${chunkIndex}.part`)
    try {
      await pipeline(
        Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
        byteLimiter(Math.min(MAX_CHUNK, remaining)),
        createWriteStream(partPath)
      )
    } catch {
      await unlink(partPath).catch(() => {})
      return NextResponse.json({ error: "Chunk write failed" }, { status: 400 })
    }

    // Not the last chunk → acknowledge and wait for the rest.
    if (chunkIndex !== totalChunks - 1) return NextResponse.json({ ok: true, received: chunkIndex }, { status: 200 })

    // ---- finalize, serialized per session via an atomic lock dir ----
    const lockPath = path.join(sdir, ".lock")
    try {
      await mkdir(lockPath) // non-recursive → throws EEXIST if another finalize already holds it
    } catch {
      try {
        const stored = JSON.parse(await readFile(donePath, "utf8"))
        if (stored?.id) return NextResponse.json(stored, { status: 200 })
      } catch {
        /* still in progress */
      }
      return NextResponse.json({ error: "Finalize lagi jalan, coba lagi." }, { status: 409 })
    }

    try {
      // Re-check completion under the lock.
      try {
        const stored = JSON.parse(await readFile(donePath, "utf8"))
        if (stored?.id) return NextResponse.json(stored, { status: 200 })
      } catch {
        /* proceed */
      }

      // Verify every part is present and the sizes add up exactly.
      let assembled = 0
      for (let i = 0; i < totalChunks; i++) {
        try {
          assembled += (await stat(path.join(sdir, `${i}.part`))).size
        } catch {
          return NextResponse.json({ error: `Missing chunk ${i}` }, { status: 400 })
        }
      }
      if (assembled !== totalSize || assembled > MAX_SIZE)
        return NextResponse.json({ error: "Size mismatch" }, { status: 400 })

      // Re-check the task at finalize (it could have been deleted mid-upload).
      const t2 = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } })
      if (!t2) return NextResponse.json({ error: "Task not found" }, { status: 404 })

      const uploadDir = path.join(process.cwd(), "public", "uploads", "attachments")
      await mkdir(uploadDir, { recursive: true })
      const ext = path.extname(filename) || ""
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
      finalPath = path.join(uploadDir, safeName)

      // Concat to a temp name, then atomically publish — a reader never sees a partial file.
      await concatToFile(sdir, totalChunks, `${finalPath}.partial`)
      await rename(`${finalPath}.partial`, finalPath)

      const attachment = await prisma.attachment.create({
        data: {
          filename,
          url: `/api/files/attachments/${safeName}`,
          mimeType: resolveMime(mimeType, filename),
          size: assembled,
          taskId,
          uploaderId: userId,
        },
      })
      committed = true

      // Mark done (so a lost-response retry is idempotent) BEFORE reclaiming the big temp parts.
      await writeFile(donePath, JSON.stringify(attachment)).catch(() => {})
      for (let i = 0; i < totalChunks; i++) await unlink(path.join(sdir, `${i}.part`)).catch(() => {})

      try {
        logAudit({
          action: "create",
          entityType: "attachment",
          entityId: attachment.id,
          entityName: filename,
          userId,
          request,
          metadata: { taskId, mimeType, size: assembled, chunked: true },
        })
      } catch {
        /* audit is best-effort */
      }

      return NextResponse.json(attachment, { status: 201 })
    } finally {
      await rm(lockPath, { recursive: true, force: true }).catch(() => {})
    }
  } catch (error) {
    console.error("Error in chunked upload:", error)
    // Only clean up the published file if we never committed the row (avoid deleting a real attachment).
    if (finalPath && !committed) {
      await unlink(finalPath).catch(() => {})
      await unlink(`${finalPath}.partial`).catch(() => {})
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

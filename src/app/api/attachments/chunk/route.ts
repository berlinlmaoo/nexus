export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { pingSubmitter } from "@/lib/submission-ping"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { emitVaultChanged } from "@/lib/socket-emitter"
import { mkdir, writeFile, readFile, rm, stat, readdir, rename, unlink } from "fs/promises"
import { createReadStream, createWriteStream } from "fs"
import { tmpdir } from "os"
import path from "path"
import { randomUUID } from "crypto"
import { resolveMime } from "@/lib/mime"
import { checkProjectAccess } from "@/lib/rbac"
import {
  getVaultActor,
  canWriteItem,
  cleanItemName,
  uniqueNameInFolder,
  newStorageKey,
  ensureStorageDir,
  assertLiveFolderTx,
  lockVaultQuota,
  lockVaultTree,
  reserveVaultUpload,
  vaultQuotaProblemTx,
  withFreeName,
  VaultWriteRefused,
  VAULT_ITEM_INCLUDE,
  serializeVaultItem,
  type VaultActor,
  type VaultItemRow,
} from "@/lib/vault"
import { replaceTargetFor, applyReplace, replacedRow, type ReplaceTarget } from "@/lib/vault-replace"
import { pipelineGate, dealInclude, serializeDeal } from "@/lib/pipeline-server"
import { pipelineToday } from "@/lib/pipeline"
import { MAX_DEAL_DOCUMENTS, addFileDocument, documentOut, newPipelineFile, storedDocs } from "@/lib/pipeline-documents"

// Chunked attachment upload — lets files larger than Cloudflare's ~100MB request-body cap through by
// splitting them client-side into sub-100MB chunks (each passes CF normally), then reassembling here.
// Stays fully behind Cloudflare (same-origin, same auth) — no origin exposure, no CORS.
//
// Wire contract: metadata in the query string, the chunk bytes as the RAW request body (NOT multipart),
// so the chunk streams straight to disk at constant memory instead of being buffered whole.
// Temp parts live under os.tmpdir()/nexus-chunk-uploads/<userId>/<uploadId>/ (NOT under public/uploads,
// so /api/files can never serve a half-uploaded part). The final file is published atomically into the
// mounted attachments dir and an Attachment row is created — same persisted shape as the single-shot route.

const MAX_SIZE = 1024 * 1024 * 1024 // 1GB final-file cap for task/pipeline files (chunks stay <100MB so Cloudflare passes them)
// Z Vault holds raw iPhone footage, which is routinely 1-3 GB (owner, 13 Oct 2026: "naik ke 5gb").
const VAULT_MAX_SIZE = 5 * 1024 * 1024 * 1024
const MAX_CHUNK = 100 * 1024 * 1024 // per-chunk hard ceiling (CF lets <100MB through)
const MAX_CHUNKS = 400 // bounds a session; web/iOS send 16 MiB chunks, so 5 GB is 320
const MAX_SESSIONS_PER_USER = 4 // caps concurrent in-flight uploads per user (disk-DoS guard)
// NEXUS_CHUNK_DIR: a directory shared by both blue-green slots, so an upload that straddles a switch
// finishes on the new slot instead of losing its parts with the old container's /tmp.
const CHUNK_ROOT = process.env.NEXUS_CHUNK_DIR || path.join(tmpdir(), "nexus-chunk-uploads")
const SWEEP_AGE_MS = 60 * 60 * 1000 // reap sessions idle >1h
// At the session cap (13 Oct 2026): an unfinished session idle this long is abandoned — the web and
// iOS clients send a chunk every few seconds, and give up after three tries — so it stops holding a slot.
const STALE_SESSION_MS = 10 * 60 * 1000
// A new session for the SAME file (same target, name, size and destination) means the client gave up
// on the old one and started over (a new uploadId each attempt); its parts are dead weight on disk.
const SAME_FILE_IDLE_MS = 60 * 1000
const META_FILE = ".meta"
// A finalize lock older than this was left by a process that died mid-finalize (a 5 GB assembly takes about
// a minute); the next finalize may take it over instead of answering "in progress" until the sweep.
const STALE_LOCK_MS = 30 * 60 * 1000
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
          // Idle = nothing written in the session for SWEEP_AGE_MS: the newest of the dir and its files (a
          // chunk rewritten in place does not touch the dir's mtime), and never while a finalize holds its
          // lock — reaping the parts under a running assembly corrupted it (race audit 16 Oct 2026, LOW).
          let last = (await stat(sdir)).mtimeMs
          let finalizing = false
          for (const f of await readdir(sdir)) {
            try {
              const m = (await stat(path.join(sdir, f))).mtimeMs
              last = Math.max(last, m)
              if (f === ".lock" && now - m < STALE_LOCK_MS) finalizing = true
            } catch {
              /* removed meanwhile */
            }
          }
          if (!finalizing && now - last > SWEEP_AGE_MS) await rm(sdir, { recursive: true, force: true })
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
  // Reservations of uploads that stopped sending chunks no longer count (lib/vault.ts); drop the rows.
  await prisma.vaultUploadReservation.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {})
}

// Proactive backstop: reap stale sessions even if no new upload ever starts (closes the "never send
// chunk 0" disk-fill vector). One unref'd timer per process.
const _g = globalThis as unknown as { __nexusChunkSweep?: ReturnType<typeof setInterval> }
if (!_g.__nexusChunkSweep) {
  _g.__nexusChunkSweep = setInterval(() => void sweepOld(), 15 * 60 * 1000)
  _g.__nexusChunkSweep.unref?.()
}

// The request body straight to `partPath`, at most `maxBytes` (defense-in-depth vs a lying
// Content-Length). Returns false when the body went over budget or the write failed.
//
// Why not pipeline(Readable.fromWeb(request.body), …): on any failure pipeline CANCELS the web body,
// while Next keeps feeding it from the socket ('data' → controller.enqueue on a closed controller),
// which is an uncaughtException ("Invalid state: Controller is already closed") in the server log.
// So the body is always read to its end, the surplus discarded, and the file write fails on its own.
async function writeBody(body: ReadableStream<Uint8Array>, partPath: string, maxBytes: number): Promise<boolean> {
  const out = createWriteStream(partPath)
  let failed = false
  let seen = 0
  out.on("error", () => {
    failed = true
  })
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (failed) continue
      seen += value.byteLength
      if (seen > maxBytes) {
        failed = true
        continue
      }
      if (!out.write(value)) {
        await new Promise<void>((resolve) => {
          const go = () => {
            out.off("drain", go)
            out.off("error", go)
            resolve()
          }
          out.on("drain", go)
          out.on("error", go)
        })
      }
    }
  } catch {
    failed = true // the client went away mid-chunk: the stream errored on its own, nothing to cancel
  } finally {
    reader.releaseLock()
  }
  if (failed) {
    out.destroy()
    return false
  }
  return new Promise<boolean>((resolve) => {
    out.end(() => resolve(!failed))
    out.on("error", () => resolve(false))
  })
}

type SessionInfo = { dir: string; done: boolean; idleMs: number; key: string | null }

/** Every session of one user: finished or not, how long since anything was written, and which file. */
async function userSessions(userDir: string): Promise<SessionInfo[]> {
  let names: string[] = []
  try {
    names = await readdir(userDir)
  } catch {
    return []
  }
  const now = Date.now()
  const out: SessionInfo[] = []
  for (const name of names) {
    const dir = path.join(userDir, name)
    try {
      let last = (await stat(dir)).mtimeMs
      let done = false
      let key: string | null = null
      for (const f of await readdir(dir)) {
        if (f === ".done") done = true
        try {
          last = Math.max(last, (await stat(path.join(dir, f))).mtimeMs)
        } catch {
          /* removed meanwhile */
        }
      }
      try {
        key = (JSON.parse(await readFile(path.join(dir, META_FILE), "utf8")) as { key?: string }).key ?? null
      } catch {
        /* sessions from before 13 Oct 2026 carry no meta */
      }
      out.push({ dir, done, idleMs: now - last, key })
    } catch {
      /* vanished */
    }
  }
  return out
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
    const kind = sp.get("kind") === "PROOF" ? "PROOF" : "GENERAL"
    // Z Vault reuses this entire transport — the chunking, the idempotent .done marker, the
    // per-user session cap, the atomic publish — and differs only in what it authorizes against
    // and which row it writes at the end. A separate chunked route for the vault would be the
    // largest duplication in this repo, and the copy that drifts is always the one nobody tests.
    // A Pipeline deal's "Documents & links" (owner, 9 Oct 2026: "kenapa ga attach documentnya jg?") is
    // the third target: authorized as an edit of the deal, and the finished file becomes an entry on
    // the deal (lib/pipeline-documents.ts) instead of an Attachment row.
    const targetParam = sp.get("target")
    const target = targetParam === "vault" ? "vault" : targetParam === "pipeline" ? "pipeline" : "task"
    const pipelineProjectId = sp.get("projectId") ?? ""
    const pipelineDealId = sp.get("dealId") ?? ""
    const vaultParentId = sp.get("parentId") || null
    // "Replace file…" for a file too big for one request (9 Oct 2026): the same transport, and at the
    // end the bytes go in place of this item's instead of into a new row (lib/vault-replace.ts).
    const replaceItemId = target === "vault" ? sp.get("replaceItemId") || null : null
    const contentLength = Number(request.headers.get("content-length") ?? "NaN")

    // ---- validate the envelope (fail closed on anything malformed) ----
    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: "Bad uploadId" }, { status: 400 })
    // Size first: an oversized file must hear "too large", not a transport detail like "Bad totalChunks".
    const maxSize = target === "vault" ? VAULT_MAX_SIZE : MAX_SIZE
    if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > maxSize)
      return NextResponse.json(
        { error: `File terlalu besar. Maksimal ${maxSize / (1024 * 1024 * 1024)} GB per file.` },
        { status: 413 },
      )
    if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS)
      return NextResponse.json({ error: "Bad totalChunks" }, { status: 400 })
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks)
      return NextResponse.json({ error: "Bad chunkIndex" }, { status: 400 })
    if (!filename) return NextResponse.json({ error: "filename is required" }, { status: 400 })
    if (target === "task" && !taskId)
      return NextResponse.json({ error: "taskId is required" }, { status: 400 })
    if (target === "pipeline" && (!pipelineProjectId || !pipelineDealId))
      return NextResponse.json({ error: "projectId and dealId are required" }, { status: 400 })
    if (!request.body) return NextResponse.json({ error: "No chunk body" }, { status: 400 })
    if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_CHUNK)
      return NextResponse.json({ error: "Bad chunk size" }, { status: 400 })

    const sdir = sessionDir(userId, uploadId)
    const donePath = path.join(sdir, ".done")
    // Which file this session carries, so a retry of the same file can retire its abandoned session.
    const fileKey = JSON.stringify([target, filename, totalSize, replaceItemId ?? vaultParentId ?? taskId ?? "", pipelineDealId])

    // Idempotent short-circuit: a retried request after a successful finalize returns the stored row
    // (fixes lost-finalize-response → false failure + duplicate).
    try {
      const stored = JSON.parse(await readFile(donePath, "utf8"))
      if (stored?.id) return NextResponse.json(stored, { status: 200 })
    } catch {
      /* not finalized */
    }

    // Authorization is re-checked on EVERY chunk, not just the first, so a client that skips chunk 0
    // can't bypass it — for either target.
    let vaultActor: VaultActor | null = null
    let replaceTarget: ReplaceTarget | null = null
    if (target === "vault" && replaceItemId) {
      vaultActor = await getVaultActor(userId)
      const check = await replaceTargetFor(vaultActor, replaceItemId, totalSize)
      if (!check.ok) return NextResponse.json({ error: check.error, code: check.code }, { status: check.status })
      replaceTarget = check.item
    } else if (target === "vault") {
      vaultActor = await getVaultActor(userId)
      if (!vaultActor.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 })
      if (vaultParentId) {
        const parent = await prisma.vaultItem.findFirst({
          where: { id: vaultParentId, workspaceId: vaultActor.workspaceId, deletedAt: null },
          select: { kind: true },
        })
        if (!parent) return NextResponse.json({ error: "Folder tidak ada" }, { status: 404 })
        if (parent.kind !== "FOLDER") return NextResponse.json({ error: "Tujuan bukan folder" }, { status: 400 })
      }
      if (!(await canWriteItem(vaultActor, vaultParentId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      // Checked against the DECLARED total on every chunk, so a 900MB upload into a vault with 200MB
      // left is refused at the first chunk instead of after twenty minutes of transfer. Since 16 Oct 2026
      // (race audit H10) the declared size is also RESERVED, under the quota lock, so two uploads into
      // the last free gigabytes cannot both start; every chunk refreshes the reservation.
      const quotaError = await reserveVaultUpload(vaultActor.workspaceId, userId, uploadId, totalSize)
      if (quotaError) return NextResponse.json({ error: quotaError, code: "VAULT_FULL" }, { status: 507 })
    } else if (target === "pipeline") {
      // Same rule as editing the deal: a member of the board (checkProjectAccess MEMBER), a PIPELINE
      // project, a deal of that project with room for one more document.
      const gate = await pipelineGate(userId, pipelineProjectId, "write")
      if (!gate.ok) return gate.response
      const deal = await prisma.pipelineDeal.findFirst({ where: { id: pipelineDealId, projectId: pipelineProjectId }, select: { links: true } })
      if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
      if (storedDocs(deal.links).length >= MAX_DEAL_DOCUMENTS)
        return NextResponse.json({ error: `Maksimal ${MAX_DEAL_DOCUMENTS} dokumen per deal.`, code: "TOO_MANY_DOCUMENTS" }, { status: 400 })
    } else {
      // Task must exist AND the user must be a member of its project (and can't upload into another
      // workspace's task).
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { taskList: { select: { projectId: true } } } })
      if (!task?.taskList?.projectId) return NextResponse.json({ error: "Task not found" }, { status: 404 })
      if (!(await checkProjectAccess(userId, task.taskList.projectId, ["MEMBER"])).allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // Per-user concurrent-session cap, enforced when opening a NEW session.
    let isNewSession = false
    try {
      await stat(sdir)
    } catch {
      isNewSession = true
    }
    if (isNewSession) {
      // Only UNFINISHED sessions count (13 Oct 2026). A finished one keeps its .done marker for an hour
      // so a lost response can be retried, but it holds no parts — counting it made a fifth upload
      // within the hour fail with 429 even when nothing else was running.
      const userDir = path.join(CHUNK_ROOT, userId)
      const retire = async (s: SessionInfo) => {
        await rm(s.dir, { recursive: true, force: true }).catch(() => {})
      }
      let open = (await userSessions(userDir)).filter((s) => !s.done)
      // The same file started over: the old attempt is dead (a new uploadId every attempt), reclaim it.
      for (const s of open) if (s.key === fileKey && s.idleMs > SAME_FILE_IDLE_MS) await retire(s)
      open = open.filter((s) => !(s.key === fileKey && s.idleMs > SAME_FILE_IDLE_MS))
      if (open.length >= MAX_SESSIONS_PER_USER) {
        for (const s of open) if (s.idleMs > STALE_SESSION_MS) await retire(s)
        open = open.filter((s) => s.idleMs <= STALE_SESSION_MS)
        if (open.length >= MAX_SESSIONS_PER_USER)
          return NextResponse.json({ error: "Terlalu banyak upload berjalan. Coba lagi sebentar." }, { status: 429 })
      }
    }

    await mkdir(sdir, { recursive: true })
    if (isNewSession) await writeFile(path.join(sdir, META_FILE), JSON.stringify({ key: fileKey })).catch(() => {})

    // Running cumulative cap: existing parts (excluding this index for idempotent retry) + this chunk
    // must not exceed the declared size. Makes the 250MB ceiling real DURING upload, not just at finalize.
    const budgetCap = Math.min(totalSize, maxSize)
    const remaining = budgetCap - (await partsBytes(sdir, chunkIndex))
    if (remaining <= 0 || contentLength > remaining)
      return NextResponse.json({ error: "Exceeds declared size" }, { status: 413 })

    // Stream the chunk straight to disk (constant memory), capped at the remaining budget.
    // Into a temp file of THIS request, then renamed over the part (race audit 16 Oct 2026, M14): two
    // requests for the same index (a retry while the first is still streaming) used to write into one file
    // at once, and the one that failed unlinked the part the other had just finished.
    const partPath = path.join(sdir, `${chunkIndex}.part`)
    const tmpPath = `${partPath}.${randomUUID()}.tmp`
    if (!(await writeBody(request.body, tmpPath, Math.min(MAX_CHUNK, remaining)))) {
      await unlink(tmpPath).catch(() => {})
      return NextResponse.json({ error: "Chunk write failed" }, { status: 400 })
    }
    await rename(tmpPath, partPath)

    // Not the last chunk → acknowledge and wait for the rest.
    if (chunkIndex !== totalChunks - 1) return NextResponse.json({ ok: true, received: chunkIndex }, { status: 200 })

    // ---- finalize, serialized per session via an atomic lock dir ----
    const lockPath = path.join(sdir, ".lock")
    try {
      try {
        await mkdir(lockPath) // non-recursive → throws EEXIST if another finalize already holds it
      } catch (e) {
        // Left by a finalize that died: take it over once.
        if (Date.now() - (await stat(lockPath)).mtimeMs <= STALE_LOCK_MS) throw e
        await rm(lockPath, { recursive: true, force: true })
        await mkdir(lockPath)
      }
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
      if (assembled !== totalSize || assembled > maxSize)
        return NextResponse.json({ error: "Size mismatch" }, { status: 400 })

      // ── vault replace finalize ──────────────────────────────────────────────
      if (target === "vault" && replaceTarget && vaultActor?.workspaceId) {
        const storageKey = newStorageKey(filename || replaceTarget.name)
        finalPath = await ensureStorageDir(storageKey)
        await concatToFile(sdir, totalChunks, `${finalPath}.partial`)
        await rename(`${finalPath}.partial`, finalPath)

        await applyReplace({
          actor: vaultActor,
          item: replaceTarget,
          storageKey,
          mimeType: resolveMime(mimeType, filename),
          size: assembled,
          width: null,
          height: null,
          fileName: filename,
          request,
          chunked: true,
        })
        committed = true

        const payload = serializeVaultItem((await replacedRow(replaceTarget.id)) as unknown as VaultItemRow, vaultActor)
        await writeFile(donePath, JSON.stringify(payload)).catch(() => {})
        for (let i = 0; i < totalChunks; i++) await unlink(path.join(sdir, `${i}.part`)).catch(() => {})
        return NextResponse.json(payload, { status: 200 })
      }

      // ── vault finalize ──────────────────────────────────────────────────────
      if (target === "vault" && vaultActor?.workspaceId) {
        const workspaceId = vaultActor.workspaceId
        const desiredName = cleanItemName(filename, "Berkas")
        const storageKey = newStorageKey(filename || desiredName)
        finalPath = await ensureStorageDir(storageKey)

        // Same atomic publish as the task path: assemble under a .partial name, then rename. The
        // nightly backup walks this tree, and it must never pick up a half-assembled file.
        await concatToFile(sdir, totalChunks, `${finalPath}.partial`)
        await rename(`${finalPath}.partial`, finalPath)

        // The row, under the Vault's locks (race audit 16 Oct 2026, H10/M16): the folder is still live, the
        // quota is re-summed (this upload's own reservation left out, and dropped in the same transaction),
        // and the name is picked there.
        let created
        try {
          created = await withFreeName(() => prisma.$transaction(async (tx) => {
            await lockVaultTree(tx, workspaceId, "shared")
            await lockVaultQuota(tx, workspaceId)
            await assertLiveFolderTx(tx, workspaceId, vaultParentId)
            const full = await vaultQuotaProblemTx(tx, workspaceId, assembled, { own: { userId, uploadId } })
            if (full) throw new VaultWriteRefused(507, { error: full, code: "VAULT_FULL" })
            const name = await uniqueNameInFolder(workspaceId, vaultParentId, desiredName, undefined, tx)
            const row = await tx.vaultItem.create({
              data: {
                kind: "FILE",
                name,
                parentId: vaultParentId,
                workspaceId,
                uploaderId: userId,
                ownerId: userId,
                storageKey,
                mimeType: resolveMime(mimeType, filename),
                size: assembled,
              },
              include: VAULT_ITEM_INCLUDE,
            })
            await tx.vaultUploadReservation.deleteMany({ where: { userId, uploadId } })
            return row
          }))
        } catch (e) {
          if (!(e instanceof VaultWriteRefused)) throw e
          // Nothing refers to the assembled bytes: reclaim them (the parts stay, so a retry can finalize again).
          await unlink(finalPath).catch(() => {})
          finalPath = null
          await prisma.vaultUploadReservation.deleteMany({ where: { userId, uploadId } }).catch(() => {})
          return NextResponse.json(e.body, { status: e.status })
        }
        committed = true
        const name = created.name

        const payload = serializeVaultItem(created as unknown as VaultItemRow, vaultActor)
        // Mark done BEFORE reclaiming the parts, so a lost response retries into the stored row
        // instead of uploading the whole file a second time.
        await writeFile(donePath, JSON.stringify(payload)).catch(() => {})
        for (let i = 0; i < totalChunks; i++) await unlink(path.join(sdir, `${i}.part`)).catch(() => {})

        try {
          logAudit({
            action: "create",
            entityType: "vault_file",
            entityId: created.id,
            entityName: name,
            userId,
            request,
            metadata: { parentId: vaultParentId, size: assembled, chunked: true },
          })
        } catch {
          /* audit is best-effort */
        }
        emitVaultChanged(vaultActor.workspaceId, userId)

        return NextResponse.json(payload, { status: 201 })
      }

      // ── pipeline finalize ───────────────────────────────────────────────────
      if (target === "pipeline") {
        const stored = await newPipelineFile(filename)
        finalPath = stored.fullPath
        await concatToFile(sdir, totalChunks, `${finalPath}.partial`)
        await rename(`${finalPath}.partial`, finalPath)

        const added = await addFileDocument({
          projectId: pipelineProjectId,
          dealId: pipelineDealId,
          userId,
          storageKey: stored.storageKey,
          fileName: filename,
          mimeType: resolveMime(mimeType, filename),
          size: assembled,
          type: sp.get("docType"),
          label: sp.get("label"),
          request,
        })
        if (!added.ok) {
          // Nothing refers to the bytes: the deal went (deleted mid-upload) or filled up meanwhile.
          await unlink(finalPath).catch(() => {})
          finalPath = null
          return added.code === "DEAL_NOT_FOUND"
            ? NextResponse.json({ error: "Deal not found" }, { status: 404 })
            : NextResponse.json({ error: `Maksimal ${MAX_DEAL_DOCUMENTS} dokumen per deal.`, code: "TOO_MANY_DOCUMENTS" }, { status: 400 })
        }
        committed = true

        // `id` is the new entry's (the web's uploadChunked expects one); `deal` replaces the client's copy.
        const fresh = await prisma.pipelineDeal.findFirst({ where: { id: pipelineDealId }, include: dealInclude })
        const payload = {
          id: added.doc.id,
          document: documentOut(pipelineProjectId, pipelineDealId, added.doc),
          deal: fresh ? serializeDeal(fresh, pipelineToday()) : null,
        }
        await writeFile(donePath, JSON.stringify(payload)).catch(() => {})
        for (let i = 0; i < totalChunks; i++) await unlink(path.join(sdir, `${i}.part`)).catch(() => {})
        return NextResponse.json(payload, { status: 201 })
      }

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
          kind,
          taskId,
          uploaderId: userId,
        },
      })
      committed = true
      void pingSubmitter(taskId, userId) // Bukti Pencairan shows up on the submitter's board live

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

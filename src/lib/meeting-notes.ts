import { createReadStream } from "fs"
import { mkdir, open, rename, rm, stat } from "fs/promises"
import path from "path"
import { Readable } from "stream"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { createLogger } from "@/lib/logger"
import { askGideon } from "@/lib/gideon-chat"
import { decideTier } from "@/lib/gideon-credits"
import { getAppConfig } from "@/lib/app-config"
import { checkProjectAccess, projectAccessLevel, LEVEL_RANK, type AccessLevel } from "@/lib/rbac"
import { isSingletonLeader } from "@/lib/bluegreen"
import { eventBus, BUS_EVENTS } from "@/lib/event-bus"
import { emitTaskCreated } from "@/lib/socket-emitter"
import { reportModel0 } from "@/lib/gideon-tier-status"
import { createInAppNotification, notifyTaskAssigned } from "@/lib/notification-service"
import { bi } from "@/lib/notification-text"
import { seedTaskCustomFieldValues } from "@/lib/custom-field-sync"
import { executeAutomations } from "@/lib/automation-engine"
import { logAudit } from "@/lib/audit"
import { docToText, sanitizeDoc } from "@/lib/blockdoc"
import {
  buildMinutesDoc, chunkLines, chunkNotesPrompt, cleanMom, cleanProposals, cleanSegments, cleanSpeakers, clock, compactNotes, draftToProposals,
  autoMatchCandidates, introNames, mergeNotesPrompt, mergeSpeakers, minutesPrompt, parseMinutes, transcriptLines, type MeetingPromptMeta, type MemberLite, type Mom,
  type NameCandidate, type TaskProposal, type TranscriptSegment,
} from "@/lib/meeting-notes-core"

/**
 * Meeting notes, Beta (owner, 18 Oct 2026). A recording → a transcript → GIDEON's overview, minutes and proposed
 * tasks → the person edits → Apply saves the minutes as a Doc in the project and creates the ticked tasks.
 *
 *  - Upload: POST /api/meetings, then the bytes in chunks (PUT …/audio?offset=, resumable: Cloudflare caps one
 *    request at 100 MB), then POST …/audio/complete (size + magic bytes checked) → QUEUED.
 *  - Transcript: Whisper on the office GPU (MEETING_WHISPER_URL, shared secret MEETING_WHISPER_SECRET). The audio
 *    never leaves the building. The service runs one job at a time and unloads GIDEON Model 0 while it does; it
 *    reports Model 0's state on /health, which this ticker copies to lib/gideon-tier-status.ts.
 *  - Minutes: askGideon as the uploader (their access, their GIDEON credits; default tier Phaëthon, Aphrodite when
 *    out of credits in phase 2). A long transcript is read in parts (the shim takes 16 000 characters a call).
 *  - Apply: one transaction that first claims READY → APPLYING (a conditional update: a double tap or a second
 *    device gets 409), then creates the Doc and the tasks. Nothing exists in the project before Apply.
 *
 * The clock (startMeetingTicker) runs only on the blue-green leader and stands down on a read-only replica. State
 * lives in MeetingNote rows, so a restart or a slot switch picks up where it left off.
 */
const log = createLogger("meeting-notes")

export const MEETING_DIR = process.env.NEXUS_MEETING_DIR || path.join(process.cwd(), "data", "meetings")
/** Bytes per upload request. Under Cloudflare's 100 MB request cap with room to spare; small enough to retry cheaply. */
export const MEETING_CHUNK_BYTES = 8 * 1024 * 1024
export const MEETING_MAX_CHUNK = 16 * 1024 * 1024
// cuid (before the 18 Oct 2026 UUIDv7 conversion) or UUID; ids name audio files, so no "/" or ".".
const ID_RE = /^[a-z0-9-]{10,40}$/i

export type MeetingRow = Awaited<ReturnType<typeof prisma.meetingNote.findUnique>> & {}

export function isMeetingId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id)
}

export function audioFile(row: { id: string; audioExt: string | null }, part = false): string {
  if (!isMeetingId(row.id)) throw new Error("bad meeting id")
  return path.join(MEETING_DIR, `${row.id}.${row.audioExt || "bin"}${part ? ".part" : ""}`)
}

// ---------------------------------------------------------------- settings

export type MeetingSettings = { enabled: boolean; retentionDays: number; maxMinutes: number; maxBytes: number }

export async function meetingSettings(): Promise<MeetingSettings> {
  const cfg = await getAppConfig(null).catch(() => null)
  const v = (cfg?.values ?? {}) as Record<string, unknown>
  const num = (x: unknown, d: number, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)
  return {
    enabled: cfg?.flags?.meetingNotesEnabled !== false,
    retentionDays: num(v.meetingAudioRetentionDays, 30, 0, 3650),
    maxMinutes: num(v.meetingMaxMinutes, 180, 1, 600),
    maxBytes: num(v.meetingMaxMB, 500, 1, 2000) * 1024 * 1024,
  }
}

// ---------------------------------------------------------------- access

export type MeetingAccess = { view: boolean; edit: boolean; remove: boolean; level: AccessLevel | null; owner: boolean }

/**
 * Who sees a meeting (owner, 18 Oct 2026): the uploader, and the people with access to its project. Editing the
 * minutes and Apply: the uploader or Can edit on the project. Delete: the uploader or Full access.
 */
export async function meetingAccess(userId: string, row: { createdById: string; projectId: string | null }): Promise<MeetingAccess> {
  const owner = row.createdById === userId
  const level = row.projectId ? await projectAccessLevel(userId, row.projectId).catch(() => null) : null
  const rank = level ? LEVEL_RANK[level] : 0
  return { owner, level, view: owner || rank >= LEVEL_RANK.VIEW, edit: owner || rank >= LEVEL_RANK.EDIT, remove: owner || rank >= LEVEL_RANK.FULL }
}

// ---------------------------------------------------------------- shape on the wire

const num = (b: bigint | number | null | undefined) => (b === null || b === undefined ? 0 : Number(b))

// ---------------------------------------------------------------- queue / ETA (owner, 18 Oct 2026)

/** Measured on the office GPU: ~1.8 min per hour of audio, plus ~45 s per job (model load, Model 0 window). */
const TRANSCRIBE_SEC_PER_AUDIO_SEC = 1.8 / 60
const TRANSCRIBE_JOB_OVERHEAD_SEC = 45
/** Speaker labels on top (word timings + voices on the CPU): measured 19 Oct 2026, 112 s → 157 s for 66 min of audio. */
const SPEAKERS_SEC_PER_AUDIO_SEC = 0.7 / 60
/** GIDEON writing the minutes: ~40 s, plus ~1 min per hour of audio (more parts to read). */
const SUMMARY_BASE_SEC = 40
const SUMMARY_SEC_PER_AUDIO_SEC = 60 / 3600

function audioSecOf(r: { durationSec: number | null; audioBytes: bigint | number }): number {
  // Unknown duration: estimated from the size at ~48 kbit/s.
  return r.durationSec && r.durationSec > 0 ? r.durationSec : Math.max(60, Number(r.audioBytes) / 6000)
}
const transcribeSec = (r: { durationSec: number | null; audioBytes: bigint | number; speakerLabels?: boolean | null }) =>
  TRANSCRIBE_JOB_OVERHEAD_SEC + audioSecOf(r) * (TRANSCRIBE_SEC_PER_AUDIO_SEC + (r.speakerLabels === false ? 0 : SPEAKERS_SEC_PER_AUDIO_SEC))
const summarySec = (r: { durationSec: number | null; audioBytes: bigint | number }) => SUMMARY_BASE_SEC + audioSecOf(r) * SUMMARY_SEC_PER_AUDIO_SEC

export type MeetingQueue = { waiting: boolean; position: number | null; etaSec: number }

/**
 * Where a meeting stands in line and roughly how long until the minutes are ready. Position counts the
 * recordings still waiting for (or in) the transcriber that started before this one (ids never leave the server),
 * and the transcriber's own queue position when it is higher (dev and prod share it).
 */
export async function meetingQueue(row: NonNullable<MeetingRow>): Promise<MeetingQueue | null> {
  if (!["QUEUED", "TRANSCRIBING", "SUMMARIZING"].includes(row.status)) return null
  const own = { durationSec: row.durationSec, audioBytes: row.audioBytes, speakerLabels: row.speakerLabels }
  if (row.status === "SUMMARIZING") return { waiting: false, position: null, etaSec: Math.round(summarySec(own) * (1 - Math.min(0.9, row.progress || 0))) }
  const stats = (row.transcribeStats && typeof row.transcribeStats === "object" ? row.transcribeStats : {}) as { state?: string; position?: number | null }
  const running = row.status === "TRANSCRIBING" && stats.state === "running"
  const since = row.stageStartedAt ?? row.createdAt
  const ahead = running ? [] : await prisma.meetingNote.findMany({
    where: { id: { not: row.id }, status: { in: ["QUEUED", "TRANSCRIBING"] }, OR: [{ stageStartedAt: { lt: since } }, { stageStartedAt: null, createdAt: { lt: since } }] },
    select: { durationSec: true, audioBytes: true, progress: true, status: true, speakerLabels: true },
    take: 50,
  }).catch(() => [])
  const transPos = typeof stats.position === "number" && stats.position > 0 ? stats.position : null
  const position = running ? 0 : Math.max(ahead.length + 1, transPos ?? 0)
  // Recordings ahead that this server cannot see (the other server's) count as an average 30-minute meeting.
  const unseen = Math.max(0, position - 1 - ahead.length)
  const aheadSec = ahead.reduce((n, r) => n + transcribeSec(r) * (r.status === "TRANSCRIBING" ? 1 - Math.min(0.9, r.progress || 0) : 1), 0) + unseen * transcribeSec({ durationSec: 1800, audioBytes: 0 })
  const ownSec = transcribeSec(own) * (running ? 1 - Math.min(0.9, row.progress || 0) : 1) + summarySec(own)
  return { waiting: !running, position: running ? null : position, etaSec: Math.round(aheadSec + ownSec) }
}

export async function serializeMeeting(row: NonNullable<MeetingRow>, access: MeetingAccess, opts: { full?: boolean } = {}) {
  const [project, creator, doc, tasks] = await Promise.all([
    row.projectId ? prisma.project.findUnique({ where: { id: row.projectId }, select: { id: true, name: true, icon: true } }).catch(() => null) : null,
    prisma.user.findUnique({ where: { id: row.createdById }, select: { id: true, name: true, avatar: true } }).catch(() => null),
    row.docId ? prisma.doc.findUnique({ where: { id: row.docId }, select: { id: true, title: true, projectId: true } }).catch(() => null) : null,
    opts.full && row.taskIds?.length
      ? prisma.task.findMany({ where: { id: { in: row.taskIds } }, select: { id: true, title: true, status: true, dueDate: true, taskList: { select: { projectId: true, name: true } }, assignees: { select: { user: { select: { id: true, name: true, avatar: true } } } } } }).catch(() => [])
      : [],
  ])
  const base = {
    id: row.id,
    title: row.title,
    status: row.status,
    progress: row.progress,
    language: row.language,
    source: row.source,
    projectId: row.projectId,
    project: project ? { id: project.id, name: project.name, icon: project.icon ?? null } : null,
    createdBy: creator ? { id: creator.id, name: creator.name, avatar: creator.avatar } : { id: row.createdById, name: null, avatar: null },
    audio: {
      name: row.audioName,
      mime: row.audioMime,
      bytes: num(row.audioBytes),
      received: num(row.audioReceived),
      available: !row.audioDeletedAt && (row.status !== "UPLOADING"),
      deletedAt: row.audioDeletedAt?.toISOString() ?? null,
      deleteAfter: row.audioDeleteAfter?.toISOString() ?? null,
    },
    durationSec: row.durationSec,
    recordedAt: row.recordedAt?.toISOString() ?? null,
    speakerLabels: row.speakerLabels !== false,
    introEndSec: row.introEndSec ?? null,
    detectedLanguage: row.detectedLanguage,
    tier: row.tier,
    doc: doc ? { id: doc.id, title: doc.title, url: `/docs/${doc.id}` } : null,
    taskCount: row.taskIds?.length ?? 0,
    error: row.error,
    errorCode: row.errorCode,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    beta: true,
    queue: await meetingQueue(row).catch(() => null),
    can: { edit: access.edit && !["APPLYING", "APPLIED"].includes(row.status), apply: access.edit && row.status === "READY", delete: access.remove, retry: access.edit && (row.status === "FAILED" || row.status === "READY") },
  }
  if (!opts.full) return base
  return {
    ...base,
    overview: row.overview,
    mom: row.mom ? cleanMom(row.mom) : null,
    proposals: cleanProposals(row.proposals),
    speakers: cleanSpeakers(row.speakers),
    transcript: cleanSegments(row.transcript),
    transcribeStats: row.transcribeStats ?? null,
    tasks: (tasks as Array<{ id: string; title: string; status: string; dueDate: Date | null; taskList: { projectId: string; name: string }; assignees: Array<{ user: { id: string; name: string | null; avatar: string | null } }> }>).map((t) => ({
      id: t.id, title: t.title, status: t.status, dueDate: t.dueDate?.toISOString() ?? null, projectId: t.taskList.projectId, section: t.taskList.name,
      assignees: t.assignees.map((a) => a.user),
    })),
  }
}

/** `meeting-changed` → the uploader's devices and the project's room. Ids + status only: clients refetch. */
export function emitMeetingChanged(row: { id: string; createdById: string; projectId: string | null; status: string; progress: number; version: number }, extra: { deleted?: boolean } = {}) {
  try {
    eventBus.emit(BUS_EVENTS.MEETING_CHANGED, {
      userId: row.createdById,
      projectId: row.projectId,
      payload: { meetingId: row.id, projectId: row.projectId, status: row.status, progress: Math.round(row.progress * 100) / 100, version: row.version, ...(extra.deleted ? { deleted: true } : {}) },
    })
  } catch (error) {
    log.warn("meeting-changed emit failed", { error: String(error) })
  }
}

/**
 * `bumpVersion: false` for the transcriber's own progress readings (QA final 19 Oct 2026, D-9): they are not an
 * edit, so they must not turn a person's title edit made meanwhile into a 409 VERSION_CONFLICT.
 */
async function patchMeeting(id: string, data: Prisma.MeetingNoteUpdateInput, where: Prisma.MeetingNoteWhereInput = {}, opts: { bumpVersion?: boolean } = {}): Promise<boolean> {
  const bump = opts.bumpVersion !== false
  const res = await prisma.meetingNote.updateMany({ where: { id, ...where }, data: { ...data, ...(bump ? { version: { increment: 1 } } : {}) } as Prisma.MeetingNoteUpdateManyMutationInput })
  if (res.count) {
    const row = await prisma.meetingNote.findUnique({ where: { id } })
    if (row) {
      emitMeetingChanged(row)
      // A meeting that just failed tells its uploader why (and whether a retry can help). Only the update that
      // made it FAILED gets here (conditional updates), and the dedupe key makes a repeat a no-op anyway.
      if (data.status === "FAILED" && row.status === "FAILED") void notifyMeeting(row, "failed")
    }
  }
  return res.count > 0
}

// ---------------------------------------------------------------- notifications (owner, 18 Oct 2026)

/** The Indonesian twin of each failure sentence (the row keeps the English one; clients translate it themselves). */
const FAIL_ID: Record<string, string> = {
  audio_missing: "Rekamannya sudah tidak ada di server.",
  too_large: "Rekaman terlalu besar untuk ditranskrip.",
  transcriber_unreachable: "Layanan transkripsi tidak bisa dihubungi.",
  too_long: "Rekaman lebih panjang dari batas.",
  undecodable: "File ini tidak berisi audio yang bisa dibaca.",
  gpu_busy: "GPU kantor terlalu lama sibuk.",
  transcribe_failed: "Transkrip gagal.",
  no_speech: "Tidak ada suara bicara di rekaman.",
  owner_gone: "Orang yang mengunggah ini sudah tidak bisa memakai GIDEON.",
  gideon_off: "GIDEON belum tersambung di server ini.",
  credits_exhausted: "Kredit GIDEON-mu habis untuk hari ini.",
  gideon_failed: "GIDEON tidak bisa menulis notulen.",
  upload_abandoned: "Unggahan tidak selesai.",
  unsupported_type: "File ini bukan audio sesuai tipe di namanya.",
}
/** Failures a retry cannot fix (the file itself is the problem, or it is gone). */
export const MEETING_FINAL_ERRORS = new Set(["unsupported_type", "too_long", "too_large", "undecodable", "upload_abandoned", "audio_missing", "no_speech", "owner_gone", "deleted"])

/**
 * READY / FAILED → an in-app notification + push to the uploader (APNs / FCM / web), deep-linked to /meetings/<id>.
 * One per outcome: the dedupe key carries the stage's start (a retry starts a new stage, so its outcome is told
 * again; a ticker that runs the same stage twice is told once). No project id on purpose: clients open the
 * project for a notification that carries one, and this one belongs to the meeting. Never throws.
 */
export async function notifyMeeting(row: NonNullable<MeetingRow>, kind: "ready" | "failed"): Promise<void> {
  try {
    if (kind === "failed" && row.errorCode === "deleted") return
    const title = (row.title || row.audioName || "Meeting").slice(0, 120)
    const stage = (row.stageStartedAt ?? row.createdAt).getTime()
    const retry = kind === "failed" && !MEETING_FINAL_ERRORS.has(row.errorCode ?? "")
    const why = (row.error || "Something went wrong.").replace(/\s*Try again(?: later)?\.?$/i, "").trim()
    const whyId = FAIL_ID[row.errorCode ?? ""] ?? "Terjadi kesalahan."
    const texts = kind === "ready"
      ? bi(
          [`Meeting notes ready: ${title}`, "Review the minutes and tasks, then press Apply."],
          [`Catatan meeting siap: ${title}`, "Cek notulen dan task-nya, lalu tekan Terapkan."],
        )
      : bi(
          [`Meeting notes failed: ${title}`, `${why}${retry ? " Open the meeting and press Try again." : ""}`],
          [`Catatan meeting gagal: ${title}`, `${whyId}${retry ? " Buka meeting-nya lalu tekan Coba lagi." : ""}`],
        )
    await createInAppNotification({
      userId: row.createdById,
      type: kind === "ready" ? "meeting_notes_ready" : "meeting_notes_failed",
      ...texts,
      link: `/meetings/${row.id}`,
      push: true,
      pushData: { meetingId: row.id },
      pushThreadId: `meeting-${row.id}`,
      dedupeKey: `meeting-${kind}:${row.id}:${stage}`,
    })
  } catch (error) {
    log.warn("meeting notification failed", { meetingId: row.id, kind, error: String(error) })
  }
}

// ---------------------------------------------------------------- upload

/** Write one chunk at `offset` (pwrite: a retried chunk overwrites itself instead of appending twice). */
export async function writeAudioChunk(row: NonNullable<MeetingRow>, offset: number, body: ReadableStream<Uint8Array>, maxLen: number): Promise<{ written: number; head: Uint8Array | null }> {
  await mkdir(MEETING_DIR, { recursive: true, mode: 0o700 })
  const file = audioFile(row, true)
  const fh = await open(file, offset === 0 ? "w" : "r+", 0o600)
  let pos = offset
  let head: Uint8Array | null = null
  try {
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.length) continue
      if (pos - offset + value.length > maxLen) { await reader.cancel().catch(() => {}); throw Object.assign(new Error("chunk too large"), { code: "CHUNK_TOO_LARGE" }) }
      if (offset === 0 && (!head || head.length < 64)) {
        const prev: Uint8Array = head ?? new Uint8Array(0)
        const next: Uint8Array = new Uint8Array(Math.min(64, prev.length + value.length))
        next.set(prev)
        next.set(value.subarray(0, next.length - prev.length), prev.length)
        head = next
      }
      await fh.write(value, 0, value.length, pos)
      pos += value.length
    }
  } finally {
    await fh.close()
  }
  return { written: pos - offset, head }
}

export async function finishAudio(row: NonNullable<MeetingRow>): Promise<void> {
  await rename(audioFile(row, true), audioFile(row))
}

export async function removeAudio(row: { id: string; audioExt: string | null }): Promise<void> {
  await rm(audioFile(row), { force: true }).catch(() => {})
  await rm(audioFile(row, true), { force: true }).catch(() => {})
}

/** The stored audio for playback (Range supported). Null when gone. */
export async function audioStream(row: NonNullable<MeetingRow>, range: string | null) {
  if (row.audioDeletedAt || row.status === "UPLOADING") return null
  const file = audioFile(row)
  const st = await stat(file).catch(() => null)
  if (!st) return null
  const size = st.size
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2])
    let end = m[1] && m[2] ? Number(m[2]) : size - 1
    start = Math.max(0, start); end = Math.min(size - 1, end)
    if (start > end) return { status: 416 as const, size }
    return { status: 206 as const, size, start, end, body: Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream }
  }
  return { status: 200 as const, size, start: 0, end: size - 1, body: Readable.toWeb(createReadStream(file)) as ReadableStream }
}

// ---------------------------------------------------------------- the transcriber

function whisper(): { url: string; secret: string } | null {
  const url = (process.env.MEETING_WHISPER_URL || "").replace(/\/+$/, "")
  const secret = process.env.MEETING_WHISPER_SECRET || ""
  return url && secret ? { url, secret } : null
}

type WhisperJob = {
  id: string
  state: "queued" | "running" | "done" | "failed"
  position?: number | null
  progress?: number
  language?: string | null
  durationSec?: number | null
  segments?: unknown
  error?: string | null
  stage?: string | null
  stats?: Record<string, unknown> | null
}

async function whisperFetch(pathname: string, init: RequestInit & { duplex?: "half" } = {}, timeoutMs = 15_000) {
  const w = whisper()
  if (!w) throw Object.assign(new Error("transcriber not configured"), { code: "NOT_CONFIGURED" })
  return fetch(`${w.url}${pathname}`, { ...init, headers: { Authorization: `Bearer ${w.secret}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) })
}

export async function whisperHealth(): Promise<{ ok: boolean; busy?: boolean; queued?: number; model0?: { state?: string; reason?: string | null } } | null> {
  if (!whisper()) return null
  try {
    const res = await whisperFetch("/health", {}, 5_000)
    if (!res.ok) return null
    return (await res.json()) as { ok: boolean }
  } catch {
    return null
  }
}

/** The transcriber's word on Model 0 → lib/gideon-tier-status.ts. Unreachable = no change of state claimed. */
async function syncModel0(): Promise<void> {
  const h = await whisperHealth()
  if (!h?.model0) return
  const state = h.model0.state
  if (state === "busy") await reportModel0({ available: false, reason: h.model0.reason === "loading" ? "loading" : "transcribing" })
  else if (state === "down") await reportModel0({ available: false, reason: "down" })
  else await reportModel0({ available: true, reason: null })
}

const active = ((globalThis as unknown as { __meetingActive?: Set<string> }).__meetingActive ??= new Set<string>())

async function submitTranscript(row: NonNullable<MeetingRow>, settings: MeetingSettings): Promise<void> {
  const file = audioFile(row)
  const st = await stat(file).catch(() => null)
  if (!st) {
    await patchMeeting(row.id, { status: "FAILED", errorCode: "audio_missing", error: "The recording is no longer on the server.", lockedUntil: null })
    return
  }
  const q = new URLSearchParams({ id: row.id, language: row.language || "auto", maxSec: String(Math.round(settings.maxMinutes * 60)) })
  // Speaker labels (owner, 19 Oct 2026). A transcriber that predates them ignores the parameters (no labels).
  if (row.speakerLabels !== false) {
    q.set("speakers", "1")
    if (row.introEndSec && row.introEndSec > 0) q.set("introEnd", row.introEndSec.toFixed(2))
  }
  try {
    const res = await whisperFetch(`/v1/jobs?${q}`, {
      method: "POST",
      headers: { "Content-Type": row.audioMime || "application/octet-stream", "Content-Length": String(st.size) },
      body: Readable.toWeb(createReadStream(file)) as ReadableStream,
      duplex: "half",
    }, 30 * 60_000)
    if (res.status === 413) {
      await patchMeeting(row.id, { status: "FAILED", errorCode: "too_large", error: "The recording is too large to transcribe.", lockedUntil: null })
      return
    }
    if (!res.ok) throw new Error(`transcriber ${res.status}`)
    const job = (await res.json().catch(() => null)) as WhisperJob | null
    await patchMeeting(row.id, { progress: 0, lockedUntil: null, stageStartedAt: new Date(), transcribeStats: { position: job?.position ?? null } as Prisma.InputJsonValue }, { status: "TRANSCRIBING" })
  } catch (error) {
    const attempts = row.attempts + 1
    log.warn("transcriber submit failed", { meetingId: row.id, attempts, error: String(error) })
    if (attempts >= 6) await patchMeeting(row.id, { status: "FAILED", attempts, errorCode: "transcriber_unreachable", error: "The transcription service can't be reached. Try again later.", lockedUntil: null })
    else await patchMeeting(row.id, { status: "QUEUED", attempts, lockedUntil: new Date(Date.now() + Math.min(10 * 60_000, 15_000 * 2 ** attempts)) })
  }
}

const WHISPER_ERRORS: Record<string, { code: string; text: string }> = {
  too_long: { code: "too_long", text: "The recording is longer than the limit." },
  undecodable: { code: "undecodable", text: "The file has no audio we can read." },
  gpu_busy: { code: "gpu_busy", text: "The office GPU was busy for too long. Try again." },
}

/** Whether the transcriber's queue reading differs from the stored one in state, stage or queue position. */
export function transcribeStatsChanged(stored: unknown, next: { position: number | null; state: string; stage?: string }): boolean {
  const o = (stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) as { position?: unknown; state?: unknown; stage?: unknown }
  return (o.position ?? null) !== (next.position ?? null) || (o.state ?? null) !== (next.state ?? null) || (o.stage ?? null) !== (next.stage ?? null)
}

async function pollTranscript(row: NonNullable<MeetingRow>): Promise<void> {
  let res: Response
  try {
    res = await whisperFetch(`/v1/jobs/${row.id}`)
  } catch {
    return // the service is down for a moment: try again next tick
  }
  if (res.status === 404) {
    // The service restarted and forgot the job: send it again (the audio is still here).
    await patchMeeting(row.id, { status: "QUEUED", progress: 0, lockedUntil: null }, { status: "TRANSCRIBING" })
    return
  }
  if (!res.ok) return
  const job = (await res.json().catch(() => null)) as WhisperJob | null
  if (!job) return
  if (job.state === "queued" || job.state === "running") {
    const progress = job.state === "running" ? Math.max(0, Math.min(1, Number(job.progress) || 0)) : 0
    const stats = { position: job.position ?? null, state: job.state, ...(job.stage ? { stage: job.stage } : {}) }
    // The transcriber knows the real length once it opened the file: the ETA uses it from then on.
    const learnedDuration = !row.durationSec && typeof job.durationSec === "number" && job.durationSec > 0 ? job.durationSec : undefined
    // Compared field by field (QA final 19 Oct 2026, D-9): the stored JSON comes back from jsonb with its keys
    // re-ordered, so comparing JSON strings saw a change on every poll and sent `meeting-changed` (and bumped the
    // version) every ~12 s for as long as the job waited in the GPU queue.
    if (learnedDuration || Math.abs(progress - row.progress) >= 0.02 || transcribeStatsChanged(row.transcribeStats, stats)) {
      await patchMeeting(row.id, { progress, transcribeStats: stats as Prisma.InputJsonValue, ...(learnedDuration ? { durationSec: learnedDuration } : {}) }, { status: "TRANSCRIBING" }, { bumpVersion: false })
    }
    return
  }
  if (job.state === "failed") {
    const known = WHISPER_ERRORS[job.error || ""]
    await patchMeeting(row.id, {
      status: "FAILED",
      errorCode: known?.code ?? "transcribe_failed",
      error: known?.text ?? "The transcript failed. Try again.",
      durationSec: typeof job.durationSec === "number" ? job.durationSec : undefined,
      lockedUntil: null,
    }, { status: "TRANSCRIBING" })
    await whisperFetch(`/v1/jobs/${row.id}`, { method: "DELETE" }).catch(() => {})
    return
  }
  const segments = cleanSegments(job.segments)
  // Names for the voices from the introductions; a name someone set by hand stays (mergeSpeakers).
  const speakers = segments.some((s) => s.speaker)
    ? mergeSpeakers(row.speakers, introNames(segments, row.introEndSec, autoMatchCandidates(await speakerCandidates(row).catch(() => []), row.createdById, Boolean(row.projectId))))
    : cleanSpeakers(row.speakers)
  if (!segments.length) {
    await patchMeeting(row.id, { status: "FAILED", errorCode: "no_speech", error: "No speech was found in the recording.", durationSec: job.durationSec ?? undefined, lockedUntil: null }, { status: "TRANSCRIBING" })
  } else {
    await patchMeeting(row.id, {
      status: "SUMMARIZING",
      progress: 0,
      transcript: segments as unknown as Prisma.InputJsonValue,
      speakers: speakers as unknown as Prisma.InputJsonValue,
      durationSec: typeof job.durationSec === "number" ? job.durationSec : segments[segments.length - 1].end,
      detectedLanguage: typeof job.language === "string" ? job.language.slice(0, 10) : null,
      transcribeStats: (job.stats ?? null) as Prisma.InputJsonValue,
      stageStartedAt: new Date(),
      lockedUntil: null,
      errorCode: null,
      error: null,
    }, { status: "TRANSCRIBING" })
  }
  await whisperFetch(`/v1/jobs/${row.id}`, { method: "DELETE" }).catch(() => {})
}

/**
 * The people a voice can be: the project's members first (exact spelling for PIC suggestions), then everyone in
 * the uploader's workspaces. Deactivated accounts never.
 */
export async function speakerCandidates(row: { projectId: string | null; createdById: string }): Promise<NameCandidate[]> {
  const out = new Map<string, NameCandidate>()
  for (const m of await projectMembers(row.projectId)) out.set(m.id, { id: m.id, name: m.name, inProject: true })
  const ws = await prisma.workspaceMember.findMany({ where: { userId: row.createdById }, select: { workspaceId: true }, take: 20 })
  if (ws.length) {
    const people = await prisma.workspaceMember.findMany({
      where: { workspaceId: { in: ws.map((w) => w.workspaceId) }, user: { deactivatedAt: null } },
      select: { user: { select: { id: true, name: true } } },
      take: 3000,
    })
    for (const p of people) if (p.user?.name && !out.has(p.user.id)) out.set(p.user.id, { id: p.user.id, name: p.user.name })
  }
  return [...out.values()]
}

// ---------------------------------------------------------------- GIDEON

/** The shim keeps the first 16 000 characters of a prompt; stay under it. */
const PROMPT_CAP = 15_500
const PART_CHARS = 11_000
const MAP_CONCURRENCY = 3

function wibDay(d: Date): { date: string; weekday: string } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", weekday: "long" }).format(d)
  return { date, weekday }
}

export function durationLabel(sec: number | null | undefined): string | null {
  if (!sec || sec < 1) return null
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.max(1, m)} min`
}

async function projectMembers(projectId: string | null): Promise<MemberLite[]> {
  if (!projectId) return []
  const rows = await prisma.projectMember.findMany({ where: { projectId }, select: { user: { select: { id: true, name: true, deactivatedAt: true } } } }).catch(() => [])
  return rows.filter((r) => r.user && !r.user.deactivatedAt && r.user.name).map((r) => ({ id: r.user.id, name: r.user.name as string }))
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/** Read the transcript and write the minutes (status SUMMARIZING → READY | FAILED). Never throws. */
export async function summarizeMeeting(id: string): Promise<void> {
  if (active.has(`s:${id}`)) return
  active.add(`s:${id}`)
  try {
    const row = await prisma.meetingNote.findUnique({ where: { id } })
    if (!row || row.status !== "SUMMARIZING") return
    const creator = await prisma.user.findUnique({ where: { id: row.createdById }, select: { id: true, name: true, email: true, deactivatedAt: true } })
    if (!creator || creator.deactivatedAt) { await patchMeeting(id, { status: "FAILED", errorCode: "owner_gone", error: "The person who uploaded this can't use GIDEON any more.", lockedUntil: null }); return }
    if (!process.env.GIDEON_CHAT_URL) { await patchMeeting(id, { status: "FAILED", errorCode: "gideon_off", error: "GIDEON isn't connected on this server.", lockedUntil: null }); return }
    const decision = await decideTier(creator.id, "luna").catch(() => ({ tier: "luna", blocked: false, fallback: false }))
    if (decision.blocked) { await patchMeeting(id, { status: "FAILED", errorCode: "credits_exhausted", error: "You're out of GIDEON credits for today. Try again after 00:00 WIB.", lockedUntil: null }); return }
    const tier = decision.tier === "terra" ? "terra" : "luna"

    const project = row.projectId ? await prisma.project.findUnique({ where: { id: row.projectId }, select: { id: true, name: true } }) : null
    const members = project && (await checkProjectAccess(creator.id, project.id, ["VIEWER"])).allowed ? await projectMembers(project.id) : []
    const day = wibDay(row.recordedAt ?? row.createdAt)
    const speakers = cleanSpeakers(row.speakers)
    const segments = cleanSegments(row.transcript)
    const meta: MeetingPromptMeta = {
      title: row.title,
      date: day.date,
      weekday: day.weekday,
      projectName: project?.name ?? null,
      members: members.map((m) => m.name).slice(0, 80),
      attendees: [...new Set(Object.values(speakers).map((s) => s.name).filter(Boolean))],
      durationLabel: durationLabel(row.durationSec),
    }
    const lines = transcriptLines(segments, (l) => speakers[l]?.name || l)
    const runIds: string[] = []
    // A shim that is restarting or busy answers 502 / nothing: two more tries, 20 s and 60 s later, before giving up
    // (seen 18 Oct 2026: the agents VM restarting turned a whole meeting into FAILED).
    const ask = async (prompt: string, title: string) => {
      for (const wait of [0, 20_000, 60_000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait))
        const reply = await askOnce(prompt, title)
        if (reply) return reply
      }
      return null
    }
    const askOnce = async (prompt: string, title: string) => {
      const reply = await askGideon({
        prompt: prompt.slice(0, PROMPT_CAP + 400),
        user: creator.name ?? "",
        actorEmail: creator.email ?? creator.id,
        model: tier,
        trigger: "MEETING",
        // The transcript stays in NEXUS only: the shim deletes the Hermes copy after billing it (19 Oct 2026).
        forgetSession: true,
        projectId: project?.id,
        title,
        timeoutMs: 240_000,
        tag: `meeting ${id}`,
        onRun: (r) => { if (r) runIds.push(r) },
      }).catch((e) => { log.warn("GIDEON call failed", { meetingId: id, error: String(e) }); return null })
      return reply
    }
    const shortTitle = (row.title || "Meeting").slice(0, 60)
    const budget = PROMPT_CAP - minutesPrompt(meta, { kind: "transcript", text: "" }).length
    const full = lines.join("\n")
    let source: { kind: "transcript" | "notes"; text: string }
    if (full.length <= budget) {
      source = { kind: "transcript", text: full }
    } else {
      const parts = chunkLines(lines, Math.min(PART_CHARS, PROMPT_CAP - chunkNotesPrompt(meta, { index: 0, total: 1, text: "" }).length - 200))
      let done = 0
      const total = parts.length + 1
      const notes = await mapLimit(parts, MAP_CONCURRENCY, async (text, i) => {
        let n: string | null = null
        for (let attempt = 0; attempt < 2 && !n; attempt++) {
          const reply = await ask(chunkNotesPrompt(meta, { index: i, total: parts.length, text }), `Meeting notes · ${shortTitle} · part ${i + 1}/${parts.length}`)
          n = reply ? compactNotes(reply) : null
        }
        done++
        await patchMeeting(id, { progress: Math.min(0.95, done / total) }, { status: "SUMMARIZING" })
        return n
      })
      if (notes.some((n) => !n)) { await patchMeeting(id, { status: "FAILED", errorCode: "gideon_failed", error: "GIDEON couldn't read part of the transcript. Try again.", runIds: { push: runIds }, lockedUntil: null }); return }
      let level = notes as string[]
      const notesBudget = PROMPT_CAP - minutesPrompt(meta, { kind: "notes", text: "" }).length
      // Very long meetings: fold the notes until they fit one prompt.
      for (let round = 0; level.join("\n").length > notesBudget && round < 4; round++) {
        const groups: string[][] = []
        let cur: string[] = []
        const cap = PROMPT_CAP - mergeNotesPrompt(meta, []).length - 300
        for (const n of level) {
          if (cur.length && cur.join("\n").length + n.length > cap) { groups.push(cur); cur = [] }
          cur.push(n.slice(0, cap))
        }
        if (cur.length) groups.push(cur)
        if (groups.length === level.length) {
          // Nothing could be paired: shorten each instead.
          level = level.map((n) => n.slice(0, Math.floor(notesBudget / level.length)))
          break
        }
        const merged = await mapLimit(groups, MAP_CONCURRENCY, async (g) => {
          const reply = g.length === 1 ? null : await ask(mergeNotesPrompt(meta, g), `Meeting notes · ${shortTitle} · merging`)
          return g.length === 1 ? g[0] : reply ? compactNotes(reply) : null
        })
        if (merged.some((n) => !n)) { await patchMeeting(id, { status: "FAILED", errorCode: "gideon_failed", error: "GIDEON couldn't combine the notes. Try again.", runIds: { push: runIds }, lockedUntil: null }); return }
        level = merged as string[]
      }
      source = { kind: "notes", text: level.join("\n").slice(0, notesBudget) }
    }
    let draft = null
    for (let attempt = 0; attempt < 2 && !draft; attempt++) {
      const reply = await ask(minutesPrompt(meta, source), `Meeting notes · ${shortTitle}`)
      draft = reply ? parseMinutes(reply) : null
    }
    if (!draft) { await patchMeeting(id, { status: "FAILED", errorCode: "gideon_failed", error: "GIDEON couldn't write the minutes. Try again.", runIds: { push: runIds }, lockedUntil: null }); return }
    const proposals = draftToProposals(draft, members)
    const ok = await patchMeeting(id, {
      status: "READY",
      progress: 1,
      title: row.title || draft.title || "Meeting",
      overview: draft.overview,
      mom: draft.mom as unknown as Prisma.InputJsonValue,
      proposals: proposals as unknown as Prisma.InputJsonValue,
      tier,
      runIds: { push: runIds },
      lockedUntil: null,
      errorCode: null,
      error: null,
      // Never applied: the audio still goes after the retention window (counted from now).
      audioDeleteAfter: new Date(Date.now() + (await meetingSettings()).retentionDays * 86_400_000),
    }, { status: "SUMMARIZING" })
    if (ok) {
      const ready = await prisma.meetingNote.findUnique({ where: { id } })
      if (ready?.status === "READY") await notifyMeeting(ready, "ready")
    }
  } catch (error) {
    log.error("summarize failed", { meetingId: id, error: String(error) })
    await patchMeeting(id, { status: "FAILED", errorCode: "gideon_failed", error: "Writing the minutes failed. Try again.", lockedUntil: null }).catch(() => {})
  } finally {
    active.delete(`s:${id}`)
  }
}

// ---------------------------------------------------------------- apply

export class MeetingConflict extends Error {
  constructor(public status: string) { super("conflict") }
}

export type ApplyInput = {
  projectId: string
  title: string
  overview: string
  mom: Mom
  proposals: TaskProposal[]
  lang: "en" | "id"
  taskListId?: string | null
}

/**
 * Apply (owner, 18 Oct 2026): the minutes become a Doc in the project and every ticked proposal a task linking to
 * it. One transaction, opened by a conditional claim READY → APPLYING: a second request (double tap, another
 * device) waits on the row lock, then finds it APPLIED and gets MeetingConflict. Nothing half-made survives a
 * failure: the transaction rolls back to READY.
 */
export async function applyMeeting(meetingId: string, actor: { id: string; name: string | null }, input: ApplyInput) {
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true, workspaceId: true, autoAssignEnabled: true, autoAssignAssigneeIds: true } })
  if (!project) throw Object.assign(new Error("Project not found"), { http: 404 })
  if (!(await checkProjectAccess(actor.id, project.id, ["MEMBER"])).allowed) throw Object.assign(new Error("You need Can edit access in this project."), { http: 403, code: "NEEDS_EDIT_ACCESS" })
  const members = await projectMembers(project.id)
  const memberIds = new Set(members.map((m) => m.id))
  const proposals = cleanProposals(input.proposals, memberIds).filter((p) => p.include)
  const taskList = input.taskListId
    ? await prisma.taskList.findFirst({ where: { id: input.taskListId, projectId: project.id }, select: { id: true, name: true, taskStatus: true } })
    : (await prisma.taskList.findFirst({ where: { projectId: project.id, OR: [{ taskStatus: "TODO" }, { name: { in: ["To Do", "To do", "To-do", "Todo", "TODO", "Backlog"], mode: "insensitive" } }] }, orderBy: { position: "asc" }, select: { id: true, name: true, taskStatus: true } }))
      ?? (await prisma.taskList.findFirst({ where: { projectId: project.id }, orderBy: { position: "asc" }, select: { id: true, name: true, taskStatus: true } }))
  if (proposals.length && !taskList) throw Object.assign(new Error("This project has no section to put tasks in."), { http: 400, code: "NO_SECTION" })
  const settings = await meetingSettings()

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.meetingNote.updateMany({ where: { id: meetingId, status: "READY" }, data: { status: "APPLYING", version: { increment: 1 } } })
    if (claimed.count === 0) {
      const now = await tx.meetingNote.findUnique({ where: { id: meetingId }, select: { status: true } })
      throw new MeetingConflict(now?.status ?? "GONE")
    }
    const row = await tx.meetingNote.findUniqueOrThrow({ where: { id: meetingId } })
    const title = input.title.trim().slice(0, 200) || row.title || "Meeting"
    const doc = await tx.doc.create({ data: { title, content: { type: "doc", content: [{ type: "paragraph" }] } as Prisma.InputJsonValue, projectId: project.id, authorId: actor.id, ownerId: actor.id }, select: { id: true, title: true } })
    const agg = taskList ? await tx.task.aggregate({ where: { taskListId: taskList.id, parentId: null }, _max: { position: true } }) : null
    let position = (agg?._max.position ?? -1) + 1
    const created: Array<{ id: string; title: string; actionIndex: number | null; assignees: MemberLite[]; dueDate: string | null; assigneeIds: string[] }> = []
    for (const p of proposals) {
      const assigneeIds = p.assigneeIds.filter((id) => memberIds.has(id))
      const body = {
        type: "doc",
        content: [
          ...(p.description ? p.description.split(/\n{2,}/).map((para) => ({ type: "paragraph", content: [{ type: "text", text: para.trim() }] })) : []),
          { type: "paragraph", content: [{ type: "text", text: input.lang === "id" ? "Dari catatan meeting: " : "From meeting notes: " }, { type: "mention", attrs: { id: doc.id, label: title, kind: "doc" } }] },
        ],
      }
      const task = await tx.task.create({
        data: {
          title: p.title,
          description: docToText(body) || null,
          status: (taskList?.taskStatus as never) || undefined,
          taskListId: taskList!.id,
          position: position++,
          creatorId: actor.id,
          dueDate: p.dueDate ? new Date(`${p.dueDate}T10:00:00.000Z`) : null,
          ...(assigneeIds.length ? { assignees: { create: assigneeIds.map((userId) => ({ userId })) } } : {}),
        },
        select: { id: true, title: true },
      })
      await tx.taskBody.create({ data: { taskId: task.id, doc: body as Prisma.InputJsonValue, updatedById: actor.id } })
      await tx.activityLog.create({ data: { action: "created task", details: `Created task "${p.title}" from meeting notes`, userId: actor.id, taskId: task.id, projectId: project.id } })
      created.push({ id: task.id, title: task.title, actionIndex: p.actionIndex, assignees: members.filter((m) => assigneeIds.includes(m.id)), dueDate: p.dueDate, assigneeIds })
    }
    const speakers = cleanSpeakers(row.speakers)
    const content = sanitizeDoc(buildMinutesDoc({
      lang: input.lang,
      dateLabel: wibDay(row.recordedAt ?? row.createdAt).date,
      durationLabel: durationLabel(row.durationSec),
      recordedBy: { id: row.createdById, name: (await tx.user.findUnique({ where: { id: row.createdById }, select: { name: true } }))?.name ?? "" },
      overview: input.overview,
      mom: input.mom,
      tasks: created,
      transcript: cleanSegments(row.transcript),
      speakerName: (l) => speakers[l]?.name || l,
    }))
    if (!content) throw Object.assign(new Error("The minutes are too long to save as a page."), { http: 400 })
    await tx.doc.update({ where: { id: doc.id }, data: { content: content as unknown as Prisma.InputJsonValue, contentText: docToText(content) || null } })
    const after = await tx.meetingNote.update({
      where: { id: meetingId },
      data: {
        status: "APPLIED",
        projectId: project.id,
        title,
        overview: input.overview,
        mom: input.mom as unknown as Prisma.InputJsonValue,
        proposals: cleanProposals(input.proposals, memberIds) as unknown as Prisma.InputJsonValue,
        docId: doc.id,
        taskIds: created.map((c) => c.id),
        appliedAt: new Date(),
        appliedById: actor.id,
        audioDeleteAfter: new Date(Date.now() + settings.retentionDays * 86_400_000),
        version: { increment: 1 },
      },
    })
    return { doc, created, after }
  }, { timeout: 60_000, maxWait: 10_000 })

  // After the commit: what every new task gets (custom field defaults, assignment notices, automations, realtime).
  for (const t of result.created) {
    await seedTaskCustomFieldValues(t.id, project.id).catch(() => {})
    await Promise.all(t.assigneeIds.map((assigneeId) => notifyTaskAssigned({ assigneeId, taskId: t.id, taskTitle: t.title, projectName: project.name, projectId: project.id, assignedByName: actor.name || "Someone", actorId: actor.id }).catch(() => {})))
    executeAutomations(project.id, "task_created", { taskId: t.id, userId: actor.id, projectId: project.id, assigneeIds: t.assigneeIds }).catch(() => {})
    const full = await prisma.task.findUnique({ where: { id: t.id }, include: { assignees: { include: { user: true } }, creator: true, taskList: true, _count: { select: { subtasks: true, comments: true } } } }).catch(() => null)
    const cfv = await prisma.customFieldValue.findMany({ where: { taskId: t.id }, select: { customFieldId: true, value: true } }).catch(() => null)
    if (full) emitTaskCreated(project.id, JSON.parse(JSON.stringify(cfv ? { ...full, customFieldValues: cfv } : full)))
  }
  eventBus.emit(BUS_EVENTS.DOC_CHANGED, { projectId: project.id, docId: result.doc.id, actorId: actor.id })
  logAudit({ action: "create", entityType: "doc", entityId: result.doc.id, entityName: result.doc.title, userId: actor.id, metadata: { projectId: project.id, meetingNoteId: meetingId } }).catch(() => {})
  emitMeetingChanged(result.after)
  return { meeting: result.after, doc: { id: result.doc.id, title: result.doc.title, url: `/docs/${result.doc.id}` }, tasks: result.created.map((t) => ({ id: t.id, title: t.title })) }
}

// ---------------------------------------------------------------- the clock

const TICK_MS = 5_000
const g = globalThis as unknown as { __meetingTicker?: boolean }

export function startMeetingTicker() {
  if (g.__meetingTicker) return
  g.__meetingTicker = true
  let busy = false
  let ticks = 0
  const tick = async () => {
    if (busy || !isSingletonLeader()) return
    busy = true
    try {
      const rows = await prisma.$queryRaw<Array<{ ro: boolean }>>`select pg_is_in_recovery() as ro`
      if (rows[0]?.ro) return
      ticks++
      const working = await prisma.meetingNote.count({ where: { status: { in: ["QUEUED", "TRANSCRIBING"] } } })
      // Model 0's state: every tick while a transcript is going, every 15 s otherwise.
      if (whisper() && (working > 0 || ticks % 3 === 0)) await syncModel0()
      await stepMeetings()
      if (ticks % 120 === 1) await sweepAudio()
    } catch (error) {
      log.error("meeting tick failed", { error: String(error) })
    } finally {
      busy = false
    }
  }
  setTimeout(() => { void tick() }, 15_000).unref?.()
  setInterval(() => { void tick() }, TICK_MS).unref?.()
}

/** One pass: start uploads that are waiting, follow transcripts, start minutes. Exported for the cron route/tests. */
export async function stepMeetings(): Promise<void> {
  const now = new Date()
  const settings = await meetingSettings()
  if (whisper()) {
    const queued = await prisma.meetingNote.findMany({ where: { status: "QUEUED", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, orderBy: { updatedAt: "asc" }, take: 3 })
    for (const row of queued) {
      if (active.has(`t:${row.id}`)) continue
      // Claimed with a lease so a second process (or the next tick) does not send it twice.
      const claimed = await prisma.meetingNote.updateMany({ where: { id: row.id, status: "QUEUED", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { status: "TRANSCRIBING", lockedUntil: new Date(Date.now() + 35 * 60_000), progress: 0, version: { increment: 1 } } })
      if (!claimed.count) continue
      const fresh = await prisma.meetingNote.findUnique({ where: { id: row.id } })
      if (!fresh) continue
      emitMeetingChanged(fresh)
      active.add(`t:${row.id}`)
      void submitTranscript(fresh, settings).finally(() => active.delete(`t:${row.id}`))
    }
    const transcribing = await prisma.meetingNote.findMany({ where: { status: "TRANSCRIBING", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, take: 20 })
    for (const row of transcribing) if (!active.has(`t:${row.id}`)) await pollTranscript(row)
  }
  const summarizing = await prisma.meetingNote.findMany({ where: { status: "SUMMARIZING", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, take: 3 })
  for (const row of summarizing) {
    const claimed = await prisma.meetingNote.updateMany({ where: { id: row.id, status: "SUMMARIZING", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(Date.now() + 30 * 60_000) } })
    if (claimed.count) void summarizeMeeting(row.id)
  }
  // Abandoned uploads (no chunk for a day) are dropped with their partial file.
  const stale = await prisma.meetingNote.findMany({ where: { status: "UPLOADING", updatedAt: { lt: new Date(Date.now() - 24 * 3600_000) } }, take: 20 })
  for (const row of stale) {
    await removeAudio(row)
    await patchMeeting(row.id, { status: "FAILED", errorCode: "upload_abandoned", error: "The upload didn't finish.", audioDeletedAt: new Date() }, { status: "UPLOADING" })
  }
}

/** Audio past its retention date is deleted (the transcript and minutes stay). */
export async function sweepAudio(): Promise<number> {
  const due = await prisma.meetingNote.findMany({ where: { audioDeleteAfter: { lt: new Date() }, audioDeletedAt: null, status: { notIn: ["UPLOADING", "QUEUED", "TRANSCRIBING"] } }, select: { id: true, audioExt: true }, take: 100 })
  for (const row of due) {
    await removeAudio(row)
    await prisma.meetingNote.update({ where: { id: row.id }, data: { audioDeletedAt: new Date() } }).catch(() => {})
  }
  if (due.length) log.info("meeting audio removed after retention", { n: due.length })
  return due.length
}

export { clock }
export type { TranscriptSegment }

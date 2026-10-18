import prisma from "@/lib/prisma"
import { todayWib } from "@/lib/gideon-dates"
import { getAppConfig } from "@/lib/app-config"
import { MEMORY_KINDS, asksToRemember, cleanMemoryText, isAffirmation, memoryKey, memoryRisk, parseKind, parseMonthDay, monthDayInText, memoryTextFromQuestion, statesPreference, styleDirectives, type MemoryKind } from "@/lib/gideon-memory-text"

/**
 * GIDEON Memory (owner, 19 Oct 2026: "memory per orang boleh, jadi GIDEON bisa personal ke orang-orangnya dan lebih
 * care"). What GIDEON remembers about ONE person: how they like to be addressed and in which language, how long
 * they like answers, the role / team / projects they focus on, working hours, dates they chose to share (a
 * birthday), and things they asked it to remember.
 *
 * Privacy, by construction:
 *  - rows are read ONLY by the person's own private chat (/api/gideon) and their own Settings › GIDEON Memory
 *    (/api/gideon/memory). No tool returns another person's memories; @GIDEON mentions, digests, the editor and
 *    Control Room (OAA review included) never read them. Hermes' own memory stays OFF (it is shared between users).
 *  - nothing sensitive is kept without being asked: secrets (passwords, PINs, OTPs, tokens, card/account numbers)
 *    are refused always; health / religion / politics only when the person explicitly asks GIDEON to remember.
 *  - consent: GIDEON proposes (PENDING, a Save / Don't save chip under its answer) unless the person said
 *    "remember …" in that very question; "forget …" soft-deletes, purged for good after 30 days.
 *  - offboarding and account deletion delete the rows (lib/offboarding.ts, api/user/account/delete).
 *
 * Race (owner, 16 Oct 2026): one live row per (userId, textKey) is a partial unique index in the DB, and every
 * save runs under a per-person advisory lock (so the cap and the dismissed-check hold under concurrent saves).
 */

export { MEMORY_KINDS, MEMORY_TEXT_MAX, asksToRemember, cleanMemoryText, isAffirmation, memoryKey, memoryRisk, memoryTextFromQuestion, parseKind, parseMonthDay, statesPreference } from "@/lib/gideon-memory-text"
export type { MemoryKind } from "@/lib/gideon-memory-text"
/** Live memories per person (ACTIVE + PENDING). The prompt carries at most MEMORY_PROMPT_CHARS of them. */
export const MEMORY_MAX = 40
/** Kept small for Model 0's 32k window (owner: works on every tier). ~400 tokens. */
export const MEMORY_PROMPT_CHARS = 1600
export const MEMORY_PURGE_DAYS = 30
/** A suggestion nobody answered is dropped after this. */
export const MEMORY_PENDING_DAYS = 7

export type MemoryView = {
  id: string
  kind: MemoryKind
  text: string
  monthDay: string | null
  status: "ACTIVE" | "PENDING" | "DELETED"
  source: string
  createdAt: string
  updatedAt: string
}

type Row = { id: string; kind: string; text: string; monthDay: string | null; status: string; source: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null }

export function memoryView(m: Row): MemoryView {
  return {
    id: m.id,
    kind: (MEMORY_KINDS as readonly string[]).includes(m.kind) ? (m.kind as MemoryKind) : "FACT",
    text: m.text,
    monthDay: m.monthDay,
    status: m.deletedAt ? "DELETED" : m.status === "PENDING" ? "PENDING" : "ACTIVE",
    source: m.source,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }
}

// ── The question behind a tool call ───────────────────────────────────────────────────────────────────
// The tools route only sees the model's arguments. Whether the PERSON asked to remember is decided from what they
// actually wrote, never from the model's `explicit` flag alone: the chat route parks the question here by run id
// (same process — the run bus in gideon-runs.ts relies on that too). Not found = treated as not explicit.

type Parked = { question: string; chatId: string | null; at: number }
const g = globalThis as unknown as { __gideonMemoryRuns?: Map<string, Parked> }
function parked(): Map<string, Parked> {
  if (!g.__gideonMemoryRuns) g.__gideonMemoryRuns = new Map()
  return g.__gideonMemoryRuns
}
export function parkRunQuestion(runId: string | null, question: string, chatId: string | null) {
  if (!runId) return
  const map = parked()
  const now = Date.now()
  if (map.size > 500) for (const [k, v] of map) if (now - v.at > 20 * 60 * 1000) map.delete(k)
  map.set(runId, { question: question.slice(0, 4000), chatId, at: now })
}
export function runQuestion(runId: string): Parked | null {
  return parked().get(runId) ?? null
}
export function dropRunQuestion(runId: string | null) {
  if (runId) parked().delete(runId)
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────

/** Remote config flags.gideonMemory (default on): the emergency kill switch. A config read error keeps it on. */
export async function memoryFeatureOn(): Promise<boolean> {
  const cfg = await getAppConfig(null).catch(() => null)
  return (cfg?.flags as Record<string, unknown> | undefined)?.gideonMemory !== false
}

export async function isMemoryPaused(userId: string): Promise<boolean> {
  const p = await prisma.gideonPreference.findUnique({ where: { userId }, select: { memoryPaused: true } })
  return p?.memoryPaused === true
}

export async function listMemories(userId: string, opts: { includePending?: boolean } = {}): Promise<MemoryView[]> {
  const rows = await prisma.gideonMemory.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(opts.includePending ? {} : { status: "ACTIVE" }),
      // A suggestion nobody answered within a week is no longer offered.
      ...(opts.includePending ? { OR: [{ status: "ACTIVE" }, { status: "PENDING", createdAt: { gte: new Date(Date.now() - MEMORY_PENDING_DAYS * 864e5) } }] } : {}),
    },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    take: MEMORY_MAX + 10,
  })
  return rows.map(memoryView)
}

const KIND_ORDER: Record<MemoryKind, number> = { PREFERENCE: 0, PERSON: 1, DATE: 2, FACT: 3 }
const KIND_WORD: Record<MemoryKind, string> = { PREFERENCE: "gaya", PERSON: "tentang dia", DATE: "tanggal", FACT: "catatan" }

/**
 * The person's own memories for THEIR chat prompt (after the static rules and who-is-asking, before the per-turn
 * context: the block only changes when a memory does, so it stays in the cached prefix). Capped to
 * MEMORY_PROMPT_CHARS: preferences first (they shape every answer), then the rest, newest kept.
 */
export async function memoryPromptLines(userId: string, personName: string, opts: { tier?: string; now?: Date } = {}): Promise<{ personal: string[]; dynamic: string[] }> {
  const now = opts.now ?? new Date()
  // Model 0 (local 9B, 32k window) gets only how to talk to them and today's date: it tended to recite every fact
  // it was handed, which reads as creepy. The hosted tiers get everything, used only when relevant.
  const styleOnly = opts.tier === "experimental"
  const who = personName?.trim() || "Orang ini"
  const none = { personal: [] as string[], dynamic: [] as string[] }
  if (await isMemoryPaused(userId)) {
    return { personal: [`[GIDEON MEMORY] ${who} menjeda GIDEON Memory: jangan panggil nexus_remember dan jangan bilang kamu mengingat apa pun tentang dia. Kalau dia minta diingat, bilang Memory sedang dijeda dan bisa dinyalakan lagi di Settings › GIDEON Memory (Pengaturan › Memori GIDEON).`], dynamic: [] }
  }
  const rows = await prisma.gideonMemory.findMany({
    where: { userId, deletedAt: null, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: MEMORY_MAX,
    select: { kind: true, text: true, monthDay: true },
  })
  if (!rows.length) return none
  const sorted = rows
    .map((r) => ({ ...r, kind: parseKind(r.kind) }))
    .filter((r) => !styleOnly || r.kind === "PREFERENCE" || r.kind === "DATE")
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  if (!sorted.length) return none
  const lines: string[] = []
  let used = 0
  for (const r of sorted) {
    const line = `- (${KIND_WORD[r.kind]}) ${r.text}${r.monthDay ? ` [${r.monthDay}]` : ""}`
    if (used + line.length > MEMORY_PROMPT_CHARS) continue
    lines.push(line)
    used += line.length + 1
  }
  const personal = [
    `[GIDEON MEMORY — yang ${who} sendiri setujui untuk kamu ingat. HANYA tentang dia; jangan pernah disebut ke atau dipakai untuk orang lain]\n${lines.join("\n")}\n` +
      `Ikuti preferensi gaya, sapaan dan bahasanya di SETIAP jawaban (sapaan yang dia minta — aku-kamu, gue-lo, formal — dipakai persis, juga kalau pesannya sendiri memakai gaya lain). Pakai yang lain hanya kalau relevan, wajar dan singkat — jangan mengulang "aku ingat kamu…" dan jangan terdengar mengawasi.`,
  ]
  // The style preferences once more right before the conversation (small models such as Model 0 follow what is near
  // the question; outside the cached prefix, a few dozen tokens).
  const prefTexts = sorted.filter((r) => r.kind === "PREFERENCE").map((r) => r.text)
  const orders = styleDirectives(prefTexts)
  const prefs = prefTexts.join("; ").slice(0, 300)
  const dynamic = prefs ? [`[GAYA ${who.toUpperCase()}] ${orders.length ? `${orders.join("; ")}. ` : ""}(${prefs}) — patuhi di jawaban ini.`] : []
  // A date they shared is today (WIB): one warm line, once — only in the first answer of their day.
  const today = todayWib(now).slice(5)
  const todays = rows.filter((r) => r.monthDay === today)
  if (todays.length) {
    const start = new Date(`${todayWib(now)}T00:00:00+07:00`)
    const answeredToday = await prisma.gideonMessage.count({ where: { userId, role: "assistant", createdAt: { gte: start } } }).catch(() => 1)
    if (answeredToday === 0) {
      dynamic.push(`[HARI INI] Tanggal yang ${who} bagikan jatuh hari ini: ${todays.map((r) => r.text).join("; ")}. Buka jawabanmu dengan satu kalimat hangat yang pas (mis. selamat ulang tahun), lalu langsung jawab pertanyaannya.`)
    }
  }
  return { personal, dynamic }
}

/**
 * Safety net after an answer (Model 0 rarely calls tools): the person stated a preference or asked to remember
 * something and the model called no memory tool in this run. A SUGGESTION is made from their own words (never saved
 * without their Save tap; every text rule applies). Null when there is nothing to suggest.
 */
export async function suggestMemoryFromQuestion(userId: string, question: string, runId: string, chatId: string | null): Promise<MemoryView | null> {
  const explicit = asksToRemember(question)
  const pref = statesPreference(question)
  if (!explicit && !pref) return null
  const text = memoryTextFromQuestion(question)
  if (!text) return null
  const touched = await prisma.gideonRunStep.count({ where: { runId, tool: { in: ["remember", "forget"] } } })
  if (touched) return null
  try {
    const { memory } = await saveMemory(userId, { text, kind: pref ? "PREFERENCE" : "FACT", status: "PENDING", source: "CHAT", explicit, chatId, runId })
    return memory.status === "PENDING" ? memory : null
  } catch {
    return null
  }
}

/** Static: the same text for every person and turn, so it sits in the cached part of the prompt. */
export const MEMORY_RULES =
  "[GIDEON MEMORY] Tiap orang punya memorinya sendiri (lihat [GIDEON MEMORY] di bawah kalau ada). " +
  "Kalau orang ini menyebut sesuatu tentang DIRINYA yang berguna untuk obrolan berikutnya — cara dia mau disapa (aku-kamu, gue-lo, formal/santai), bahasa (EN/ID), jawaban pendek atau detail, peran/tim/project yang dia pegang, jam kerjanya, tanggal penting yang dia bagikan sendiri (ulang tahun) — " +
  "panggil nexus_remember sekali (explicit:false): itu jadi usulan dengan tombol Simpan / Jangan di bawah jawabanmu; tanyakan singkat di akhir jawaban, mis. \"Aku ingat ya: kamu lebih suka pakai aku-kamu?\", dan ikuti preferensinya mulai jawaban ini. " +
  "Kalau dia sendiri minta diingat (\"inget ya…\", \"remember…\", \"catat ya…\") atau menjawab \"iya\" ke usulanmu, panggil nexus_remember explicit:true dengan teks yang sama. \"Lupain…\" / \"forget…\" → nexus_forget. " +
  "JANGAN simpan: password, PIN, OTP, token, nomor kartu/rekening/KTP (tolak walau diminta); kesehatan, agama, politik, keuangan pribadi hanya kalau dia sendiri minta diingat; hal tentang orang lain, isi task/project/dokumen, atau hal sekali pakai. Jangan usul hal yang sama dua kali. " +
  "Kamu TIDAK punya memori tentang orang lain. Ditanya apa yang kamu ingat tentang orang lain: bilang kamu tidak menyimpan apa pun tentang orang lain dan memori tiap orang hanya bisa dilihat orangnya sendiri. Jangan pernah menulis isi memori ke task, komentar, dokumen, pesan atau tool lain."

// ── Writes ────────────────────────────────────────────────────────────────────────────────────────────

export class MemoryRefusal extends Error {
  constructor(public readonly code: "empty" | "secret" | "sensitive" | "paused" | "full" | "dismissed" | "not_found", message: string) {
    super(message)
  }
}

const isUnique = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002"

/**
 * Save one memory (ACTIVE) or suggest it (PENDING). Idempotent on the normalised text: saving what is already
 * there returns that row (a PENDING one is promoted when this save is ACTIVE). Serialised per person.
 */
export async function saveMemory(
  userId: string,
  input: { text: unknown; kind?: unknown; date?: unknown; status: "ACTIVE" | "PENDING"; source: "CHAT" | "SETTINGS"; explicit: boolean; chatId?: string | null; runId?: string | null },
): Promise<{ memory: MemoryView; created: boolean }> {
  const text = cleanMemoryText(input.text)
  if (!text) throw new MemoryRefusal("empty", "Nothing to remember.")
  const risk = memoryRisk(text)
  if (risk === "secret") throw new MemoryRefusal("secret", "Not saved: GIDEON never keeps passwords, PINs, codes, tokens or card/account/ID numbers.")
  if (risk === "sensitive" && !input.explicit) throw new MemoryRefusal("sensitive", "Not saved: health, religion, politics and personal finances are kept only when the person asks GIDEON to remember them.")
  const kind = parseKind(input.kind)
  const monthDay = parseMonthDay(input.date) ?? (kind === "DATE" ? monthDayInText(text) : null)
  const textKey = memoryKey(text)
  if (!textKey) throw new MemoryRefusal("empty", "Nothing to remember.")

  const run = async () => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gideon-memory|${userId}`})::int8)`
    const pref = await tx.gideonPreference.findUnique({ where: { userId }, select: { memoryPaused: true } })
    if (pref?.memoryPaused) throw new MemoryRefusal("paused", "GIDEON Memory is paused by this person (Settings › GIDEON Memory).")
    const live = await tx.gideonMemory.findFirst({ where: { userId, textKey, deletedAt: null } })
    if (live) {
      if (live.status === "PENDING" && input.status === "ACTIVE") {
        const up = await tx.gideonMemory.update({ where: { id: live.id }, data: { status: "ACTIVE", kind, ...(monthDay ? { monthDay } : {}) } })
        return { memory: memoryView(up), created: false }
      }
      return { memory: memoryView(live), created: false }
    }
    // They said "don't save" to this exact suggestion recently: GIDEON does not keep asking.
    if (input.status === "PENDING") {
      const dismissed = await tx.gideonMemory.findFirst({ where: { userId, textKey, status: "PENDING", deletedAt: { gte: new Date(Date.now() - MEMORY_PURGE_DAYS * 864e5) } }, select: { id: true } })
      if (dismissed) throw new MemoryRefusal("dismissed", "The person already said not to save this. Do not suggest it again.")
    }
    const count = await tx.gideonMemory.count({ where: { userId, deletedAt: null } })
    if (count >= MEMORY_MAX) throw new MemoryRefusal("full", `GIDEON Memory is full (${MEMORY_MAX}). The person can remove some in Settings › GIDEON Memory.`)
    const row = await tx.gideonMemory.create({
      data: { userId, kind, text, textKey, monthDay, status: input.status, source: input.source, sourceChatId: input.chatId ?? null, sourceRunId: input.runId ?? null },
    })
    return { memory: memoryView(row), created: true }
  })
  try {
    return await run()
  } catch (e) {
    // Two saves in the same instant on a path that skipped the lock: the unique index refused the second.
    if (isUnique(e)) {
      const live = await prisma.gideonMemory.findFirst({ where: { userId, textKey, deletedAt: null } })
      if (live) return { memory: memoryView(live), created: false }
    }
    throw e
  }
}

/** Edit text / kind / date, or confirm a suggestion (status ACTIVE). Only the person's own live row. */
export async function updateMemory(userId: string, id: string, patch: { text?: unknown; kind?: unknown; date?: unknown; status?: unknown }): Promise<MemoryView> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gideon-memory|${userId}`})::int8)`
    const row = await tx.gideonMemory.findFirst({ where: { id, userId, deletedAt: null } })
    if (!row) throw new MemoryRefusal("not_found", "That memory is gone.")
    const data: Record<string, unknown> = {}
    if (patch.text !== undefined) {
      const text = cleanMemoryText(patch.text)
      if (!text) throw new MemoryRefusal("empty", "Nothing to remember.")
      if (memoryRisk(text) === "secret") throw new MemoryRefusal("secret", "GIDEON never keeps passwords, PINs, codes, tokens or card/account/ID numbers.")
      const textKey = memoryKey(text)
      if (textKey !== row.textKey) {
        const clash = await tx.gideonMemory.findFirst({ where: { userId, textKey, deletedAt: null, id: { not: id } }, select: { id: true } })
        if (clash) await tx.gideonMemory.update({ where: { id: clash.id }, data: { deletedAt: new Date() } })
      }
      data.text = text
      data.textKey = textKey
    }
    if (patch.kind !== undefined) data.kind = parseKind(patch.kind)
    if (patch.date !== undefined) data.monthDay = patch.date === null || patch.date === "" ? null : parseMonthDay(patch.date)
    if (patch.status === "ACTIVE") {
      const pref = await tx.gideonPreference.findUnique({ where: { userId }, select: { memoryPaused: true } })
      if (pref?.memoryPaused) throw new MemoryRefusal("paused", "GIDEON Memory is paused.")
      data.status = "ACTIVE"
    }
    const up = await tx.gideonMemory.update({ where: { id }, data })
    return memoryView(up)
  })
}

/** Soft-delete one of the person's memories (also "Don't save" on a suggestion). Conditional: twice = once. */
export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  const n = await prisma.gideonMemory.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } })
  return n.count > 0
}

export async function deleteAllMemories(userId: string): Promise<number> {
  const n = await prisma.gideonMemory.updateMany({ where: { userId, deletedAt: null }, data: { deletedAt: new Date() } })
  return n.count
}

/** "Forget X" from the chat: by id, or the live memories whose text matches the words given. */
export async function forgetMemories(userId: string, input: { id?: unknown; query?: unknown; all?: unknown }): Promise<MemoryView[]> {
  if (input.all === true) {
    const rows = await prisma.gideonMemory.findMany({ where: { userId, deletedAt: null } })
    await deleteAllMemories(userId)
    return rows.map((r) => memoryView({ ...r, deletedAt: new Date() }))
  }
  const id = typeof input.id === "string" ? input.id.trim() : ""
  if (id) {
    const row = await prisma.gideonMemory.findFirst({ where: { id, userId, deletedAt: null } })
    if (!row) throw new MemoryRefusal("not_found", "No memory of this person has that id.")
    await deleteMemory(userId, id)
    return [memoryView({ ...row, deletedAt: new Date() })]
  }
  const q = cleanMemoryText(input.query)
  const words = memoryKey(q).split(" ").filter((w) => w.length >= 3)
  if (!words.length) throw new MemoryRefusal("empty", "Say what to forget (part of its text), or all:true.")
  const rows = await prisma.gideonMemory.findMany({ where: { userId, deletedAt: null } })
  const hit = rows.filter((r) => words.every((w) => r.textKey.includes(w)))
  const loose = hit.length ? hit : rows.filter((r) => words.some((w) => r.textKey.includes(w)))
  if (!loose.length) throw new MemoryRefusal("not_found", `Nothing remembered matches "${q}".`)
  if (loose.length > 3 && !hit.length) throw new MemoryRefusal("not_found", `Several memories match "${q}": ${loose.slice(0, 6).map((r) => r.text.slice(0, 50)).join("; ")}. Ask which one.`)
  await prisma.gideonMemory.updateMany({ where: { id: { in: loose.map((r) => r.id) }, userId, deletedAt: null }, data: { deletedAt: new Date() } })
  return loose.map((r) => memoryView({ ...r, deletedAt: new Date() }))
}

export async function setMemoryPaused(userId: string, paused: boolean): Promise<void> {
  await prisma.gideonPreference.upsert({ where: { userId }, create: { userId, memoryPaused: paused }, update: { memoryPaused: paused } })
}

/** Nightly: forgotten memories older than MEMORY_PURGE_DAYS and stale suggestions are deleted for good. */
export async function purgeGideonMemories(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MEMORY_PURGE_DAYS * 864e5)
  const stale = new Date(now.getTime() - MEMORY_PURGE_DAYS * 864e5)
  const n = await prisma.gideonMemory.deleteMany({ where: { OR: [{ deletedAt: { lt: cutoff } }, { status: "PENDING", deletedAt: null, createdAt: { lt: stale } }] } })
  return n.count
}

// ── The tools (POST /api/gideon/tools, as the asking person, inside their own CHAT run) ──────────────

export const MEMORY_ACTIONS = new Set(["remember", "forget", "list_my_memories"])

export async function runMemoryTool(
  actorId: string,
  action: string,
  input: Record<string, unknown>,
  run: { id: string; trigger: string } | null,
): Promise<{ data: Record<string, unknown>; memories: MemoryView[] }> {
  if (!(await memoryFeatureOn())) throw new MemoryRefusal("paused", "GIDEON Memory is not available right now. Nothing was saved.")
  if (action === "list_my_memories") {
    if (await isMemoryPaused(actorId)) return { data: { paused: true, memories: [], note: "GIDEON Memory is paused by this person." }, memories: [] }
    const list = await listMemories(actorId)
    return { data: { memories: list.map((m) => ({ memoryId: m.id, kind: m.kind, text: m.text, ...(m.monthDay ? { date: m.monthDay } : {}) })), note: list.length ? "Only this person's own memories. Never share them with anyone else." : "Nothing remembered yet." }, memories: [] }
  }
  // Writes only from the person's own private chat: never from an @GIDEON mention, a digest or a ticket review.
  if (!run || run.trigger !== "CHAT") throw new MemoryRefusal("not_found", "GIDEON Memory can only be changed in the person's own GIDEON chat.")
  if (action === "forget") {
    const gone = await forgetMemories(actorId, { id: input.memoryId ?? input.id, query: input.query ?? input.text ?? input.about, all: input.all })
    return { data: { forgotten: gone.map((m) => m.text), note: "Forgotten: GIDEON no longer uses it. Say so in one short line." }, memories: [] }
  }
  // remember
  const parkedQ = runQuestion(run.id)
  const question = parkedQ?.question ?? ""
  // Saved at once only when the PERSON asked for it in this question ("inget ya…"), or answered "iya" to the very
  // suggestion GIDEON made (a PENDING row with the same text). Otherwise it is a suggestion with a chip.
  let explicit = input.explicit !== false && asksToRemember(question)
  if (!explicit && isAffirmation(question)) {
    const key = memoryKey(cleanMemoryText(input.text ?? input.memory ?? input.what))
    explicit = !!key && !!(await prisma.gideonMemory.findFirst({ where: { userId: actorId, textKey: key, status: "PENDING", deletedAt: null }, select: { id: true } }))
  }
  const saved = await saveMemory(actorId, {
    text: input.text ?? input.memory ?? input.what,
    kind: input.kind,
    date: input.date ?? input.monthDay,
    status: explicit ? "ACTIVE" : "PENDING",
    source: "CHAT",
    explicit,
    chatId: parkedQ?.chatId ?? null,
    runId: run.id,
  })
  const m = saved.memory
  const note = m.status === "ACTIVE"
    ? (saved.created ? "Saved to GIDEON Memory. Confirm in one short line; they can see, edit or delete it in Settings › GIDEON Memory." : "Already remembered. No need to mention it again.")
    : "NOT saved yet: a Save / Don't save chip is under your answer. Ask in one short line at the end (e.g. \"Aku ingat ya: …?\"). Follow the preference in this answer anyway."
  return { data: { memoryId: m.id, status: m.status, text: m.text, note }, memories: [m] }
}

/**
 * Meeting notes (Beta, owner 18 Oct 2026) — the pure parts: audio sniffing, transcript formatting and chunking,
 * the GIDEON prompts and the reading of their answers, matching a spoken name to a project member, and the
 * minutes as a block document. No I/O: unit-tested in meeting-notes-core.test.mjs.
 */

export const MEETING_STATUSES = ["UPLOADING", "QUEUED", "TRANSCRIBING", "SUMMARIZING", "READY", "APPLYING", "APPLIED", "FAILED"] as const
export type MeetingStatus = (typeof MEETING_STATUSES)[number]
export const MEETING_LANGUAGES = ["auto", "id", "en"] as const
export type MeetingLanguage = (typeof MEETING_LANGUAGES)[number]

// ---------------------------------------------------------------- audio

/** What may be uploaded, by extension. Video containers are accepted for their audio track. */
export const MEETING_AUDIO_EXTS = ["m4a", "mp4", "mov", "mp3", "wav", "webm", "ogg", "oga", "opus", "aac", "flac", "3gp", "amr"] as const
export type MeetingAudioExt = (typeof MEETING_AUDIO_EXTS)[number]

const MIME_EXT: Record<string, MeetingAudioExt> = {
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/aac": "aac", "audio/x-aac": "aac", "audio/aacp": "aac",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav",
  "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "application/ogg": "ogg", "audio/opus": "opus",
  "audio/flac": "flac", "audio/x-flac": "flac", "video/mp4": "mp4", "video/quicktime": "mov", "audio/3gpp": "3gp", "video/3gpp": "3gp", "audio/amr": "amr",
}

/** The extension to store the file under: the name's when it is an audio one, else from the MIME type. */
export function meetingAudioExt(name: string | null | undefined, mime: string | null | undefined): MeetingAudioExt | null {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(name || ""))
  const fromName = m ? m[1].toLowerCase() : ""
  if ((MEETING_AUDIO_EXTS as readonly string[]).includes(fromName)) return fromName as MeetingAudioExt
  const base = String(mime || "").toLowerCase().split(";")[0].trim()
  return MIME_EXT[base] ?? null
}

/** The family the first bytes say the file is, or null when they look like none of them. */
export function sniffAudio(head: Uint8Array): "mp4" | "mp3" | "wav" | "webm" | "ogg" | "aac" | "flac" | "amr" | null {
  const b = head
  const at = (i: number, s: string) => s.split("").every((c, k) => b[i + k] === c.charCodeAt(0))
  if (b.length < 12) return null
  if (at(4, "ftyp")) return "mp4" // m4a, mp4, mov, 3gp
  if (at(4, "moov") || at(4, "mdat") || at(4, "wide") || at(4, "free")) return "mp4"
  if (at(0, "RIFF") && at(8, "WAVE")) return "wav"
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm"
  if (at(0, "OggS")) return "ogg"
  if (at(0, "fLaC")) return "flac"
  if (at(0, "#!AMR")) return "amr"
  if (at(0, "ID3")) return "mp3"
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac" // ADTS
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3" // MPEG audio frame sync
  return null
}

/** Whether sniffed bytes agree with the extension (a renamed .exe is refused; m4a/mp4/mov share a family). */
export function audioBytesMatch(ext: MeetingAudioExt, family: ReturnType<typeof sniffAudio>): boolean {
  if (!family) return false
  const want: Record<MeetingAudioExt, string[]> = {
    m4a: ["mp4"], mp4: ["mp4"], mov: ["mp4"], "3gp": ["mp4"], mp3: ["mp3"], wav: ["wav"], webm: ["webm"],
    ogg: ["ogg"], oga: ["ogg"], opus: ["ogg", "webm"], aac: ["aac", "mp4"], flac: ["flac"], amr: ["amr"],
  }
  return want[ext].includes(family)
}

// ---------------------------------------------------------------- transcript

export type TranscriptSegment = { start: number; end: number; text: string; speaker?: string | null }

/** 754.2 → "12:34", 3723 → "1:02:03". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const two = (n: number) => String(n).padStart(2, "0")
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`
}

/** Whisper's segments as stored: numbers checked, text trimmed, empty ones dropped. */
export function cleanSegments(raw: unknown): TranscriptSegment[] {
  if (!Array.isArray(raw)) return []
  const out: TranscriptSegment[] = []
  for (const r of raw) {
    if (!r || typeof r !== "object") continue
    const x = r as Record<string, unknown>
    const text = typeof x.text === "string" ? x.text.replace(/\s+/g, " ").trim() : ""
    if (!text) continue
    const start = Number(x.start)
    const end = Number(x.end)
    const seg: TranscriptSegment = { start: Number.isFinite(start) ? Math.max(0, start) : 0, end: Number.isFinite(end) ? Math.max(0, end) : 0, text: text.slice(0, 4000) }
    if (typeof x.speaker === "string" && x.speaker.trim()) seg.speaker = x.speaker.trim().slice(0, 40)
    out.push(seg)
    if (out.length >= 20000) break
  }
  return out
}

/** One line per segment, "[12:34] text" (with "Speaker 2: " when the segment has a speaker). */
export function transcriptLines(segments: TranscriptSegment[], speakerName?: (label: string) => string): string[] {
  return segments.map((s) => `[${clock(s.start)}] ${s.speaker ? `${speakerName ? speakerName(s.speaker) : s.speaker}: ` : ""}${s.text}`)
}

// ---------------------------------------------------------------- speakers (owner, 19 Oct 2026)

/**
 * "Speaker N" → a person. auto = read from the round of introductions (introNames); a hand-made entry has no
 * `auto` and always wins over an automatic one (mergeSpeakers).
 */
export type SpeakerEntry = { name: string; userId: string | null; auto?: boolean }
export type SpeakerMap = Record<string, SpeakerEntry>
export type NameCandidate = { id: string; name: string; inProject?: boolean }

/**
 * The people a voice is named after AUTOMATICALLY (QA final 19 Oct 2026, D-Q3): the project's members only, so a
 * heard "Dimas" never becomes a real colleague who was not in the meeting's project; another name stays plain
 * text ("Dimas", no person). A meeting outside any project matches only its uploader. Naming a voice by hand still
 * offers the whole workspace (speakerCandidates).
 */
export function autoMatchCandidates(candidates: NameCandidate[], uploaderId: string, hasProject: boolean): NameCandidate[] {
  return candidates.filter((c) => (hasProject ? c.inProject === true : c.id === uploaderId))
}

/** Without the record screen's marker, introductions are looked for in the first two minutes only. */
export const INTRO_DEFAULT_SEC = 120

const NAME_STOP = new Set([
  "dari", "mau", "akan", "pegang", "di", "yang", "sudah", "juga", "adalah", "sebagai", "bagian", "lagi", "setuju", "kerja", "bekerja",
  "ikut", "cuma", "hanya", "baru", "tadi", "nanti", "rasa", "kira", "pikir", "punya", "minta", "mohon", "bisa", "tidak", "nggak", "gak",
  "enggak", "belum", "masih", "selaku", "yg", "dan", "atau", "untuk", "dengan", "ke", "ini", "itu", "sini", "situ", "kan", "sih", "dong",
  "ya", "oke", "ok", "mulai", "pimpin", "memimpin", "bertugas", "tugas", "tim", "team", "divisi", "jadi", "perwakilan", "wakil", "pic",
  "the", "a", "an", "from", "working", "here", "going", "not", "just", "also", "on", "in", "at", "with", "and", "sorry", "fine", "good",
  "happy", "glad", "sure", "ready", "back", "joining", "speaking", "leading", "responsible", "currently", "still", "very", "so", "now",
  "pak", "bu", "bapak", "ibu", "mas", "mbak", "kak", "bang",
])
const INTRO_TRIGGER = /(?<=^|[\s,.;:!?"“(])(?:nama\s*(?:saya|aku|gue|gw)(?:\s+adalah)?|namaku|saya|aku|gue|gw|panggil(?:\s+(?:saja|aja))?|dipanggil|my\s+name\s+is|my\s+name's|i'm|i\s+am|this\s+is|call\s+me)\s+((?:[\p{L}][\p{L}'-]*[ \t]*){1,3})/giu

function editSim(a: string, b: string): number {
  if (a === b) return 1
  const m = a.length, n = b.length
  if (!m || !n) return 0
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim()

/**
 * The person a heard name means: the candidate whose full name or first name is (nearly) the heard name. Project
 * members first, then the workspace; two equally good people → null (better "Speaker 2" than the wrong person).
 */
export function matchHeardName(heard: string, candidates: NameCandidate[]): NameCandidate | null {
  const h = fold(heard)
  if (h.length < 2) return null
  const words = h.split(" ")
  let best: { c: NameCandidate; score: number }[] = []
  for (const c of candidates) {
    const full = fold(c.name)
    if (!full) continue
    const parts = full.split(" ")
    let score = 0
    // "Berlin" ~ "Berlin", "Galang" ~ "Galang Pratama", "Dimas Putra" ~ "Dimas Putra Wijaya"
    for (let k = Math.min(words.length, 3); k >= 1; k--) {
      const said = words.slice(0, k).join(" ")
      // the full name, its first k words, or (one word said) any other word of it, a little less sure
      const s = Math.max(editSim(said, full), editSim(said, parts.slice(0, k).join(" ")), ...parts.slice(1).map((p) => (k === 1 ? editSim(said, p) * 0.95 : 0)))
      // more words heard and matching = surer ("Ayu Lestari" beats "Ayu Wandira" though both start "Ayu")
      score = Math.max(score, s + (s >= 0.8 ? 0.03 * (k - 1) : 0))
    }
    if (score >= 0.8) best.push({ c, score: score + (c.inProject ? 0.05 : 0) })
  }
  if (!best.length) return null
  best = best.sort((a, b) => b.score - a.score)
  if (best.length > 1 && best[0].score - best[1].score < 0.02 && fold(best[0].c.name) !== fold(best[1].c.name)) return null
  return best[0].c
}

/**
 * The names in "saya Berlin" / "nama saya Dimas Putra" / "I'm Ayu": capitalised words that are not filler.
 * `sure` = said with a naming phrase ("nama saya", "panggil saja", "my name is"), or one word that ends the
 * phrase ("saya Ayu, …"). Only a sure name that matches nobody is used as heard: "Saya Backend Engineer" is not.
 */
function heardNames(text: string): Array<{ name: string; sure: boolean }> {
  const out: Array<{ name: string; sure: boolean }> = []
  const FOLLOW = new Set(["dari", "di", "dan", "from", "here", "yang", "selaku", "sebagai"])
  for (const m of text.matchAll(INTRO_TRIGGER)) {
    const strong = /nama|panggil|my\s+name|call\s+me/i.test(m[0].slice(0, m[0].length - m[1].length))
    const words = m[1].trim().split(/\s+/).map((w) => w.replace(/[.'-]+$/g, "")).filter(Boolean)
    const name: string[] = []
    let next: string | undefined
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (NAME_STOP.has(w.toLowerCase()) || !/^\p{Lu}/u.test(w)) { next = w; break }
      name.push(w)
      if (name.length === 2) { next = words[i + 1]; break }
    }
    if (!name.length) continue
    const after = text.slice((m.index ?? 0) + m[0].length).trimStart()
    const ended = name.length === words.length && (!after || /^[,.;:!?)]/.test(after))
    const sure = strong || (name.length === 1 && (ended || (next !== undefined && FOLLOW.has(next.toLowerCase()))))
    out.push({ name: name.join(" "), sure })
  }
  return out
}

/**
 * Names for the voices, read from the round of introductions at the start ("Halo, saya Berlin…"). Only segments
 * before `introEndSec` (the record screen's "Done with introductions"; INTRO_DEFAULT_SEC without it) count. Each
 * voice gets the name it said most; a person is given to one voice only (the one that said it most, then the
 * first). A heard name that matches nobody is kept as heard (no userId).
 */
export function introNames(segments: TranscriptSegment[], introEndSec: number | null | undefined, candidates: NameCandidate[]): SpeakerMap {
  const end = introEndSec && introEndSec > 0 ? introEndSec + 1 : INTRO_DEFAULT_SEC
  const votes = new Map<string, Map<string, { n: number; first: number; who: NameCandidate | null; heard: string }>>()
  for (const s of segments) {
    if (s.start >= end) break
    if (!s.speaker) continue
    for (const { name: heard, sure } of heardNames(s.text)) {
      const who = matchHeardName(heard, candidates)
      if (!who && !sure) continue
      const key = who ? `u:${who.id}` : `h:${fold(heard)}`
      const per = votes.get(s.speaker) ?? new Map()
      const v = per.get(key) ?? { n: 0, first: s.start, who, heard }
      v.n++
      per.set(key, v)
      votes.set(s.speaker, per)
    }
  }
  const claims: Array<{ label: string; key: string; n: number; first: number; who: NameCandidate | null; heard: string }> = []
  for (const [label, per] of votes) for (const [key, v] of per) claims.push({ label, key, ...v })
  // A name that is someone in the workspace beats one that is not ("saya Dimas. Saya backend engineer" →
  // Dimas, not "Backend"), then the most said, then the first said.
  claims.sort((a, b) => Number(Boolean(b.who)) - Number(Boolean(a.who)) || b.n - a.n || a.first - b.first)
  const out: SpeakerMap = {}
  const taken = new Set<string>()
  for (const c of claims) {
    if (out[c.label] || taken.has(c.key)) continue
    taken.add(c.key)
    out[c.label] = c.who ? { name: c.who.name, userId: c.who.id, auto: true } : { name: c.heard.slice(0, 120), userId: null, auto: true }
  }
  return out
}

/** Automatic names under the hand-made ones: a label someone named by hand keeps that name. */
export function mergeSpeakers(current: unknown, auto: SpeakerMap): SpeakerMap {
  const cur = cleanSpeakers(current)
  const out: SpeakerMap = { ...auto }
  for (const [k, v] of Object.entries(cur)) if (!v.auto) out[k] = v
  return out
}

export function cleanSpeakers(raw: unknown): SpeakerMap {
  const out: SpeakerMap = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>
    const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, 120) : ""
    if (k.length > 40 || !name) continue
    out[k] = { name, userId: typeof o.userId === "string" && o.userId ? o.userId.slice(0, 40) : null, ...(o.auto === true ? { auto: true } : {}) }
  }
  return out
}

/** Lines grouped into chunks of at most `maxChars` (a single over-long line is cut). */
export function chunkLines(lines: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let cur = ""
  for (const raw of lines) {
    const line = raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw
    if (cur && cur.length + 1 + line.length > maxChars) { chunks.push(cur); cur = "" }
    cur = cur ? `${cur}\n${line}` : line
  }
  if (cur) chunks.push(cur)
  return chunks
}

// ---------------------------------------------------------------- GIDEON

export type MeetingPromptMeta = {
  title: string
  /** YYYY-MM-DD (Asia/Jakarta) the meeting took place; relative dates ("next Friday") resolve from it. */
  date: string
  weekday: string
  projectName: string | null
  /** Project members GIDEON may name as PIC (exact names). */
  members: string[]
  /** Attendees the person already listed. */
  attendees: string[]
  durationLabel: string | null
}

/** Rules every meeting prompt starts with (same text each time: friendly to the provider's prompt cache). */
const RULES = [
  "You are GIDEON, writing meeting minutes inside NEXUS. Do NOT call any tools: everything you may use is below.",
  "The transcript comes from automatic speech recognition: names and words can be misheard. A line starts with its speaker when the voice was recognised (a person's name, or \"Speaker N\" for a voice nobody named); lines without one have no known speaker, and a label can be wrong when people talk over each other. Never invent facts, names, numbers or dates that the transcript does not support.",
  "Write in the language mostly spoken in the meeting (Indonesian stays Indonesian; keep English terms people used as they said them).",
  "Do not mention models, providers or yourself.",
]

function metaLines(m: MeetingPromptMeta): string[] {
  return [
    `MEETING: "${m.title || "Untitled meeting"}" on ${m.weekday} ${m.date}${m.durationLabel ? ` (${m.durationLabel})` : ""}.`,
    m.projectName ? `PROJECT: "${m.projectName}".` : "PROJECT: not chosen yet.",
    m.members.length ? `PROJECT MEMBERS (the only people who can be a task PIC; use these exact names): ${m.members.map((n) => `"${n}"`).join(", ")}.` : "PROJECT MEMBERS: none known — leave every pic null.",
    m.attendees.length ? `ATTENDEES listed by the organiser: ${m.attendees.join(", ")}.` : "",
  ].filter(Boolean)
}

/** Notes of ONE part of a long meeting (the map step). Answer: the NOTES JSON shape. */
export function chunkNotesPrompt(meta: MeetingPromptMeta, part: { index: number; total: number; text: string }): string {
  return [
    ...RULES,
    ...metaLines(meta),
    `This is PART ${part.index + 1} of ${part.total} of the transcript. Take notes of THIS part only, short and factual.`,
    `Answer with ONLY one JSON object, no code fence: {"summary":["…"],"topics":[{"title":"…","points":["…"]}],"decisions":["…"],"openQuestions":["…"],"actionItems":[{"text":"…","owner":"name or null","due":"YYYY-MM-DD or null"}],"people":["names heard"]}`,
    "At most 8 summary bullets, 6 topics, 3 points per topic. Keep every concrete commitment as an action item.",
    "TRANSCRIPT PART:",
    part.text,
  ].join("\n")
}

/** Several parts' notes folded into one notes object (a second map level for very long meetings). */
export function mergeNotesPrompt(meta: MeetingPromptMeta, notes: string[]): string {
  return [
    ...RULES,
    ...metaLines(meta),
    "Below are notes of consecutive parts of one meeting. Merge them into ONE notes object of the same shape: remove repeats, keep every decision and action item.",
    `Answer with ONLY one JSON object, no code fence: {"summary":["…"],"topics":[{"title":"…","points":["…"]}],"decisions":["…"],"openQuestions":["…"],"actionItems":[{"text":"…","owner":"name or null","due":"YYYY-MM-DD or null"}],"people":["…"]}`,
    ...notes.map((n, i) => `NOTES ${i + 1}:\n${n}`),
  ].join("\n")
}

/** The minutes, overview and proposed tasks (the reduce step), from the whole transcript or the merged notes. */
export function minutesPrompt(meta: MeetingPromptMeta, source: { kind: "transcript" | "notes"; text: string }): string {
  return [
    ...RULES,
    ...metaLines(meta),
    source.kind === "transcript" ? "Below is the full transcript." : "Below are notes taken from the full transcript, part by part, in order.",
    "Write the minutes of meeting (MoM) and propose tasks from the action items.",
    "- overview: 2–4 sentences, what the meeting was about and what came out of it.",
    "- title: a short title for the minutes (max 8 words), in the meeting's language.",
    "- attendees: people who clearly took part (names as heard; include the listed attendees).",
    "- topics: the main topics, each with a few short points. decisions: what was agreed. openQuestions: what is still open.",
    "- actionItems: every concrete next step: text, owner (a name or null), due (YYYY-MM-DD resolved from the meeting date, or null).",
    "- tasks: one proposed NEXUS task per action item that is real work: title (imperative, max 10 words), description (1–2 sentences of context), pic (EXACTLY one name from PROJECT MEMBERS, or null when nobody from that list owns it), due (YYYY-MM-DD or null), action (the index of its action item).",
    `Answer with ONLY one JSON object, no code fence, no other text: {"title":"…","overview":"…","attendees":["…"],"topics":[{"title":"…","points":["…"]}],"decisions":["…"],"openQuestions":["…"],"actionItems":[{"text":"…","owner":null,"due":null}],"tasks":[{"title":"…","description":"…","pic":null,"due":null,"action":0}]}`,
    source.kind === "transcript" ? "TRANSCRIPT:" : "NOTES:",
    source.text,
  ].join("\n")
}

/** The first {...} object in a reply (tolerates a code fence or a stray sentence around it). */
export function firstJsonObject(reply: string): Record<string, unknown> | null {
  const text = String(reply || "").replace(/```(?:json)?/gi, "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export type MomTopic = { title: string; points: string[] }
export type MomActionItem = { text: string; owner: string | null; due: string | null }
export type Mom = {
  attendees: string[]
  topics: MomTopic[]
  decisions: string[]
  openQuestions: string[]
  actionItems: MomActionItem[]
}
export type MinutesDraft = { title: string; overview: string; mom: Mom; tasks: Array<{ title: string; description: string; pic: string | null; due: string | null; action: number | null }> }

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "")
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, maxLen)).filter(Boolean))].slice(0, maxItems) : []
export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

export function cleanMom(raw: unknown): Mom {
  const x = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const topics = Array.isArray(x.topics)
    ? x.topics.map((t) => {
        const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>
        return { title: str(o.title, 200), points: strList(o.points, 12, 600) }
      }).filter((t) => t.title || t.points.length).slice(0, 30)
    : []
  const actionItems = Array.isArray(x.actionItems)
    ? x.actionItems.map((a) => {
        const o = (a && typeof a === "object" ? a : { text: a }) as Record<string, unknown>
        return { text: str(o.text, 500), owner: str(o.owner, 120) || null, due: isDay(o.due) ? (o.due as string) : null }
      }).filter((a) => a.text).slice(0, 60)
    : []
  return {
    // "Speaker 4" is a voice nobody named, not a person: never an attendee.
    attendees: strList(x.attendees ?? x.people, 60, 120).filter((a) => !/^(speaker|pembicara)\s*\d+$/i.test(a.trim())),
    topics,
    decisions: strList(x.decisions, 40, 600),
    openQuestions: strList(x.openQuestions, 40, 600),
    actionItems,
  }
}

/** GIDEON's minutes answer → a clean draft, or null when it is not readable. */
export function parseMinutes(reply: string): MinutesDraft | null {
  const o = firstJsonObject(reply)
  if (!o) return null
  const mom = cleanMom(o)
  const overview = typeof o.overview === "string" ? o.overview.trim().slice(0, 3000) : ""
  if (!overview && !mom.topics.length && !mom.actionItems.length && !mom.decisions.length) return null
  const tasks = Array.isArray(o.tasks)
    ? o.tasks.map((t) => {
        const x = (t && typeof t === "object" ? t : {}) as Record<string, unknown>
        const action = Number.isInteger(x.action) && (x.action as number) >= 0 && (x.action as number) < mom.actionItems.length ? (x.action as number) : null
        return { title: str(x.title, 200), description: typeof x.description === "string" ? x.description.trim().slice(0, 2000) : "", pic: str(x.pic, 120) || null, due: isDay(x.due) ? (x.due as string) : null, action }
      }).filter((t) => t.title).slice(0, 40)
    : []
  return { title: str(o.title, 120), overview, mom, tasks }
}

/** Notes of a part, compacted to JSON text for the next step (null = unreadable). */
export function compactNotes(reply: string): string | null {
  const o = firstJsonObject(reply)
  if (!o) return null
  const mom = cleanMom(o)
  const summary = strList(o.summary, 10, 400)
  if (!summary.length && !mom.topics.length && !mom.actionItems.length && !mom.decisions.length) return null
  return JSON.stringify({ summary, topics: mom.topics, decisions: mom.decisions, openQuestions: mom.openQuestions, actionItems: mom.actionItems, people: mom.attendees })
}

// ---------------------------------------------------------------- people

export type MemberLite = { id: string; name: string }

/** A spoken/written name → one project member: exact name, else a unique first-name or contained match. */
export function matchMember(name: string | null | undefined, members: MemberLite[]): MemberLite | null {
  const n = String(name || "").toLowerCase().replace(/^(pak|bu|bapak|ibu|mas|mbak|kak|bang)\s+/i, "").replace(/\s+/g, " ").trim()
  if (!n) return null
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
  const exact = members.filter((m) => norm(m.name) === n)
  if (exact.length === 1) return exact[0]
  const first = members.filter((m) => norm(m.name).split(" ")[0] === n.split(" ")[0])
  if (first.length === 1) return first[0]
  const contains = members.filter((m) => norm(m.name).includes(n) || (n.length >= 4 && n.includes(norm(m.name))))
  return contains.length === 1 ? contains[0] : null
}

// ---------------------------------------------------------------- proposals (what Apply takes)

export type TaskProposal = {
  /** Stable key per row (survives edits; Apply reports per key). */
  key: string
  include: boolean
  title: string
  description: string
  assigneeIds: string[]
  dueDate: string | null
  /** Index into mom.actionItems, or null. */
  actionIndex: number | null
}

export function cleanProposals(raw: unknown, validMemberIds?: Set<string>): TaskProposal[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TaskProposal[] = []
  for (const r of raw) {
    if (!r || typeof r !== "object") continue
    const x = r as Record<string, unknown>
    let key = typeof x.key === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x.key) ? x.key : `t${out.length + 1}`
    while (seen.has(key)) key = `${key}x`
    seen.add(key)
    const title = str(x.title, 200)
    if (!title) continue
    const ids = Array.isArray(x.assigneeIds) ? [...new Set(x.assigneeIds.filter((i): i is string => typeof i === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(i)))] : []
    out.push({
      key,
      include: x.include !== false,
      title,
      description: typeof x.description === "string" ? x.description.trim().slice(0, 4000) : "",
      assigneeIds: (validMemberIds ? ids.filter((i) => validMemberIds.has(i)) : ids).slice(0, 10),
      dueDate: isDay(x.dueDate) ? (x.dueDate as string) : null,
      actionIndex: Number.isInteger(x.actionIndex) && (x.actionIndex as number) >= 0 ? (x.actionIndex as number) : null,
    })
    if (out.length >= 60) break
  }
  return out
}

/** The draft's tasks → proposals, PIC names resolved against the project members. */
export function draftToProposals(draft: MinutesDraft, members: MemberLite[]): TaskProposal[] {
  return draft.tasks.map((t, i) => {
    const pic = matchMember(t.pic, members) ?? (t.action !== null ? matchMember(draft.mom.actionItems[t.action]?.owner, members) : null)
    return {
      key: `t${i + 1}`,
      include: true,
      title: t.title,
      description: t.description,
      assigneeIds: pic ? [pic.id] : [],
      dueDate: t.due ?? (t.action !== null ? draft.mom.actionItems[t.action]?.due ?? null : null),
      actionIndex: t.action,
    }
  })
}

// ---------------------------------------------------------------- the minutes as a block document

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }

const text = (t: string, marks?: Node["marks"]): Node => ({ type: "text", text: t, ...(marks ? { marks } : {}) })
const p = (...content: Node[]): Node => (content.filter((c) => c.type !== "text" || c.text).length ? { type: "paragraph", content: content.filter((c) => c.type !== "text" || c.text) } : { type: "paragraph" })
const h = (level: number, t: string): Node => ({ type: "heading", attrs: { level }, content: [text(t)] })
const bullets = (items: string[]): Node => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(text(i))] })) })

export type DocLabels = {
  beta: string
  recordedBy: string
  overview: string
  attendees: string
  topics: string
  decisions: string
  openQuestions: string
  actionItems: string
  transcript: string
  transcriptNote: string
  none: string
  owner: string
}

export const DOC_LABELS: Record<"en" | "id", DocLabels> = {
  en: { beta: "Meeting notes (Beta)", recordedBy: "Recorded by", overview: "Overview", attendees: "Attendees", topics: "Topics", decisions: "Decisions", openQuestions: "Open questions", actionItems: "Action items", transcript: "Transcript", transcriptNote: "Automatic transcript — names and words can be misheard.", none: "None", owner: "Owner" },
  id: { beta: "Catatan meeting (Beta)", recordedBy: "Direkam oleh", overview: "Ringkasan", attendees: "Peserta", topics: "Topik", decisions: "Keputusan", openQuestions: "Pertanyaan terbuka", actionItems: "Action item", transcript: "Transkrip", transcriptNote: "Transkrip otomatis — nama dan kata bisa salah dengar.", none: "Tidak ada", owner: "PIC" },
}

export function buildMinutesDoc(input: {
  lang: "en" | "id"
  dateLabel: string
  durationLabel: string | null
  recordedBy: { id: string; name: string }
  overview: string
  mom: Mom
  /** Created tasks per action item index (and the ones without one), for task mentions in the list. */
  tasks: Array<{ id: string; title: string; actionIndex: number | null; assignees: MemberLite[]; dueDate: string | null }>
  transcript: TranscriptSegment[]
  speakerName?: (label: string) => string
}): { type: "doc"; content: Node[] } {
  const L = DOC_LABELS[input.lang]
  const content: Node[] = []
  content.push({
    type: "callout",
    attrs: { emoji: "🎙️" },
    content: [p(text(`${L.beta} · ${input.dateLabel}${input.durationLabel ? ` · ${input.durationLabel}` : ""} · ${L.recordedBy} `), { type: "mention", attrs: { id: input.recordedBy.id, label: input.recordedBy.name, kind: "user" } })],
  })
  content.push(h(2, L.overview), ...(input.overview ? input.overview.split(/\n{2,}/).map((para) => p(text(para.trim()))) : [p(text(L.none))]))
  content.push(h(2, L.attendees), input.mom.attendees.length ? bullets(input.mom.attendees) : p(text(L.none)))
  content.push(h(2, L.topics))
  if (input.mom.topics.length) {
    for (const t of input.mom.topics) {
      content.push(h(3, t.title || "—"))
      if (t.points.length) content.push(bullets(t.points))
    }
  } else content.push(p(text(L.none)))
  content.push(h(2, L.decisions), input.mom.decisions.length ? bullets(input.mom.decisions) : p(text(L.none)))
  content.push(h(2, L.openQuestions), input.mom.openQuestions.length ? bullets(input.mom.openQuestions) : p(text(L.none)))
  content.push(h(2, L.actionItems))
  const items: Node[] = []
  const usedTasks = new Set<string>()
  input.mom.actionItems.forEach((a, i) => {
    const linked = input.tasks.filter((t) => t.actionIndex === i)
    linked.forEach((t) => usedTasks.add(t.id))
    const line: Node[] = [text(a.text)]
    if (!linked.length && a.owner) line.push(text(` — ${L.owner}: ${a.owner}`))
    if (!linked.length && a.due) line.push(text(" "), { type: "dateChip", attrs: { date: a.due, time: null, remind: false } })
    for (const t of linked) {
      line.push(text(" → "), { type: "mention", attrs: { id: t.id, label: t.title, kind: "task" } })
      for (const u of t.assignees) line.push(text(" "), { type: "mention", attrs: { id: u.id, label: u.name, kind: "user" } })
      if (t.dueDate) line.push(text(" "), { type: "dateChip", attrs: { date: t.dueDate, time: null, remind: false } })
    }
    items.push({ type: "taskItem", attrs: { checked: false }, content: [p(...line)] })
  })
  for (const t of input.tasks) {
    if (usedTasks.has(t.id)) continue
    const line: Node[] = [{ type: "mention", attrs: { id: t.id, label: t.title, kind: "task" } }]
    for (const u of t.assignees) line.push(text(" "), { type: "mention", attrs: { id: u.id, label: u.name, kind: "user" } })
    if (t.dueDate) line.push(text(" "), { type: "dateChip", attrs: { date: t.dueDate, time: null, remind: false } })
    items.push({ type: "taskItem", attrs: { checked: false }, content: [p(...line)] })
  }
  content.push(items.length ? { type: "taskList", content: items } : p(text(L.none)))
  if (input.transcript.length) {
    const lines = transcriptLines(input.transcript, input.speakerName)
    // One paragraph per ~20 lines with hard breaks keeps a 3-hour transcript well under the node limit.
    const paras: Node[] = []
    for (let i = 0; i < lines.length; i += 20) {
      const group = lines.slice(i, i + 20)
      const inl: Node[] = []
      group.forEach((l, k) => { if (k) inl.push({ type: "hardBreak" }); inl.push(text(l)) })
      paras.push({ type: "paragraph", content: inl })
    }
    content.push(h(2, L.transcript))
    content.push({
      type: "details",
      attrs: { open: false },
      content: [
        { type: "detailsSummary", content: [text(`${L.transcript} · ${input.transcript.length} ${input.lang === "id" ? "baris" : "lines"}`)] },
        { type: "detailsContent", content: [p(text(L.transcriptNote, [{ type: "italic" }])), ...paras] },
      ],
    })
  }
  return { type: "doc", content }
}

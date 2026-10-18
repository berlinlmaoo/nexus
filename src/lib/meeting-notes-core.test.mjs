// node --experimental-strip-types src/lib/meeting-notes-core.test.mjs
import assert from "node:assert/strict"
import {
  audioBytesMatch, buildMinutesDoc, chunkLines, chunkNotesPrompt, cleanProposals, cleanSegments, clock, compactNotes, draftToProposals,
  matchMember, meetingAudioExt, minutesPrompt, parseMinutes, sniffAudio, transcriptLines,
} from "./meeting-notes-core.ts"

const bytes = (s, pad = 16) => { const b = new Uint8Array(Math.max(pad, s.length)); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b }
// Audio sniffing
assert.equal(sniffAudio(bytes("\0\0\0\x20ftypM4A ")), "mp4")
assert.equal(sniffAudio(bytes("RIFF\0\0\0\0WAVEfmt ")), "wav")
assert.equal(sniffAudio(bytes("OggS\0\x02")), "ogg")
assert.equal(sniffAudio(bytes("ID3\x04\0\0")), "mp3")
assert.equal(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), "webm")
assert.equal(sniffAudio(new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0])), "aac")
assert.equal(sniffAudio(bytes("MZ\x90\0 not audio")), null)
assert.equal(audioBytesMatch("m4a", "mp4"), true)
assert.equal(audioBytesMatch("mp3", "mp4"), false)
assert.equal(audioBytesMatch("webm", null), false)
assert.equal(meetingAudioExt("Rapat Senin.M4A", ""), "m4a")
assert.equal(meetingAudioExt("blob", "audio/webm;codecs=opus"), "webm")
assert.equal(meetingAudioExt("evil.exe", "application/x-msdownload"), null)

// Transcript
assert.equal(clock(754.2), "12:34")
assert.equal(clock(3723), "1:02:03")
const segs = cleanSegments([{ start: 0, end: 2.5, text: "  Halo  semua " }, { start: 3, end: 4, text: "" }, { start: 5, end: 9, text: "Oke, next item", speaker: "Speaker 2" }, "x"])
assert.equal(segs.length, 2)
assert.deepEqual(transcriptLines(segs, (l) => (l === "Speaker 2" ? "Rina" : l)), ["[0:00] Halo semua", "[0:05] Rina: Oke, next item"])
const chunks = chunkLines(Array.from({ length: 50 }, (_, i) => `[0:${String(i).padStart(2, "0")}] ${"x".repeat(90)}`), 1000)
assert.ok(chunks.length >= 5 && chunks.every((c) => c.length <= 1000))

// Prompts stay under the shim cap for a part
const meta = { title: "Weekly", date: "2026-10-18", weekday: "Sunday", projectName: "Intoo", members: ["Rina Wulandari", "Budi Santoso"], attendees: [], durationLabel: "45 min" }
const part = chunkNotesPrompt(meta, { index: 0, total: 3, text: "x".repeat(11000) })
assert.ok(part.length < 15500)
assert.ok(minutesPrompt(meta, { kind: "transcript", text: "" }).includes('"Rina Wulandari"'))

// Reading GIDEON's answers
const reply = "Here you go:\n```json\n" + JSON.stringify({
  title: "Rapat mingguan", overview: "Tim membahas rilis.", attendees: ["Rina", "Budi"],
  topics: [{ title: "Rilis", points: ["Tanggal 22 Okt"] }], decisions: ["Rilis Kamis"], openQuestions: [],
  actionItems: [{ text: "Siapkan release notes", owner: "Rina", due: "2026-10-20" }, { text: "Cek server", owner: "Pak Budi", due: "besok" }],
  tasks: [{ title: "Siapkan release notes", description: "Untuk App Store", pic: "Rina Wulandari", due: "2026-10-20", action: 0 }, { title: "Cek server", pic: null, due: null, action: 1 }, { title: "" }],
}) + "\n```"
const draft = parseMinutes(reply)
assert.ok(draft)
assert.equal(draft.mom.actionItems[1].due, null) // "besok" is not a date
assert.equal(draft.tasks.length, 2)
const members = [{ id: "u1", name: "Rina Wulandari" }, { id: "u2", name: "Budi Santoso" }, { id: "u3", name: "Budi Hartono" }]
assert.equal(matchMember("rina", members)?.id, "u1")
assert.equal(matchMember("Budi", members), null) // two Budis: ambiguous
assert.equal(matchMember("Pak Budi Santoso", members)?.id, "u2")
const props = draftToProposals(draft, members)
assert.deepEqual(props[0].assigneeIds, ["u1"])
assert.equal(props[0].dueDate, "2026-10-20")
assert.deepEqual(props[1].assigneeIds, []) // owner "Pak Budi" is ambiguous → nobody
assert.equal(parseMinutes("sorry, I can't"), null)
assert.ok(compactNotes(JSON.stringify({ summary: ["a"], actionItems: [{ text: "b" }] })))

// Proposals from a client are cleaned; unknown members dropped
const cleaned = cleanProposals([{ key: "t1", title: "A", assigneeIds: ["u1", "zz"], dueDate: "2026-13-40", include: false }, { title: " " }, { key: "t1", title: "B" }], new Set(["u1"]))
assert.equal(cleaned.length, 2)
assert.deepEqual(cleaned[0].assigneeIds, ["u1"])
assert.equal(cleaned[0].dueDate, null)
assert.equal(cleaned[0].include, false)
assert.notEqual(cleaned[1].key, "t1")

// The minutes document
const doc = buildMinutesDoc({ lang: "id", dateLabel: "2026-10-18", durationLabel: "45 min", recordedBy: { id: "u9", name: "Berlin" }, overview: draft.overview, mom: draft.mom, tasks: [{ id: "task1", title: "Siapkan release notes", actionIndex: 0, assignees: [members[0]], dueDate: "2026-10-20" }], transcript: segs })
const json = JSON.stringify(doc)
assert.ok(json.includes('"kind":"task"') && json.includes('"id":"task1"'))
assert.ok(json.includes('"type":"details"') && json.includes("Transkrip"))
assert.ok(json.includes('"type":"taskList"'))
console.log("meeting-notes-core: ok")

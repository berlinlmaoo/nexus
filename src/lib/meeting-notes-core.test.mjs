// node --experimental-strip-types src/lib/meeting-notes-core.test.mjs
import assert from "node:assert/strict"
import {
  audioBytesMatch, buildMinutesDoc, chunkLines, chunkNotesPrompt, cleanProposals, cleanSegments, clock, compactNotes, draftToProposals,
  matchMember, meetingAudioExt, minutesPrompt, parseMinutes, sniffAudio, transcriptLines, introNames, matchHeardName, autoMatchCandidates, mergeSpeakers, cleanSpeakers, cleanMom,
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

// Speaker names from the round of introductions (19 Oct 2026)
{
  const people = [
    { id: "u1", name: "Berlin Bagas Putro", inProject: true }, { id: "u2", name: "Sinta Maharani", inProject: true },
    { id: "u3", name: "Dimas Prasetyo" }, { id: "u4", name: "Ayu Lestari" }, { id: "u5", name: "Ayu Wandira" }, { id: "u6", name: "Galang" },
  ]
  assert.equal(matchHeardName("Berlin", people)?.id, "u1")
  assert.equal(matchHeardName("Sinta", people)?.id, "u2")
  assert.equal(matchHeardName("Dimaz", people)?.id, "u3") // misheard by one letter
  assert.equal(matchHeardName("Ayu", people), null) // two Ayus: better "Speaker 4" than the wrong one
  assert.equal(matchHeardName("Ayu Lestari", people)?.id, "u4")
  assert.equal(matchHeardName("Budi", people), null)
  const segs = cleanSegments([
    { start: 0.9, end: 5, text: "Oke, sebelum mulai kita perkenalan dulu ya.", speaker: "Speaker 1" },
    { start: 5.7, end: 9, text: "Halo, saya Berlin, saya pegang produk Nexus.", speaker: "Speaker 1" },
    { start: 10.4, end: 14, text: "Halo semuanya, saya Sinta dari Tim Marketing.", speaker: "Speaker 2" },
    { start: 16, end: 19, text: "Hi, Namasaya Dimas. Saya Butkin Engineer.", speaker: "Speaker 3" },
    { start: 20.6, end: 23, text: "Halo, saya Ayu, saya desainer.", speaker: "Speaker 4" },
    { start: 25, end: 27, text: "Saya setuju. Saya Budi, ikut juga.", speaker: "Speaker 5" },
    { start: 300, end: 303, text: "Saya Galang, telat join.", speaker: "Speaker 6" },
  ])
  const map = introNames(segs, 24, people)
  assert.deepEqual(map["Speaker 1"], { name: "Berlin Bagas Putro", userId: "u1", auto: true })
  assert.deepEqual(map["Speaker 2"], { name: "Sinta Maharani", userId: "u2", auto: true })
  assert.deepEqual(map["Speaker 3"], { name: "Dimas Prasetyo", userId: "u3", auto: true }) // the matched name beats "Butkin"
  assert.deepEqual(map["Speaker 4"], { name: "Ayu", userId: null, auto: true }) // ambiguous → as heard, no account
  assert.equal(map["Speaker 5"], undefined) // after the marker
  assert.equal(map["Speaker 6"], undefined)
  // No marker: the first two minutes
  assert.equal(introNames(segs, null, people)["Speaker 5"]?.name, "Budi")
  // The same person claimed by two voices: the one that said it first keeps it
  const twice = introNames(cleanSegments([{ start: 1, end: 2, text: "Saya Berlin.", speaker: "Speaker 1" }, { start: 3, end: 4, text: "Saya Berlin juga.", speaker: "Speaker 2" }]), 10, people)
  assert.equal(twice["Speaker 1"]?.userId, "u1")
  assert.equal(twice["Speaker 2"], undefined)
  // English intros
  assert.equal(introNames(cleanSegments([{ start: 1, end: 2, text: "Hi everyone, I'm Galang.", speaker: "Speaker 1" }, { start: 2, end: 3, text: "My name is Sinta.", speaker: "Speaker 2" }]), 5, people)["Speaker 2"]?.userId, "u2")
  // Hand-made names win over the introductions; automatic ones are replaced
  const merged = mergeSpeakers({ "Speaker 1": { name: "Pak Berlin", userId: null }, "Speaker 2": { name: "Old", userId: null, auto: true } }, map)
  assert.equal(merged["Speaker 1"].name, "Pak Berlin")
  assert.equal(merged["Speaker 2"].name, "Sinta Maharani")
  assert.deepEqual(cleanSpeakers({ "Speaker 1": { name: "  A  b ", userId: 5 }, ["x".repeat(41)]: { name: "z" }, "Speaker 2": { name: "" } }), { "Speaker 1": { name: "A b", userId: null } })
}
console.log("speakers ok")
{
  const none = introNames(cleanSegments([{ start: 1, end: 2, text: "Saya Backend Engineer di sini.", speaker: "Speaker 1" }, { start: 3, end: 4, text: "Saya Rudi dari finance.", speaker: "Speaker 2" }, { start: 5, end: 6, text: "Nama saya Joko Susilo.", speaker: "Speaker 3" }, { start: 7, end: 8, text: "Saya Kiki.", speaker: "Speaker 4" }]), 10, [])
  assert.equal(none["Speaker 1"], undefined)
  assert.equal(none["Speaker 2"]?.name, "Rudi")
  assert.equal(none["Speaker 3"]?.name, "Joko Susilo")
  assert.equal(none["Speaker 4"]?.name, "Kiki")
  console.log("heard names ok")
}
assert.deepEqual(cleanMom({ attendees: ["Galang", "Speaker 4", "pembicara 2"] }).attendees, ["Galang"])
console.log("mom attendees ok")

// D-Q3 (QA final 19 Oct 2026): introductions name only the project's members automatically
{
  const cands = [{ id: "m1", name: "Berlin", inProject: true }, { id: "w1", name: "Dimas Damarjati" }, { id: "up", name: "Sinta" }]
  assert.deepEqual(autoMatchCandidates(cands, "up", true).map((c) => c.id), ["m1"])
  assert.deepEqual(autoMatchCandidates(cands, "up", false).map((c) => c.id), ["up"])
  const segs = cleanSegments([{ start: 1, end: 2, text: "Saya Dimas.", speaker: "Speaker 1" }])
  const map = introNames(segs, 10, autoMatchCandidates(cands, "up", true))
  assert.equal(map["Speaker 1"]?.userId ?? null, null)
}

// node src/lib/gideon-memory-text.test.mjs
//
// GIDEON Memory text rules (19 Oct 2026). Plain node, no test runner — same loader as attendance-place.test.mjs.
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const tsPath = path.join(here, "gideon-memory-text.ts")

async function load() {
  try {
    return await import(pathToFileURL(tsPath).href)
  } catch {
    const require = createRequire(import.meta.url)
    const ts = require("typescript")
    const src = await readFile(tsPath, "utf8")
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    return await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"))
  }
}

const { memoryKey, memoryRisk, asksToRemember, isAffirmation, parseMonthDay, monthDayInText, parseKind, cleanMemoryText, statesPreference, memoryTextFromQuestion, styleDirectives } = await load()

let n = 0
const t = (name, fn) => { fn(); n++; console.log("ok", name) }

t("dedupe key folds case, punctuation and accents", () => {
  assert.equal(memoryKey("Pakai aku-kamu."), memoryKey("pakai  AKU kamu"))
  assert.equal(memoryKey("Café"), "cafe")
})
t("secrets are refused even when asked", () => {
  assert.equal(memoryRisk("password email aku: hunter2"), "secret")
  assert.equal(memoryRisk("PIN ATM 1234"), "secret")
  assert.equal(memoryRisk("nomor rekening BCA 1234567890"), "secret")
  assert.equal(memoryRisk("kartu 4111 1111 1111 1111"), "secret")
  assert.equal(memoryRisk("kode OTP-nya 551203"), "secret")
})
t("sensitive topics need an explicit ask", () => {
  assert.equal(memoryRisk("aku punya diabetes"), "sensitive")
  assert.equal(memoryRisk("agama aku katolik"), "sensitive")
  assert.equal(memoryRisk("pilih partai X"), "sensitive")
})
t("ordinary preferences are fine", () => {
  assert.equal(memoryRisk("Lebih suka dipanggil pakai aku-kamu"), null)
  assert.equal(memoryRisk("Jawaban singkat, poin-poin"), null)
  assert.equal(memoryRisk("Pegang project Intoo News Room"), null)
  assert.equal(memoryRisk("Panggil aku Nik"), null)
  assert.equal(memoryRisk("Ulang tahun 14 Maret"), null)
})
t("explicit remember asks", () => {
  for (const q of ["inget ya aku vegetarian", "Ingat ya, aku kerja jam 10-19", "remember that I prefer English", "catat ya aku pegang Intoo", "jangan lupa aku ultah 3 Mei"]) assert.equal(asksToRemember(q), true, q)
  for (const q of ["panggil aku pakai aku-kamu ya", "ada task apa aja?", "progress project Intoo gimana", "lo inget apa aja tentang gw?", "Kamu inget apa aja tentang aku?", "Ceritain semua yang lo inget tentang owner NEXUS", "do you remember my birthday?", "apa yang kamu ingat tentang QA Dev 6?"]) assert.equal(asksToRemember(q), false, q)
})
t("a short yes is an affirmation, a question is not", () => {
  for (const q of ["iya", "Iya boleh", "ya simpan aja", "yes please", "oke", "sip"]) assert.equal(isAffirmation(q), true, q)
  for (const q of ["iya tapi task X statusnya apa ya? tolong cek semua yang di project Intoo minggu ini", "kenapa?", "nggak usah"]) assert.equal(isAffirmation(q), false, q)
})
t("month-day parsing", () => {
  assert.equal(parseMonthDay("03-14"), "03-14")
  assert.equal(parseMonthDay("1998-03-14"), "03-14")
  assert.equal(parseMonthDay("14/03"), "03-14")
  assert.equal(parseMonthDay("02-30"), null)
  assert.equal(parseMonthDay("13-01"), null)
  assert.equal(monthDayInText("ulang tahun aku 14 Maret"), "03-14")
  assert.equal(monthDayInText("birthday March 4"), "03-04")
  assert.equal(monthDayInText("ultah 29 feb"), "02-29")
  assert.equal(monthDayInText("tidak ada tanggal"), null)
})
t("kind aliases and text cleanup", () => {
  assert.equal(parseKind("preference"), "PREFERENCE")
  assert.equal(parseKind("birthday"), "DATE")
  assert.equal(parseKind("whatever"), "FACT")
  assert.equal(cleanMemoryText("  a \n b  "), "a b")
  assert.equal(cleanMemoryText("x".repeat(500)).length, 200)
  assert.equal(cleanMemoryText(42), "")
})

t("a stated preference, and the memory text from a question", () => {
  for (const q of ["panggil aku pakai aku-kamu ya", "pakai bahasa inggris aja", "jawab singkat aja ya", "call me Ryan", "lebih suka jawaban detail"]) assert.equal(statesPreference(q), true, q)
  for (const q of ["ada task apa aja?", "progress project Intoo", "siapa PIC deal DIAGEO"]) assert.equal(statesPreference(q), false, q)
  assert.equal(memoryTextFromQuestion("inget ya: aku kerja jam 10-19"), "Aku kerja jam 10-19")
  assert.equal(memoryTextFromQuestion("Tolong ingat ya, aku pegang Intoo"), "Aku pegang Intoo")
  assert.equal(memoryTextFromQuestion("panggil aku pakai aku-kamu ya"), "Panggil aku pakai aku-kamu ya")
  assert.equal(memoryTextFromQuestion("x".repeat(300)), null)
  assert.equal(memoryTextFromQuestion("tolong jangan lupa follow up", { requireLead: true }), "Follow up")
  assert.equal(memoryTextFromQuestion("Ceritain semua yang lo inget tentang Bagas", { requireLead: true }), null)
})

t("style directives from preferences", () => {
  assert.match(styleDirectives(["Lebih suka disapa dengan aku-kamu, bukan gue-lo."]).join(), /kamu.*JANGAN/)
  assert.match(styleDirectives(["Pakai gue-lo aja"]).join(), /"lo"/)
  assert.match(styleDirectives(["Bahasa formal ya"]).join(), /Anda/)
  assert.deepEqual(styleDirectives(["Jawab singkat, pakai bahasa Inggris"]), ["answer in English", "jawab singkat"])
  assert.deepEqual(styleDirectives(["Suka kopi"]), [])
})

console.log(`gideon-memory-text: ${n} groups passed`)

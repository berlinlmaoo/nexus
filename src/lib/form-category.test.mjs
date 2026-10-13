// node src/lib/form-category.test.mjs
//
// Plain node, no test runner (same loader as permit-reason-guard.test.mjs).
import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))

async function load(file) {
  const tsPath = path.join(here, file)
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

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

const { categoryFieldForQuestion, categoryValueForAnswer, isChoiceQuestion } = await load("form-category.ts")

// Finance Management after the conversion (dev, 13 Oct 2026).
const sections = [{ name: "To Do" }, { name: "On Progress" }, { name: "Done" }]
const kategori = { id: "k", name: "Kategori", type: "SELECT", options: { options: ["AI & Tech", "AI & Tech On Prog", "Management", "Management OP"], optionColors: {} } }
const other = { id: "o", name: "Tipe", type: "SELECT", options: ["Management", "Lain"] }
const harga = { id: "h", name: "Harga", type: "NUMBER", options: { format: "currency-idr" } }
const fields = [harga, other, kategori]

test("category options of a task_list question point at Kategori", () => {
  assert.equal(categoryFieldForQuestion(["AI & Tech", "Management"], sections, fields)?.id, "k")
  assert.equal(categoryFieldForQuestion({ choices: ["ai & tech"] }, sections, fields)?.id, "k")
})
test("a real status question stays a section question", () => {
  assert.equal(categoryFieldForQuestion(["To Do", "On Progress", "Done"], sections, fields), null)
  assert.equal(categoryFieldForQuestion(["Done", "AI & Tech"], sections, fields), null)
})
test("options no select lists -> null; empty options -> the field named Kategori", () => {
  assert.equal(categoryFieldForQuestion(["Nope"], sections, fields), null)
  assert.equal(categoryFieldForQuestion([], sections, fields)?.id, "k")
  assert.equal(categoryFieldForQuestion([], sections, [harga, other]), null)
})
test("answers: section names are not categories, Kategori wins a tie, spelling from the field", () => {
  assert.equal(categoryValueForAnswer("Done", sections, fields), null)
  assert.deepEqual(categoryValueForAnswer("ai & tech", sections, fields), { fieldId: "k", value: "AI & Tech" })
  assert.deepEqual(categoryValueForAnswer("Management", sections, fields), { fieldId: "k", value: "Management" })
  assert.deepEqual(categoryValueForAnswer("Lain", sections, fields), { fieldId: "o", value: "Lain" })
  assert.equal(categoryValueForAnswer("", sections, fields), null)
  assert.equal(categoryValueForAnswer("xyz", sections, fields), null)
})
test("only one-answer choice questions", () => {
  assert.equal(isChoiceQuestion("dropdown"), true)
  assert.equal(isChoiceQuestion("file"), false)
  assert.equal(isChoiceQuestion("multi_select"), false)
})

console.log(`form-category: ${passed} passed`)

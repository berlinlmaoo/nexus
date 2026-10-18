// node --experimental-strip-types src/lib/gideon-file-render.test.mjs
import assert from "node:assert/strict"
import { docxDocumentXml, firstTable, inlineRuns, markdownBlocks, plainBlocks } from "./gideon-file-render.ts"

assert.deepEqual(inlineRuns("a **b** c"), [{ text: "a " }, { text: "b", bold: true }, { text: " c" }])
assert.deepEqual(inlineRuns("see [NEXUS](https://x.id) `code`"), [{ text: "see NEXUS (https://x.id) code" }])
const md = "# Ringkasan\n\nBudget **Rp 47.350.000**.\nBaris dua.\n\n- satu\n- dua\n1. pertama\n\n| Item | Harga |\n|---|---|\n| Sound | 1.500.000 |\n| Light | 2.000.000 |\n\n---\nAkhir"
const b = markdownBlocks(md)
assert.deepEqual(b.map((x) => x.kind), ["heading", "para", "bullet", "bullet", "bullet", "table", "para"])
assert.equal(b[2].n, undefined)
assert.equal(b[4].n, 1)
assert.deepEqual(b[5].rows, [["Item", "Harga"], ["Sound", "1.500.000"], ["Light", "2.000.000"]])
assert.deepEqual(firstTable(b), [["Item", "Harga"], [["Sound", "1.500.000"], ["Light", "2.000.000"]]])
assert.equal(plainBlocks("a\n\nb\n").length, 2)
const x = docxDocumentXml("Judul <&>", b)
assert.ok(x.includes("Judul &lt;&amp;&gt;"))
assert.ok(x.includes("<w:tbl>") && x.includes("Rp 47.350.000"))
assert.ok(!/[\u0001-\u0008]/.test(docxDocumentXml("a\u0001b", [])))
console.log("gideon-file-render: ok")

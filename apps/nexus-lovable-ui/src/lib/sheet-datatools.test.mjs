// node --experimental-strip-types src/lib/sheet-datatools.test.mjs   (from apps/nexus-lovable-ui)
//
// Data tools: split text, remove duplicates, trim whitespace, sort range, randomise, find & replace.
import assert from "node:assert/strict"

const D = await import("./sheet-datatools.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

// ── Separator detection & split ─────────────────────────────────────────────────────────────────
eq(D.detectSeparator(["a,b,c", "d,e"]), ",", "comma")
eq(D.detectSeparator(["a;b", "c;d"]), ";", "semicolon")
eq(D.detectSeparator(["Budi Santoso", "Ani Wijaya"]), " ", "space")
eq(D.detectSeparator(["a.b.c"]), ".", "period")
eq(D.detectSeparator(["a\tb"]), "\t", "tab")
eq(D.detectSeparator(["a, b", "c, d"]), ",", "comma beats the space after it")
eq(D.detectSeparator(["abc", ""]), null, "nothing to split on")
eq(D.splitText("a,b,c", "auto"), ["a", "b", "c"], "auto split")
eq(D.splitText("a, b , c", ","), ["a", "b", "c"], "parts are trimmed")
eq(D.splitText("a,,c", ","), ["a", "", "c"], "empty part kept")
eq(D.splitText("Budi   Santoso", " "), ["Budi", "Santoso"], "runs of spaces are one separator")
eq(D.splitText("1|2|3", { custom: "|" }), ["1", "2", "3"], "custom separator")
eq(D.splitText("a--b", { custom: "--" }), ["a", "b"], "multi-character custom separator")
eq(D.splitText("abc", "auto"), ["abc"], "nothing detected keeps the text")
eq(D.splitText("x", { custom: "" }), ["x"], "empty custom separator")

// ── Remove duplicates ───────────────────────────────────────────────────────────────────────────
const rows = [["Nama", "Kat"], ["Apel", "Buah"], ["apel", "Buah"], ["Apel", "Buah"], ["Apel", "Sayur"], ["Nama", "Kat"]]
eq(D.dedupe(rows, [0, 1]), { keep: [0, 1, 2, 4], removed: 2 }, "all columns, case-sensitive")
eq(D.dedupe(rows, [0, 1], { header: true }), { keep: [0, 1, 2, 4, 5], removed: 1 }, "header row isn't compared")
eq(D.dedupe(rows, [1], { header: true }), { keep: [0, 1, 4, 5], removed: 2 }, "one column analysed")
eq(D.dedupe([[" a"], ["a"]], [0]), { keep: [0, 1], removed: 0 }, "nothing is trimmed")
eq(D.dedupe([], [0]), { keep: [], removed: 0 }, "empty block")

// ── Trim whitespace ─────────────────────────────────────────────────────────────────────────────
eq(D.trimCell("  Fig  "), "Fig", "outer spaces")
eq(D.trimCell("Jl.   Sudirman  5"), "Jl. Sudirman 5", "inner runs collapse")
eq(D.trimCell("a  b"), "a b", "non-breaking spaces")
eq(D.trimCell("clean"), "clean", "nothing to trim")

// ── Sort range ──────────────────────────────────────────────────────────────────────────────────
const block = [
  { key: ["Ceri", 30] }, { key: ["apel", 12] }, { key: [null, 5] }, { key: ["Bayam", 12] }, { key: [7, 1] }, { key: [true, 0] },
]
eq(D.sortBlock(block, [{ idx: 0, dir: "asc" }]), [4, 1, 3, 0, 5, 2], "numbers, text, booleans, empty last")
eq(D.sortBlock(block, [{ idx: 0, dir: "desc" }]), [5, 0, 3, 1, 4, 2], "descending, empty still last")
eq(D.sortBlock(block, [{ idx: 1, dir: "asc" }, { idx: 0, dir: "desc" }]), [5, 4, 2, 3, 1, 0], "second key breaks ties")
eq(D.sortBlock([{ key: [1] }, { key: [1] }, { key: [0] }], [{ idx: 0, dir: "asc" }]), [2, 0, 1], "stable")
eq(Math.sign(D.compareValues("item 2", "item 10")), -1, "natural order for text with numbers")
eq(D.compareValues(null, 5, "desc"), 1, "empty after a number when descending")

// ── Randomise ───────────────────────────────────────────────────────────────────────────────────
{
  let seed = 7
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  const p = D.shuffle(10, rng)
  eq([...p].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "a permutation")
  eq(D.shuffle(0), [], "nothing to shuffle")
  eq(D.shuffle(5, () => 0.999999).length, 5, "length kept")
}

// ── Find and replace ────────────────────────────────────────────────────────────────────────────
eq(D.textMatches("Apel merah", { find: "apel" }), true, "case-insensitive by default")
eq(D.textMatches("Apel merah", { find: "apel", matchCase: true }), false, "match case")
eq(D.textMatches("Apel merah", { find: "Apel", entire: true }), false, "entire cell")
eq(D.textMatches("Apel", { find: "apel", entire: true }), true, "entire cell, any case")
eq(D.textMatches("a.b", { find: "." }), true, "dot is literal without regex")
eq(D.textMatches("ab", { find: "." , entire: true }), false, "literal dot doesn't match a letter")
eq(D.textMatches("2026-10-12", { find: "^\\d{4}", regex: true }), true, "regular expression")
eq(D.buildMatcher({ find: "(", regex: true }), null, "invalid regex")
eq(D.buildMatcher({ find: "" }), null, "empty search")
eq(D.replaceText("apel Apel APEL", { find: "apel", replace: "jeruk" }), { text: "jeruk jeruk jeruk", count: 3 }, "replace all, any case")
eq(D.replaceText("apel Apel", { find: "apel", replace: "jeruk", matchCase: true }), { text: "jeruk Apel", count: 1 }, "replace, match case")
eq(D.replaceText("Rp $5", { find: "$5", replace: "$10" }), { text: "Rp $10", count: 1 }, "dollar signs are literal without regex")
eq(D.replaceText("Santoso, Budi", { find: "(\\w+), (\\w+)", replace: "$2 $1", regex: true }), { text: "Budi Santoso", count: 1 }, "regex groups")
eq(D.replaceText("abc", { find: "x", replace: "y" }), { text: "abc", count: 0 }, "no match")

console.log(`sheet-datatools: ${n} checks passed`)

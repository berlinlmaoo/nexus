// node --experimental-strip-types src/lib/glue-dash.test.mjs   (from apps/web)
// A spaced dash in a clamped title sticks to the word after it, whatever dash or spacing (decision 4, R18-WM-1).
import assert from "node:assert/strict"
import { glueDash } from "./utils.ts"

const WJ = "\u2060", NB = "\u00a0"
assert.equal(glueDash("Gaji Clippers – Cymenggs"), `Gaji Clippers –${WJ}${NB}Cymenggs`)
assert.equal(glueDash("PATS ARCHIVE - INVOICE"), `PATS ARCHIVE -${WJ}${NB}INVOICE`)
assert.equal(glueDash("PATS ARCHIVE — INVOICE"), `PATS ARCHIVE —${WJ}${NB}INVOICE`)
// No space after: the hyphen must not end a line ("PATS ARCHIVE -" / "INVOICE")
assert.equal(glueDash("PATS ARCHIVE -INVOICE"), `PATS ARCHIVE -${WJ}INVOICE`)
// Double spaces, NBSP and narrow NBSP, on either side
assert.equal(glueDash("PATS ARCHIVE  –  INVOICE"), `PATS ARCHIVE –${WJ}${NB}INVOICE`)
assert.equal(glueDash(`PATS${NB}–${NB}INVOICE`), `PATS –${WJ}${NB}INVOICE`)
assert.equal(glueDash("PATS\u202f—\u202fINVOICE"), `PATS —${WJ}${NB}INVOICE`)
assert.equal(glueDash("A \u2212 B"), `A \u2212${WJ}${NB}B`)
// Idempotent
assert.equal(glueDash(glueDash("A – B -C")), glueDash("A – B -C"))
// Left alone: a dash inside a word, a trailing dash, plain text
assert.equal(glueDash("PKS/PATS-UNIV/2026"), "PKS/PATS-UNIV/2026")
assert.equal(glueDash("Lunas -"), "Lunas -")
assert.equal(glueDash("Reimburse pats sports"), "Reimburse pats sports")
console.log("glue-dash: ok")

// node --experimental-strip-types src/lib/doc-read-format.test.mjs
//
// GET /api/docs/:id body shape (lib/doc-read-format.ts): released Android keeps its flattened BlockNote
// read; the opt-in canonical read is lossless and is a valid base for POST /api/collab/edit's merge.
import assert from "node:assert/strict"
import { docReadFormat, docContentFor } from "./doc-read-format.ts"
import { sanitizeDoc, EMPTY_DOC, docToBlockNote, canonicalDoc } from "./blockdoc.ts"
import { planBlockMerge } from "./block-merge.ts"

let n = 0
const t = (name, fn) => {
  try { fn(); n++ } catch (error) { console.error(`FAIL ${name}`); throw error }
}
const deps = { sanitize: sanitizeDoc, empty: EMPTY_DOC, toBlockNote: docToBlockNote }

// Marks, nested lists, details and an unknown block: everything docToBlockNote flattens.
const rich = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, blockId: "h1" }, content: [{ type: "text", text: "Agenda" }] },
    { type: "paragraph", attrs: { blockId: "p1", textAlign: null }, content: [
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
    ] },
    { type: "bulletList", attrs: { blockId: "l1" }, content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }] }] }] },
    ] },
    { type: "details", attrs: { blockId: "d1" }, content: [
      { type: "detailsSummary", content: [{ type: "text", text: "More" }] },
      { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "hidden" }] }] },
    ] },
    { type: "someFutureBlock", attrs: { blockId: "x1", payload: { a: 1 } } },
  ],
}

t("no opt-in: released Android keeps BlockNote, web/iOS/untagged keep stored JSON", () => {
  assert.equal(docReadFormat({ platform: "android", formatParam: null, formatHeader: null }), "blocknote")
  for (const platform of ["ios", "web", null, undefined]) {
    assert.equal(docReadFormat({ platform, formatParam: null, formatHeader: null }), "stored", String(platform))
  }
  // Anything but "canonical" is not an opt-in.
  for (const v of ["", "blocknote", "tiptap", "canon", "true", "1"]) {
    assert.equal(docReadFormat({ platform: "android", formatParam: v, formatHeader: v }), "blocknote", v)
  }
})

t("opt-in by query or header, any platform, case/space-insensitive", () => {
  for (const platform of ["android", "ios", "web", null]) {
    assert.equal(docReadFormat({ platform, formatParam: "canonical", formatHeader: null }), "canonical")
    assert.equal(docReadFormat({ platform, formatParam: null, formatHeader: "canonical" }), "canonical")
  }
  assert.equal(docReadFormat({ platform: "android", formatParam: " Canonical ", formatHeader: null }), "canonical")
  assert.equal(docReadFormat({ platform: "android", formatParam: null, formatHeader: "CANONICAL" }), "canonical")
})

t("default Android content is exactly today's docToBlockNote output (lossy)", () => {
  const out = docContentFor("blocknote", rich, deps)
  assert.deepEqual(out, docToBlockNote(rich))
  assert.ok(Array.isArray(out))
  // It is not a document, so it could never be a merge base.
  assert.equal(sanitizeDoc(out), null)
  // Non-TipTap content (legacy / null) passes through untouched, as before.
  const legacy = [{ id: "1", type: "paragraph", content: "x" }]
  assert.equal(docContentFor("blocknote", legacy, deps), legacy)
  assert.equal(docContentFor("blocknote", null, deps), null)
})

t("stored format returns the same object", () => {
  assert.equal(docContentFor("stored", rich, deps), rich)
})

t("canonical content is lossless: marks, lists, details, unknown blocks all kept", () => {
  const out = docContentFor("canonical", rich, deps)
  assert.equal(out.type, "doc")
  assert.equal(canonicalDoc(out), canonicalDoc(rich))
  const s = JSON.stringify(out)
  for (const needle of ['"bold"', '"https://example.com"', '"nested"', '"details"', '"detailsSummary"', '"someFutureBlock"', '"payload"']) {
    assert.ok(s.includes(needle), needle)
  }
  // Only null attrs are dropped (canonicalDoc ignores them too).
  assert.equal(out.content[1].attrs.textAlign, undefined)
})

t("canonical of an empty / unreadable body is the empty document the live room loads", () => {
  for (const c of [null, undefined, [], "text", { type: "nope" }]) {
    assert.deepEqual(docContentFor("canonical", c, deps), EMPTY_DOC)
  }
})

t("canonical read works as the collab/edit base: an unchanged base merges cleanly", () => {
  const base = docContentFor("canonical", rich, deps)
  const mine = structuredClone(base)
  mine.content[0].content[0].text = "Agenda (edited)"
  const blockCanon = (b) => canonicalDoc({ type: "doc", content: [b] })
  const plan = planBlockMerge(base.content, mine.content, rich.content, blockCanon)
  assert.ok(plan, "plan")
  assert.equal(plan.conflicts.length, 0)
  assert.equal(plan.changed, true)
})

console.log(`doc-read-format: ${n} passed`)

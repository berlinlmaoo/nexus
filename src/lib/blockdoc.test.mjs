// node --experimental-strip-types src/lib/blockdoc.test.mjs
import assert from "node:assert/strict"
import {
  plainTextToDoc, legacyDescriptionToDoc, docToText, mergeTextIntoDoc, resolveTaskBody, sanitizeDoc,
  canonicalDoc, collectMentions, collectReminders, docToBlockNote, descriptionOf,
} from "./blockdoc.ts"

let n = 0
const t = (name, fn) => { fn(); n++ }
const P = (text) => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" })

t("plain text round-trips exactly", () => {
  for (const s of ["", "one", "a\nb", "a\n\nb", "a\n", "\n\nx\n", "- not a list\n# not a heading", "tab\there  spaces "]) {
    const doc = plainTextToDoc(s)
    assert.equal(docToText(doc), s.trim() ? s : "", JSON.stringify(s))
  }
})

t("legacy BlockNote description converts line by line", () => {
  const raw = JSON.stringify([
    { id: "1", type: "text", content: "first", children: [] },
    { id: "2", type: "text", content: "", children: [] },
    { id: "3", type: "text", content: "third", children: [{ id: "4", type: "text", content: "child", children: [] }] },
  ])
  const doc = legacyDescriptionToDoc(raw)
  assert.deepEqual(doc.content, [P("first"), P(""), P("third"), P("child")])
  assert.equal(docToText(doc), "first\n\nthird\nchild")
  // Not BlockNote, just text that looks like JSON: kept literally.
  assert.equal(docToText(legacyDescriptionToDoc("[draft] fix the banner")), "[draft] fix the banner")
  assert.equal(docToText(legacyDescriptionToDoc("{oops")), "{oops")
})

const rich = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, blockId: "h1" }, content: [{ type: "text", text: "Agenda" }] },
    { type: "paragraph", content: [{ type: "text", text: "Hi " }, { type: "mention", attrs: { id: "u1", label: "Mira", kind: "user" } }, { type: "text", text: " see " }, { type: "mention", attrs: { id: "t1", label: "Fix banner", kind: "task" } }] },
    { type: "bulletList", content: [
      { type: "listItem", content: [P("one")] },
      { type: "listItem", content: [P("two"), { type: "bulletList", content: [{ type: "listItem", content: [P("nested")] }] }] },
    ] },
    { type: "taskList", content: [
      { type: "taskItem", attrs: { checked: true }, content: [P("done")] },
      { type: "taskItem", attrs: { checked: false }, content: [P("todo")] },
    ] },
    { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [P("first")] }, { type: "listItem", content: [P("second")] }] },
    { type: "blockquote", content: [P("quoted")] },
    { type: "callout", attrs: { emoji: "💡" }, content: [P("note")] },
    { type: "details", attrs: { open: false }, content: [{ type: "detailsSummary", content: [{ type: "text", text: "More" }] }, { type: "detailsContent", content: [P("hidden")] }] },
    { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "a()\nb()" }] },
    { type: "horizontalRule" },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [P("A")] }, { type: "tableHeader", content: [P("B")] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [P("1")] }, { type: "tableCell", content: [P("2|x")] }] },
    ] },
    { type: "paragraph", content: [{ type: "text", text: "call " }, { type: "dateChip", attrs: { date: "2026-10-13", time: "09:30", remind: true } }, { type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://z.id" } }] }] },
    { type: "image", attrs: { src: "/api/files/a.png", alt: "pic" } },
    { type: "fileBlock", attrs: { url: "/api/files/b.pdf", name: "b.pdf" } },
    { type: "bookmark", attrs: { url: "https://youtu.be/x" } },
    { type: "futureBlock", content: [P("still readable")] },
  ],
}

const richText = [
  "## Agenda",
  "Hi @Mira see Fix banner",
  "- one",
  "- two",
  "  - nested",
  "- [x] done",
  "- [ ] todo",
  "1. first",
  "2. second",
  "> quoted",
  "> 💡 note",
  "▸ More",
  "  hidden",
  "```js",
  "a()",
  "b()",
  "```",
  "---",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2\\|x |",
  "call ⏰ 2026-10-13 09:30site (https://z.id)",
  "![pic](/api/files/a.png)",
  "📎 b.pdf (/api/files/b.pdf)",
  "🔗 https://youtu.be/x",
  "still readable",
].join("\n")

t("rich document → text", () => {
  assert.equal(docToText(rich), richText)
})

t("unchanged text keeps the stored document", () => {
  const doc = sanitizeDoc(rich)
  assert.equal(canonicalDoc(resolveTaskBody(richText, doc)), canonicalDoc(doc))
})

t("an older app edits one line: other blocks survive", () => {
  const doc = sanitizeDoc(rich)
  const edited = richText.replace("- [ ] todo", "- [ ] todo (edited)").replace("Hi @Mira see Fix banner\n", "Hi @Mira see Fix banner\nnew line\n")
  const merged = resolveTaskBody(edited, doc)
  assert.equal(docToText(merged), edited)
  const types = merged.content.map((b) => b.type)
  assert.equal(types[0], "heading")
  assert.equal(merged.content[1].content[1].type, "mention") // mention node kept
  assert.deepEqual(merged.content[2], { type: "paragraph", content: [{ type: "text", text: "new line" }] })
  // the task list: "done" item kept as taskList, edited item became a paragraph
  const tl = merged.content.find((b) => b.type === "taskList")
  assert.equal(tl.content.length, 1)
  assert.ok(merged.content.some((b) => b.type === "paragraph" && b.content?.[0]?.text === "- [ ] todo (edited)"))
  assert.ok(merged.content.some((b) => b.type === "table"))
})

t("text cleared → empty doc; empty doc → null description", () => {
  const doc = resolveTaskBody(null, rich)
  assert.equal(docToText(doc), "")
  assert.equal(descriptionOf(doc), null)
  assert.equal(descriptionOf(plainTextToDoc("x")), "x")
})

t("sanitize drops script urls, null attrs, keeps unknown types", () => {
  const dirty = { type: "doc", content: [
    { type: "image", attrs: { src: "javascript:alert(1)", alt: null } },
    { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:x" } }, { type: "bold" }] }] },
    { type: "bookmark", attrs: { url: "//evil.com" } },
    { type: "weird", content: [{ type: "text", text: "" }] },
  ] }
  const c = sanitizeDoc(dirty)
  assert.deepEqual(c.content[0], { type: "image" })
  assert.deepEqual(c.content[1].content[0].marks, [{ type: "bold" }])
  assert.deepEqual(c.content[2], { type: "bookmark" })
  assert.deepEqual(c.content[3], { type: "weird" })
  assert.equal(sanitizeDoc({ type: "paragraph" }), null)
  assert.equal(sanitizeDoc("doc"), null)
  assert.deepEqual(sanitizeDoc({ type: "doc", content: [] }).content, [{ type: "paragraph" }])
})

t("canonical ignores key order and nulls", () => {
  assert.equal(canonicalDoc({ type: "doc", content: [{ attrs: { b: 1, a: null }, type: "p" }] }), canonicalDoc({ content: [{ type: "p", attrs: { b: 1 } }], type: "doc" }))
})

t("mentions and reminders", () => {
  const m = collectMentions(rich)
  assert.deepEqual([...m.users], ["u1"])
  assert.deepEqual([...m.tasks], ["t1"])
  const r = collectReminders(rich)
  assert.equal(r.length, 1)
  assert.equal(r[0].key, "2026-10-13T09:30")
  assert.match(r[0].text, /^call /)
})

t("BlockNote shape for the released Android reader", () => {
  const b = docToBlockNote(rich)
  const types = b.map((x) => x.type)
  assert.equal(types[0], "heading")
  assert.equal(b[0].props.level, 2)
  assert.ok(types.includes("bulletListItem") && types.includes("checkListItem") && types.includes("numberedListItem") && types.includes("quote") && types.includes("codeBlock"))
  assert.equal(b.find((x) => x.type === "checkListItem").props.checked, true)
  assert.equal(b[1].content[0].text, "Hi @Mira see Fix banner")
})

console.log(`blockdoc: ${n} tests passed`)

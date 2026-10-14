// node --experimental-strip-types src/lib/collab-ydoc.test.mjs   (needs node_modules: yjs)
// JSON → Y.Doc → JSON is lossless for every block type of the editor, and two editors' concurrent
// edits on a seeded document merge into one document (no duplicated content).
// Compatibility with @tiptap/y-tiptap itself (the browser side) was checked in a harness on 12 Oct 2026:
// ours → yXmlFragmentToProseMirrorRootNode and prosemirrorJSONToYDoc → ours both give the same JSON.
import assert from "node:assert/strict"
import * as Y from "yjs"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
// collab-ydoc.ts imports "@/lib/blockdoc" for types only; strip-types erases it, but resolve it anyway.
const dir = mkdtempSync(path.join(tmpdir(), "ydoc-"))
writeFileSync(path.join(dir, "blockdoc.ts"), readFileSync(path.join(here, "blockdoc.ts")))
writeFileSync(path.join(dir, "collab-ydoc.ts"), readFileSync(path.join(here, "collab-ydoc.ts"), "utf8").replace('"@/lib/blockdoc"', '"./blockdoc.ts"').replace('from "yjs"', `from ${JSON.stringify(pathToFileURL(path.join(here, "../../node_modules/yjs/dist/yjs.mjs")).href)}`))
const { ydocFromJson, ydocToJson } = await import(pathToFileURL(path.join(dir, "collab-ydoc.ts")).href)
const { canonicalDoc, sanitizeDoc } = await import(pathToFileURL(path.join(dir, "blockdoc.ts")).href)

const P = (text, marks) => (text ? { type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] } : { type: "paragraph" })
const doc = sanitizeDoc({ type: "doc", content: [
  { type: "heading", attrs: { level: 2, blockId: "abc", blockColor: "red" }, content: [{ type: "text", text: "Agenda" }] },
  { type: "paragraph", content: [{ type: "text", text: "b", marks: [{ type: "bold" }] }, { type: "mention", attrs: { id: "u1", label: "Mira", kind: "user" } }, { type: "hardBreak" }, { type: "dateChip", attrs: { date: "2026-10-13", time: "09:30", remind: true, remindUserId: "u2" } }, { type: "text", text: "l", marks: [{ type: "link", attrs: { href: "https://z.id" } }] }] },
  P(""),
  { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [P("done")] }] },
  { type: "callout", attrs: { emoji: "🔥" }, content: [P("c")] },
  { type: "details", content: [{ type: "detailsSummary", content: [{ type: "text", text: "S" }] }, { type: "detailsContent", content: [P("x")] }] },
  { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [P("A")] }] }] },
  { type: "image", attrs: { src: "/api/files/a.png" } },
  { type: "bookmark", attrs: { url: "https://youtu.be/x", embed: true } },
] })

assert.equal(canonicalDoc(ydocToJson(ydocFromJson(doc))), canonicalDoc(doc))

// Two editors on the seeded state, concurrent inserts → both survive, nothing duplicated.
const server = ydocFromJson(doc)
const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(server))
const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(server))
const para = (s) => { const e = new Y.XmlElement("paragraph"); const t = new Y.XmlText(); t.insert(0, s); e.insert(0, [t]); return e }
a.getXmlFragment("default").insert(0, [para("from A")])
b.getXmlFragment("default").push([para("from B")])
for (const d of [a, b]) Y.applyUpdate(server, Y.encodeStateAsUpdate(d, Y.encodeStateVector(server)))
const merged = ydocToJson(server)
assert.equal(merged.content.length, doc.content.length + 2)
assert.equal(merged.content[0].content[0].text, "from A")
assert.equal(merged.content.at(-1).content[0].text, "from B")
console.log("collab-ydoc: ok")

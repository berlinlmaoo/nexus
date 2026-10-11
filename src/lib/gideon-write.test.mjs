// node --experimental-strip-types src/lib/gideon-write.test.mjs
import assert from "node:assert/strict"
import { parseActionItems, writePrompt } from "./gideon-write.ts"

const items = parseActionItems("- [ ] Send the deck to Rina (due: 2026-10-20, owner: Rina)\n- [ ] **Book the venue**\n- [ ] (none)\nnot an item\n1. Call the vendor")
assert.deepEqual(items, [
  { title: "Send the deck to Rina", due: "2026-10-20", owner: "Rina" },
  { title: "Book the venue", due: null, owner: null },
  { title: "Call the vendor", due: null, owner: null },
])
assert.equal(parseActionItems("- [ ] (none)").length, 0)
const p = writePrompt({ action: "translate", text: "Halo", language: "en" })
assert.match(p, /Translate the TEXT into natural English/)
assert.match(p, /Do NOT call any tools/)
assert.match(writePrompt({ action: "tone", text: "x", tone: "casual" }), /casual tone/)
console.log("gideon-write ok")

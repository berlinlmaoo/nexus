// node --experimental-strip-types src/components/forms/form-coedit.test.mjs   (from apps/web)
//
// Live form co-editing (A-12): diffOps sends only what changed; rebaseDraft keeps local edits and takes the
// rest from a newer server copy. A small copy of the server's op semantics (src/lib/form-ops.ts) checks that
// diff + apply round-trips, and two simulated editors converge.
import assert from "node:assert/strict"

const C = await import("./form-coedit.ts")
let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const q = (id, extra = {}) => ({ id, name: id.toUpperCase(), label: id.toUpperCase(), type: "text", required: false, ...extra })
const form = (over = {}) => ({ name: "F", description: "", fields: [q("a"), q("b"), q("c")], isPublic: true, requireAuth: true, accessSchedule: null, branding: { icon: "📝" }, settings: null, ...over })
const payload = (d) => ({ ...d, name: d.name.trim() || "Untitled form", description: d.description.trim() ? d.description : null })
const clone = (x) => structuredClone(x)

// Minimal server (same rules as src/lib/form-ops.ts applyFormOps).
function apply(state, ops) {
  const s = clone(state)
  const ins = (list, item, afterId) => { if (afterId === undefined) list.push(item); else if (afterId === null) list.unshift(item); else { const i = list.findIndex((f) => f.id === afterId); if (i < 0) list.push(item); else list.splice(i + 1, 0, item) } }
  const merge = (cur, patch) => { if (patch === null) return null; const o = { ...(cur ?? {}) }; for (const [k, v] of Object.entries(patch)) { if (v === null) delete o[k]; else o[k] = v } return Object.keys(o).length ? o : null }
  for (const op of ops) {
    if (op.op === "set_title") s.name = op.value.trim() ? op.value : "Untitled form"
    else if (op.op === "set_description") s.description = op.value && op.value.trim() ? op.value : ""
    else if (op.op === "set_settings") { for (const k of ["isPublic", "requireAuth", "accessSchedule"]) if (op[k] !== undefined) s[k] = op[k]; if (op.branding !== undefined) s.branding = merge(s.branding, op.branding); if (op.settings !== undefined) s.settings = merge(s.settings, op.settings) }
    else if (op.op === "add_question") { if (!s.fields.some((f) => f.id === op.question.id)) ins(s.fields, clone(op.question), op.afterId) }
    else if (op.op === "update_question") { const i = s.fields.findIndex((f) => f.id === op.id); if (i >= 0) { s.fields[i] = { ...s.fields[i], ...op.fields }; for (const k of op.unset ?? []) delete s.fields[i][k] } }
    else if (op.op === "move_question") { const i = s.fields.findIndex((f) => f.id === op.id); if (i >= 0 && (op.afterId === null || s.fields.some((f) => f.id === op.afterId))) { const [x] = s.fields.splice(i, 1); ins(s.fields, x, op.afterId) } }
    else if (op.op === "delete_question") s.fields = s.fields.filter((f) => f.id !== op.id)
  }
  return s
}
const roundTrip = (base, mine, msg) => { const ops = C.diffOps(payload(base), payload(mine)); eq(C.stable(apply(base, ops)), C.stable(mine), msg); return ops }

// 1. diff: nothing changed → no ops
eq(C.diffOps(payload(form()), payload(form())), [], "no change, no ops")

// 2. diff round trips
{
  const b = form()
  roundTrip(b, form({ name: "New title" }), "title")
  const ops = roundTrip(b, form({ fields: [q("a", { name: "Ay", label: "Ay" }), q("b"), q("c")] }), "one key")
  eq(ops, [{ op: "update_question", id: "a", fields: { name: "Ay", label: "Ay" } }], "only the changed keys travel")
  roundTrip(b, form({ fields: [q("b"), q("c"), q("a")] }), "move first to last")
  eq(C.diffOps(payload(b), payload(form({ fields: [q("b"), q("c"), q("a")] }))).length, 1, "a single drag is one move")
  roundTrip(b, form({ fields: [q("c"), q("a"), q("x"), q("b")] }), "move + add")
  roundTrip(b, form({ fields: [q("y"), q("c")] }), "deletes + add at top")
  roundTrip(b, form({ fields: [q("c"), q("b"), q("a")] }), "reverse")
  roundTrip(b, form({ fields: [q("a", { description: "d" }), q("b"), q("c")] }), "add a key")
  roundTrip(form({ fields: [q("a", { description: "d" })] }), form({ fields: [q("a")] }), "unset a key")
  roundTrip(b, form({ branding: { icon: "📝", cover: "preset:mint" }, settings: { submitLabel: "Kirim" }, isPublic: false }), "settings")
  roundTrip(b, form({ branding: null }), "clear branding")
  const s = C.diffOps(payload(b), payload(form({ branding: { cover: "preset:sky" } })))
  eq(s, [{ op: "set_settings", branding: { icon: null, cover: "preset:sky" } }], "branding goes key by key")
}

// 3. rebase: their change elsewhere is taken, mine stays
{
  const base = form()
  const mine = form({ fields: [q("a", { name: "typing…", label: "typing…" }), q("b"), q("c")] })
  const theirs = form({ name: "Their title", fields: [q("a"), q("b", { required: true }), q("c")] })
  const r = C.rebaseDraft(base, mine, theirs)
  eq(r.name, "Their title", "their title")
  eq(r.fields[0].name, "typing…", "my typing stays")
  eq(r.fields[1].required, true, "their question change")
}
// 4. rebase: same key — mine stays on screen (it goes out next: last writer wins)
{
  const base = form()
  const r = C.rebaseDraft(base, form({ fields: [q("a", { name: "mine" }), q("b"), q("c")] }), form({ fields: [q("a", { name: "theirs" }), q("b"), q("c")] }))
  eq(r.fields[0].name, "mine", "same key keeps local")
  const r2 = C.rebaseDraft(base, form(), form({ fields: [q("a", { name: "theirs" }), q("b"), q("c")] }))
  eq(r2.fields[0].name, "theirs", "untouched key takes theirs")
}
// 5. rebase: adds / deletes / order on both sides
{
  const base = form()
  const mine = form({ fields: [q("a"), q("m"), q("b")] }) // I added m, deleted c
  const theirs = form({ fields: [q("t"), q("a"), q("b"), q("c")] }) // they added t at the top
  eq(C.rebaseDraft(base, mine, theirs).fields.map((f) => f.id), ["t", "a", "m", "b"], "both adds, my delete")
  const theirsDel = form({ fields: [q("a"), q("c")] }) // they deleted b, which I edited
  eq(C.rebaseDraft(base, form({ fields: [q("a"), q("b", { required: true }), q("c")] }), theirsDel).fields.map((f) => f.id), ["a", "c"], "their delete wins")
  const iMoved = form({ fields: [q("c"), q("a"), q("b")] })
  const theyAdded = form({ fields: [q("a"), q("b"), q("x"), q("c")] })
  eq(C.rebaseDraft(base, iMoved, theyAdded).fields.map((f) => f.id), ["c", "a", "b", "x"], "my move + their add")
  const theyMoved = form({ fields: [q("b"), q("a"), q("c")] })
  eq(C.rebaseDraft(base, form(), theyMoved).fields.map((f) => f.id), ["b", "a", "c"], "their move")
}
// 6. settings objects merge per key
{
  const base = form({ settings: { submitLabel: "Send" } })
  const r = C.rebaseDraft(base, form({ settings: { submitLabel: "Send", confirmationTitle: "Thanks" } }), form({ settings: { submitLabel: "Kirim" } }))
  eq(r.settings, { submitLabel: "Kirim", confirmationTitle: "Thanks" }, "settings keys merge")
}
// 7. two editors converge through a server that applies batches in arrival order
{
  let server = form()
  const A = { base: clone(server), draft: clone(server) }
  const B = { base: clone(server), draft: clone(server) }
  A.draft.fields[0] = q("a", { name: "Ann's", label: "Ann's" })
  A.draft.name = "Ann title"
  B.draft.fields[2] = q("c", { required: true })
  B.draft.fields.push(q("z"))
  // B saves first, A second (A's save still diffs against its old base)
  const sendB = C.diffOps(payload(B.base), payload(B.draft)); server = apply(server, sendB)
  B.draft = C.rebaseDraft(B.base, B.draft, server); B.base = clone(server)
  const sendA = C.diffOps(payload(A.base), payload(A.draft)); server = apply(server, sendA)
  A.draft = C.rebaseDraft(A.base, A.draft, server); A.base = clone(server)
  // B hears A's event
  B.draft = C.rebaseDraft(B.base, B.draft, server); B.base = clone(server)
  eq(C.stable(A.draft), C.stable(server), "A shows the server")
  eq(C.stable(B.draft), C.stable(server), "B shows the server")
  eq(server.fields.map((f) => f.id), ["a", "b", "c", "z"], "every change landed")
  eq([server.name, server.fields[0].name, server.fields[2].required], ["Ann title", "Ann's", true], "both people's edits")
}
console.log(`form-coedit: ${n} checks passed`)

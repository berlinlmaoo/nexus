import { describe, expect, it } from "vitest"
import { applyFormOps, editStateOf, FormOpError, parseFormOps, type FormEditState, type FormOp } from "@/lib/form-ops"

const q = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), label: id.toUpperCase(), type: "text", required: false, ...extra })
const base = (): FormEditState => ({
  name: "Reimburse",
  description: null,
  fields: [q("a"), q("b"), q("c")],
  isPublic: true,
  requireAuth: true,
  accessSchedule: null,
  branding: { icon: "📝" },
  settings: { submitLabel: "Send" },
})
const ids = (s: FormEditState) => s.fields.map((f) => f.id)
const run = (s: FormEditState, ops: unknown[]) => applyFormOps(s, parseFormOps(ops))

describe("form ops: parse", () => {
  it("accepts every op kind", () => {
    const ops = parseFormOps([
      { op: "set_title", value: "x" },
      { op: "set_description", value: null },
      { op: "set_settings", isPublic: false, branding: { cover: null } },
      { op: "add_question", question: { id: "z" }, afterId: null },
      { op: "update_question", id: "a", fields: { required: true }, unset: ["description"] },
      { op: "move_question", id: "a", afterId: "b" },
      { op: "delete_question", id: "c" },
    ])
    expect(ops.map((o) => o.op)).toEqual(["set_title", "set_description", "set_settings", "add_question", "update_question", "move_question", "delete_question"])
  })

  it("refuses malformed ops with their index", () => {
    const bad: unknown[][] = [
      [{ op: "nope" }],
      [{ op: "set_title", value: 3 }],
      [{ op: "add_question", question: { name: "no id" } }],
      [{ op: "update_question", id: "a", fields: { id: "b" } }],
      [{ op: "update_question", id: "a", fields: {} }],
      [{ op: "move_question", id: "a" }],
      [{ op: "set_settings" }],
      [{ op: "set_settings", isPublic: "yes" }],
    ]
    for (const ops of bad) expect(() => parseFormOps(ops)).toThrow(FormOpError)
    expect(() => parseFormOps([])).toThrow(FormOpError)
    expect(() => parseFormOps(Array.from({ length: 201 }, () => ({ op: "set_title", value: "x" })))).toThrow(FormOpError)
    try { parseFormOps([{ op: "set_title", value: "ok" }, { op: "bad" }]) } catch (e) { expect((e as FormOpError).index).toBe(1) }
  })
})

describe("form ops: apply", () => {
  it("sets title, description and settings; empty title becomes the placeholder", () => {
    const r = run(base(), [
      { op: "set_title", value: "  " },
      { op: "set_description", value: "Hello" },
      { op: "set_settings", isPublic: false, branding: { cover: "preset:mint" }, settings: { submitLabel: null, confirmationTitle: "Thanks" } },
    ])
    expect(r.state.name).toBe("Untitled form")
    expect(r.state.description).toBe("Hello")
    expect(r.state.isPublic).toBe(false)
    expect(r.state.branding).toEqual({ icon: "📝", cover: "preset:mint" })
    expect(r.state.settings).toEqual({ confirmationTitle: "Thanks" })
    expect(r.changed).toBe(true)
  })

  it("adds after an anchor, first, last; an existing id is skipped (idempotent retry)", () => {
    let r = run(base(), [{ op: "add_question", question: q("x"), afterId: "a" }, { op: "add_question", question: q("y"), afterId: null }, { op: "add_question", question: q("z") }])
    expect(ids(r.state)).toEqual(["y", "a", "x", "b", "c", "z"])
    r = run(r.state, [{ op: "add_question", question: q("x", { name: "other" }), afterId: "c" }])
    expect(r.skipped).toEqual([{ index: 0, op: "add_question", reason: "EXISTS" }])
    expect(r.changed).toBe(false)
  })

  it("an add whose anchor is gone still lands, at the end", () => {
    const r = run(base(), [{ op: "add_question", question: q("x"), afterId: "gone" }])
    expect(ids(r.state)).toEqual(["a", "b", "c", "x"])
  })

  it("updates only the keys sent, unsets keys, never the id", () => {
    const s = base(); s.fields[0] = q("a", { description: "d", options: ["1"] })
    const r = run(s, [{ op: "update_question", id: "a", fields: { required: true }, unset: ["description"] }])
    expect(r.state.fields[0]).toEqual({ ...q("a", { options: ["1"] }), required: true })
  })

  it("moves (to first, after another) and skips unknown ids/anchors", () => {
    let r = run(base(), [{ op: "move_question", id: "c", afterId: null }])
    expect(ids(r.state)).toEqual(["c", "a", "b"])
    r = run(r.state, [{ op: "move_question", id: "c", afterId: "b" }])
    expect(ids(r.state)).toEqual(["a", "b", "c"])
    r = run(r.state, [{ op: "move_question", id: "zz", afterId: null }, { op: "move_question", id: "a", afterId: "zz" }, { op: "move_question", id: "a", afterId: "a" }])
    expect(r.skipped.map((x) => x.reason)).toEqual(["NOT_FOUND", "ANCHOR_NOT_FOUND", "ANCHOR_NOT_FOUND"])
    expect(r.changed).toBe(false)
  })

  it("delete wins over a later update of the same question, and a dangling condition is dropped", () => {
    const s = base(); s.fields[2] = q("c", { showIf: { fieldId: "b", operator: "equals", value: "x" } })
    const r = run(s, [{ op: "delete_question", id: "b" }, { op: "update_question", id: "b", fields: { required: true } }, { op: "delete_question", id: "b" }])
    expect(ids(r.state)).toEqual(["a", "c"])
    expect(r.state.fields[1].showIf).toBeNull()
    expect(r.skipped.map((x) => x.reason)).toEqual(["NOT_FOUND", "NOT_FOUND"])
  })

  it("does not mutate its input", () => {
    const s = base(); const before = JSON.stringify(s)
    run(s, [{ op: "delete_question", id: "a" }, { op: "update_question", id: "b", fields: { name: "B2" } }, { op: "set_title", value: "T" }])
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe("form ops: merging two editors (server applies batches one after the other)", () => {
  const serial = (start: FormEditState, ...batches: FormOp[][]) => batches.reduce((s, b) => applyFormOps(s, b).state, start)

  it("different questions: both land, in either order", () => {
    const A: FormOp[] = [{ op: "update_question", id: "a", fields: { name: "A by Ann", label: "A by Ann" } }]
    const B: FormOp[] = [{ op: "update_question", id: "c", fields: { required: true } }, { op: "add_question", question: q("n"), afterId: "b" }]
    const x = serial(base(), A, B), y = serial(base(), B, A)
    expect(x).toEqual(y)
    expect(x.fields.find((f) => f.id === "a")?.name).toBe("A by Ann")
    expect(x.fields.find((f) => f.id === "c")?.required).toBe(true)
    expect(ids(x)).toEqual(["a", "b", "n", "c"])
  })

  it("different keys of one question: both land", () => {
    const x = serial(base(), [{ op: "update_question", id: "b", fields: { name: "Bee", label: "Bee" } }], [{ op: "update_question", id: "b", fields: { required: true } }])
    expect(x.fields[1]).toMatchObject({ name: "Bee", required: true })
  })

  it("same key: the later batch wins (field-level last writer)", () => {
    const x = serial(base(), [{ op: "update_question", id: "b", fields: { name: "first" } }], [{ op: "update_question", id: "b", fields: { name: "second" } }])
    expect(x.fields[1].name).toBe("second")
  })

  it("title and settings vs questions: independent", () => {
    const x = serial(base(), [{ op: "set_title", value: "New" }], [{ op: "set_settings", settings: { submitLabel: "Kirim" } }], [{ op: "delete_question", id: "a" }])
    expect(x.name).toBe("New"); expect(x.settings).toEqual({ submitLabel: "Kirim" }); expect(ids(x)).toEqual(["b", "c"])
  })

  it("two people adding at the same anchor keep both questions", () => {
    const x = serial(base(), [{ op: "add_question", question: q("p"), afterId: "a" }], [{ op: "add_question", question: q("r"), afterId: "a" }])
    expect(ids(x)).toEqual(["a", "r", "p", "b", "c"])
  })
})

describe("form ops: stored rows", () => {
  it("reads any stored JSON safely", () => {
    const s = editStateOf({ name: "x", description: null, fields: [q("a"), "junk", null], isPublic: false, requireAuth: false, accessSchedule: "bad", branding: [], settings: null })
    expect(ids(s)).toEqual(["a"]); expect(s.accessSchedule).toBeNull(); expect(s.branding).toBeNull()
  })
})

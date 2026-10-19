/**
 * Live co-editing of forms (owner, 19 Oct 2026, QA A-12): the builder sends small OPERATIONS instead of the
 * whole form, the server applies them one request at a time under the form's row lock, and every applied
 * batch bumps `Form.version` and goes to the `form:<id>` room with the form as it now is.
 *
 * Merge rule: field level, last writer wins. Two people changing DIFFERENT things (the title and a question,
 * two questions, two keys of one question, two settings) both land. The same key of the same thing: the
 * later request wins; nobody gets a 409 for normal editing. A delete wins over a concurrent edit of the
 * deleted question (the edit is skipped, not an error).
 *
 * Every op is idempotent (a retry of the same batch changes nothing more): add_question of an id that
 * exists is skipped, delete of a missing id is skipped, set/move/update write the same value again.
 *
 * Pure: no database, no request. The route (lib/form-coedit-server.ts) loads the row under a lock, calls
 * applyFormOps and writes the result. The protocol for the native clients is in
 * ~/nexus-ops/qa-decisions-19oct.md, "A-12 live form co-editing — native contract".
 */
import { normalizeFormAccessSchedule } from "@/lib/form-access-schedule"
import { normalizeFormBranding, normalizeFormSettings } from "@/lib/form-settings"

export type FormQuestion = { id: string } & Record<string, unknown>

/** The parts of a form the builder edits (the columns ops can touch). */
export interface FormEditState {
  name: string
  description: string | null
  fields: FormQuestion[]
  isPublic: boolean
  requireAuth: boolean
  accessSchedule: Record<string, unknown> | null
  branding: Record<string, unknown> | null
  settings: Record<string, unknown> | null
}

export type FormOp =
  | { op: "set_title"; value: string }
  | { op: "set_description"; value: string | null }
  | {
      op: "set_settings"
      isPublic?: boolean
      requireAuth?: boolean
      accessSchedule?: Record<string, unknown> | null
      /** Merged key by key into the current branding: a key set to null is removed. null = clear all. */
      branding?: Record<string, unknown> | null
      /** Merged key by key into the current settings: a key set to null is removed. null = clear all. */
      settings?: Record<string, unknown> | null
    }
  | { op: "add_question"; question: FormQuestion; afterId?: string | null }
  | { op: "update_question"; id: string; fields: Record<string, unknown>; unset?: string[] }
  | { op: "move_question"; id: string; afterId: string | null }
  | { op: "delete_question"; id: string }

export const FORM_OP_KINDS = ["set_title", "set_description", "set_settings", "add_question", "update_question", "move_question", "delete_question"] as const

export const FORM_OPS_LIMITS = {
  /** Ops in one request. A drag or an undo is a handful; a pasted form a few dozen. */
  maxOps: 200,
  maxQuestions: 500,
  /** One question as JSON (label, options, logic, routing). */
  maxQuestionBytes: 64_000,
  maxTitle: 500,
  maxDescription: 20_000,
  maxIdLength: 100,
} as const

export type SkipReason = "NOT_FOUND" | "EXISTS" | "ANCHOR_NOT_FOUND" | "TOO_MANY_QUESTIONS"
export interface ApplyResult {
  state: FormEditState
  /** The ops that changed (or re-wrote) something, as applied — what the room hears. */
  applied: FormOp[]
  skipped: { index: number; op: FormOp["op"]; reason: SkipReason }[]
  changed: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= FORM_OPS_LIMITS.maxIdLength
const jsonSize = (v: unknown) => { try { return JSON.stringify(v)?.length ?? 0 } catch { return Infinity } }
/** Question keys that are not a plain property: `id` names the question and never changes. */
const RESERVED_KEYS = new Set(["id", "__proto__", "constructor", "prototype"])

export class FormOpError extends Error {
  constructor(public index: number, message: string) { super(message) }
}

/**
 * Checks the shape of a request's ops and returns them typed. Throws FormOpError (→ 400 INVALID_OP) on the
 * first malformed op; nothing is applied then.
 */
export function parseFormOps(raw: unknown): FormOp[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new FormOpError(-1, "ops must be a non-empty array")
  if (raw.length > FORM_OPS_LIMITS.maxOps) throw new FormOpError(-1, `at most ${FORM_OPS_LIMITS.maxOps} ops per request`)
  return raw.map((o, i): FormOp => {
    if (!isObj(o) || typeof o.op !== "string") throw new FormOpError(i, "op must be an object with an `op`")
    switch (o.op) {
      case "set_title":
        if (typeof o.value !== "string" || o.value.length > FORM_OPS_LIMITS.maxTitle) throw new FormOpError(i, "set_title.value must be a string")
        return { op: "set_title", value: o.value }
      case "set_description":
        if (!(o.value === null || typeof o.value === "string") || (typeof o.value === "string" && o.value.length > FORM_OPS_LIMITS.maxDescription)) throw new FormOpError(i, "set_description.value must be a string or null")
        return { op: "set_description", value: o.value as string | null }
      case "set_settings": {
        const out: FormOp & { op: "set_settings" } = { op: "set_settings" }
        if (o.isPublic !== undefined) { if (typeof o.isPublic !== "boolean") throw new FormOpError(i, "isPublic must be a boolean"); out.isPublic = o.isPublic }
        if (o.requireAuth !== undefined) { if (typeof o.requireAuth !== "boolean") throw new FormOpError(i, "requireAuth must be a boolean"); out.requireAuth = o.requireAuth }
        for (const k of ["accessSchedule", "branding", "settings"] as const) {
          if (o[k] === undefined) continue
          if (o[k] !== null && !isObj(o[k])) throw new FormOpError(i, `${k} must be an object or null`)
          if (jsonSize(o[k]) > 20_000) throw new FormOpError(i, `${k} is too large`)
          out[k] = o[k] as Record<string, unknown> | null
        }
        if (Object.keys(out).length === 1) throw new FormOpError(i, "set_settings changes nothing")
        return out
      }
      case "add_question": {
        if (!isObj(o.question) || !isId(o.question.id)) throw new FormOpError(i, "add_question.question needs a string id")
        if (jsonSize(o.question) > FORM_OPS_LIMITS.maxQuestionBytes) throw new FormOpError(i, "question is too large")
        if (!(o.afterId === undefined || o.afterId === null || isId(o.afterId))) throw new FormOpError(i, "afterId must be a question id or null")
        return { op: "add_question", question: o.question as FormQuestion, ...(o.afterId !== undefined ? { afterId: o.afterId as string | null } : {}) }
      }
      case "update_question": {
        if (!isId(o.id)) throw new FormOpError(i, "update_question.id must be a question id")
        const fields = o.fields === undefined ? {} : o.fields
        if (!isObj(fields)) throw new FormOpError(i, "update_question.fields must be an object")
        const unset = o.unset === undefined ? [] : o.unset
        if (!Array.isArray(unset) || unset.some((k) => typeof k !== "string")) throw new FormOpError(i, "update_question.unset must be a list of keys")
        if (Object.keys(fields).some((k) => RESERVED_KEYS.has(k)) || (unset as string[]).some((k) => RESERVED_KEYS.has(k))) throw new FormOpError(i, "a question's id cannot be changed")
        if (Object.keys(fields).length === 0 && unset.length === 0) throw new FormOpError(i, "update_question changes nothing")
        if (jsonSize(fields) > FORM_OPS_LIMITS.maxQuestionBytes) throw new FormOpError(i, "fields are too large")
        return { op: "update_question", id: o.id, fields, ...(unset.length ? { unset: unset as string[] } : {}) }
      }
      case "move_question":
        if (!isId(o.id) || !(o.afterId === null || isId(o.afterId))) throw new FormOpError(i, "move_question needs id and afterId (a question id or null for first)")
        return { op: "move_question", id: o.id, afterId: o.afterId as string | null }
      case "delete_question":
        if (!isId(o.id)) throw new FormOpError(i, "delete_question.id must be a question id")
        return { op: "delete_question", id: o.id }
      default:
        throw new FormOpError(i, `unknown op "${String(o.op)}"`)
    }
  })
}

/** Stored JSON (any shape a released app wrote) → the edit state. Questions without an id are kept as they are. */
export function editStateOf(row: { name: string; description: string | null; fields: unknown; isPublic: boolean; requireAuth: boolean; accessSchedule: unknown; branding: unknown; settings: unknown }): FormEditState {
  return {
    name: row.name,
    description: row.description,
    fields: Array.isArray(row.fields) ? (row.fields.filter(isObj) as FormQuestion[]) : [],
    isPublic: row.isPublic,
    requireAuth: row.requireAuth,
    accessSchedule: isObj(row.accessSchedule) ? row.accessSchedule : null,
    branding: isObj(row.branding) ? row.branding : null,
    settings: isObj(row.settings) ? row.settings : null,
  }
}

function mergePatch(current: Record<string, unknown> | null, patch: Record<string, unknown> | null): Record<string, unknown> | null {
  if (patch === null) return null
  const next: Record<string, unknown> = { ...(current ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (RESERVED_KEYS.has(k)) continue
    if (v === null || v === undefined) delete next[k]
    else next[k] = v
  }
  return Object.keys(next).length ? next : null
}

function insertAfter(list: FormQuestion[], q: FormQuestion, afterId: string | null | undefined): boolean {
  if (afterId === undefined) { list.push(q); return true }
  if (afterId === null) { list.unshift(q); return true }
  const at = list.findIndex((f) => f.id === afterId)
  if (at < 0) return false
  list.splice(at + 1, 0, q)
  return true
}

/**
 * A question's "Show only when" pointing at a question that no longer exists would hide it forever (the
 * respondent can never answer a missing question): such a condition is dropped. Happens when one person
 * deletes a question while another makes a question depend on it.
 */
function dropDanglingConditions(fields: FormQuestion[]): FormQuestion[] {
  const ids = new Set(fields.map((f) => f.id))
  return fields.map((f) => {
    const cond = f.showIf
    if (isObj(cond) && typeof cond.fieldId === "string" && !ids.has(cond.fieldId)) return { ...f, showIf: null }
    return f
  })
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Applies the ops in order. Never throws for a conflict: an op that cannot apply is reported in `skipped`. */
export function applyFormOps(start: FormEditState, ops: FormOp[]): ApplyResult {
  const s: FormEditState = { ...start, fields: [...start.fields] }
  const applied: FormOp[] = []
  const skipped: ApplyResult["skipped"] = []
  const skip = (index: number, op: FormOp, reason: SkipReason) => skipped.push({ index, op: op.op, reason })

  ops.forEach((op, index) => {
    switch (op.op) {
      case "set_title": {
        // An empty title would leave a nameless row in every list; the clients show their placeholder.
        const value = op.value.trim() ? op.value : "Untitled form"
        s.name = value
        applied.push({ op: "set_title", value })
        return
      }
      case "set_description": {
        const value = op.value && op.value.trim() ? op.value : null
        s.description = value
        applied.push({ op: "set_description", value })
        return
      }
      case "set_settings": {
        if (op.isPublic !== undefined) s.isPublic = op.isPublic
        if (op.requireAuth !== undefined) s.requireAuth = op.requireAuth
        if (op.accessSchedule !== undefined) s.accessSchedule = (normalizeFormAccessSchedule(op.accessSchedule) as unknown as Record<string, unknown> | null) ?? null
        if (op.branding !== undefined) s.branding = (normalizeFormBranding(mergePatch(s.branding, op.branding)) as Record<string, unknown> | null) ?? null
        if (op.settings !== undefined) s.settings = (normalizeFormSettings(mergePatch(s.settings, op.settings)) as Record<string, unknown> | null) ?? null
        applied.push(op)
        return
      }
      case "add_question": {
        if (s.fields.some((f) => f.id === op.question.id)) return skip(index, op, "EXISTS")
        if (s.fields.length >= FORM_OPS_LIMITS.maxQuestions) return skip(index, op, "TOO_MANY_QUESTIONS")
        const q = { ...op.question }
        // The anchor was deleted meanwhile: the question still lands (at the end) rather than being lost.
        if (!insertAfter(s.fields, q, op.afterId)) s.fields.push(q)
        applied.push(op)
        return
      }
      case "update_question": {
        const at = s.fields.findIndex((f) => f.id === op.id)
        if (at < 0) return skip(index, op, "NOT_FOUND")
        const next: FormQuestion = { ...s.fields[at] }
        for (const [k, v] of Object.entries(op.fields)) if (!RESERVED_KEYS.has(k)) next[k] = v
        for (const k of op.unset ?? []) if (!RESERVED_KEYS.has(k)) delete next[k]
        s.fields[at] = next
        applied.push(op)
        return
      }
      case "move_question": {
        const at = s.fields.findIndex((f) => f.id === op.id)
        if (at < 0) return skip(index, op, "NOT_FOUND")
        if (op.afterId === op.id) return skip(index, op, "ANCHOR_NOT_FOUND")
        if (op.afterId !== null && !s.fields.some((f) => f.id === op.afterId)) return skip(index, op, "ANCHOR_NOT_FOUND")
        const [q] = s.fields.splice(at, 1)
        insertAfter(s.fields, q, op.afterId)
        applied.push(op)
        return
      }
      case "delete_question": {
        const at = s.fields.findIndex((f) => f.id === op.id)
        if (at < 0) return skip(index, op, "NOT_FOUND")
        s.fields.splice(at, 1)
        applied.push(op)
        return
      }
    }
  })

  s.fields = dropDanglingConditions(s.fields)
  const changed = !same(s, start)
  return { state: s, applied, skipped, changed }
}

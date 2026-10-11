/**
 * Pure parts of AI Autofill (prompt, reading the answer, checking a value against the field) — no I/O,
 * unit-tested in gideon-autofill.test.mjs.
 */
export type AutofillField = {
  id: string
  name: string
  type: "TEXT" | "URL" | "NUMBER" | "SELECT" | "MULTI_SELECT" | "STATUS" | "DATE" | string
  options: string[]
  mode: "summary" | "classify" | "extract"
  prompt: string | null
}
export type AutofillTask = {
  id: string; title: string; description: string; status: string; priority: string; due: string | null; section: string; assignees: string[]; fields: Record<string, string>
}

function shape(f: AutofillField): string {
  switch (f.type) {
    case "SELECT": case "STATUS": return `exactly one of ${JSON.stringify(f.options)} (or null)`
    case "MULTI_SELECT": return `an array with any of ${JSON.stringify(f.options)} (or null)`
    case "NUMBER": return "a number (or null)"
    case "DATE": return "a date \"YYYY-MM-DD\" (or null)"
    case "URL": return "a full URL starting with https:// (or null)"
    default: return f.mode === "summary" ? "a short summary, at most 2 sentences / 240 characters (or null)" : "a short text (or null)"
  }
}

function goal(f: AutofillField): string {
  if (f.prompt?.trim()) return f.prompt.trim()
  if (f.mode === "classify") return `Classify the task into the best-fitting option of "${f.name}".`
  if (f.mode === "extract") return `Extract the value of "${f.name}" from the task's title and description.`
  return `Summarise the task for the "${f.name}" field.`
}

export function autofillPrompt(projectName: string, fields: AutofillField[], tasks: AutofillTask[]): string {
  return [
    `You are GIDEON filling custom fields of tasks in the NEXUS project "${projectName}". Do NOT call any tools: everything you may use is below. Never invent facts — when a task does not say, use null.`,
    "Write text values in the same language as the task (Indonesian stays Indonesian).",
    "FIELDS:",
    ...fields.map((f) => `- id "${f.id}" · "${f.name}" (${f.type}): ${goal(f)} Value: ${shape(f)}.`),
    "TASKS (JSON):",
    JSON.stringify(tasks),
    `Answer with ONLY one JSON object, no code fence, no other text: { "<taskId>": { "<fieldId>": value, ... }, ... } — one entry per task above.`,
  ].join("\n")
}

/** The first {...} object in a reply (tolerates a code fence or a stray sentence around it). */
export function extractJsonObject(reply: string): Record<string, unknown> | null {
  const text = (reply || "").replace(/```(?:json)?/gi, "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A model value checked against the field. null = leave the field alone. */
export function coerceAutofillValue(f: AutofillField, raw: unknown): string | number | string[] | null {
  if (raw === null || raw === undefined) return null
  const pick = (s: string) => f.options.find((o) => o.toLowerCase() === s.trim().toLowerCase()) ?? null
  switch (f.type) {
    case "SELECT":
    case "STATUS":
      return typeof raw === "string" ? pick(raw) : null
    case "MULTI_SELECT": {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []
      const out = [...new Set(list.map((x) => (typeof x === "string" ? pick(x) : null)).filter((x): x is string => Boolean(x)))]
      return out.length ? out : null
    }
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."))
      return Number.isFinite(n) ? n : null
    }
    case "DATE":
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) && !Number.isNaN(Date.parse(raw.trim())) ? raw.trim() : null
    case "URL":
      return typeof raw === "string" && /^https?:\/\/\S+$/i.test(raw.trim()) ? raw.trim().slice(0, 2000) : null
    default: {
      if (typeof raw !== "string" && typeof raw !== "number") return null
      const s = String(raw).replace(/\s+/g, " ").trim()
      return s ? s.slice(0, f.mode === "summary" ? 400 : 1000) : null
    }
  }
}

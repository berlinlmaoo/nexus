import { AlignLeft, AtSign, Calendar, CheckSquare, CircleDot, Hash, Link2, ListChecks, Paperclip, Phone, Type, Wallet } from "lucide-react";
import type { NexusFormBranding, NexusFormField } from "@/lib/nexus-api";

/**
 * The form model shared by the builder (FormStudio), the respondent page (/f/:id) and its preview.
 * The stored field JSON is unchanged — the released iOS/Android apps read the same objects — so a
 * "question kind" here is a builder-side view over `type` + `numberFormat`.
 */

export type FCond = { fieldId: string; operator: string; value: string };
export type FRule = { id: string; operator: string; value: string; action: string; targetTaskListId?: string; targetUserId?: string; targetUserIds?: string[]; targetCustomFieldId?: string; targetValue?: string };
export type FMapping = { target?: string; customFieldId?: string };
export type RichField = NexusFormField & {
  name?: string;
  showIf?: FCond | null;
  routingRules?: FRule[];
  mapping?: FMapping | null;
  attachmentEnabled?: boolean;
  autofill?: "name" | "email";
  numberFormat?: "currency-idr";
};

/** A question kind in the type menu. `rupiah` is a number question with the Rupiah format. */
export type QuestionKind = "text" | "textarea" | "dropdown" | "multi_select" | "checkbox" | "number" | "rupiah" | "date" | "email" | "phone" | "url" | "file";

export const QUESTION_KINDS: { kind: QuestionKind; label: string; hint: string; icon: typeof Type; group: "basic" | "specific"; keywords: string }[] = [
  { kind: "text", label: "Short answer", hint: "One line of text", icon: Type, group: "basic", keywords: "text short teks singkat" },
  { kind: "textarea", label: "Long answer", hint: "Several lines", icon: AlignLeft, group: "basic", keywords: "text long paragraph textarea panjang" },
  { kind: "dropdown", label: "Single choice", hint: "Pick one option", icon: CircleDot, group: "basic", keywords: "select dropdown radio pilihan satu" },
  { kind: "multi_select", label: "Multiple choice", hint: "Pick any number of options", icon: ListChecks, group: "basic", keywords: "multi checkbox pilihan ganda" },
  { kind: "checkbox", label: "Checkbox", hint: "A single yes / no tick", icon: CheckSquare, group: "basic", keywords: "check yes no centang" },
  { kind: "number", label: "Number", hint: "Digits only", icon: Hash, group: "specific", keywords: "number angka" },
  { kind: "rupiah", label: "Rupiah amount", hint: "Rp 1.500.000", icon: Wallet, group: "specific", keywords: "money currency idr rupiah harga uang" },
  { kind: "date", label: "Date", hint: "A day from a calendar", icon: Calendar, group: "specific", keywords: "date tanggal" },
  { kind: "email", label: "Email", hint: "name@company.com", icon: AtSign, group: "specific", keywords: "email mail surel" },
  { kind: "phone", label: "Phone", hint: "A phone number", icon: Phone, group: "specific", keywords: "phone telepon hp wa" },
  { kind: "url", label: "Link", hint: "A web address", icon: Link2, group: "specific", keywords: "url link tautan web" },
  { kind: "file", label: "File upload", hint: "One or more files", icon: Paperclip, group: "specific", keywords: "file upload attachment lampiran foto" },
];

export function kindOf(f: Pick<RichField, "type" | "numberFormat">): QuestionKind {
  if (f.type === "number" && f.numberFormat === "currency-idr") return "rupiah";
  if (f.type === "select") return "dropdown";
  return (QUESTION_KINDS.find((k) => k.kind === f.type)?.kind ?? "text") as QuestionKind;
}
export const kindMeta = (k: QuestionKind) => QUESTION_KINDS.find((x) => x.kind === k) ?? QUESTION_KINDS[0];
export const hasOptions = (f: Pick<RichField, "type">) => f.type === "dropdown" || f.type === "multi_select" || f.type === "select";

/** Turns a field into another kind, keeping what still applies (options, mapping, logic). */
export function withKind(f: RichField, kind: QuestionKind): RichField {
  const type = kind === "rupiah" ? "number" : kind;
  const next: RichField = { ...f, type };
  if (kind === "rupiah") next.numberFormat = "currency-idr";
  else delete next.numberFormat;
  if ((type === "dropdown" || type === "multi_select") && !Array.isArray(next.options)) next.options = optionsOf(f).length ? optionsOf(f) : [""];
  if (type !== "dropdown") delete next.display;
  if (type !== "text" && type !== "email") delete next.autofill;
  if (type === "file") delete next.attachmentEnabled;
  return next;
}

export function optionsOf(f: Pick<RichField, "options">): string[] {
  if (Array.isArray(f.options)) return f.options.map(String);
  if (f.options && typeof f.options === "object" && Array.isArray(f.options.choices)) return f.options.choices.map(String);
  return [];
}
export const fieldTitle = (f: Pick<RichField, "name" | "label">) => (f.name || f.label || "").trim();

let counter = 0;
export function newFieldId() {
  counter += 1;
  return `field_${Date.now()}_${counter}`;
}
export function newQuestion(kind: QuestionKind = "text"): RichField {
  return withKind({ id: newFieldId(), name: "", label: "", type: "text", required: false }, kind);
}

/** Client-side branching: mirrors submit/route.ts evaluateCondition. */
export function evalCond(cond: FCond | null | undefined, values: Record<string, unknown>): boolean {
  if (!cond) return true;
  const raw = values[cond.fieldId];
  const list = Array.isArray(raw) ? raw.map(String) : [raw == null ? "" : String(raw)];
  const joined = list.join(", ");
  const exp = String(cond.value ?? "");
  switch (cond.operator) {
    case "equals": return list.includes(exp);
    case "not_equals": return !list.includes(exp);
    case "contains": return joined.toLowerCase().includes(exp.toLowerCase());
    case "is_empty": return !joined;
    case "is_not_empty": return !!joined;
    default: return true;
  }
}
export function isFilled(v: unknown) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== "" && v !== false;
}

export const OPERATORS = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];
export const needsValue = (op: string) => op !== "is_empty" && op !== "is_not_empty";

export const MAPPING_TARGETS = [
  { value: "none", label: "Nothing (answer stays in the description)" },
  { value: "task_title", label: "Task title" },
  { value: "task_description", label: "Task description" },
  { value: "task_due_date", label: "Due date" },
  { value: "task_status", label: "Status" },
  { value: "task_priority", label: "Priority" },
  { value: "task_list", label: "Section" },
  { value: "custom_field", label: "A project field" },
];
export const ROUTING_ACTIONS = [
  { value: "assign_user", label: "Assign to" },
  { value: "set_field", label: "Set field" },
  { value: "set_task_list", label: "Move to section" },
];

/** Cover presets: drawn with CSS, nothing to upload. Stored as branding.cover = "preset:<key>". */
export const COVER_PRESETS: { key: string; label: string; css: string }[] = [
  { key: "paper", label: "Paper", css: "linear-gradient(135deg, #f4f1ea 0%, #e7e1d5 100%)" },
  { key: "mist", label: "Mist", css: "linear-gradient(135deg, #e8edf3 0%, #d5dee8 100%)" },
  { key: "lilac", label: "Lilac", css: "linear-gradient(135deg, #ece8fd 0%, #d9d1fb 100%)" },
  { key: "mint", label: "Mint", css: "linear-gradient(135deg, #e3f4ec 0%, #c9eadb 100%)" },
  { key: "peach", label: "Peach", css: "linear-gradient(135deg, #fdebe1 0%, #f9d3c0 100%)" },
  { key: "sky", label: "Sky", css: "linear-gradient(120deg, #8ec5fc 0%, #e0c3fc 100%)" },
  { key: "dusk", label: "Dusk", css: "linear-gradient(120deg, #5b4bc4 0%, #9d6bd6 55%, #e7a3b4 100%)" },
  { key: "forest", label: "Forest", css: "linear-gradient(120deg, #1f4e3d 0%, #3f7d5c 100%)" },
  { key: "ink", label: "Ink", css: "linear-gradient(120deg, #1d1f24 0%, #3a3e48 100%)" },
];
export function coverCss(cover: string | undefined | null): string | null {
  if (!cover) return null;
  if (cover.startsWith("preset:")) return COVER_PRESETS.find((p) => `preset:${p.key}` === cover)?.css ?? null;
  return `center / cover no-repeat url("${cover.replace(/"/g, "%22")}")`;
}

export const ICON_CHOICES = ["📝", "📋", "🧾", "💸", "💰", "🧮", "📦", "🛒", "🎟️", "📅", "🗓️", "⏰", "✈️", "🚗", "🏢", "🏠", "🎤", "🎬", "🎨", "📸", "🎧", "💡", "🛠️", "🧰", "📣", "📨", "📞", "🤝", "✅", "❓", "🔒", "⭐", "🔥", "🌱", "🍽️", "☕", "🎓", "🩺", "⚖️", "🧑‍💻"];

/** Draft form state the builder edits and autosaves. */
export type FormDraft = {
  name: string;
  description: string;
  fields: RichField[];
  isPublic: boolean;
  requireAuth: boolean;
  accessSchedule: Record<string, unknown> | null;
  branding: NexusFormBranding | null;
  settings: Record<string, unknown> | null;
};

/** A "Show only when…" the author hasn't finished ("is" with no value yet): not live, not saved. */
export const condIncomplete = (c: FCond | null | undefined) => !!c && needsValue(c.operator) && !String(c.value ?? "").trim();

/**
 * The fields as saved: option rows trimmed, blank rows dropped (the editor keeps one for typing), and an
 * unfinished condition left out, so switching on "Show only when…" never hides a question from the live
 * form before a value is picked (it used to save "is ''", which hides it as soon as the parent is answered).
 */
export function cleanFields(fields: RichField[]): RichField[] {
  return fields.map((f) => {
    let out = f;
    if (Array.isArray(f.options)) out = { ...out, options: (f.options as unknown[]).map(String).map((s) => s.trim()).filter(Boolean) };
    if (condIncomplete(f.showIf)) out = { ...out, showIf: null };
    return out;
  });
}

/**
 * The questions `self` may depend on ("Show only when…"): every other question except those already shown
 * only because of `self`, directly or down a chain. Picking one of those would make a loop where neither
 * question can ever show.
 */
export function logicParents(fields: RichField[], selfId: string): RichField[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const leadsTo = (startId: string) => {
    const seen = new Set<string>();
    let cur = byId.get(startId);
    while (cur?.showIf?.fieldId && !seen.has(cur.id)) {
      if (cur.showIf.fieldId === selfId) return true;
      seen.add(cur.id);
      cur = byId.get(cur.showIf.fieldId);
    }
    return false;
  };
  return fields.filter((f) => f.id !== selfId && !leadsTo(f.id));
}

/** A condition or routing value that no longer matches any option of the question it reads. */
export function staleOption(source: RichField | null | undefined, op: string | undefined, value: string | undefined): boolean {
  if (!source || !hasOptions(source) || !op || !needsValue(op) || op === "contains") return false;
  const v = String(value ?? "").trim();
  if (!v) return false;
  const opts = optionsOf(source).map((o) => o.trim()).filter(Boolean);
  return opts.length > 0 && !opts.includes(v);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Mirrors submit/route.ts: a link needs a host with a dot ("company.com", "https://x.co/a"), no spaces. */
export function looksLikeUrl(v: string) {
  if (/\s/.test(v)) return false;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    return (u.protocol === "http:" || u.protocol === "https:") && /\.[a-z]{2,}$/i.test(u.hostname);
  } catch { return false; }
}
/** Why a filled-in answer can't be right ("email" / "url"), or null. Empty answers are the required check's job. */
export function answerProblem(field: Pick<RichField, "type" | "autofill">, value: unknown): "email" | "url" | null {
  if (field.autofill || typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  if (field.type === "email" && !EMAIL_RE.test(v)) return "email";
  if (field.type === "url" && !looksLikeUrl(v)) return "url";
  return null;
}

/* ------------------------------------------------------------------ categories (13 Oct 2026) */

type SelectLike = { id: string; name: string; type?: string; options?: unknown };
const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();
const CATEGORY_NAME = /^(kategori|category)( \d+)?$/i;
/** A select custom field's options, whatever shape they were saved in. */
export function selectChoices(f: Pick<SelectLike, "options">): string[] {
  const o = f.options as unknown;
  if (!o) return [];
  if (Array.isArray(o)) return o.map(String);
  const obj = o as { options?: unknown[]; choices?: unknown[] };
  if (Array.isArray(obj.options)) return obj.options.map(String);
  if (Array.isArray(obj.choices)) return obj.choices.map(String);
  return [];
}
const isSelect = (f: SelectLike) => (f.type ?? "").toUpperCase() === "SELECT";
/** The project's category field: the select named Kategori / Category (made from the old category sections). */
export function projectCategoryField<T extends SelectLike>(customFields: T[]): T | null {
  return customFields.find((c) => isSelect(c) && CATEGORY_NAME.test(c.name)) ?? null;
}
/**
 * A one-answer question still sending its answer to "Section" whose options are categories, not the
 * project's sections (sections became statuses on 12 Oct 2026): the select field those options belong to.
 * Mirrors the server (src/lib/form-category.ts), which keeps these options on the live form and files the
 * answer in that field.
 */
export function categoryFieldForSectionQuestion<T extends SelectLike>(field: RichField, customFields: T[], taskLists: { name: string }[]): T | null {
  if (field.mapping?.target !== "task_list" || !(field.type === "dropdown" || field.type === "select")) return null;
  const opts = optionsOf(field).map((o) => o.trim()).filter(Boolean);
  const sections = new Set(taskLists.map((s) => lc(s.name)));
  if (opts.some((o) => sections.has(lc(o)))) return null;
  const selects = customFields.filter(isSelect).sort((a, b) => Number(CATEGORY_NAME.test(b.name)) - Number(CATEGORY_NAME.test(a.name)));
  if (!opts.length) return selects.find((c) => CATEGORY_NAME.test(c.name)) ?? null;
  return selects.find((c) => { const ch = new Set(selectChoices(c).map(lc)); return opts.every((o) => ch.has(lc(o))); }) ?? null;
}
/** True when every option of the question is a section name (what "Use these sections as options" writes). */
export function optionsAreSections(field: RichField, taskLists: { name: string }[]): boolean {
  const opts = optionsOf(field).map((o) => o.trim()).filter(Boolean);
  const sections = new Set(taskLists.map((s) => lc(s.name)));
  return opts.length > 0 && opts.every((o) => sections.has(lc(o)));
}
